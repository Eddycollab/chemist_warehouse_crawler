/**
 * tenderScorer.ts
 * AI-powered tender scoring engine using LLM.
 * Evaluates each tender based on company strategy and returns structured JSON scores.
 */

import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { tenders } from "../drizzle/schema";
import { eq, isNull } from "drizzle-orm";

const SYSTEM_PROMPT = `你是一個政府標案商機篩選專家，請根據公司資源限制與策略，篩選最適合投標的案件。

【公司策略】
- 人力有限（小團隊）
- 優先承接：學校活動、教育訓練、AI數位精進、數位學習
- 不適合：大型系統、長期維運、大型工程案

【金額策略】
- 20萬~50萬 → 高優先
- 50萬~100萬 → 最佳優先
- 100萬~300萬 → 中優先（需評估）
- 超過300萬 → 原則不建議
- 未公開預算 → 中優先（需進一步了解）

【關鍵字優先】
強匹配：AI、數位精進、教育訓練、學校活動、數位學習、課程、教師研習
排除：工程、硬體採購、建築、大型系統整合

【評分邏輯】
- 金額符合（20萬~100萬）：+30
- 強關鍵字匹配：+30
- 客戶為學校/政府教育單位：+20
- 案子簡單（活動/課程）：+20
- 金額過高（超過300萬）：-40
- 複雜系統整合：-30

請輸出嚴格符合以下 JSON schema 的結果，不要輸出任何其他文字：`;

interface TenderInput {
  id: string;
  projectName: string;
  orgName?: string | null;
  budget?: number | null;
  catName?: string | null;
  typeofTender?: string | null;
}

interface ScoreResult {
  tender_id: string;
  recommend: "Yes" | "No";
  priority: "High" | "Medium" | "Low";
  budget_fit: "符合" | "偏高" | "過高" | "未知";
  category: "教育" | "AI" | "活動" | "系統" | "其他";
  score: number;
  reasons: string[];
  risks: string[];
}

/**
 * Score a batch of tenders using LLM
 */
export async function scoreTenders(tenderList: TenderInput[]): Promise<ScoreResult[]> {
  if (tenderList.length === 0) return [];

  const tenderJson = JSON.stringify(
    tenderList.map(t => ({
      tender_id: t.id,
      title: t.projectName,
      org: t.orgName ?? "未知機關",
      budget: t.budget ? `${Math.round(t.budget / 10000)}萬` : "未公開",
      category: t.catName ?? "未分類",
      tender_type: t.typeofTender ?? "未知",
    })),
    null,
    2
  );

  const response = await invokeLLM({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `【標案資料】\n${tenderJson}\n\n請針對每個標案輸出評分結果，格式為 JSON 陣列。`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "tender_scores",
        strict: true,
        schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  tender_id: { type: "string" },
                  recommend: { type: "string", enum: ["Yes", "No"] },
                  priority: { type: "string", enum: ["High", "Medium", "Low"] },
                  budget_fit: { type: "string", enum: ["符合", "偏高", "過高", "未知"] },
                  category: { type: "string", enum: ["教育", "AI", "活動", "系統", "其他"] },
                  score: { type: "integer" },
                  reasons: { type: "array", items: { type: "string" } },
                  risks: { type: "array", items: { type: "string" } },
                },
                required: ["tender_id", "recommend", "priority", "budget_fit", "category", "score", "reasons", "risks"],
                additionalProperties: false,
              },
            },
          },
          required: ["results"],
          additionalProperties: false,
        },
      },
    },
  });

  const rawContent = response?.choices?.[0]?.message?.content;
  if (!rawContent) return [];
  const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

  const parsed = JSON.parse(content);
  return parsed.results as ScoreResult[];
}

/**
 * Score all unscored tenders in the database (batch of 20 at a time)
 */
export async function scoreUnscoredTenders(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Fetch up to 20 unscored tenders
  const unscoredList = await db
    .select()
    .from(tenders)
    .where(isNull(tenders.aiScore))
    .limit(20);

  if (unscoredList.length === 0) return 0;

  const inputs: TenderInput[] = unscoredList.map(t => ({
    id: t.id,
    projectName: t.projectName,
    orgName: t.orgName,
    budget: t.budget,
    catName: t.catName,
    typeofTender: t.typeofTender,
  }));

  let scored = 0;
  try {
    const results = await scoreTenders(inputs);

    for (const result of results) {
      await db
        .update(tenders)
        .set({
          aiScore: result.score,
          aiPriority: result.priority,
          aiRecommend: result.recommend === "Yes",
          aiCategory: result.category,
          aiBudgetFit: result.budget_fit,
          aiReasons: result.reasons,
          aiRisks: result.risks,
          scoredAt: new Date(),
        })
        .where(eq(tenders.id, result.tender_id));
      scored++;
    }
  } catch (err) {
    console.error("[TenderScorer] Error scoring tenders:", err);
  }

  return scored;
}

/**
 * Re-score a single tender by ID
 */
export async function rescoreTender(tenderId: string): Promise<ScoreResult | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(tenders).where(eq(tenders.id, tenderId)).limit(1);
  if (rows.length === 0) return null;

  const t = rows[0];
  const results = await scoreTenders([{
    id: t.id,
    projectName: t.projectName,
    orgName: t.orgName,
    budget: t.budget,
    catName: t.catName,
    typeofTender: t.typeofTender,
  }]);

  if (results.length === 0) return null;
  const result = results[0];

  await db
    .update(tenders)
    .set({
      aiScore: result.score,
      aiPriority: result.priority,
      aiRecommend: result.recommend === "Yes",
      aiCategory: result.category,
      aiBudgetFit: result.budget_fit,
      aiReasons: result.reasons,
      aiRisks: result.risks,
      scoredAt: new Date(),
    })
    .where(eq(tenders.id, tenderId));

  return result;
}
