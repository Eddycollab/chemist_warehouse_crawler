/**
 * tenderCrawler.ts
 * Fetches government tender data from the acebidx API and stores it in the database.
 * The acebidx backend is a public Python API (no auth required).
 */

import { getDb } from "./db";
import { tenders, tenderCrawlJobs, InsertTender } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const ACEBIDX_API_BASE = "https://tendersanic-dimlok2rsq-de.a.run.app";
const PAGE_SIZE = 50;

interface AcebidxTender {
  id: string;
  projectNumber?: string;
  projectName: string;
  orgId?: string;
  orgName?: string;
  budget?: number;
  catName?: string;
  typeofTender?: string;
  typeofAward?: string;
  isBudgetPublic?: boolean;
  postDate?: string;
  submitDeadline?: string;
  queryDate?: string;
}

interface AcebidxResponse {
  data: AcebidxTender[];
  total?: number;
  page?: number;
}

/**
 * Fetch one page of tenders from acebidx API
 */
async function fetchTenderPage(page: number = 1): Promise<AcebidxResponse> {
  const url = `${ACEBIDX_API_BASE}/tender?page=${page}&page_size=${PAGE_SIZE}`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "GovTenderBot/1.0",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`acebidx API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  // Handle both array response and object with data field
  if (Array.isArray(json)) {
    return { data: json };
  }
  return json as AcebidxResponse;
}

/**
 * Upsert a single tender into the database (skip if already exists)
 */
async function upsertTender(tender: AcebidxTender): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(tenders).where(eq(tenders.id, tender.id)).limit(1);

  if (existing.length > 0) return false; // already exists, skip

  const row: InsertTender = {
    id: tender.id,
    source: "acebidx",
    projectNumber: tender.projectNumber ?? null,
    projectName: tender.projectName,
    orgId: tender.orgId ?? null,
    orgName: tender.orgName ?? null,
    budget: tender.budget ?? null,
    catName: tender.catName ?? null,
    typeofTender: tender.typeofTender ?? null,
    typeofAward: tender.typeofAward ?? null,
    isBudgetPublic: tender.isBudgetPublic ?? true,
    postDate: tender.postDate ?? null,
    submitDeadline: tender.submitDeadline ?? null,
    queryDate: tender.queryDate ?? null,
  };

  await db.insert(tenders).values(row);
  return true; // newly inserted
}

export interface CrawlResult {
  jobId: number;
  totalFetched: number;
  newTenders: number;
  errorMessage?: string;
  status: "completed" | "failed";
}

/**
 * Main crawl function: fetch all pages from acebidx and store new tenders
 */
export async function runTenderCrawl(jobType: "scheduled" | "manual" = "manual"): Promise<CrawlResult> {
  // Create job record
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [jobRow] = await db
    .insert(tenderCrawlJobs)
    .values({ jobType, status: "running", startedAt: new Date() });

  const jobId = (jobRow as any).insertId as number;

  let totalFetched = 0;
  let newTenders = 0;
  let errorMessage: string | undefined;

  try {
    // Fetch first page to determine total
    const firstPage = await fetchTenderPage(1);
    const items = firstPage.data ?? [];
    totalFetched += items.length;

    for (const item of items) {
      const isNew = await upsertTender(item);
      if (isNew) newTenders++;
    }

    // If there are more pages (API returns exactly PAGE_SIZE items), fetch next pages
    // Limit to 10 pages max (500 tenders) per crawl to avoid overload
    let page = 2;
    while (items.length === PAGE_SIZE && page <= 10) {
      const nextPage = await fetchTenderPage(page);
      const nextItems = nextPage.data ?? [];
      if (nextItems.length === 0) break;

      totalFetched += nextItems.length;
      for (const item of nextItems) {
        const isNew = await upsertTender(item);
        if (isNew) newTenders++;
      }

      // If we're getting no new tenders, stop early (we've caught up)
      if (newTenders === 0 && page > 2) break;

      page++;
    }

    // Update job as completed
    await db
      .update(tenderCrawlJobs)
      .set({
        status: "completed" as const,
        totalFetched,
        newTenders,
        completedAt: new Date(),
      })
      .where(eq(tenderCrawlJobs.id, jobId));

    return { jobId, totalFetched, newTenders, status: "completed" };
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[TenderCrawler] Error:", errorMessage);

    const dbForError = await getDb();
    if (dbForError) await dbForError
      .update(tenderCrawlJobs)
      .set({
        status: "failed" as const,
        totalFetched,
        newTenders,
        errorMessage,
        completedAt: new Date(),
      })
      .where(eq(tenderCrawlJobs.id, jobId));

    return { jobId, totalFetched, newTenders, errorMessage, status: "failed" };
  }
}
