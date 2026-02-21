import { eq, desc, and, gte, lte, like, or, sql, inArray, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  InsertUser,
  users,
  products,
  priceHistory,
  crawlJobs,
  notifications,
  crawlerSettings,
  crawlTargets,
  InsertProduct,
  InsertPriceHistory,
  InsertCrawlJob,
  InsertNotification,
  InsertCrawlTarget,
  ProductCategory,
  newsSources,
  newsArticles,
  newsCrawlJobs,
  InsertNewsSource,
  InsertNewsArticle,
  InsertNewsCrawlJob,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _migrated = false;

async function runMigrations(connectionString: string) {
  if (_migrated) return;
  try {
    const conn = await mysql.createConnection(connectionString);
    // Create all tables if they don't exist
    await conn.execute(`CREATE TABLE IF NOT EXISTS \`users\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`openId\` varchar(64) NOT NULL,
      \`name\` text,
      \`email\` varchar(320),
      \`loginMethod\` varchar(64),
      \`role\` enum('user','admin') NOT NULL DEFAULT 'user',
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      \`lastSignedIn\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`users_id\` PRIMARY KEY(\`id\`),
      CONSTRAINT \`users_openId_unique\` UNIQUE(\`openId\`)
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS \`crawl_jobs\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`jobType\` enum('scheduled','manual') NOT NULL DEFAULT 'manual',
      \`status\` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
      \`category\` enum('beauty_skincare','adult_health','childrens_health','vegan_health','natural_soap','other','all') DEFAULT 'all',
      \`totalProducts\` int DEFAULT 0,
      \`crawledProducts\` int DEFAULT 0,
      \`failedProducts\` int DEFAULT 0,
      \`errorMessage\` text,
      \`startedAt\` timestamp NULL,
      \`completedAt\` timestamp NULL,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`crawl_jobs_id\` PRIMARY KEY(\`id\`)
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS \`crawler_settings\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`key\` varchar(100) NOT NULL,
      \`value\` text NOT NULL,
      \`description\` text,
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`crawler_settings_id\` PRIMARY KEY(\`id\`),
      CONSTRAINT \`crawler_settings_key_unique\` UNIQUE(\`key\`)
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS \`notifications\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`productId\` int NOT NULL,
      \`type\` enum('price_drop','price_increase','new_sale','sale_ended') NOT NULL,
      \`title\` varchar(500) NOT NULL,
      \`message\` text NOT NULL,
      \`oldPrice\` decimal(10,2),
      \`newPrice\` decimal(10,2),
      \`changePercent\` decimal(5,2),
      \`isRead\` boolean NOT NULL DEFAULT false,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`notifications_id\` PRIMARY KEY(\`id\`)
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS \`price_history\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`productId\` int NOT NULL,
      \`price\` decimal(10,2) NOT NULL,
      \`originalPrice\` decimal(10,2),
      \`isOnSale\` boolean NOT NULL DEFAULT false,
      \`discountPercent\` decimal(5,2),
      \`crawledAt\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`price_history_id\` PRIMARY KEY(\`id\`)
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS \`products\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`name\` varchar(500) NOT NULL,
      \`brand\` varchar(200),
      \`sku\` varchar(100),
      \`url\` text NOT NULL,
      \`imageUrl\` text,
      \`category\` enum('beauty_skincare','adult_health','childrens_health','vegan_health','natural_soap','other') NOT NULL DEFAULT 'other',
      \`currentPrice\` decimal(10,2),
      \`originalPrice\` decimal(10,2),
      \`isOnSale\` boolean NOT NULL DEFAULT false,
      \`discountPercent\` decimal(5,2),
      \`isActive\` boolean NOT NULL DEFAULT true,
      \`lastCrawledAt\` timestamp NULL,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`products_id\` PRIMARY KEY(\`id\`)
    )`);
    // ─── Crawl targets table ───────────────────────────────────────────────────
    await conn.execute(`CREATE TABLE IF NOT EXISTS \`crawl_targets\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`name\` varchar(200) NOT NULL,
      \`baseUrl\` text NOT NULL,
      \`productListSelector\` varchar(500) NOT NULL DEFAULT '.product-list',
      \`productNameSelector\` varchar(500) NOT NULL DEFAULT '.product-name',
      \`productPriceSelector\` varchar(500) NOT NULL DEFAULT '.product-price',
      \`productOriginalPriceSelector\` varchar(500),
      \`productLinkSelector\` varchar(500),
      \`productImageSelector\` varchar(500),
      \`paginationParam\` varchar(100) NOT NULL DEFAULT 'page',
      \`maxPages\` int NOT NULL DEFAULT 10,
      \`isActive\` boolean NOT NULL DEFAULT true,
      \`notes\` text,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`crawl_targets_id\` PRIMARY KEY(\`id\`)
    )`);
    // ─── News sources table ────────────────────────────────────────────────────
    await conn.execute(`CREATE TABLE IF NOT EXISTS \`news_sources\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`name\` varchar(200) NOT NULL,
      \`url\` text NOT NULL,
      \`articleSelector\` varchar(500) NOT NULL DEFAULT 'article',
      \`titleSelector\` varchar(500) NOT NULL DEFAULT '.entry-title a',
      \`dateSelector\` varchar(500),
      \`excerptSelector\` varchar(500),
      \`imageSelector\` varchar(500),
      \`paginationSelector\` varchar(500),
      \`maxPages\` int NOT NULL DEFAULT 5,
      \`isActive\` boolean NOT NULL DEFAULT true,
      \`notes\` text,
      \`lastCrawledAt\` timestamp NULL,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`news_sources_id\` PRIMARY KEY(\`id\`)
    )`);
    // ─── News articles table ───────────────────────────────────────────────────
    await conn.execute(`CREATE TABLE IF NOT EXISTS \`news_articles\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`sourceId\` int,
      \`sourceName\` varchar(200),
      \`title\` varchar(1000) NOT NULL,
      \`url\` text NOT NULL,
      \`excerpt\` text,
      \`imageUrl\` text,
      \`publishedAt\` timestamp NULL,
      \`crawledAt\` timestamp NOT NULL DEFAULT (now()),
      \`isRead\` boolean NOT NULL DEFAULT false,
      \`urlHash\` varchar(64),
      CONSTRAINT \`news_articles_id\` PRIMARY KEY(\`id\`),
      CONSTRAINT \`news_articles_urlHash_unique\` UNIQUE(\`urlHash\`)
    )`);
    // ─── News crawl jobs table ─────────────────────────────────────────────────
    await conn.execute(`CREATE TABLE IF NOT EXISTS \`news_crawl_jobs\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`sourceId\` int,
      \`sourceName\` varchar(200),
      \`jobType\` enum('scheduled','manual') NOT NULL DEFAULT 'manual',
      \`status\` enum('pending','running','completed','failed','stopped') NOT NULL DEFAULT 'pending',
      \`newArticles\` int DEFAULT 0,
      \`totalArticles\` int DEFAULT 0,
      \`errorMessage\` text,
      \`startedAt\` timestamp NULL,
      \`completedAt\` timestamp NULL,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`news_crawl_jobs_id\` PRIMARY KEY(\`id\`)
    )`);
    // Insert default password if not exists
    await conn.execute(
      `INSERT IGNORE INTO \`crawler_settings\` (\`key\`, \`value\`, \`description\`) VALUES ('access_password', 'CW150721', 'System access password')`
    );
    await conn.end();
    _migrated = true;
    console.log("[Database] Migrations completed successfully");
  } catch (error) {
    console.error("[Database] Migration failed:", error);
  }
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      await runMigrations(process.env.DATABASE_URL);
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── User Helpers ───────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;

  textFields.forEach((field) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  });

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Product Helpers ─────────────────────────────────────────────────────────

export async function getAllProducts(filters?: {
  category?: ProductCategory;
  isActive?: boolean;
  isOnSale?: boolean;
  search?: string;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.category) conditions.push(eq(products.category, filters.category));
  if (filters?.isActive !== undefined) conditions.push(eq(products.isActive, filters.isActive));
  if (filters?.isOnSale !== undefined) conditions.push(eq(products.isOnSale, filters.isOnSale));
  if (filters?.search) {
    conditions.push(
      or(
        like(products.name, `%${filters.search}%`),
        like(products.brand, `%${filters.search}%`)
      )
    );
  }

  const query = conditions.length > 0
    ? db.select().from(products).where(and(...conditions)).orderBy(desc(products.updatedAt))
    : db.select().from(products).orderBy(desc(products.updatedAt));

  return query;
}

export async function getProductById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createProduct(data: InsertProduct) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(products).values(data);
  return result;
}

export async function updateProduct(id: number, data: Partial<InsertProduct>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(products).set(data).where(eq(products.id, id));
}

export async function deleteProduct(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(products).where(eq(products.id, id));
}

export async function getProductStats() {
  const db = await getDb();
  if (!db) return { total: 0, onSale: 0, active: 0, categories: {} };

  const allProducts = await db.select().from(products).where(eq(products.isActive, true));
  const onSale = allProducts.filter((p) => p.isOnSale).length;

  const categories: Record<string, number> = {};
  allProducts.forEach((p) => {
    categories[p.category] = (categories[p.category] || 0) + 1;
  });

  return {
    total: allProducts.length,
    onSale,
    active: allProducts.length,
    categories,
  };
}

// ─── Price History Helpers ────────────────────────────────────────────────────

export async function getPriceHistory(productId: number, days = 30) {
  const db = await getDb();
  if (!db) return [];

  const since = new Date();
  since.setDate(since.getDate() - days);

  return db
    .select()
    .from(priceHistory)
    .where(and(eq(priceHistory.productId, productId), gte(priceHistory.crawledAt, since)))
    .orderBy(priceHistory.crawledAt);
}

export async function addPriceHistory(data: InsertPriceHistory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.insert(priceHistory).values(data);
}

export async function getLatestPriceForProduct(productId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(priceHistory)
    .where(eq(priceHistory.productId, productId))
    .orderBy(desc(priceHistory.crawledAt))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Crawl Job Helpers ────────────────────────────────────────────────────────

/** Reset any jobs stuck in 'running' state (e.g. after server restart). */
export async function resetStuckJobs() {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .update(crawlJobs)
    .set({ status: "stopped", completedAt: new Date() })
    .where(eq(crawlJobs.status, "running"));
  const affected = (result as unknown as { affectedRows?: number }[])[0]?.affectedRows ?? 0;
  if (affected > 0) {
    console.log(`[Database] Reset ${affected} stuck running job(s) to stopped`);
  }
  return affected;
}

export async function createCrawlJob(data: InsertCrawlJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(crawlJobs).values(data);
  return result;
}

export async function updateCrawlJob(id: number, data: Partial<InsertCrawlJob>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(crawlJobs).set(data).where(eq(crawlJobs.id, id));
}

export async function getCrawlJobs(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(crawlJobs).orderBy(desc(crawlJobs.createdAt)).limit(limit);
}

export async function getLatestCrawlJob() {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(crawlJobs).orderBy(desc(crawlJobs.createdAt)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function deleteCrawlJob(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(crawlJobs).where(eq(crawlJobs.id, id));
}

export async function deleteAllCrawlJobs() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Only delete non-running jobs to avoid deleting active jobs
  return db.delete(crawlJobs).where(
    and(
      sql`${crawlJobs.status} != 'running'`
    )
  );
}

export async function getAllProductsForExport() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(products).orderBy(desc(products.updatedAt));
}

export async function getPriceHistoryForExport(productIds?: number[], days = 90) {
  const db = await getDb();
  if (!db) return [];

  const since = new Date();
  since.setDate(since.getDate() - days);

  const conditions = [gte(priceHistory.crawledAt, since)];
  if (productIds && productIds.length > 0) {
    conditions.push(inArray(priceHistory.productId, productIds));
  }

  return db
    .select()
    .from(priceHistory)
    .where(and(...conditions))
    .orderBy(desc(priceHistory.crawledAt));
}

// ─── Notification Helpers ─────────────────────────────────────────────────────

export async function createNotification(data: InsertNotification) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.insert(notifications).values(data);
}

export async function getNotifications(limit = 50, unreadOnly = false) {
  const db = await getDb();
  if (!db) return [];

  const query = unreadOnly
    ? db
        .select()
        .from(notifications)
        .where(eq(notifications.isRead, false))
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
    : db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit);

  return query;
}

export async function markNotificationRead(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
}

export async function markAllNotificationsRead() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(notifications).set({ isRead: true }).where(eq(notifications.isRead, false));
}

export async function getUnreadNotificationCount() {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(eq(notifications.isRead, false));
  return result[0]?.count ?? 0;
}

// ─── Crawler Settings Helpers ─────────────────────────────────────────────────

export async function getCrawlerSettings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(crawlerSettings);
}

export async function updateCrawlerSetting(key: string, value: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .insert(crawlerSettings)
    .values({ key, value })
    .onDuplicateKeyUpdate({ set: { value } });
}

export async function getAccessPassword(): Promise<string> {
  const db = await getDb();
  if (!db) return "cw2024"; // fallback default
  const result = await db
    .select()
    .from(crawlerSettings)
    .where(eq(crawlerSettings.key, "access_password"))
    .limit(1);
  return result[0]?.value ?? "CW150721";
}

// ─── Crawl Targets Helpers ────────────────────────────────────────────────────
export async function getCrawlTargets() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(crawlTargets).orderBy(desc(crawlTargets.createdAt));
}

export async function getCrawlTargetById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(crawlTargets).where(eq(crawlTargets.id, id)).limit(1);
  return result[0] ?? null;
}

export async function createCrawlTarget(data: InsertCrawlTarget) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(crawlTargets).values(data);
  return result;
}

export async function updateCrawlTarget(id: number, data: Partial<InsertCrawlTarget>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(crawlTargets).set(data).where(eq(crawlTargets.id, id));
}

export async function deleteCrawlTarget(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(crawlTargets).where(eq(crawlTargets.id, id));
}


// ============================================================
// News Sources
// ============================================================
export async function getNewsSources() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(newsSources).orderBy(desc(newsSources.createdAt));
}
export async function getNewsSourceById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(newsSources).where(eq(newsSources.id, id));
  return rows[0] ?? null;
}
export async function createNewsSource(data: InsertNewsSource) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.insert(newsSources).values(data);
}
export async function updateNewsSource(id: number, data: Partial<InsertNewsSource>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(newsSources).set({ ...data, updatedAt: new Date() }).where(eq(newsSources.id, id));
}
export async function deleteNewsSource(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Also delete related articles and jobs
  await db.delete(newsArticles).where(eq(newsArticles.sourceId, id));
  await db.delete(newsCrawlJobs).where(eq(newsCrawlJobs.sourceId, id));
  return db.delete(newsSources).where(eq(newsSources.id, id));
}
export async function toggleNewsSourceActive(id: number, isActive: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(newsSources).set({ isActive, updatedAt: new Date() }).where(eq(newsSources.id, id));
}

// ============================================================
// News Articles
// ============================================================
export async function getNewsArticles(opts?: { sourceId?: number; isRead?: boolean; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (opts?.sourceId !== undefined) conditions.push(eq(newsArticles.sourceId, opts.sourceId));
  if (opts?.isRead !== undefined) conditions.push(eq(newsArticles.isRead, opts.isRead));
  const query = db.select().from(newsArticles)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(newsArticles.crawledAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);
  return query;
}
export async function countNewsArticles(opts?: { sourceId?: number; isRead?: boolean }) {
  const db = await getDb();
  if (!db) return 0;
  const conditions = [];
  if (opts?.sourceId !== undefined) conditions.push(eq(newsArticles.sourceId, opts.sourceId));
  if (opts?.isRead !== undefined) conditions.push(eq(newsArticles.isRead, opts.isRead));
  const rows = await db.select({ count: sql<number>`count(*)` }).from(newsArticles)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  return Number(rows[0]?.count ?? 0);
}
export async function upsertNewsArticle(data: InsertNewsArticle) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Check if article with same URL already exists
  const existing = await db.select({ id: newsArticles.id }).from(newsArticles)
    .where(eq(newsArticles.url, data.url as string));
  if (existing.length > 0) return { inserted: false, id: existing[0].id };
  const result = await db.insert(newsArticles).values(data);
  return { inserted: true, id: (result as any).insertId };
}
export async function markNewsArticleRead(id: number, isRead: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(newsArticles).set({ isRead }).where(eq(newsArticles.id, id));
}
export async function markAllNewsArticlesRead(sourceId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (sourceId !== undefined) {
    return db.update(newsArticles).set({ isRead: true }).where(eq(newsArticles.sourceId, sourceId));
  }
  return db.update(newsArticles).set({ isRead: true });
}
export async function deleteNewsArticle(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(newsArticles).where(eq(newsArticles.id, id));
}
export async function deleteAllNewsArticles(sourceId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (sourceId !== undefined) {
    return db.delete(newsArticles).where(eq(newsArticles.sourceId, sourceId));
  }
  return db.delete(newsArticles);
}

// ============================================================
// News Crawl Jobs
// ============================================================
export async function getNewsCrawlJobs(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(newsCrawlJobs).orderBy(desc(newsCrawlJobs.createdAt)).limit(limit);
}
export async function createNewsCrawlJob(data: InsertNewsCrawlJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(newsCrawlJobs).values(data);
  return (result as any).insertId as number;
}
export async function updateNewsCrawlJob(id: number, data: Partial<InsertNewsCrawlJob>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(newsCrawlJobs).set(data).where(eq(newsCrawlJobs.id, id));
}
export async function deleteNewsCrawlJob(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(newsCrawlJobs).where(eq(newsCrawlJobs.id, id));
}
export async function deleteAllNewsCrawlJobs() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(newsCrawlJobs);
}
export async function resetStuckNewsCrawlJobs() {
  const db = await getDb();
  if (!db) return;
  await db.update(newsCrawlJobs)
    .set({ status: "stopped", completedAt: new Date() })
    .where(eq(newsCrawlJobs.status, "running"));
}
