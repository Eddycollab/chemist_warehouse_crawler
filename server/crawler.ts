/**
 * Chemist Warehouse Price Crawler
 *
 * Uses Algolia API to fetch product data directly.
 * Algolia is CW's search/product API (public frontend key).
 * This approach is much faster and more reliable than browser-based scraping.
 *
 * Algolia Config (discovered 2026-02-22):
 *   App ID: 42NP1V2I98
 *   API Key: 3ce54af79eae81a18144a7aa7ee10ec2
 *   Index: prod_cwr-cw-au_products_en
 *   Filter: categoryKeys.en:"<category name>"
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

// ─── Algolia Config ───────────────────────────────────────────────────────────

const ALGOLIA_APP_ID = "42NP1V2I98";
const ALGOLIA_API_KEY = "3ce54af79eae81a18144a7aa7ee10ec2";
const ALGOLIA_INDEX = "prod_cwr-cw-au_products_en";
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`;

// ─── Constants ────────────────────────────────────────────────────────────────

const CRAWL_DELAY_MIN_MS = 500;
const CRAWL_DELAY_MAX_MS = 1500;

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

// ─── Category Algolia Filter Mappings ────────────────────────────────────────
// Maps our internal category keys to Algolia categoryKeys.en filter values
// Verified from CW website navigation 2026-02-22

const CATEGORY_ALGOLIA_FILTERS: Record<string, { label: string; algoliaCategory: string }[]> = {
  beauty_skincare: [
    { label: "Skincare", algoliaCategory: "Skincare" },
    { label: "Cosmetics", algoliaCategory: "Cosmetics" },
    { label: "Hair Care", algoliaCategory: "Hair Care" },
    { label: "Personal Care", algoliaCategory: "Personal Care" },
    { label: "Fragrances", algoliaCategory: "Fragrances" },
  ],
  adult_health: [
    { label: "Vitamins & Supplements", algoliaCategory: "Vitamins & Supplements" },
    { label: "Sports Nutrition", algoliaCategory: "Sports Nutrition" },
    { label: "Weight Management", algoliaCategory: "Weight Management" },
  ],
  childrens_health: [
    { label: "Baby & Kids", algoliaCategory: "Baby & Kids" },
    { label: "Pregnancy", algoliaCategory: "Pregnancy" },
  ],
  vegan_health: [
    { label: "Vitamins & Supplements", algoliaCategory: "Vitamins & Supplements" },
    { label: "Natural Health", algoliaCategory: "Natural Health" },
  ],
  natural_soap: [
    { label: "Personal Care", algoliaCategory: "Personal Care" },
    { label: "Natural Health", algoliaCategory: "Natural Health" },
  ],
  oral_care: [
    { label: "Oral Care", algoliaCategory: "Oral Care" },
  ],
  medicines: [
    { label: "Cold, Flu & Immunity", algoliaCategory: "Cold, Flu & Immunity" },
    { label: "Pain Relief", algoliaCategory: "Pain Relief" },
    { label: "Digestive Health", algoliaCategory: "Digestive Health" },
    { label: "Allergy", algoliaCategory: "Allergy" },
  ],
};

// ─── Utility Functions ────────────────────────────────────────────────────────

/** Random delay between min and max ms */
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

/** Realistic user agents pool */
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── Algolia API Product Fetcher ──────────────────────────────────────────────

interface AlgoliaHit {
  objectID: string;
  name?: { en?: string } | string;
  slug?: { en?: string } | string;
  images?: string[];
  calculatedPrice?: number;
  prices?: {
    AUD?: {
      priceValues?: Array<{
        customFields?: {
          rrp?: { centAmount?: number };
        };
      }>;
    };
  };
  attributes?: {
    "PIMS_percentage_discount"?: number;
    "cwr-algolia-price"?: number | string;
    "cwr-brand"?: { label?: { en?: string } };
    "cwr-product-flags"?: string[];
    "cwr-epid"?: number;
    [key: string]: unknown;
  };
  sku?: string;
  productID?: string;
}

/**
 * Fetch products from Algolia API for a given category filter.
 * Returns all products across all pages.
 */
async function fetchAlgoliaProducts(
  algoliaCategory: string,
  maxPages = 10
): Promise<CrawledProductData[]> {
  const results: CrawledProductData[] = [];
  const hitsPerPage = 100; // max per page

  for (let page = 0; page < maxPages; page++) {
    if (_crawlStopped) break;

    const filterStr = `categoryKeys.en:"${algoliaCategory}"`;
    const params = [
      `hitsPerPage=${hitsPerPage}`,
      `page=${page}`,
      `filters=${encodeURIComponent(filterStr)}`,
      `attributesToRetrieve=objectID,name,slug,images,calculatedPrice,prices,attributes,sku,productID`,
      `attributesToHighlight=[]`,
    ].join("&");

    const payload = {
      requests: [{ indexName: ALGOLIA_INDEX, params }],
    };

    const queryParams = new URLSearchParams({
      "x-algolia-agent": "Algolia for JavaScript (4.23.3); Browser (lite)",
      "x-algolia-api-key": ALGOLIA_API_KEY,
      "x-algolia-application-id": ALGOLIA_APP_ID,
    });

    try {
      const res = await fetch(`${ALGOLIA_URL}?${queryParams}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "https://www.chemistwarehouse.com.au",
          "Referer": "https://www.chemistwarehouse.com.au/",
          "User-Agent": randomUserAgent(),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        console.error(`[Algolia] HTTP ${res.status} for category "${algoliaCategory}" page ${page}`);
        break;
      }

      const data = await res.json() as { results?: Array<{ hits?: AlgoliaHit[]; nbHits?: number; nbPages?: number }> };
      const algoliaResult = data.results?.[0];

      if (!algoliaResult) break;

      const hits = algoliaResult.hits || [];
      const totalPages = algoliaResult.nbPages || 1;

      console.log(`[Algolia] Category "${algoliaCategory}" page ${page + 1}/${totalPages}: ${hits.length} products (total: ${algoliaResult.nbHits})`);

      for (const hit of hits) {
        const product = parseAlgoliaHit(hit);
        if (product) results.push(product);
      }

      // Stop if we've fetched all pages
      if (page >= totalPages - 1 || hits.length === 0) break;

      // Small delay between pages
      await sleep(200, 500);

    } catch (err) {
      console.error(`[Algolia] Error fetching category "${algoliaCategory}" page ${page}:`, err);
      break;
    }
  }

  return results;
}

/**
 * Parse a single Algolia hit into CrawledProductData.
 */
function parseAlgoliaHit(hit: AlgoliaHit): CrawledProductData | null {
  // Get product name
  const nameRaw = hit.name;
  const name = typeof nameRaw === "object" ? nameRaw?.en : nameRaw;
  if (!name) return null;

  // Get slug for URL construction
  const slugRaw = hit.slug;
  const slug = typeof slugRaw === "object" ? slugRaw?.en : slugRaw;

  // Construct product URL
  const epid = hit.attributes?.["cwr-epid"];
  let url: string;
  if (slug) {
    url = `https://www.chemistwarehouse.com.au/buy/${slug}`;
  } else if (epid) {
    url = `https://www.chemistwarehouse.com.au/buy/${epid}`;
  } else {
    return null; // Can't construct URL
  }

  // Get current price (in cents, divide by 100)
  const algoliaPrice = hit.attributes?.["cwr-algolia-price"];
  const calculatedPrice = hit.calculatedPrice;
  const priceCents = typeof algoliaPrice === "number" ? algoliaPrice
    : typeof algoliaPrice === "string" ? parseInt(algoliaPrice, 10)
    : typeof calculatedPrice === "number" ? calculatedPrice
    : null;

  if (!priceCents || isNaN(priceCents)) return null;
  const currentPrice = priceCents / 100;

  // Get original price (RRP) from prices object
  let originalPrice: number | undefined;
  const rrpCents = hit.prices?.AUD?.priceValues?.[0]?.customFields?.rrp?.centAmount;
  if (rrpCents && rrpCents > priceCents) {
    originalPrice = rrpCents / 100;
  }

  // Get discount percent
  const discountPct = hit.attributes?.["PIMS_percentage_discount"];
  let discountPercent: number | undefined;
  if (discountPct && discountPct > 0) {
    discountPercent = discountPct;
    // If no original price from RRP, calculate from discount
    if (!originalPrice && discountPct < 100) {
      originalPrice = Math.round((currentPrice / (1 - discountPct / 100)) * 100) / 100;
    }
  }

  const isOnSale = !!(originalPrice && originalPrice > currentPrice);

  // Get brand
  const brand = hit.attributes?.["cwr-brand"]?.label?.en;

  // Get first image
  const imageUrl = hit.images?.[0] || undefined;

  // Get SKU
  const sku = hit.sku || (epid ? String(epid) : undefined);

  return {
    name,
    brand: brand || undefined,
    currentPrice,
    originalPrice,
    isOnSale,
    discountPercent,
    imageUrl,
    sku,
    url,
  };
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
      message: `${product.name} 現在特價 $${newPrice.toFixed(2)}（原價 $${(newData.originalPrice ?? oldPrice ?? newPrice).toFixed(2)}），快來搶購！`,
      oldPrice: String(oldPrice ?? newData.originalPrice ?? newPrice),
      newPrice: String(newPrice),
      changePercent: String(newData.discountPercent ?? 0),
    });
  } else if (wasOnSale && !isNowOnSale) {
    await createNotification({
      productId: product.id,
      type: "sale_ended",
      title: `${product.name} 特價結束`,
      message: `${product.name} 特價已結束，現在售價 $${newPrice.toFixed(2)}。`,
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

  const jobId = (Array.isArray(jobResult) ? (jobResult[0] as { insertId?: number })?.insertId : (jobResult as { insertId?: number })?.insertId) || 0;
  _currentJobId = jobId;
  _crawlStopped = false;

  const isTestMode = options.testMode === true;

  // Determine target categories
  const targetCategories = options.category && options.category !== "all"
    ? [options.category]
    : Object.keys(CATEGORY_ALGOLIA_FILTERS);

  // Count total sub-categories for progress
  const totalSubCats = isTestMode ? 1 : targetCategories.reduce(
    (sum, cat) => sum + (CATEGORY_ALGOLIA_FILTERS[cat]?.length || 0), 0
  );

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
    const shouldDiscover = options.discoverNew !== false;

    if (shouldDiscover) {
      console.log("[Crawler] Phase 1: Discovering products via Algolia API:", targetCategories);

      const existingProducts = await getAllProducts({ isActive: true });
      const existingUrls = new Set(existingProducts.map((p) => p.url.toLowerCase()));

      let subCatsDone = 0;

      outerLoop:
      for (const cat of targetCategories) {
        if (_crawlStopped) break;
        const categoryFilters = CATEGORY_ALGOLIA_FILTERS[cat] || [];

        for (const catInfo of categoryFilters) {
          if (_crawlStopped) break;

          _crawlProgress.currentCategory = cat;
          _crawlProgress.currentCategoryLabel = catInfo.label;
          _crawlProgress.completedCategories = subCatsDone;

          try {
            const maxPages = isTestMode ? 1 : 10;
            console.log(`[Crawler] Fetching Algolia category: ${catInfo.algoliaCategory}`);
            const discovered = await fetchAlgoliaProducts(catInfo.algoliaCategory, maxPages);
            subCatsDone++;
            _crawlProgress.completedCategories = subCatsDone;
            console.log(`[Crawler] Discovered ${discovered.length} products in ${catInfo.label}`);

            for (const product of discovered) {
              if (!product.url || !product.name || !product.currentPrice) continue;

              const normalizedUrl = product.url.toLowerCase();
              if (existingUrls.has(normalizedUrl)) {
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

            // Small delay between categories
            await sleep();

            if (isTestMode) break outerLoop;
          } catch (err) {
            console.error(`[Crawler] Error fetching category ${catInfo.label}:`, err);
            failedCount++;
            if (isTestMode) break outerLoop;
          }
        }
      }
    }

  } catch (error) {
    console.error("[Crawler] Fatal error:", error);
    failedCount++;
  } finally {
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
  const totalCrawled = crawledCount + newProductsCount;
  await updateCrawlJob(jobId, {
    status: wasStopped ? "stopped" : (failedCount > 0 && totalCrawled === 0 ? "failed" : "completed"),
    crawledProducts: totalCrawled,
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
  const jobId = (Array.isArray(jobResult) ? (jobResult[0] as { insertId?: number })?.insertId : (jobResult as { insertId?: number })?.insertId) || 0;

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

          let originalPriceText = "";
          if (target.productOriginalPriceSelector) {
            originalPriceText = $el.find(target.productOriginalPriceSelector).first().text().trim();
          } else {
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
