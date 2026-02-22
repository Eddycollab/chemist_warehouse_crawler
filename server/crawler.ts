/**
 * Chemist Warehouse Price Crawler
 *
 * Uses playwright-extra + stealth plugin to bypass Cloudflare/bot detection.
 * Features: stealth mode, random delays, cookie persistence, random viewport.
 *
 * Fixed issues (2026-02-21):
 * - Updated category URLs to match CW's current URL structure
 * - Fixed pagination parameter: ?page=N (was ?pageNumber=N)
 * - Fixed RRP calculation: "$X.XX Off RRP" → originalPrice = currentPrice + discount
 * - Fixed wait strategy: waitForSelector instead of networkidle
 * - Fixed browser context lifecycle: each subcategory gets its own context
 * - Fixed product name extraction: link.textContent is the product name
 */

import {
  getAllProducts,
  updateProduct,
  addPriceHistory,
  createNotification,
  createProduct,
  createCrawlJob,
  updateCrawlJob,
  getCrawlerSettings,
  getCrawlTargetById,
} from "./db";
import * as cheerio from "cheerio";
import { notifyOwner } from "./_core/notification";
import type { Product } from "../drizzle/schema";
import path from "path";
import fs from "fs";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrawledProductData {
  name?: string;
  brand?: string;
  currentPrice?: number;
  originalPrice?: number;
  isOnSale?: boolean;
  discountPercent?: number;
  imageUrl?: string;
  sku?: string;
  url?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CRAWL_DELAY_MIN_MS = 1500;
const CRAWL_DELAY_MAX_MS = 4000;
const COOKIE_STORE_PATH = path.join(process.cwd(), ".crawl-cookies.json");

// ─── Crawl Stop Control & Progress ──────────────────────────────────────────

let _crawlStopped = false;
let _currentJobId: number | null = null;

// Progress tracking
interface CrawlProgress {
  currentCategory: string | null;
  currentCategoryLabel: string | null;
  completedCategories: number;
  totalCategories: number;
  isTestMode: boolean;
}

let _crawlProgress: CrawlProgress = {
  currentCategory: null,
  currentCategoryLabel: null,
  completedCategories: 0,
  totalCategories: 0,
  isTestMode: false,
};

/** Request the running crawl job to stop gracefully. */
export function stopCrawl(): { stopped: boolean; jobId: number | null } {
  if (_currentJobId !== null) {
    _crawlStopped = true;
    console.log(`[Crawler] Stop requested for job #${_currentJobId}`);
    return { stopped: true, jobId: _currentJobId };
  }
  return { stopped: false, jobId: null };
}

/** Returns true if a crawl is currently running. */
export function isCrawlRunning(): boolean {
  return _currentJobId !== null;
}

/** Returns current crawl progress. */
export function getCrawlProgress(): CrawlProgress & { running: boolean } {
  return { ..._crawlProgress, running: _currentJobId !== null };
}

// ─── Category URL mappings for Chemist Warehouse ─────────────────────────────
// URL format: https://www.chemistwarehouse.com.au/shop-online/{id}/{slug}?page={n}
// Verified on 2026-02-21

const CATEGORY_URLS: Record<string, { id: number; slug: string; label: string }[]> = {
  beauty_skincare: [
    { id: 665, slug: "skin-care", label: "Skincare" },
    { id: 648, slug: "cosmetics", label: "Cosmetics" },
    { id: 129, slug: "hair-care", label: "Hair Care" },
    { id: 259, slug: "personal-care", label: "Personal Care" },
  ],
  adult_health: [
    { id: 81, slug: "vitamins-supplements", label: "Vitamins & Supplements" },
    { id: 1255, slug: "sports-nutrition", label: "Sport & Fitness" },
  ],
  childrens_health: [
    { id: 20, slug: "baby-care", label: "Pregnancy & Baby" },
  ],
  vegan_health: [
    { id: 81, slug: "vitamins-supplements", label: "Vitamins & Supplements (Vegan)" },
  ],
  natural_soap: [
    { id: 259, slug: "personal-care", label: "Personal Care (Soaps)" },
  ],
  oral_care: [
    { id: 159, slug: "oral-care", label: "Oral Care" },
  ],
  medicines: [
    { id: 258, slug: "medicines", label: "Medicines" },
  ],
};

// ─── Utility Functions ────────────────────────────────────────────────────────

/** Random delay between min and max ms to mimic human browsing */
function sleep(min = CRAWL_DELAY_MIN_MS, max = CRAWL_DELAY_MAX_MS): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePrice(priceStr: string | undefined | null): number | undefined {
  if (!priceStr) return undefined;
  const cleaned = priceStr.replace(/[^0-9.]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? undefined : parsed;
}

function calculateDiscountPercent(original: number, current: number): number {
  if (original <= 0) return 0;
  return Math.round(((original - current) / original) * 10000) / 100;
}

function extractSkuFromUrl(url: string): string | undefined {
  const match = url.match(/\/buy\/(\d+)\//);
  return match ? match[1] : undefined;
}

/** Random viewport size to avoid fingerprinting */
function randomViewport() {
  const viewports = [
    { width: 1280, height: 800 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
  ];
  return viewports[Math.floor(Math.random() * viewports.length)];
}

/** Realistic user agents pool */
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
];

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── Cookie Persistence ───────────────────────────────────────────────────────

function loadCookies(): object[] {
  try {
    if (fs.existsSync(COOKIE_STORE_PATH)) {
      const data = fs.readFileSync(COOKIE_STORE_PATH, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // ignore
  }
  return [];
}

function saveCookies(cookies: object[]): void {
  try {
    fs.writeFileSync(COOKIE_STORE_PATH, JSON.stringify(cookies, null, 2));
  } catch {
    // ignore
  }
}

// ─── Playwright Stealth Browser Manager ──────────────────────────────────────

/**
 * Creates a fresh browser instance for each subcategory scrape.
 * Using a singleton browser caused context-closed errors when one subcategory
 * crashed the context — subsequent subcategories would fail on newPage().
 * By creating a new browser per subcategory, each scrape is fully isolated.
 */
async function createBrowser(): Promise<import("playwright").Browser> {
  const { chromium: playwrightChromium } = await import("playwright-extra");
  const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
  playwrightChromium.use(StealthPlugin());

  return playwrightChromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--lang=en-AU",
    ],
  });
}

// ─── Category Scraper ─────────────────────────────────────────────────────────

/**
 * Scrapes a single page of a category and returns discovered products.
 * Each call creates its own browser context to avoid context lifecycle issues.
 */
async function scrapeCategoryPage(
  categoryId: number,
  slug: string,
  maxPages = 3
): Promise<CrawledProductData[]> {
  // Each subcategory gets its own fresh browser + context for full isolation.
  // This prevents a crashed context from affecting subsequent subcategories.
  const browser = await createBrowser();
  const savedCookies = loadCookies();

  const context = await browser.newContext({
    userAgent: randomUserAgent(),
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
    viewport: randomViewport(),
    extraHTTPHeaders: {
      "Accept-Language": "en-AU,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
  });

  // Restore saved cookies if available
  if (savedCookies.length > 0) {
    try {
      await context.addCookies(savedCookies as Parameters<typeof context.addCookies>[0]);
      console.log(`[Crawler] Restored ${savedCookies.length} cookies`);
    } catch {
      // ignore invalid cookies
    }
  }

  const discoveredProducts: CrawledProductData[] = [];

  try {
    for (let page = 1; page <= maxPages; page++) {
      // CW pagination uses ?page=N (not ?pageNumber=N)
      const url = page === 1
        ? `https://www.chemistwarehouse.com.au/shop-online/${categoryId}/${slug}`
        : `https://www.chemistwarehouse.com.au/shop-online/${categoryId}/${slug}?page=${page}`;

      const pageObj = await context.newPage();

      // Override automation detection signals
      await pageObj.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, "languages", { get: () => ["en-AU", "en"] });
        // @ts-ignore
        window.chrome = { runtime: {} };
      });

      try {
        console.log(`[Crawler] Scraping: ${url}`);

        // Navigate and wait for DOM content (faster than networkidle)
        await pageObj.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

        // Accept cookie banner if present (non-blocking)
        await pageObj.click('#onetrust-accept-btn-handler').catch(() => {});

        // Wait for product links to appear - this is the key selector
        // CW renders product cards as <li> elements with <a href="/buy/..."> links
        const productLinksVisible = await pageObj.waitForSelector(
          'a[href*="/buy/"]',
          { timeout: 30000, state: "attached" }
        ).then(() => true).catch(() => false);

        if (!productLinksVisible) {
          console.warn(`[Crawler] No product links found on ${url} after 30s wait`);
          // Log page title to help diagnose
          const title = await pageObj.title().catch(() => "unknown");
          console.warn(`[Crawler] Page title: ${title}`);
          await pageObj.close();
          break;
        }

        // Simulate human scrolling to trigger lazy-loaded content
        await pageObj.evaluate(() => {
          window.scrollTo({ top: 400, behavior: "smooth" });
        });
        await sleep(500, 1000);
        await pageObj.evaluate(() => {
          window.scrollTo({ top: 900, behavior: "smooth" });
        });
        await sleep(300, 700);

        // Extract products from the page
        const products = await pageObj.evaluate(() => {
          const results: Array<{
            name: string;
            url: string;
            price: string;
            discountAmount: string;
            imageUrl: string;
          }> = [];

          // CW product cards: <li> containing <a href="/buy/...">ProductName</a>
          const productLinks = document.querySelectorAll('a[href*="/buy/"]');
          const seen = new Set<string>();

          productLinks.forEach((link) => {
            const href = (link as HTMLAnchorElement).href;
            if (!href || seen.has(href)) return;
            seen.add(href);

            // Product name is the link's text content directly
            const name = link.textContent?.trim() || "";
            if (!name) return;

            // The product card is the closest <li>
            const card = link.closest("li");
            if (!card) return;

            // Current price: <p class="text-colour-title-light headline-xl">$X.XX</p>
            let price = "";
            const priceEl = card.querySelector('p.text-colour-title-light.headline-xl');
            if (priceEl) {
              price = priceEl.textContent?.trim() || "";
            }
            // Fallback: find any <p> starting with $
            if (!price) {
              const allPs = Array.from(card.querySelectorAll("p"));
              const priceP = allPs.find(p => p.textContent?.trim().startsWith("$"));
              if (priceP) price = priceP.textContent?.trim() || "";
            }

            if (!price) return;

            // Discount amount: <p class="text-brand-red body-s-emphasis">$X.XX Off RRP</p>
            // Format: "$X.XX Off RRP" — originalPrice = currentPrice + discountAmount
            let discountAmount = "";
            const discountEl = card.querySelector('p.text-brand-red.body-s-emphasis');
            if (discountEl) {
              const discountText = discountEl.textContent?.trim() || "";
              // Match "$X.XX Off RRP" or "$X.XX Off EDLP"
              const match = discountText.match(/^\$([\d.]+)\s+Off/);
              if (match) {
                discountAmount = match[1];
              }
            }

            // Product image
            let imageUrl = "";
            const img = card.querySelector("img");
            if (img) {
              imageUrl = img.src || img.getAttribute("data-src") || "";
            }

            if (name && href && price) {
              results.push({ name, url: href, price, discountAmount, imageUrl });
            }
          });

          return results;
        });

        console.log(`[Crawler] Found ${products.length} products on page ${page} of ${slug}`);

        for (const p of products) {
          const currentPrice = parsePrice(p.price);
          if (!currentPrice) continue;

          // Calculate original price: currentPrice + discountAmount
          let origPrice: number | undefined;
          if (p.discountAmount) {
            const discount = parseFloat(p.discountAmount);
            if (!isNaN(discount) && discount > 0) {
              origPrice = Math.round((currentPrice + discount) * 100) / 100;
            }
          }

          const isOnSale = !!(origPrice && origPrice > currentPrice);
          const discountPercent = isOnSale ? calculateDiscountPercent(origPrice!, currentPrice) : undefined;

          discoveredProducts.push({
            name: p.name,
            url: p.url,
            currentPrice,
            originalPrice: origPrice,
            isOnSale,
            discountPercent,
            imageUrl: p.imageUrl || undefined,
            sku: extractSkuFromUrl(p.url),
          });
        }

        // Save cookies after successful page load
        const cookies = await context.cookies();
        if (cookies.length > 0) {
          saveCookies(cookies);
        }

        // Check if there are more pages
        // CW uses ?page=N format and has a "NEXT" link
        const hasNextPage = await pageObj.evaluate(() => {
          // Look for next page link
          const nextLink = document.querySelector('a[href*="?page="]');
          const nextBtn = document.querySelector('[aria-label="Go to next page"]');
          return !!(nextLink || nextBtn);
        }).catch(() => false);

        await pageObj.close();

        if (!hasNextPage || products.length === 0) {
          console.log(`[Crawler] No more pages for ${slug} (hasNextPage=${hasNextPage}, products=${products.length})`);
          break;
        }

        // Random delay between pages
        await sleep();

      } catch (err) {
        console.error(`[Crawler] Error on page ${page} of ${url}:`, err);
        await pageObj.close().catch(() => {});
        break;
      }
    }
  } finally {
    // Close context then browser to fully release all resources
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  return discoveredProducts;
}

// ─── Price Change Detection ───────────────────────────────────────────────────

async function detectAndNotifyPriceChange(
  product: Product,
  newData: CrawledProductData,
  settings: { priceDrop: number; priceIncrease: number; notifyOnSale: boolean }
): Promise<void> {
  const oldPrice = product.currentPrice ? parseFloat(String(product.currentPrice)) : null;
  const newPrice = newData.currentPrice;

  if (!newPrice) return;

  const wasOnSale = product.isOnSale;
  const isNowOnSale = newData.isOnSale ?? false;

  if (!wasOnSale && isNowOnSale && settings.notifyOnSale) {
    await createNotification({
      productId: product.id,
      type: "new_sale",
      title: `${product.name} 開始特價！`,
      message: `${product.name} 現在特價 $${newPrice}（原價 $${newData.originalPrice ?? oldPrice}），快來搶購！`,
      oldPrice: String(oldPrice ?? newData.originalPrice ?? newPrice),
      newPrice: String(newPrice),
      changePercent: String(newData.discountPercent ?? 0),
    });
  } else if (wasOnSale && !isNowOnSale) {
    await createNotification({
      productId: product.id,
      type: "sale_ended",
      title: `${product.name} 特價結束`,
      message: `${product.name} 特價已結束，現在售價 $${newPrice}。`,
      oldPrice: String(oldPrice ?? 0),
      newPrice: String(newPrice),
      changePercent: "0",
    });
  }

  if (oldPrice && Math.abs(oldPrice - newPrice) > 0.01) {
    const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;

    if (changePercent < 0 && Math.abs(changePercent) >= settings.priceDrop) {
      await createNotification({
        productId: product.id,
        type: "price_drop",
        title: `${product.name} 價格下降 ${Math.abs(changePercent).toFixed(1)}%！`,
        message: `${product.name} 價格從 $${oldPrice.toFixed(2)} 降至 $${newPrice.toFixed(2)}，節省 $${(oldPrice - newPrice).toFixed(2)}！`,
        oldPrice: String(oldPrice),
        newPrice: String(newPrice),
        changePercent: String(changePercent.toFixed(2)),
      });
    } else if (changePercent > 0 && changePercent >= settings.priceIncrease) {
      await createNotification({
        productId: product.id,
        type: "price_increase",
        title: `${product.name} 價格上漲 ${changePercent.toFixed(1)}%`,
        message: `${product.name} 價格從 $${oldPrice.toFixed(2)} 漲至 $${newPrice.toFixed(2)}。`,
        oldPrice: String(oldPrice),
        newPrice: String(newPrice),
        changePercent: String(changePercent.toFixed(2)),
      });
    }
  }
}

// ─── Main Crawl Function ──────────────────────────────────────────────────────

export async function runCrawl(options: {
  category?: string;
  jobType?: "scheduled" | "manual";
  productIds?: number[];
  discoverNew?: boolean;
  testMode?: boolean;
}): Promise<{ jobId: number; success: boolean; message: string }> {
  console.log("[Crawler] Starting crawl job...", options);

  const settingsRows = await getCrawlerSettings();
  const settingsMap: Record<string, string> = {};
  settingsRows.forEach((s) => (settingsMap[s.key] = s.value));

  const priceDrop = parseFloat(settingsMap["price_drop_threshold"] || "5");
  const priceIncrease = parseFloat(settingsMap["price_increase_threshold"] || "10");
  const notifyOnSale = settingsMap["notify_on_sale"] !== "false";

  const jobResult = await createCrawlJob({
    jobType: options.jobType || "manual",
    status: "running",
    category: (options.category as "beauty_skincare" | "adult_health" | "childrens_health" | "vegan_health" | "natural_soap" | "other" | "all") || "all",
    startedAt: new Date(),
  });

  const jobId = (jobResult as { insertId?: number })?.insertId || 0;
  // Register this job as the active job and reset stop flag
  _currentJobId = jobId;
  _crawlStopped = false;

  const isTestMode = options.testMode === true;

  // Determine target categories for progress tracking
  const targetCategoriesForProgress = options.category && options.category !== "all"
    ? [options.category]
    : Object.keys(CATEGORY_URLS);

  // Count total sub-categories
  const totalSubCats = isTestMode ? 1 : targetCategoriesForProgress.reduce(
    (sum, cat) => sum + (CATEGORY_URLS[cat]?.length || 0), 0
  );

  // Initialize progress
  _crawlProgress = {
    currentCategory: null,
    currentCategoryLabel: null,
    completedCategories: 0,
    totalCategories: totalSubCats,
    isTestMode,
  };

  let crawledCount = 0;
  let failedCount = 0;
  let newProductsCount = 0;

  try {
    // ── Phase 1: Discover new products from category pages ────────────────────────
    const shouldDiscover = options.discoverNew !== false; // default true
    const targetCategories = options.category && options.category !== "all"
      ? [options.category]
      : Object.keys(CATEGORY_URLS);

    if (shouldDiscover) {
      console.log("[Crawler] Phase 1: Discovering products from categories:", targetCategories);

      // Get existing product URLs to avoid duplicates
      const existingProducts = await getAllProducts({ isActive: true });
      const existingUrls = new Set(existingProducts.map((p) => p.url.toLowerCase()));

      let subCatsDone = 0;

      outerLoop:
      for (const cat of targetCategories) {
        if (_crawlStopped) {
          console.log("[Crawler] Stop flag detected, aborting category loop");
          break;
        }
        const categoryUrls = CATEGORY_URLS[cat] || [];

        for (const catInfo of categoryUrls) {
          if (_crawlStopped) {
            console.log("[Crawler] Stop flag detected, aborting sub-category loop");
            break;
          }

          // Update progress
          _crawlProgress.currentCategory = cat;
          _crawlProgress.currentCategoryLabel = catInfo.label;
          _crawlProgress.completedCategories = subCatsDone;

          try {
            // testMode: only 1 page, only first sub-category
            const maxPages = isTestMode ? 1 : 2;
            const discovered = await scrapeCategoryPage(catInfo.id, catInfo.slug, maxPages);
            subCatsDone++;
            _crawlProgress.completedCategories = subCatsDone;
            console.log(`[Crawler] Discovered ${discovered.length} products in ${catInfo.label}`);

            for (const product of discovered) {
              if (!product.url || !product.name || !product.currentPrice) continue;

              const normalizedUrl = product.url.toLowerCase();
              if (existingUrls.has(normalizedUrl)) {
                // Update existing product price
                const existing = existingProducts.find(
                  (p) => p.url.toLowerCase() === normalizedUrl
                );
                if (existing) {
                  await detectAndNotifyPriceChange(existing, product, {
                    priceDrop,
                    priceIncrease,
                    notifyOnSale,
                  });
                  await updateProduct(existing.id, {
                    currentPrice: String(product.currentPrice),
                    originalPrice: product.originalPrice ? String(product.originalPrice) : undefined,
                    isOnSale: product.isOnSale ?? false,
                    discountPercent: product.discountPercent ? String(product.discountPercent) : undefined,
                    imageUrl: product.imageUrl || existing.imageUrl,
                    lastCrawledAt: new Date(),
                  });
                  await addPriceHistory({
                    productId: existing.id,
                    price: String(product.currentPrice),
                    originalPrice: product.originalPrice ? String(product.originalPrice) : undefined,
                    isOnSale: product.isOnSale ?? false,
                    discountPercent: product.discountPercent ? String(product.discountPercent) : undefined,
                    crawledAt: new Date(),
                  });
                  crawledCount++;
                }
              } else {
                // Add new product
                await createProduct({
                  name: product.name,
                  brand: product.brand || null,
                  sku: product.sku || null,
                  url: product.url,
                  imageUrl: product.imageUrl || null,
                  category: cat as "beauty_skincare" | "adult_health" | "childrens_health" | "vegan_health" | "natural_soap" | "oral_care" | "medicines" | "other",
                  currentPrice: String(product.currentPrice),
                  originalPrice: product.originalPrice ? String(product.originalPrice) : null,
                  isOnSale: product.isOnSale ?? false,
                  discountPercent: product.discountPercent ? String(product.discountPercent) : null,
                  isActive: true,
                  lastCrawledAt: new Date(),
                });
                existingUrls.add(normalizedUrl);
                newProductsCount++;
                crawledCount++;
              }
            }

            // Random delay between categories
            await sleep();

            // testMode: stop after first sub-category
            if (isTestMode) break outerLoop;
          } catch (err) {
            console.error(`[Crawler] Error scraping category ${catInfo.label}:`, err);
            failedCount++;
            // testMode: stop even on error
            if (isTestMode) break outerLoop;
          }
        }
      }
    }

    // ── Phase 2: Update manually-added products ───────────────────────────────
    const manualProducts = await getAllProducts({
      category: options.category && options.category !== "all"
        ? (options.category as "beauty_skincare" | "adult_health" | "childrens_health" | "vegan_health" | "natural_soap" | "other")
        : undefined,
      isActive: true,
    });

    const productsToUpdate = options.productIds
      ? manualProducts.filter((p) => options.productIds!.includes(p.id))
      : manualProducts.filter((p) => !p.lastCrawledAt || new Date().getTime() - new Date(p.lastCrawledAt).getTime() > 3600000);

    if (productsToUpdate.length > 0 && !shouldDiscover) {
      console.log(`[Crawler] Phase 2: Updating ${productsToUpdate.length} existing products`);
      await updateCrawlJob(jobId, { totalProducts: productsToUpdate.length });
    }

  } catch (error) {
    console.error("[Crawler] Fatal error:", error);
    failedCount++;
  } finally {
    // Browser lifecycle is managed per-subcategory in scrapeCategoryPage().
    // Nothing to close here at the job level.
    _currentJobId = null;
    _crawlStopped = false;
    _crawlProgress = {
      currentCategory: null,
      currentCategoryLabel: null,
      completedCategories: 0,
      totalCategories: 0,
      isTestMode: false,
    };
  }

  const wasStopped = _crawlStopped;
  await updateCrawlJob(jobId, {
    status: wasStopped ? "stopped" : (failedCount > 0 && crawledCount === 0 ? "failed" : "completed"),
    crawledProducts: crawledCount,
    failedProducts: failedCount,
    completedAt: new Date(),
  });

  if (crawledCount > 0 || newProductsCount > 0) {
    try {
      await notifyOwner({
        title: `爬蟲任務完成`,
        content: `已完成爬取 ${crawledCount} 個產品（新增 ${newProductsCount} 個），${failedCount} 個失敗。`,
      });
    } catch {
      // non-critical
    }
  }

  const message = wasStopped
    ? `爬取已中止：已更新 ${crawledCount} 個，新增 ${newProductsCount} 個`
    : `爬取完成：更新 ${crawledCount} 個，新增 ${newProductsCount} 個，失敗 ${failedCount} 個`;
  console.log(`[Crawler] Job ${jobId} completed: ${message}`);

  return { jobId, success: crawledCount > 0 || newProductsCount > 0, message };
}

// ─── Custom Target Crawler ────────────────────────────────────────────────────

/**
 * Crawl a custom target website using cheerio (no browser needed).
 * Fetches pages using the target's pagination config, parses products with
 * the configured CSS selectors, and saves them to the database.
 */
export async function crawlCustomTarget(targetId: number): Promise<{
  jobId: number;
  success: boolean;
  message: string;
  crawledCount: number;
  newCount: number;
}> {
  const target = await getCrawlTargetById(targetId);
  if (!target) throw new Error("找不到目標網站");
  if (!target.isActive) throw new Error("目標網站未啟用");
  if (!target.productListSelector) throw new Error("尚未設定產品容器選擇器");

  const jobResult = await createCrawlJob({
    jobType: "manual",
    status: "running",
    category: "all",
    startedAt: new Date(),
  });
  const jobId = (jobResult as { insertId?: number })?.insertId || 0;

  let crawledCount = 0;
  let newCount = 0;
  let failedCount = 0;

  // Helper: extract clean price (handles WooCommerce ins/del structure)
  function extractCleanPrice($: ReturnType<typeof cheerio.load>, $priceEl: ReturnType<ReturnType<typeof cheerio.load>>): string {
    const insText = $priceEl.find("ins").first().text().trim();
    if (insText) {
      const m = insText.match(/(?:AU\$|\$|USD\$|NZ\$)?[\d,]+\.?\d*/i);
      return m ? m[0].replace(/,/g, "") : insText.split("\n")[0].trim();
    }
    const cloned = $priceEl.clone();
    cloned.find("del").remove();
    const remaining = cloned.text().trim();
    const priceMatch = remaining.match(/(?:AU\$|\$|USD\$|NZ\$)[\d,]+\.?\d*/i);
    if (priceMatch) return priceMatch[0];
    return remaining.split("\n")[0].trim();
  }

  try {
    const existingProducts = await getAllProducts({ isActive: true });
    const existingUrls = new Set(existingProducts.map((p) => p.url.toLowerCase()));

    const maxPages = target.maxPages || 10;
    const paginationParam = target.paginationParam || "page";

    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1
        ? target.baseUrl
        : `${target.baseUrl}${target.baseUrl.includes("?") ? "&" : "?"}${paginationParam}=${page}`;

      try {
        console.log(`[CustomCrawler] Fetching page ${page}: ${url}`);
        const res = await fetch(url, {
          headers: {
            "User-Agent": randomUserAgent(),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
          },
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) {
          console.warn(`[CustomCrawler] HTTP ${res.status} on page ${page}`);
          failedCount++;
          break;
        }
        const html = await res.text();
        const $ = cheerio.load(html);
        $("script, style, noscript, iframe").remove();

        const containers = $(target.productListSelector);
        if (containers.length === 0) {
          console.log(`[CustomCrawler] No containers found on page ${page}, stopping`);
          break;
        }

        let pageProductCount = 0;
        const seenLinks = new Set<string>();

        containers.each((_i, el) => {
          const $el = $(el);
          const name = target.productNameSelector
            ? $el.find(target.productNameSelector).first().text().trim()
            : $el.find("h2,h3,h4,.title,.name").first().text().trim();

          const $priceEl = target.productPriceSelector
            ? $el.find(target.productPriceSelector).first()
            : $el.find(".price,span[class*=price]").first();
          const priceText = extractCleanPrice($, $priceEl as ReturnType<ReturnType<typeof cheerio.load>>);

          const linkEl = target.productLinkSelector
            ? $el.find(target.productLinkSelector).first()
            : $el.find("a").first();
          let link = linkEl.attr("href") || "";
          // Resolve relative URLs
          if (link && !link.startsWith("http")) {
            try {
              link = new URL(link, target.baseUrl).href;
            } catch { /* ignore */ }
          }

          if (!name || !link || seenLinks.has(link)) return;
          seenLinks.add(link);

          const imgEl = target.productImageSelector
            ? $el.find(target.productImageSelector).first()
            : $el.find("img").first();
          const imageUrl = imgEl.attr("src") || imgEl.attr("data-src") || "";

          // Parse original price (for sale detection)
          let originalPriceText = "";
          if (target.productOriginalPriceSelector) {
            originalPriceText = $el.find(target.productOriginalPriceSelector).first().text().trim();
          } else {
            // WooCommerce: del tag = original price
            const delText = $priceEl.find("del").first().text().trim();
            if (delText) {
              const m = delText.match(/(?:AU\$|\$|USD\$|NZ\$)?[\d,]+\.?\d*/i);
              originalPriceText = m ? m[0].replace(/,/g, "") : "";
            }
          }

          const currentPrice = parsePrice(priceText);
          if (!currentPrice) return;

          const originalPrice = parsePrice(originalPriceText);
          const isOnSale = !!(originalPrice && originalPrice > currentPrice);
          const discountPercent = isOnSale ? calculateDiscountPercent(originalPrice!, currentPrice) : undefined;

          const normalizedUrl = link.toLowerCase();
          if (existingUrls.has(normalizedUrl)) {
            // Update existing product
            const existing = existingProducts.find((p) => p.url.toLowerCase() === normalizedUrl);
            if (existing) {
              updateProduct(existing.id, {
                currentPrice: String(currentPrice),
                originalPrice: originalPrice ? String(originalPrice) : undefined,
                isOnSale,
                discountPercent: discountPercent ? String(discountPercent) : undefined,
                imageUrl: imageUrl || existing.imageUrl,
                lastCrawledAt: new Date(),
              }).catch(console.error);
              addPriceHistory({
                productId: existing.id,
                price: String(currentPrice),
                originalPrice: originalPrice ? String(originalPrice) : undefined,
                isOnSale,
                discountPercent: discountPercent ? String(discountPercent) : undefined,
                crawledAt: new Date(),
              }).catch(console.error);
              crawledCount++;
              pageProductCount++;
            }
          } else {
            // Create new product
            createProduct({
              name,
              brand: null,
              sku: null,
              url: link,
              imageUrl: imageUrl || null,
              category: "other",
              currentPrice: String(currentPrice),
              originalPrice: originalPrice ? String(originalPrice) : null,
              isOnSale,
              discountPercent: discountPercent ? String(discountPercent) : null,
              isActive: true,
              lastCrawledAt: new Date(),
            }).catch(console.error);
            existingUrls.add(normalizedUrl);
            newCount++;
            crawledCount++;
            pageProductCount++;
          }
        });

        console.log(`[CustomCrawler] Page ${page}: found ${pageProductCount} products`);

        if (pageProductCount === 0) break;

        // Random delay between pages
        await sleep(1000, 2500);
      } catch (err) {
        console.error(`[CustomCrawler] Error on page ${page}:`, err);
        failedCount++;
        break;
      }
    }
  } catch (err) {
    console.error("[CustomCrawler] Fatal error:", err);
    failedCount++;
  }

  await updateCrawlJob(jobId, {
    status: failedCount > 0 && crawledCount === 0 ? "failed" : "completed",
    crawledProducts: crawledCount,
    failedProducts: failedCount,
    completedAt: new Date(),
  });

  if (crawledCount > 0) {
    notifyOwner({
      title: `自訂目標爬蟲完成：${target.name}`,
      content: `已爬取 ${crawledCount} 個產品（新增 ${newCount} 個）。`,
    }).catch(() => {});
  }

  const message = `爬取完成：更新 ${crawledCount - newCount} 個，新增 ${newCount} 個，失敗 ${failedCount} 頁`;
  return { jobId, success: crawledCount > 0, message, crawledCount, newCount };
}
