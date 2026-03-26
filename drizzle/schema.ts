import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  boolean,
  json,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Product categories for Chemist Warehouse
 */
export const PRODUCT_CATEGORIES = [
  "beauty_skincare",
  "adult_health",
  "childrens_health",
  "vegan_health",
  "natural_soap",
  "oral_care",
  "medicines",
  "other",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  beauty_skincare: "美妚護膚",
  adult_health: "成人保健",
  childrens_health: "兒童保健",
  vegan_health: "純素保健",
  natural_soap: "天然香皂",
  oral_care: "口腔保健",
  medicines: "藥品",
  other: "其他",
};

/**
 * Products table - stores tracked products from Chemist Warehouse
 */
export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 500 }).notNull(),
  brand: varchar("brand", { length: 200 }),
  sku: varchar("sku", { length: 100 }),
  url: text("url").notNull(),
  imageUrl: text("imageUrl"),
  category: mysqlEnum("category", PRODUCT_CATEGORIES).default("other").notNull(),
  currentPrice: decimal("currentPrice", { precision: 10, scale: 2 }),
  originalPrice: decimal("originalPrice", { precision: 10, scale: 2 }),
  isOnSale: boolean("isOnSale").default(false).notNull(),
  discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }),
  isActive: boolean("isActive").default(true).notNull(),
  lastCrawledAt: timestamp("lastCrawledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

/**
 * Price history table - tracks price changes over time
 */
export const priceHistory = mysqlTable("price_history", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  originalPrice: decimal("originalPrice", { precision: 10, scale: 2 }),
  isOnSale: boolean("isOnSale").default(false).notNull(),
  discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }),
  crawledAt: timestamp("crawledAt").defaultNow().notNull(),
});

export type PriceHistory = typeof priceHistory.$inferSelect;
export type InsertPriceHistory = typeof priceHistory.$inferInsert;

/**
 * Crawl jobs table - scheduled and manual crawl tasks
 */
export const crawlJobs = mysqlTable("crawl_jobs", {
  id: int("id").autoincrement().primaryKey(),
  jobType: mysqlEnum("jobType", ["scheduled", "manual"]).default("manual").notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed", "stopped"]).default("pending").notNull(),
  category: mysqlEnum("category", [...PRODUCT_CATEGORIES, "all"]).default("all"),
  totalProducts: int("totalProducts").default(0),
  crawledProducts: int("crawledProducts").default(0),
  failedProducts: int("failedProducts").default(0),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CrawlJob = typeof crawlJobs.$inferSelect;
export type InsertCrawlJob = typeof crawlJobs.$inferInsert;

/**
 * Notifications table - price change and sale alerts
 */
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull(),
  type: mysqlEnum("type", ["price_drop", "price_increase", "new_sale", "sale_ended"]).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  message: text("message").notNull(),
  oldPrice: decimal("oldPrice", { precision: 10, scale: 2 }),
  newPrice: decimal("newPrice", { precision: 10, scale: 2 }),
  changePercent: decimal("changePercent", { precision: 5, scale: 2 }),
  isRead: boolean("isRead").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * Crawler settings table - configurable settings
 */
export const crawlerSettings = mysqlTable("crawler_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CrawlerSettings = typeof crawlerSettings.$inferSelect;

/**
 * Crawl targets table - user-defined websites to crawl
 */
export const crawlTargets = mysqlTable("crawl_targets", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  baseUrl: text("baseUrl").notNull(),
  productListSelector: text("productListSelector").notNull(),
  productNameSelector: text("productNameSelector").notNull(),
  productPriceSelector: text("productPriceSelector").notNull(),
  productOriginalPriceSelector: text("productOriginalPriceSelector"),
  productLinkSelector: text("productLinkSelector").notNull(),
  productImageSelector: text("productImageSelector"),
  paginationParam: varchar("paginationParam", { length: 50 }).default("page").notNull(),
  maxPages: int("maxPages").default(10).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CrawlTarget = typeof crawlTargets.$inferSelect;
export type InsertCrawlTarget = typeof crawlTargets.$inferInsert;

/**
 * News sources table - user-defined news/blog websites to monitor
 */
export const newsSources = mysqlTable("news_sources", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  url: text("url").notNull(),
  articleSelector: text("articleSelector").notNull().default("article"),
  titleSelector: text("titleSelector").notNull().default(".entry-title a"),
  dateSelector: text("dateSelector").default(".entry-date"),
  excerptSelector: text("excerptSelector").default(".entry-summary"),
  imageSelector: text("imageSelector").default(".wp-post-image"),
  paginationSelector: text("paginationSelector").default(".pagination a.next"),
  maxPages: int("maxPages").default(5).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  notes: text("notes"),
  lastCrawledAt: timestamp("lastCrawledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NewsSource = typeof newsSources.$inferSelect;
export type InsertNewsSource = typeof newsSources.$inferInsert;

/**
 * News articles table - crawled news articles
 */
export const newsArticles = mysqlTable("news_articles", {
  id: int("id").autoincrement().primaryKey(),
  sourceId: int("sourceId"),
  sourceName: varchar("sourceName", { length: 200 }),
  title: varchar("title", { length: 1000 }).notNull(),
  url: text("url").notNull(),
  excerpt: text("excerpt"),
  imageUrl: text("imageUrl"),
  publishedAt: timestamp("publishedAt"),
  crawledAt: timestamp("crawledAt").defaultNow().notNull(),
  isRead: boolean("isRead").default(false).notNull(),
  urlHash: varchar("urlHash", { length: 64 }),
});

export type NewsArticle = typeof newsArticles.$inferSelect;
export type InsertNewsArticle = typeof newsArticles.$inferInsert;

/**
 * News crawl jobs table - news crawl task history
 */
export const newsCrawlJobs = mysqlTable("news_crawl_jobs", {
  id: int("id").autoincrement().primaryKey(),
  sourceId: int("sourceId"),
  sourceName: varchar("sourceName", { length: 200 }),
  jobType: mysqlEnum("jobType", ["scheduled", "manual"]).default("manual").notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed", "stopped"]).default("pending").notNull(),
  newArticles: int("newArticles").default(0),
  totalArticles: int("totalArticles").default(0),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type NewsCrawlJob = typeof newsCrawlJobs.$inferSelect;
export type InsertNewsCrawlJob = typeof newsCrawlJobs.$inferInsert;

/**
 * Tenders table - government procurement tender data from acebidx API
 */
export const tenders = mysqlTable("tenders", {
  id: varchar("id", { length: 36 }).primaryKey(),
  source: varchar("source", { length: 20 }).notNull().default("acebidx"),
  projectNumber: varchar("projectNumber", { length: 50 }),
  projectName: text("projectName").notNull(),
  orgId: varchar("orgId", { length: 50 }),
  orgName: varchar("orgName", { length: 300 }),
  budget: int("budget"),
  catName: varchar("catName", { length: 100 }),
  typeofTender: varchar("typeofTender", { length: 200 }),
  typeofAward: varchar("typeofAward", { length: 200 }),
  isBudgetPublic: boolean("isBudgetPublic").default(true),
  postDate: varchar("postDate", { length: 20 }),
  submitDeadline: varchar("submitDeadline", { length: 30 }),
  queryDate: varchar("queryDate", { length: 20 }),
  // AI scoring fields
  aiScore: int("aiScore"),
  aiPriority: varchar("aiPriority", { length: 10 }),   // High / Medium / Low
  aiRecommend: boolean("aiRecommend"),
  aiCategory: varchar("aiCategory", { length: 20 }),   // 教育 / AI / 活動 / 系統 / 其他
  aiBudgetFit: varchar("aiBudgetFit", { length: 10 }), // 符合 / 偏高 / 過高
  aiReasons: json("aiReasons"),
  aiRisks: json("aiRisks"),
  scoredAt: timestamp("scoredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Tender = typeof tenders.$inferSelect;
export type InsertTender = typeof tenders.$inferInsert;

/**
 * Tender crawl jobs table - crawl task history for acebidx
 */
export const tenderCrawlJobs = mysqlTable("tender_crawl_jobs", {
  id: int("id").autoincrement().primaryKey(),
  jobType: mysqlEnum("jobType", ["scheduled", "manual"]).default("manual").notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed"]).default("pending").notNull(),
  newTenders: int("newTenders").default(0),
  totalFetched: int("totalFetched").default(0),
  scoredCount: int("scoredCount").default(0),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TenderCrawlJob = typeof tenderCrawlJobs.$inferSelect;
export type InsertTenderCrawlJob = typeof tenderCrawlJobs.$inferInsert;
