import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductStats,
  getPriceHistory,
  getCrawlJobs,
  getLatestCrawlJob,
  deleteCrawlJob,
  deleteAllCrawlJobs,
  getAllProductsForExport,
  getPriceHistoryForExport,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
  getCrawlerSettings,
  updateCrawlerSetting,
  getAccessPassword,
  resetStuckJobs,
  getCrawlTargets,
  getCrawlTargetById,
  createCrawlTarget,
  updateCrawlTarget,
  deleteCrawlTarget,
  getNewsSources,
  getNewsSourceById,
  createNewsSource,
  updateNewsSource,
  deleteNewsSource,
  toggleNewsSourceActive,
  getNewsArticles,
  countNewsArticles,
  markNewsArticleRead,
  markAllNewsArticlesRead,
  deleteNewsArticle,
  deleteAllNewsArticles,
  getNewsCrawlJobs,
  deleteNewsCrawlJob,
  deleteAllNewsCrawlJobs,
  resetStuckNewsCrawlJobs,
} from "./db";
import { runCrawl, stopCrawl, isCrawlRunning, getCrawlProgress, crawlCustomTarget } from "./crawler";
import { runNewsCrawl, isNewsCrawlRunning, testNewsSelector } from "./newsCrawler";
import { runTenderCrawl } from "./tenderCrawler";
import { scoreUnscoredTenders, rescoreTender } from "./tenderScorer";
import * as cheerio from "cheerio";
import * as XLSX from "xlsx";
import { getSchedulerStatus } from "./scheduler";
import { PRODUCT_CATEGORIES, tenders, tenderCrawlJobs } from "../drizzle/schema";
import { getDb } from "./db";
import { desc, eq, isNull, isNotNull, and, like, or, gte, lte, sql } from "drizzle-orm";

// ─── Product Router ───────────────────────────────────────────────────────────

const productRouter = router({
  list: publicProcedure
    .input(
      z.object({
        category: z.enum(PRODUCT_CATEGORIES).optional(),
        isOnSale: z.boolean().optional(),
        search: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return getAllProducts({
        category: input?.category,
        isActive: true,
        isOnSale: input?.isOnSale,
        search: input?.search,
      });
    }),

  stats: publicProcedure.query(async () => {
    return getProductStats();
  }),

  byId: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const product = await getProductById(input.id);
      if (!product) throw new Error("Product not found");
      return product;
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(500),
        brand: z.string().max(200).optional(),
        url: z.string().url(),
        category: z.enum(PRODUCT_CATEGORIES),
        sku: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input }) => {
      await createProduct({
        name: input.name,
        brand: input.brand,
        url: input.url,
        category: input.category,
        sku: input.sku,
        isActive: true,
        isOnSale: false,
      });
      return { success: true };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(500).optional(),
        brand: z.string().max(200).optional(),
        url: z.string().url().optional(),
        category: z.enum(PRODUCT_CATEGORIES).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateProduct(id, data);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteProduct(input.id);
      return { success: true };
    }),

  importFromExcel: publicProcedure
    .input(
      z.object({
        // base64-encoded xlsx file content
        fileBase64: z.string(),
        fileName: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      // Decode base64 to buffer
      const buffer = Buffer.from(input.fileBase64, "base64");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("Excel 檔案為空，請檢查格式");
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      if (rows.length === 0) throw new Error("資料為空，請檢查 Excel 內容");

      const validCategories = new Set(PRODUCT_CATEGORIES);
      const results: { success: number; failed: number; errors: string[] } = {
        success: 0,
        failed: 0,
        errors: [],
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const rowNum = i + 2; // Excel row number (1-indexed + header)

        // Flexible column name matching (support Chinese and English headers)
        const name = String(
          row["name"] ?? row["\u5546\u54c1\u540d\u7a31"] ?? row["\u540d\u7a31"] ?? ""
        ).trim();
        const url = String(
          row["url"] ?? row["URL"] ?? row["\u5546\u54c1\u9023\u7d50"] ?? row["\u9023\u7d50"] ?? ""
        ).trim();
        const brand = String(
          row["brand"] ?? row["\u54c1\u724c"] ?? ""
        ).trim();
        const categoryRaw = String(
          row["category"] ?? row["\u54c1\u985e"] ?? row["\u5206\u985e"] ?? ""
        ).trim();
        const sku = String(
          row["sku"] ?? row["SKU"] ?? ""
        ).trim();

        if (!name) {
          results.errors.push(`\u7b2c ${rowNum} \u884c\uff1a\u5546\u54c1\u540d\u7a31\u4e0d\u80fd\u70ba\u7a7a`);
          results.failed++;
          continue;
        }
        if (!url || !url.startsWith("http")) {
          results.errors.push(`\u7b2c ${rowNum} \u884c (${name})\uff1aURL \u683c\u5f0f\u4e0d\u6b63\u78ba`);
          results.failed++;
          continue;
        }

        // Map category
        let category: typeof PRODUCT_CATEGORIES[number] = "beauty_skincare";
        const catMap: Record<string, typeof PRODUCT_CATEGORIES[number]> = {
          beauty: "beauty_skincare",
          beauty_skincare: "beauty_skincare",
          "\u7f8e\u599a\u8b77\u819a": "beauty_skincare",
          "\u7f8e\u5bb9": "beauty_skincare",
          adult_health: "adult_health",
          "\u6210\u4eba\u4fdd\u5065": "adult_health",
          children_health: "childrens_health",
          childrens_health: "childrens_health",
          "\u5152\u7ae5\u4fdd\u5065": "childrens_health",
          vegan_health: "vegan_health",
          "\u7d14\u7d20\u4fdd\u5065": "vegan_health",
          natural_soap: "natural_soap",
          "\u5929\u7136\u9999\u7682": "natural_soap",
          oral_care: "oral_care",
          "\u53e3\u8154\u4fdd\u5065": "oral_care",
          medicines: "medicines",
          "\u85e5\u54c1": "medicines",
          other: "other",
          "\u5176\u4ed6": "other",
        };
        if (categoryRaw && catMap[categoryRaw.toLowerCase()]) {
          category = catMap[categoryRaw.toLowerCase()]!;
        } else if (validCategories.has(categoryRaw as typeof PRODUCT_CATEGORIES[number])) {
          category = categoryRaw as typeof PRODUCT_CATEGORIES[number];
        }

        try {
          await createProduct({
            name,
            brand: brand || undefined,
            url,
            category,
            sku: sku || undefined,
            isActive: true,
            isOnSale: false,
          });
          results.success++;
        } catch (err) {
          results.errors.push(`\u7b2c ${rowNum} \u884c (${name})\uff1a${err instanceof Error ? err.message : "\u672a\u77e5\u932f\u8aa4"}`);
          results.failed++;
        }
      }

      return results;
    }),

  downloadTemplate: publicProcedure.query(() => {
    // Return template column definitions for frontend to generate
    return {
      headers: [
        { key: "name", label: "\u5546\u54c1\u540d\u7a31", required: true, example: "Swisse Ultiboost Vitamin C 1000mg 120\u9821" },
        { key: "url", label: "\u5546\u54c1\u9023\u7d50", required: true, example: "https://www.chemistwarehouse.com.au/buy/..." },
        { key: "brand", label: "\u54c1\u724c", required: false, example: "Swisse" },
        { key: "category", label: "\u54c1\u985e", required: false, example: "adult_health" },
        { key: "sku", label: "SKU", required: false, example: "SW001" },
      ],
      categories: PRODUCT_CATEGORIES,
      categoryLabels: {
        beauty: "\u7f8e\u599a\u8b77\u819a",
        adult_health: "\u6210\u4eba\u4fdd\u5065",
        children_health: "\u5152\u7ae5\u4fdd\u5065",
        vegan_health: "\u7d14\u7d20\u4fdd\u5065",
        natural_soap: "\u5929\u7136\u9999\u7682",
        oral_care: "\u53e3\u8154\u4fdd\u5065",
        medicines: "\u85e5\u54c1",
      },
    };
  }),
});

// ─── Price History Router ─────────────────────────────────────────────────────

const priceHistoryRouter = router({
  byProduct: publicProcedure
    .input(
      z.object({
        productId: z.number(),
        days: z.number().min(1).max(365).default(30),
      })
    )
    .query(async ({ input }) => {
      return getPriceHistory(input.productId, input.days);
    }),
});

// ─── Crawl Router ─────────────────────────────────────────────────────────────

const crawlRouter = router({
  runCustomTarget: publicProcedure
    .input(z.object({ targetId: z.number() }))
    .mutation(async ({ input }) => {
      // Run crawl in background (don't await) to avoid HTTP connection timeout
      // which causes "message channel closed before a response was received" error
      crawlCustomTarget(input.targetId).catch((err) =>
        console.error("[CrawlRouter] Custom target crawl error:", err)
      );
      return { success: true, message: "爬蟲任務已啟動，請稍後查看結果" };
    }),
  jobs: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      return getCrawlJobs(input?.limit ?? 20);
    }),

  latestJob: publicProcedure.query(async () => {
    return getLatestCrawlJob();
  }),

  trigger: publicProcedure
    .input(
      z.object({
        category: z.string().optional(),
        productIds: z.array(z.number()).optional(),
        testMode: z.boolean().optional(),
        brandFilter: z.string().optional(),
      }).optional()
    )
    .mutation(async ({ input }) => {
      // Run crawl in background (don't await)
      runCrawl({
        category: input?.category,
        jobType: "manual",
        productIds: input?.productIds,
        testMode: input?.testMode,
        brandFilter: input?.brandFilter,
      }).catch((err) => console.error("[CrawlRouter] Background crawl error:", err));

      const brandMsg = input?.brandFilter ? `（品牌：${input.brandFilter}）` : "";
      const msg = input?.testMode
        ? `測試模式已啟動，將爬取第一個品類第 1 頁${brandMsg}`
        : `爬蟲任務已啟動${brandMsg}，請稍後查看結果`;
      return { success: true, message: msg };
    }),

  progress: publicProcedure.query(() => {
    return getCrawlProgress();
  }),

  schedulerStatus: publicProcedure.query(() => {
    return getSchedulerStatus();
  }),

  isRunning: publicProcedure.query(() => {
    return { running: isCrawlRunning() };
  }),

  stop: publicProcedure.mutation(() => {
    const result = stopCrawl();
    if (result.stopped) {
      return { success: true, message: `已發送停止指令，爬蟲將在完成目前頁面後停止` };
    }
    return { success: false, message: "目前沒有正在執行的爬蟲任務" };
  }),

  resetStuck: publicProcedure.mutation(async () => {
    const count = await resetStuckJobs();
    return { success: true, message: count > 0 ? `已重置 ${count} 個卡住的任務` : "沒有需要重置的任務", count };
  }),

  deleteJob: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteCrawlJob(input.id);
      return { success: true };
    }),

  deleteAllJobs: publicProcedure.mutation(async () => {
    await deleteAllCrawlJobs();
    return { success: true };
  }),

  getBrands: publicProcedure
    .input(
      z.object({
        category: z.string().optional(),
        query: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const ALGOLIA_APP_ID = "42NP1V2I98";
      const ALGOLIA_API_KEY = "3ce54af79eae81a18144a7aa7ee10ec2";
      const ALGOLIA_INDEX = "prod_cwr-cw-au_products_en";
      const ALGOLIA_BASE = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net`;
      const FACET_ATTR = "attributes.cwr-brand.label.en";

      const queryParams = new URLSearchParams({
        "x-algolia-agent": "Algolia for JavaScript (4.23.3); Browser (lite)",
        "x-algolia-api-key": ALGOLIA_API_KEY,
        "x-algolia-application-id": ALGOLIA_APP_ID,
      });

      const commonHeaders = {
        "Content-Type": "application/json",
        "Origin": "https://www.chemistwarehouse.com.au",
        "Referer": "https://www.chemistwarehouse.com.au/",
      };

      // Build category filter if provided
      let filters = "";
      if (input?.category && input.category !== "all") {
        const CATEGORY_MAP: Record<string, string[]> = {
          beauty_skincare: ["Skincare", "Cosmetics", "Hair Care", "Personal Care", "Fragrances"],
          adult_health: ["Vitamins & Supplements", "Sports Nutrition", "Weight Management"],
          childrens_health: ["Baby & Kids", "Pregnancy"],
          vegan_health: ["Vitamins & Supplements", "Natural Health"],
          natural_soap: ["Personal Care", "Natural Health"],
          oral_care: ["Oral Care"],
          medicines: ["Cold, Flu & Immunity", "Pain Relief", "Digestive Health", "Allergy"],
        };
        const cats = CATEGORY_MAP[input.category];
        if (cats && cats.length > 0) {
          filters = cats.map((c) => `categoryKeys.en:"${c}"`).join(" OR ");
        }
      }

      const searchQuery = input?.query?.trim() ?? "";

      try {
        // ── Strategy A: keyword search ──────────────────────────────────────
        // When user types a keyword, use searchForFacetValues which does
        // prefix-match on the facet value itself (not limited by alphabet order).
        if (searchQuery.length >= 1) {
          const body: Record<string, unknown> = {
            facetQuery: searchQuery,
            maxFacetHits: 50,
          };
          if (filters) body.filters = filters;

          const res = await fetch(
            `${ALGOLIA_BASE}/1/indexes/${ALGOLIA_INDEX}/facets/${encodeURIComponent(FACET_ATTR)}/query?${queryParams}`,
            { method: "POST", headers: commonHeaders, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }
          );
          if (!res.ok) throw new Error(`Algolia searchForFacetValues HTTP ${res.status}`);

          const data = await res.json() as { facetHits?: Array<{ value: string; count: number }> };
          const brands = (data.facetHits ?? []).map((h) => ({ name: h.value, count: h.count }));
          return { brands, total: brands.length };
        }

        // ── Strategy B: browse all brands (no keyword) ──────────────────────
        // Use the multi-index query endpoint with a large maxValuesPerFacet
        // to get the full brand list sorted by product count.
        const params = [
          `hitsPerPage=0`,
          `facets=${encodeURIComponent(FACET_ATTR)}`,
          `maxValuesPerFacet=1000`,
          filters ? `filters=${encodeURIComponent(filters)}` : "",
        ].filter(Boolean).join("&");

        const res = await fetch(
          `${ALGOLIA_BASE}/1/indexes/*/queries?${queryParams}`,
          {
            method: "POST",
            headers: commonHeaders,
            body: JSON.stringify({ requests: [{ indexName: ALGOLIA_INDEX, params }] }),
            signal: AbortSignal.timeout(15000),
          }
        );
        if (!res.ok) throw new Error(`Algolia facets HTTP ${res.status}`);

        const data = await res.json() as {
          results?: Array<{ facets?: Record<string, Record<string, number>> }>;
        };
        const facets = data.results?.[0]?.facets?.[FACET_ATTR] ?? {};
        const brands = Object.entries(facets)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);

        return { brands, total: brands.length };
      } catch (err) {
        console.error("[getBrands] Algolia error:", err);
        return { brands: [], total: 0 };
      }
    }),
});
// ─── Notification Router ──────────────────────────────────────────────────────

const notificationRouter = router({
  list: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        unreadOnly: z.boolean().default(false),
      }).optional()
    )
    .query(async ({ input }) => {
      return getNotifications(input?.limit ?? 50, input?.unreadOnly ?? false);
    }),

  unreadCount: publicProcedure.query(async () => {
    const count = await getUnreadNotificationCount();
    return { count };
  }),

  markRead: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await markNotificationRead(input.id);
      return { success: true };
    }),

  markAllRead: publicProcedure.mutation(async () => {
    await markAllNotificationsRead();
    return { success: true };
  }),
});

// ─── Settings Router ──────────────────────────────────────────────────────────

const settingsRouter = router({
  list: publicProcedure.query(async () => {
    return getCrawlerSettings();
  }),

  update: publicProcedure
    .input(
      z.object({
        key: z.string(),
        value: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await updateCrawlerSetting(input.key, input.value);
      return { success: true };
    }),
});

// ─── Export Router ──────────────────────────────────────────────────────────

const exportRouter = router({
  products: publicProcedure
    .input(
      z.object({
        category: z.enum(PRODUCT_CATEGORIES).optional(),
        isOnSale: z.boolean().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const allProducts = await getAllProductsForExport();
      let filtered = allProducts;
      if (input?.category) filtered = filtered.filter((p) => p.category === input.category);
      if (input?.isOnSale !== undefined) filtered = filtered.filter((p) => p.isOnSale === input.isOnSale);
      return filtered;
    }),

  priceHistory: publicProcedure
    .input(
      z.object({
        productIds: z.array(z.number()).optional(),
        days: z.number().min(1).max(365).default(90),
      }).optional()
    )
    .query(async ({ input }) => {
      return getPriceHistoryForExport(input?.productIds, input?.days ?? 90);
    }),
});

// ─── Access Auth Router ─────────────────────────────────────────────────────
const accessAuthRouter = router({
  verify: publicProcedure
    .input(z.object({ password: z.string() }))
    .mutation(async ({ input }) => {
      const stored = await getAccessPassword();
      if (input.password === stored) {
        return { success: true };
      }
      return { success: false, error: "密碼錯誤，請重試" };
    }),
  hasPassword: publicProcedure.query(async () => {
    const pwd = await getAccessPassword();
    return { enabled: pwd.length > 0 };
  }),
});

// ─── App Router ───────────────────────────────────────────────────────────────
// ─── Crawl Targets Router ─────────────────────────────────────────────────────
const targetsRouter = router({
  list: publicProcedure.query(async () => {
    return getCrawlTargets();
  }),
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getCrawlTargetById(input.id);
    }),
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        baseUrl: z.string().url(),
        productListSelector: z.string().default(""),
        productNameSelector: z.string().default(""),
        productPriceSelector: z.string().default(""),
        productOriginalPriceSelector: z.string().default(""),
        productLinkSelector: z.string().default(""),
        productImageSelector: z.string().default(""),
        paginationParam: z.string().default("page"),
        maxPages: z.number().min(1).max(100).default(10),
        isActive: z.boolean().default(true),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await createCrawlTarget(input);
      return { success: true };
    }),
  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(200).optional(),
        baseUrl: z.string().url().optional(),
        productListSelector: z.string().optional(),
        productNameSelector: z.string().optional(),
        productPriceSelector: z.string().optional(),
        productOriginalPriceSelector: z.string().optional(),
        productLinkSelector: z.string().optional(),
        productImageSelector: z.string().optional(),
        paginationParam: z.string().optional(),
        maxPages: z.number().min(1).max(100).optional(),
        isActive: z.boolean().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateCrawlTarget(id, data);
      return { success: true };
    }),
  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteCrawlTarget(input.id);
      return { success: true };
    }),
  toggleActive: publicProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      await updateCrawlTarget(input.id, { isActive: input.isActive });
      return { success: true };
    }),
  detectSelectors: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      // Fetch the page HTML
      const res = await fetch(input.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const $ = cheerio.load(html);

      // Remove non-content elements
      $("script, style, noscript, iframe, svg").remove();

      // --- Rule-based selector detection ---
      type Candidate = { selector: string; count: number; confidence: "high" | "medium" | "low" };

      // Common product container patterns (ordered by specificity)
      const containerPatterns = [
        // WooCommerce
        { sel: "ul.products li.product", label: "WooCommerce product" },
        { sel: "li.product", label: "WooCommerce product" },
        { sel: "div.product-small", label: "WooCommerce product-small" },
        // Shopify
        { sel: "div.product-item", label: "Shopify product-item" },
        { sel: "li.grid__item", label: "Shopify grid item" },
        { sel: "div.card-wrapper", label: "Shopify card" },
        // Generic
        { sel: ".product-card", label: "product card" },
        { sel: ".product-tile", label: "product tile" },
        { sel: ".product-box", label: "product box" },
        { sel: ".product-item", label: "product item" },
        { sel: ".item-product", label: "item product" },
        { sel: "[class*=\"product-\"]", label: "product-* class" },
        { sel: "[class*=\"ProductCard\"]", label: "ProductCard" },
        { sel: "[class*=\"product_item\"]", label: "product_item" },
        { sel: "[data-product-id]", label: "data-product-id" },
        { sel: "[data-product]", label: "data-product" },
      ];

      let bestContainer = "";
      let containerCount = 0;
      let confidence: "high" | "medium" | "low" = "low";

      for (const p of containerPatterns) {
        const count = $(p.sel).length;
        if (count >= 3 && count > containerCount) {
          bestContainer = p.sel;
          containerCount = count;
          confidence = count >= 6 ? "high" : "medium";
        }
      }

      // If no pattern matched, try to find repeating structures
      if (!bestContainer) {
        const candidates: Candidate[] = [];
        $("ul, ol, div").each((_: number, el: any) => {
          const children = $(el).children();
          if (children.length >= 4) {
            const firstTag = children.first().prop("tagName");
            const allSame = children.toArray().every((c: any) => $(c).prop("tagName") === firstTag);
            if (allSame && firstTag) {
              const cls = $(el).attr("class");
              if (cls) {
                const sel = `${firstTag.toLowerCase()}.${cls.trim().split(/\s+/)[0]}`;
                candidates.push({ selector: sel, count: children.length, confidence: "low" });
              }
            }
          }
        });
        if (candidates.length > 0) {
          candidates.sort((a, b) => b.count - a.count);
          bestContainer = candidates[0].selector;
          containerCount = candidates[0].count;
        }
      }

      // Detect sub-selectors within the container
      const detectSubSelector = (parent: any, patterns: string[]): string => {
        for (const p of patterns) {
          if (parent.find(p).length > 0) return p;
        }
        return "";
      };

      const firstItem = bestContainer ? $(bestContainer).first() : $("body");

      const namePatterns = [".product-title", ".product-name", ".woocommerce-loop-product__title", ".card-title", "h2.name", "h3.name", ".name", "h2 a", "h3 a", "h4 a", ".title", "[class*=\"title\"]", "[class*=\"name\"]"];
      const pricePatterns = [".price", ".product-price", ".woocommerce-Price-amount", ".price-wrapper", ".sale-price", "[class*=\"price\"]", "ins .amount", ".amount"];
      const origPricePatterns = ["del .amount", ".original-price", ".compare-at-price", ".was-price", "del", "[class*=\"original\"]", "[class*=\"compare\"]"];
      const linkPatterns = ["a[href*=\"/product/\"]", "a[href*=\"/products/\"]", "a[href*=\"/item/\"]", ".woocommerce-LoopProduct-link", "a.product-link", "a"];
      const imagePatterns = [".attachment-woocommerce_thumbnail", ".wp-post-image", "img.product-image", "img.card-img", "img[src*=\"product\"]", "img"];
      const paginationPatterns = [".next.page-numbers", "a.next", ".pagination a[rel=\"next\"]", "[class*=\"next\"]", ".page-next a"];

      const nameSelector = detectSubSelector(firstItem, namePatterns);
      const priceSelector = detectSubSelector(firstItem, pricePatterns);
      const origPriceSelector = detectSubSelector(firstItem, origPricePatterns);
      const linkSelector = detectSubSelector(firstItem, linkPatterns);
      const imageSelector = detectSubSelector(firstItem, imagePatterns);
      const paginationSelector = detectSubSelector($("body"), paginationPatterns);

      // Detect pagination URL pattern
      let paginationParam = "page";
      const nextHref = $(paginationSelector || ".next").attr("href") || "";
      if (nextHref.includes("/page/")) paginationParam = "path:/page/{page}/";
      else if (nextHref.includes("?page=")) paginationParam = "page";
      else if (nextHref.includes("?p=")) paginationParam = "p";

      // Build analysis notes
      const notes: string[] = [];
      if (containerCount > 0) notes.push(`找到 ${containerCount} 個產品容器（${bestContainer}）`);
      if (!bestContainer) notes.push("未找到明確的產品容器，可能需要手動調整選擇器");
      const isWooCommerce = html.includes("woocommerce") || html.includes("WooCommerce");
      const isShopify = html.includes("Shopify") || html.includes("/cdn/shop/");
      if (isWooCommerce) notes.push("偵測到 WooCommerce 架構");
      if (isShopify) notes.push("偵測到 Shopify 架構");
      if (html.includes("loading-container") || html.includes("__NEXT_DATA__") || html.includes("window.__nuxt")) {
        notes.push("⚠️ 此網站可能使用 JavaScript 動態載入，靜態爬蟲可能無法抓取所有產品");
        confidence = "low";
      }

      return {
        productListSelector: bestContainer || ".product",
        productNameSelector: nameSelector || ".name",
        productPriceSelector: priceSelector || ".price",
        productOriginalPriceSelector: origPriceSelector || "",
        productLinkSelector: linkSelector || "a",
        productImageSelector: imageSelector || "",
        paginationSelector: paginationSelector || "",
        paginationParam,
        confidence,
         notes: notes.join("；"),
        containerCount,
      };
    }),
  testCrawl: publicProcedure
    .input(
      z.object({
        id: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      // 取得目標設定
      const targets = await getCrawlTargets();
      const target = targets.find((t) => t.id === input.id);
      if (!target) throw new Error("找不到目標網站");
      if (!target.productListSelector) throw new Error("尚未設定產品容器選擇器，請先使用「自動偵測」或手動填入");
      // 抓取第一頁
      const res = await fetch(target.baseUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`網頁載入失敗：HTTP ${res.status}`);
      const html = await res.text();
      const $ = cheerio.load(html);
      $("script, style, noscript, iframe").remove();
      // 套用產品容器選擇器
      const containers = $(target.productListSelector);
      const products: Array<{ name: string; price: string; link: string; image: string }> = [];
      const seenLinks = new Set<string>();

      // Helper: extract clean price from a price element (handles WooCommerce ins/del structure)
      function extractCleanPrice($priceEl: ReturnType<typeof $>): string {
        // Priority 1: <ins> tag = current sale price (WooCommerce)
        const insText = $priceEl.find("ins").first().text().trim();
        if (insText) {
          // Extract first AU$/$/price pattern
          const m = insText.match(/(?:AU\$|\$|USD\$|NZ\$)?[\d,]+\.?\d*/i);
          return m ? m[0].replace(/,/g, "") : insText.split("\n")[0].trim();
        }
        // Priority 2: remove <del> (original price) and take remaining text
        const cloned = $priceEl.clone();
        cloned.find("del").remove();
        const remaining = cloned.text().trim();
        // Take only the first price-like token (AU$X.XX or $X.XX), ignore NT$ etc.
        const priceMatch = remaining.match(/(?:AU\$|\$|USD\$|NZ\$)[\d,]+\.?\d*/i);
        if (priceMatch) return priceMatch[0];
        // Fallback: first line only
        return remaining.split("\n")[0].trim();
      }

      containers.each((_i: number, el: any) => {
        if (products.length >= 10) return false; // stop after 10
        const $el = $(el);
        const name = target.productNameSelector ? $el.find(target.productNameSelector).first().text().trim() : $el.find("h2,h3,h4,.title,.name").first().text().trim();
        // Price: use helper for clean extraction
        const $priceEl = target.productPriceSelector ? $el.find(target.productPriceSelector).first() : $el.find(".price,span[class*=price]").first();
        const price = extractCleanPrice($priceEl);
        const linkEl = target.productLinkSelector ? $el.find(target.productLinkSelector).first() : $el.find("a").first();
        const link = linkEl.attr("href") || "";
        // Deduplicate by URL
        if (link && seenLinks.has(link)) return;
        if (link) seenLinks.add(link);
        const imgEl = target.productImageSelector ? $el.find(target.productImageSelector).first() : $el.find("img").first();
        const image = imgEl.attr("src") || imgEl.attr("data-src") || "";
        if (name || price) {
          products.push({ name: name || "(無名稱)", price: price || "(無價格)", link, image });
        }
      });
      return {
        success: true,
        totalFound: containers.length,
        products,
        url: target.baseUrl,
        selector: target.productListSelector,
      };
    }),
});
// ─── News Router ─────────────────────────────────────────────────────────────

const newsRouter = router({
  // Sources CRUD
  getSources: publicProcedure.query(async () => {
    return getNewsSources();
  }),
  createSource: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        url: z.string().url(),
        articleSelector: z.string().default("article"),
        titleSelector: z.string().default(".entry-title a"),
        dateSelector: z.string().optional(),
        excerptSelector: z.string().optional(),
        imageSelector: z.string().optional(),
        paginationSelector: z.string().optional(),
        maxPages: z.number().int().min(1).max(50).default(5),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await createNewsSource(input);
      return { success: true };
    }),
  updateSource: publicProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        url: z.string().url().optional(),
        articleSelector: z.string().optional(),
        titleSelector: z.string().optional(),
        dateSelector: z.string().optional(),
        excerptSelector: z.string().optional(),
        imageSelector: z.string().optional(),
        paginationSelector: z.string().optional(),
        maxPages: z.number().int().min(1).max(50).optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateNewsSource(id, data);
      return { success: true };
    }),
  deleteSource: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteNewsSource(input.id);
      return { success: true };
    }),
  toggleSourceActive: publicProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      await toggleNewsSourceActive(input.id, input.isActive);
      return { success: true };
    }),

  // Articles
  getArticles: publicProcedure
    .input(
      z.object({
        sourceId: z.number().optional(),
        isRead: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }).optional()
    )
    .query(async ({ input }) => {
      const articles = await getNewsArticles(input ?? {});
      const total = await countNewsArticles(input ?? {});
      return { articles, total };
    }),
  markRead: publicProcedure
    .input(z.object({ id: z.number(), isRead: z.boolean() }))
    .mutation(async ({ input }) => {
      await markNewsArticleRead(input.id, input.isRead);
      return { success: true };
    }),
  markAllRead: publicProcedure
    .input(z.object({ sourceId: z.number().optional() }).optional())
    .mutation(async ({ input }) => {
      await markAllNewsArticlesRead(input?.sourceId);
      return { success: true };
    }),
  deleteArticle: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteNewsArticle(input.id);
      return { success: true };
    }),
  deleteAllArticles: publicProcedure
    .input(z.object({ sourceId: z.number().optional() }).optional())
    .mutation(async ({ input }) => {
      await deleteAllNewsArticles(input?.sourceId);
      return { success: true };
    }),

  // Crawl Jobs
  getJobs: publicProcedure.query(async () => {
    return getNewsCrawlJobs(30);
  }),
  isRunning: publicProcedure
    .input(z.object({ sourceId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return { running: isNewsCrawlRunning(input?.sourceId) };
    }),
  startCrawl: publicProcedure
    .input(z.object({ sourceId: z.number() }))
    .mutation(async ({ input }) => {
      // Prevent duplicate runs
      if (isNewsCrawlRunning(input.sourceId)) {
        return { success: false, message: "該來源正在爬取中，請稍候" };
      }
      // Run in background
      runNewsCrawl(input.sourceId).catch(console.error);
      return { success: true, message: "爬取任務已啟動，請稍後查看結果" };
    }),
  resetStuck: publicProcedure.mutation(async () => {
    await resetStuckNewsCrawlJobs();
    return { success: true };
  }),
  deleteJob: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteNewsCrawlJob(input.id);
      return { success: true };
    }),
  deleteAllJobs: publicProcedure.mutation(async () => {
    await deleteAllNewsCrawlJobs();
    return { success: true };
  }),
  testSelector: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
        articleSelector: z.string().min(1),
        titleSelector: z.string().min(1),
        dateSelector: z.string().optional(),
        excerptSelector: z.string().optional(),
        imageSelector: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return testNewsSelector(input);
    }),
});

// ─── Tender Router ──────────────────────────────────────────────────────────
const tenderRouter = router({
  // List tenders with filters
  list: publicProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
      keyword: z.string().optional(),
      priority: z.enum(["High", "Medium", "Low"]).optional(),
      recommend: z.boolean().optional(),
      category: z.string().optional(),
      minScore: z.number().optional(),
      scored: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };

      const conditions = [];
      if (input.keyword) {
        conditions.push(or(
          like(tenders.projectName, `%${input.keyword}%`),
          like(tenders.orgName, `%${input.keyword}%`)
        ));
      }
      if (input.priority) conditions.push(eq(tenders.aiPriority, input.priority));
      if (input.recommend !== undefined) conditions.push(eq(tenders.aiRecommend, input.recommend));
      if (input.category) conditions.push(eq(tenders.aiCategory, input.category));
      if (input.minScore !== undefined) conditions.push(gte(tenders.aiScore, input.minScore));
      if (input.scored === true) conditions.push(isNotNull(tenders.aiScore));
      if (input.scored === false) conditions.push(isNull(tenders.aiScore));

      const offset = (input.page - 1) * input.pageSize;
      const query = conditions.length > 0 ? and(...conditions) : undefined;

      const [items, countResult] = await Promise.all([
        query
          ? db.select().from(tenders).where(query).orderBy(desc(tenders.aiScore), desc(tenders.createdAt)).limit(input.pageSize).offset(offset)
          : db.select().from(tenders).orderBy(desc(tenders.aiScore), desc(tenders.createdAt)).limit(input.pageSize).offset(offset),
        query
          ? db.select({ count: sql<number>`count(*)` }).from(tenders).where(query)
          : db.select({ count: sql<number>`count(*)` }).from(tenders),
      ]);

      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),

  // Get stats for dashboard
  stats: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, scored: 0, recommended: 0, highPriority: 0, unscored: 0 };

    const [total, scored, recommended, highPriority] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(tenders),
      db.select({ count: sql<number>`count(*)` }).from(tenders).where(isNotNull(tenders.aiScore)),
      db.select({ count: sql<number>`count(*)` }).from(tenders).where(eq(tenders.aiRecommend, true)),
      db.select({ count: sql<number>`count(*)` }).from(tenders).where(eq(tenders.aiPriority, "High")),
    ]);

    const t = Number(total[0]?.count ?? 0);
    const s = Number(scored[0]?.count ?? 0);
    return {
      total: t,
      scored: s,
      unscored: t - s,
      recommended: Number(recommended[0]?.count ?? 0),
      highPriority: Number(highPriority[0]?.count ?? 0),
    };
  }),

  // Get single tender
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db.select().from(tenders).where(eq(tenders.id, input.id)).limit(1);
      return rows[0] ?? null;
    }),

  // Re-score a single tender
  rescore: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const result = await rescoreTender(input.id);
      if (!result) return { success: false, message: "標案不存在或評分失敗" };
      return { success: true, score: result.score, priority: result.priority };
    }),

  // Score all unscored tenders (background)
  scoreAll: publicProcedure.mutation(async () => {
    scoreUnscoredTenders().catch(console.error);
    return { success: true, message: "AI 評分任務已啟動，請稍後刷新" };
  }),

  // Export tenders to Excel
  exportExcel: publicProcedure
    .input(z.object({
      keyword: z.string().optional(),
      priority: z.enum(["High", "Medium", "Low"]).optional(),
      recommend: z.boolean().optional(),
      category: z.string().optional(),
      minScore: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false, message: "資料庫連接失敗" };

      const conditions = [];
      if (input.keyword) {
        conditions.push(or(
          like(tenders.projectName, `%${input.keyword}%`),
          like(tenders.orgName, `%${input.keyword}%`)
        ));
      }
      if (input.priority) conditions.push(eq(tenders.aiPriority, input.priority));
      if (input.recommend !== undefined) conditions.push(eq(tenders.aiRecommend, input.recommend));
      if (input.category) conditions.push(eq(tenders.aiCategory, input.category));
      if (input.minScore !== undefined) conditions.push(gte(tenders.aiScore, input.minScore));

      const query = conditions.length > 0 ? and(...conditions) : undefined;
      const items = query
        ? await db.select().from(tenders).where(query).orderBy(desc(tenders.aiScore), desc(tenders.createdAt))
        : await db.select().from(tenders).orderBy(desc(tenders.aiScore), desc(tenders.createdAt));

      // 使用 exceljs 生成 Excel 檔案
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("標案列表");

      // 設定欄位
      worksheet.columns = [
        { header: "標案 ID", key: "id", width: 15 },
        { header: "標案名稱", key: "projectName", width: 40 },
        { header: "機關名稱", key: "orgName", width: 20 },
        { header: "預算", key: "budget", width: 12 },
        { header: "類別", key: "catName", width: 15 },
        { header: "發布日期", key: "postDate", width: 12 },
        { header: "截止日期", key: "submitDeadline", width: 12 },
        { header: "AI 評分", key: "aiScore", width: 10 },
        { header: "優先級", key: "aiPriority", width: 10 },
        { header: "推薦", key: "aiRecommend", width: 8 },
        { header: "分類", key: "aiCategory", width: 10 },
        { header: "金額適配", key: "aiBudgetFit", width: 10 },
      ];

      // 添加資料
      items.forEach((item: any) => {
        worksheet.addRow({
          id: item.id,
          projectName: item.projectName,
          orgName: item.orgName,
          budget: item.budget ? `${(item.budget / 10000).toFixed(1)}萬` : "-",
          catName: item.catName,
          postDate: item.postDate,
          submitDeadline: item.submitDeadline,
          aiScore: item.aiScore || "-",
          aiPriority: item.aiPriority || "-",
          aiRecommend: item.aiRecommend ? "是" : "否",
          aiCategory: item.aiCategory || "-",
          aiBudgetFit: item.aiBudgetFit || "-",
        });
      });

      // 設定樣式
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3D3D3" } };

      // 生成 Buffer
      const buffer = await workbook.xlsx.writeBuffer();
      const base64 = (buffer as unknown as Buffer).toString("base64");

      return {
        success: true,
        data: base64,
        filename: `標案列表_${new Date().toISOString().split("T")[0] ?? "export"}.xlsx`,
        count: items.length,
      };
    }),
});

// ─── Tender Crawl Router ─────────────────────────────────────────────────────
const tenderCrawlRouter = router({
  // Trigger manual crawl
  trigger: publicProcedure.mutation(async () => {
    runTenderCrawl("manual")
      .then(result => {
        if (result.newTenders > 0) {
          scoreUnscoredTenders().catch(console.error);
        }
      })
      .catch(console.error);
    return { success: true, message: "標案爬取任務已啟動，完成後將自動進行 AI 評分" };
  }),

  // Get crawl job history
  jobs: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(tenderCrawlJobs).orderBy(desc(tenderCrawlJobs.createdAt)).limit(input.limit);
    }),

  // Delete a crawl job
  deleteJob: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      await db.delete(tenderCrawlJobs).where(eq(tenderCrawlJobs.id, input.id));
      return { success: true };
    }),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  access: accessAuthRouter,
  product: productRouter,
  priceHistory: priceHistoryRouter,
  crawl: crawlRouter,
  notification: notificationRouter,
  settings: settingsRouter,
  export: exportRouter,
  targets: targetsRouter,
   news: newsRouter,
  tender: tenderRouter,
  tenderCrawl: tenderCrawlRouter,
});
export type AppRouter = typeof appRouter;
