/**
 * News Crawler - Generic news/blog article crawler using Puppeteer
 * Supports any website with configurable CSS selectors
 */
import puppeteer from "puppeteer";
import {
  getNewsSourceById,
  updateNewsSource,
  upsertNewsArticle,
  createNewsCrawlJob,
  updateNewsCrawlJob,
} from "./db";
import type { NewsSource } from "../drizzle/schema";

const LOG_PREFIX = "[NewsCrawler]";

// Track running crawls per source to prevent duplicate runs
const _runningCrawls = new Set<number>();

export function isNewsCrawlRunning(sourceId?: number): boolean {
  if (sourceId !== undefined) return _runningCrawls.has(sourceId);
  return _runningCrawls.size > 0;
}

function log(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}

interface ScrapeResult {
  title: string;
  url: string;
  publishedAt?: string;
  excerpt?: string;
  imageUrl?: string;
}

/**
 * Scrape a single page of articles from a news source
 */
async function scrapeNewsPage(
  pageUrl: string,
  source: NewsSource
): Promise<{ articles: ScrapeResult[]; nextPageUrl: string | null }> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    log(`Scraping page: ${pageUrl}`);
    // 使用 Puppeteer 的 networkidle2 等待策略，更適合複雜的 JavaScript 渲染
    log(`[DEBUG] Starting page.goto with networkidle2 strategy...`);
    await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 120000 });
    log(`[DEBUG] page.goto completed`);

    // 等待 JavaScript 執行完成
    log(`[DEBUG] Waiting 3 seconds for additional JS execution...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    log(`[DEBUG] Wait completed`);

    // Wait for article cards to appear
    try {
      // 等待選擇器出現
      log(`[DEBUG] Waiting for selector: ${source.articleSelector}`);
      await page.waitForFunction(
        (selector: string) => document.querySelector(selector) !== null,
        { timeout: 30000 },
        source.articleSelector
      );
      log(`[DEBUG] Selector found`);
    } catch (e) {
      log(`Error: article selector "${source.articleSelector}" not found on ${pageUrl}`);
      log(`[DEBUG] Error details: ${e instanceof Error ? e.message : String(e)}`);
      return { articles: [], nextPageUrl: null };
    }

    // Extract articles using Puppeteer's evaluate
    const articles = await page.evaluate(
      ({
        articleSel,
        titleSel,
        dateSel,
        excerptSel,
        imageSel,
      }: {
        articleSel: string;
        titleSel: string;
        dateSel: string | null;
        excerptSel: string | null;
        imageSel: string | null;
      }) => {
        const cards = Array.from(document.querySelectorAll(articleSel));
        return cards.slice(0, 50).map((card: Element) => {
          // Title and link
          const titleEl = card.querySelector(titleSel) as HTMLAnchorElement | null;
          const title = titleEl?.textContent?.trim() ?? "";
          let url = titleEl?.href ?? (card.querySelector("a") as HTMLAnchorElement | null)?.href ?? "";
          
          // Convert relative URLs to absolute
          if (url && !url.startsWith("http")) {
            url = new URL(url, window.location.href).href;
          }

          // Date
          const dateEl = dateSel ? card.querySelector(dateSel) : null;
          const publishedAt = dateEl?.textContent?.trim() ?? undefined;

          // Excerpt
          const excerptEl = excerptSel ? card.querySelector(excerptSel) : null;
          const excerpt = excerptEl?.textContent?.trim() ?? undefined;

          // Image
          const imgEl = imageSel ? card.querySelector(imageSel) as HTMLImageElement | null : null;
          let imageUrl = imgEl?.src ?? imgEl?.getAttribute("data-src") ?? undefined;
          
          // Convert relative image URLs to absolute
          if (imageUrl && !imageUrl.startsWith("http")) {
            imageUrl = new URL(imageUrl, window.location.href).href;
          }

          return { title, url, publishedAt, excerpt, imageUrl };
        });
      },
      {
        articleSel: source.articleSelector,
        titleSel: source.titleSelector,
        dateSel: source.dateSelector ?? null,
        excerptSel: source.excerptSelector ?? null,
        imageSel: source.imageSelector ?? null,
      }
    );

    // Find next page URL
    let nextPageUrl: string | null = null;
    if (source.paginationSelector) {
      try {
        const nextEl = await page.$(source.paginationSelector);
        if (nextEl) {
          nextPageUrl = await page.evaluate(
            (el: Element) => (el as HTMLElement).getAttribute("href"),
            nextEl
          );
          // Convert relative URLs to absolute
          if (nextPageUrl && !nextPageUrl.startsWith("http")) {
            nextPageUrl = new URL(nextPageUrl, pageUrl).href;
          }
        }
      } catch {
        // No next page
      }
    }

    const validArticles = articles.filter((a: ScrapeResult) => a.title && a.url);
    log(`Found ${validArticles.length} articles on ${pageUrl}`);
    return { articles: validArticles, nextPageUrl };
  } finally {
    await page.close();
    await browser.close();
  }
}

/**
 * Run a full news crawl for a specific source
 */
export async function runNewsCrawl(sourceId: number): Promise<void> {
  const source = await getNewsSourceById(sourceId);
  if (!source) {
    log(`Source ${sourceId} not found`);
    return;
  }
  if (!source.isActive) {
    log(`Source ${sourceId} (${source.name}) is inactive, skipping`);
    return;
  }

  // Prevent duplicate runs for the same source
  if (_runningCrawls.has(sourceId)) {
    log(`Source ${sourceId} (${source.name}) is already running, skipping`);
    return;
  }
  _runningCrawls.add(sourceId);

  log(`Starting crawl for source: ${source.name} (${source.url})`);

  // Create job record
  const jobId = await createNewsCrawlJob({
    sourceId: source.id,
    sourceName: source.name,
    jobType: "manual",
    status: "running",
    startedAt: new Date(),
  });

  let totalArticles = 0;
  let newArticles = 0;
  let currentUrl: string | null = source.url;
  let pageNum = 0;

  try {
    while (currentUrl && pageNum < source.maxPages) {
      pageNum++;
      const { articles, nextPageUrl } = await scrapeNewsPage(currentUrl, source);

      for (const article of articles) {
        if (!article.url) continue;
        totalArticles++;
        const result = await upsertNewsArticle({
          sourceId: source.id,
          sourceName: source.name,
          title: article.title,
          url: article.url,
          publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
          excerpt: article.excerpt,
          imageUrl: article.imageUrl,
        });
        if (result.inserted) newArticles++;
      }

      // If no new articles found on this page, stop early (already have all)
      if (articles.length > 0 && newArticles === 0 && pageNum > 1) {
        log(`No new articles on page ${pageNum}, stopping early`);
        break;
      }

      currentUrl = nextPageUrl;
    }

    // Update source lastCrawledAt
    await updateNewsSource(source.id, { lastCrawledAt: new Date() });

    // Complete job
    await updateNewsCrawlJob(jobId, {
      status: "completed",
      totalArticles,
      newArticles,
      completedAt: new Date(),
    });

    log(`Crawl completed for ${source.name}: ${newArticles} new / ${totalArticles} total`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Crawl failed for ${source.name}: ${msg}`);
    await updateNewsCrawlJob(jobId, {
      status: "failed",
      totalArticles,
      newArticles,
      errorMessage: msg,
      completedAt: new Date(),
    });
  } finally {
    // Always release the lock
    _runningCrawls.delete(sourceId);
  }
}

/**
 * Test news selectors on a given URL without saving to DB
 * Returns a preview of articles that would be scraped
 */
export async function testNewsSelector(params: {
  url: string;
  articleSelector: string;
  titleSelector: string;
  dateSelector?: string;
  excerptSelector?: string;
  imageSelector?: string;
}): Promise<{
  success: boolean;
  articles: Array<{ title: string; url: string; publishedAt?: string; excerpt?: string }>;
  totalFound: number;
  errorMessage?: string;
}> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    log(`[testSelector] Loading: ${params.url}`);
    await page.goto(params.url, { waitUntil: "networkidle2", timeout: 60000 });

    // Wait for article selector
    try {
      await page.waitForSelector(params.articleSelector, { timeout: 10000 });
    } catch {
      return {
        success: false,
        articles: [],
        totalFound: 0,
        errorMessage: `找不到文章選擇器「${params.articleSelector}」，請確認選擇器是否正確`,
      };
    }

    const results = await page.evaluate(
      ({ articleSel, titleSel, dateSel, excerptSel, imageSel }: {
        articleSel: string;
        titleSel: string;
        dateSel: string | null;
        excerptSel: string | null;
        imageSel: string | null;
      }) => {
        const cards = Array.from(document.querySelectorAll(articleSel));
        const totalFound = cards.length;
        const articles = cards.slice(0, 10).map((card: Element) => {
          const titleEl = card.querySelector(titleSel) as HTMLAnchorElement | null;
          const title = titleEl?.textContent?.trim() ?? "";
          const url = titleEl?.href ?? (card.querySelector("a") as HTMLAnchorElement | null)?.href ?? "";
          const dateEl = dateSel ? card.querySelector(dateSel) : null;
          const publishedAt = dateEl?.textContent?.trim() ?? undefined;
          const excerptEl = excerptSel ? card.querySelector(excerptSel) : null;
          const excerpt = excerptEl?.textContent?.trim() ?? undefined;
          return { title, url, publishedAt, excerpt };
        });
        return { totalFound, articles };
      },
      {
        articleSel: params.articleSelector,
        titleSel: params.titleSelector,
        dateSel: params.dateSelector ?? null,
        excerptSel: params.excerptSelector ?? null,
        imageSel: params.imageSelector ?? null,
      }
    );

    const validArticles = results.articles.filter((a: ScrapeResult) => a.title || a.url);

    if (validArticles.length === 0) {
      return {
        success: false,
        articles: [],
        totalFound: results.totalFound,
        errorMessage:
          results.totalFound > 0
            ? `找到 ${results.totalFound} 個文章容器，但標題選擇器「${params.titleSelector}」未能抓到任何標題，請確認標題選擇器`
            : `文章選擇器「${params.articleSelector}」找到 0 個元素，請確認選擇器是否正確`,
      };
    }

    return {
      success: true,
      articles: validArticles,
      totalFound: results.totalFound,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      articles: [],
      totalFound: 0,
      errorMessage: `載入頁面失敗：${msg}`,
    };
  } finally {
    await page.close();
    await browser.close();
  }
}

/**
 * Run news crawls for all active sources
 */
export async function runAllNewsCrawls(): Promise<void> {
  const { getNewsSources } = await import("./db");
  const sources = await getNewsSources();
  const activeSources = sources.filter((s) => s.isActive);
  log(`Running crawls for ${activeSources.length} active sources`);
  for (const source of activeSources) {
    await runNewsCrawl(source.id);
  }
}
