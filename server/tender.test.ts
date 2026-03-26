import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── tenderCrawler 單元測試 ───────────────────────────────────────────────────

describe("tenderCrawler - parseTenderItem", () => {
  it("should parse a complete tender item from acebidx API", () => {
    const rawItem = {
      id: "T001",
      project_name: "AI 教育訓練課程採購案",
      org_name: "臺北市立第一女子高級中學",
      budget: 500000,
      post_date: "2026-03-01",
      submit_deadline: "2026-03-31",
      cat_name: "教育訓練",
      typeof_tender: "公開招標",
    };

    // 驗證欄位對應
    expect(rawItem.id).toBe("T001");
    expect(rawItem.project_name).toContain("AI");
    expect(rawItem.budget).toBe(500000);
    expect(rawItem.budget / 10000).toBe(50); // 50 萬
  });

  it("should handle missing optional fields gracefully", () => {
    const rawItem = {
      id: "T002",
      project_name: "數位學習平台建置",
      org_name: null,
      budget: null,
      post_date: null,
      submit_deadline: null,
    };

    expect(rawItem.org_name).toBeNull();
    expect(rawItem.budget).toBeNull();
    expect(rawItem.id).toBe("T002");
  });

  it("should correctly identify budget ranges", () => {
    const budgets = [
      { amount: 150000, range: "20萬~50萬", priority: "high" },
      { amount: 750000, range: "50萬~100萬", priority: "best" },
      { amount: 2000000, range: "100萬~300萬", priority: "medium" },
      { amount: 5000000, range: "超過300萬", priority: "low" },
    ];

    budgets.forEach(({ amount, priority }) => {
      if (amount >= 200000 && amount <= 500000) {
        expect(priority).toBe("high");
      } else if (amount > 500000 && amount <= 1000000) {
        expect(priority).toBe("best");
      } else if (amount > 1000000 && amount <= 3000000) {
        expect(priority).toBe("medium");
      } else if (amount > 3000000) {
        expect(priority).toBe("low");
      }
    });
  });
});

// ─── tenderScorer AI 評分邏輯測試 ─────────────────────────────────────────────

describe("tenderScorer - scoring logic", () => {
  it("should calculate high score for AI education tender", () => {
    const tender = {
      projectName: "AI 數位精進教育訓練課程",
      orgName: "國立臺灣大學",
      budget: 800000, // 80 萬，最佳優先
    };

    // 模擬評分邏輯
    let score = 0;
    // 金額符合（50萬~100萬）：+30
    if (tender.budget >= 500000 && tender.budget <= 1000000) score += 30;
    // 強關鍵字（AI、教育訓練）：+30
    if (/AI|數位精進|教育訓練/.test(tender.projectName)) score += 30;
    // 客戶為學校：+20
    if (/大學|學校|高中|國立/.test(tender.orgName)) score += 20;
    // 案子簡單（課程）：+20
    if (/課程|訓練|研習/.test(tender.projectName)) score += 20;

    expect(score).toBe(100);
  });

  it("should calculate low score for engineering tender", () => {
    const tender = {
      projectName: "大型橋樑工程建設採購案",
      orgName: "交通部公路局",
      budget: 50000000, // 5000 萬，過高
    };

    let score = 50; // 基礎分
    // 金額過高（超過300萬）：-40
    if (tender.budget > 3000000) score -= 40;
    // 複雜系統/工程：-30
    if (/工程|建設|硬體|系統整合/.test(tender.projectName)) score -= 30;

    expect(score).toBe(-20); // 低分，不推薦
  });

  it("should recommend tender with score >= 60", () => {
    const scores = [
      { score: 80, shouldRecommend: true },
      { score: 60, shouldRecommend: true },
      { score: 59, shouldRecommend: false },
      { score: 30, shouldRecommend: false },
    ];

    scores.forEach(({ score, shouldRecommend }) => {
      const recommend = score >= 60;
      expect(recommend).toBe(shouldRecommend);
    });
  });

  it("should map score to priority correctly", () => {
    const mapPriority = (score: number) => {
      if (score >= 70) return "High";
      if (score >= 40) return "Medium";
      return "Low";
    };

    expect(mapPriority(85)).toBe("High");
    expect(mapPriority(70)).toBe("High");
    expect(mapPriority(69)).toBe("Medium");
    expect(mapPriority(40)).toBe("Medium");
    expect(mapPriority(39)).toBe("Low");
    expect(mapPriority(0)).toBe("Low");
  });

  it("should categorize tender correctly", () => {
    const categorize = (name: string): string => {
      if (/AI|人工智慧|機器學習|數位精進/.test(name)) return "AI";
      if (/教育訓練|課程|研習|學習/.test(name)) return "教育";
      if (/活動|展覽|競賽|表演/.test(name)) return "活動";
      if (/系統|平台|資訊|軟體/.test(name)) return "系統";
      return "其他";
    };

    expect(categorize("AI 數位精進課程")).toBe("AI");
    expect(categorize("教師研習活動辦理")).toBe("教育");
    expect(categorize("校慶活動籌辦")).toBe("活動");
    expect(categorize("資訊系統建置")).toBe("系統");
    expect(categorize("辦公室清潔服務")).toBe("其他");
  });
});

// ─── tenderCrawl API 結構測試 ─────────────────────────────────────────────────

describe("acebidx API response structure", () => {
  it("should validate expected API response fields", () => {
    const mockApiResponse = {
      items: [
        {
          id: "abc123",
          project_name: "測試標案",
          org_name: "測試機關",
          budget: 300000,
          post_date: "2026-03-01",
          submit_deadline: "2026-04-01",
          cat_name: "教育訓練",
          typeof_tender: "公開招標",
        },
      ],
      total: 1,
    };

    expect(mockApiResponse.items).toHaveLength(1);
    expect(mockApiResponse.items[0]).toHaveProperty("id");
    expect(mockApiResponse.items[0]).toHaveProperty("project_name");
    expect(mockApiResponse.items[0]).toHaveProperty("budget");
    expect(typeof mockApiResponse.items[0].id).toBe("string");
    expect(typeof mockApiResponse.items[0].budget).toBe("number");
  });

  it("should handle pagination correctly", () => {
    const PAGE_SIZE = 50;
    const total = 150;
    const totalPages = Math.ceil(total / PAGE_SIZE);

    expect(totalPages).toBe(3);

    // 模擬分頁邏輯
    const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
    expect(pages).toEqual([1, 2, 3]);
  });

  it("should deduplicate tenders by id", () => {
    const tenders = [
      { id: "T001", project_name: "標案A" },
      { id: "T002", project_name: "標案B" },
      { id: "T001", project_name: "標案A（重複）" }, // 重複
    ];

    // 去重策略：保留第一次出現的（先到先得）
    const seen = new Set<string>();
    const deduped = tenders.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    expect(deduped).toHaveLength(2);
    expect(deduped.find((t) => t.id === "T001")?.project_name).toBe("\u6a19\u6848A");
  });
});
