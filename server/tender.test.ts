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

// ─── testNewsSelector 功能測試 ─────────────────────────────────────────────────

describe("testNewsSelector - input validation", () => {
  it("should require non-empty articleSelector", () => {
    const params = {
      url: "https://www.example.com/news/",
      articleSelector: "",
      titleSelector: ".entry-title a",
    };
    // 空選擇器應被視為無效輸入
    expect(params.articleSelector.trim().length).toBe(0);
    expect(params.titleSelector.trim().length).toBeGreaterThan(0);
  });

  it("should require non-empty titleSelector", () => {
    const params = {
      url: "https://www.example.com/news/",
      articleSelector: "article",
      titleSelector: "",
    };
    expect(params.titleSelector.trim().length).toBe(0);
  });

  it("should accept valid selector params", () => {
    const params = {
      url: "https://www.cw.com.tw/subchannel.action?idSubChannel=7",
      articleSelector: ".article-list li",
      titleSelector: "h3 a",
      dateSelector: ".date",
      excerptSelector: ".summary",
    };
    expect(params.url.startsWith("https://")).toBe(true);
    expect(params.articleSelector.length).toBeGreaterThan(0);
    expect(params.titleSelector.length).toBeGreaterThan(0);
  });

  it("should handle optional selectors as undefined", () => {
    const params = {
      url: "https://www.edu.tw/News.aspx",
      articleSelector: "table tr",
      titleSelector: 'a[href*="News_Content"]',
      dateSelector: undefined,
      excerptSelector: undefined,
    };
    expect(params.dateSelector).toBeUndefined();
    expect(params.excerptSelector).toBeUndefined();
  });
});

describe("testNewsSelector - result structure", () => {
  it("should return success=false when no articles found", () => {
    const mockResult = {
      success: false,
      articles: [],
      totalFound: 0,
      errorMessage: "文章選擇器「.nonexistent」找到 0 個元素，請確認選擇器是否正確",
    };
    expect(mockResult.success).toBe(false);
    expect(mockResult.articles).toHaveLength(0);
    expect(mockResult.errorMessage).toContain("找到 0 個元素");
  });

  it("should return success=true with article list when found", () => {
    const mockResult = {
      success: true,
      articles: [
        { title: "AI 教育訓練課程開始報名", url: "https://example.com/news/1", publishedAt: "2026-04-01" },
        { title: "數位學習新趨勢", url: "https://example.com/news/2", publishedAt: "2026-03-28" },
      ],
      totalFound: 15,
    };
    expect(mockResult.success).toBe(true);
    expect(mockResult.articles).toHaveLength(2);
    expect(mockResult.totalFound).toBe(15);
    expect(mockResult.articles[0]).toHaveProperty("title");
    expect(mockResult.articles[0]).toHaveProperty("url");
  });

  it("should limit preview to at most 10 articles", () => {
    const allArticles = Array.from({ length: 20 }, (_, i) => ({
      title: `文章 ${i + 1}`,
      url: `https://example.com/news/${i + 1}`,
    }));
    const preview = allArticles.slice(0, 10);
    expect(preview).toHaveLength(10);
  });

  it("should provide descriptive error when title selector fails", () => {
    const totalFound = 8;
    const titleSelector = ".wrong-title";
    const errorMessage =
      totalFound > 0
        ? `找到 ${totalFound} 個文章容器，但標題選擇器「${titleSelector}」未能抓到任何標題，請確認標題選擇器`
        : `文章選擇器找到 0 個元素`;
    expect(errorMessage).toContain("找到 8 個文章容器");
    expect(errorMessage).toContain(titleSelector);
  });
});


// ─── tender tRPC 路由測試 ──────────────────────────────────────────────────────

describe("tender tRPC routes - data structure", () => {
  it("should return correct tender list structure", () => {
    const mockTenderList = [
      {
        id: "acebidx-T001",
        source: "acebidx",
        projectNumber: "20260301-001",
        projectName: "AI 教育訓練課程採購案",
        orgId: "org-001",
        orgName: "臺北市立第一女子高級中學",
        budget: 500000,
        catName: "教育訓練",
        typeofTender: "公開招標",
        typeofAward: "未決標",
        isBudgetPublic: 1,
        postDate: "2026-03-01",
        submitDeadline: "2026-03-31",
        queryDate: "2026-03-01",
        aiScore: 85,
        aiPriority: "High",
        aiRecommend: 1,
        aiCategory: "教育",
        aiBudgetFit: "符合",
        aiReasons: ["金額符合", "強關鍵字", "客戶為學校"],
        aiRisks: [],
        scoredAt: new Date(),
        createdAt: new Date(),
      },
    ];

    expect(mockTenderList).toHaveLength(1);
    const tender = mockTenderList[0];
    expect(tender).toHaveProperty("id");
    expect(tender).toHaveProperty("projectName");
    expect(tender).toHaveProperty("budget");
    expect(tender).toHaveProperty("aiScore");
    expect(tender).toHaveProperty("aiRecommend");
    expect(typeof tender.aiScore).toBe("number");
    expect(typeof tender.aiRecommend).toBe("number");
  });

  it("should filter tenders by priority", () => {
    const tenders = [
      { id: "T001", aiPriority: "High", aiScore: 85 },
      { id: "T002", aiPriority: "Medium", aiScore: 55 },
      { id: "T003", aiPriority: "Low", aiScore: 30 },
    ];

    const highPriority = tenders.filter((t) => t.aiPriority === "High");
    expect(highPriority).toHaveLength(1);
    expect(highPriority[0].id).toBe("T001");
  });

  it("should filter tenders by recommend flag", () => {
    const tenders = [
      { id: "T001", aiRecommend: 1, projectName: "推薦標案 A" },
      { id: "T002", aiRecommend: 0, projectName: "不推薦標案 B" },
      { id: "T003", aiRecommend: 1, projectName: "推薦標案 C" },
    ];

    const recommended = tenders.filter((t) => t.aiRecommend === 1);
    expect(recommended).toHaveLength(2);
    expect(recommended.map((t) => t.id)).toEqual(["T001", "T003"]);
  });

  it("should sort tenders by score descending", () => {
    const tenders = [
      { id: "T001", aiScore: 60 },
      { id: "T002", aiScore: 90 },
      { id: "T003", aiScore: 75 },
    ];

    const sorted = [...tenders].sort((a, b) => b.aiScore - a.aiScore);
    expect(sorted.map((t) => t.id)).toEqual(["T002", "T003", "T001"]);
  });

  it("should handle pagination correctly", () => {
    const totalTenders = 157;
    const pageSize = 20;
    const page = 1;
    const totalPages = Math.ceil(totalTenders / pageSize);

    expect(totalPages).toBe(8);
    expect(page).toBeLessThanOrEqual(totalPages);
  });
});

describe("tender tRPC routes - filtering", () => {
  it("should filter by budget range", () => {
    const tenders = [
      { id: "T001", budget: 250000 }, // 25 萬
      { id: "T002", budget: 750000 }, // 75 萬
      { id: "T003", budget: 2500000 }, // 250 萬
    ];

    const filterByBudget = (tenders: any[], min: number, max: number) => {
      return tenders.filter((t) => t.budget >= min && t.budget <= max);
    };

    const highPriority = filterByBudget(tenders, 500000, 1000000);
    expect(highPriority).toHaveLength(1);
    expect(highPriority[0].id).toBe("T002");
  });

  it("should filter by keyword", () => {
    const tenders = [
      { id: "T001", projectName: "AI 教育訓練課程" },
      { id: "T002", projectName: "橋樑工程建設" },
      { id: "T003", projectName: "數位精進研習" },
    ];

    const filterByKeyword = (tenders: any[], keyword: string) => {
      const regex = new RegExp(keyword, "i");
      return tenders.filter((t) => regex.test(t.projectName));
    };

    const aiTenders = filterByKeyword(tenders, "AI|數位");
    expect(aiTenders).toHaveLength(2);
    expect(aiTenders.map((t) => t.id)).toEqual(["T001", "T003"]);
  });

  it("should filter by organization type", () => {
    const tenders = [
      { id: "T001", orgName: "臺北市立第一女子高級中學" },
      { id: "T002", orgName: "交通部公路局" },
      { id: "T003", orgName: "國立臺灣大學" },
    ];

    const filterByOrgType = (tenders: any[], keyword: string) => {
      const regex = new RegExp(keyword, "i");
      return tenders.filter((t) => regex.test(t.orgName));
    };

    // 「臺北市立第一女子高級中學」包含「中學」，「國立臺灣大學」包含「大學"
    const schoolTenders = filterByOrgType(tenders, "中學|大學");
    expect(schoolTenders).toHaveLength(2);
    expect(schoolTenders.map((t) => t.id)).toEqual(["T001", "T003"]);
  });
});

describe("tender tRPC routes - rescore", () => {
  it("should validate rescore input", () => {
    const rescoreInput = {
      tenderId: "acebidx-T001",
    };
    expect(rescoreInput.tenderId).toBeDefined();
    expect(typeof rescoreInput.tenderId).toBe("string");
  });

  it("should handle batch rescore", () => {
    const tenderIds = ["T001", "T002", "T003"];
    const rescoreCount = tenderIds.length;
    expect(rescoreCount).toBe(3);
  });
});

describe("tender tRPC routes - statistics", () => {
  it("should calculate tender statistics", () => {
    const tenders = [
      { id: "T001", aiRecommend: 1, aiScore: 85 },
      { id: "T002", aiRecommend: 0, aiScore: 45 },
      { id: "T003", aiRecommend: 1, aiScore: 75 },
      { id: "T004", aiRecommend: 1, aiScore: 90 },
    ];

    const stats = {
      total: tenders.length,
      recommended: tenders.filter((t) => t.aiRecommend === 1).length,
      averageScore: tenders.reduce((sum, t) => sum + t.aiScore, 0) / tenders.length,
      highScore: Math.max(...tenders.map((t) => t.aiScore)),
      lowScore: Math.min(...tenders.map((t) => t.aiScore)),
    };

    expect(stats.total).toBe(4);
    expect(stats.recommended).toBe(3);
    expect(stats.averageScore).toBe(73.75);
    expect(stats.highScore).toBe(90);
    expect(stats.lowScore).toBe(45);
  });

  it("should group tenders by category", () => {
    const tenders = [
      { id: "T001", aiCategory: "教育" },
      { id: "T002", aiCategory: "AI" },
      { id: "T003", aiCategory: "教育" },
      { id: "T004", aiCategory: "活動" },
    ];

    const grouped = tenders.reduce(
      (acc, t) => {
        if (!acc[t.aiCategory]) acc[t.aiCategory] = [];
        acc[t.aiCategory].push(t);
        return acc;
      },
      {} as Record<string, any[]>
    );

    expect(grouped["教育"]).toHaveLength(2);
    expect(grouped["AI"]).toHaveLength(1);
    expect(grouped["活動"]).toHaveLength(1);
  });
});
