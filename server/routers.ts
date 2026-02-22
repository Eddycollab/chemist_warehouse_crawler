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
import { runCrawl, stopCrawl, isCrawlRunning, getCrawlProgress } from "./crawler";
import { runNewsCrawl, isNewsCrawlRunning } from "./newsCrawler";
import { invokeLLM } from "./_core/llm";
import * as cheerio from "cheerio";
import * as XLSX from "xlsx";
import { getSchedulerStatus } from "./scheduler";
import { PRODUCT_CATEGORIES } from "../drizzle/schema";

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
      }).optional()
    )
    .mutation(async ({ input }) => {
      // Run crawl in background (don't await)
      runCrawl({
        category: input?.category,
        jobType: "manual",
        productIds: input?.productIds,
        testMode: input?.testMode,
      }).catch((err) => console.error("[CrawlRouter] Background crawl error:", err));

      const msg = input?.testMode
        ? "測試模式已啟動，將爬取第一個品類第 1 頁"
        : "爬蟲任務已啟動，請稍後查看結果";
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
        productListSelector: z.string().min(1),
        productNameSelector: z.string().min(1),
        productPriceSelector: z.string().min(1),
        productOriginalPriceSelector: z.string().optional(),
        productLinkSelector: z.string().min(1),
        productImageSelector: z.string().optional(),
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
        productListSelector: z.string().min(1).optional(),
        productNameSelector: z.string().min(1).optional(),
        productPriceSelector: z.string().min(1).optional(),
        productOriginalPriceSelector: z.string().optional(),
        productLinkSelector: z.string().min(1).optional(),
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
      // 抓取目標網頁 HTML
      const res = await fetch(input.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(15000),
      });
      const html = await res.text();

      // 用 cheerio 提取結構摘要（前 8000 字）
      const $ = cheerio.load(html);
      // 移除 script/style/svg/head
      $("script, style, svg, head, noscript, iframe").remove();
      const bodyHtml = $("body").html() || "";
      const truncated = bodyHtml.substring(0, 8000);

      // 用 LLM 分析 HTML 結構
      const llmResult = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are an expert web scraping CSS selector analyst. Analyze the provided HTML and suggest CSS selectors for scraping product data. Return ONLY valid JSON, no markdown, no explanation.`,
          },
          {
            role: "user" as const,
            content: `Analyze this HTML from ${input.url} and suggest CSS selectors for scraping products/items.

HTML:
${truncated}

Return JSON with these exact keys (use empty string if not found):
{
  "productListSelector": "CSS selector for each product card container",
  "productNameSelector": "CSS selector for product name (relative to card)",
  "productPriceSelector": "CSS selector for current price (relative to card)",
  "productOriginalPriceSelector": "CSS selector for original/crossed-out price (relative to card)",
  "productLinkSelector": "CSS selector for product link (relative to card)",
  "productImageSelector": "CSS selector for product image (relative to card)",
  "paginationParam": "URL parameter or path pattern for pagination (e.g. 'page' or 'page/{page}')",
  "confidence": "high/medium/low",
  "notes": "brief explanation of the site structure in Traditional Chinese"
}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "selector_result",
            strict: true,
            schema: {
              type: "object",
              properties: {
                productListSelector: { type: "string" },
                productNameSelector: { type: "string" },
                productPriceSelector: { type: "string" },
                productOriginalPriceSelector: { type: "string" },
                productLinkSelector: { type: "string" },
                productImageSelector: { type: "string" },
                paginationParam: { type: "string" },
                confidence: { type: "string" },
                notes: { type: "string" },
              },
              required: ["productListSelector", "productNameSelector", "productPriceSelector", "productOriginalPriceSelector", "productLinkSelector", "productImageSelector", "paginationParam", "confidence", "notes"],
              additionalProperties: false,
            },
          },
        },
      });

      const rawContent = llmResult.choices[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : "{}";
      return JSON.parse(content) as {
        productListSelector: string;
        productNameSelector: string;
        productPriceSelector: string;
        productOriginalPriceSelector: string;
        productLinkSelector: string;
        productImageSelector: string;
        paginationParam: string;
        confidence: string;
        notes: string;
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
});

export type AppRouter = typeof appRouter;
