import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Bot,
  Play,
  Square,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  XCircle,
  Trash2,
  Tag,
  Search,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Globe } from "lucide-react";
import { CATEGORY_LABELS } from "../lib/categoryLabels";

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "從未";
  return new Date(date).toLocaleString("zh-TW", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">已完成</Badge>;
    case "running":
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">執行中</Badge>;
    case "failed":
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">失敗</Badge>;
    case "stopped":
      return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">已中止</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">待機</Badge>;
  }
}

const CRAWL_CATEGORIES = [
  { value: "all", label: "全部品類" },
  { value: "beauty_skincare", label: "美妝護膚" },
  { value: "adult_health", label: "成人保健" },
  { value: "childrens_health", label: "兒童保健" },
  { value: "vegan_health", label: "純素保健" },
  { value: "natural_soap", label: "天然香皂" },
  { value: "oral_care", label: "口腔保健" },
  { value: "medicines", label: "藥品" },
];

// Popular CW brands for quick selection
const POPULAR_BRANDS = [
  "Swisse", "Blackmores", "Nature's Way", "Neutrogena", "L'Oreal Paris",
  "Revlon", "Maybelline", "Garnier", "Pantene", "Head & Shoulders",
  "Dove", "Nivea", "Cetaphil", "QV", "Ego",
  "Bioglan", "Naturopathica", "Nutra-Life", "Herbs of Gold", "Fusion Health",
];

export default function CrawlerManager() {
  const { data: jobs, isLoading: jobsLoading, refetch: refetchJobs } = trpc.crawl.jobs.useQuery({ limit: 20 });
  const { data: schedulerStatus } = trpc.crawl.schedulerStatus.useQuery(undefined, { refetchInterval: 10000 });
  const { data: runningStatus, refetch: refetchRunning } = trpc.crawl.isRunning.useQuery(undefined, {
    refetchInterval: 3000,
  });
  const { data: crawlProgress } = trpc.crawl.progress.useQuery(undefined, {
    refetchInterval: 2000,
    enabled: runningStatus?.running ?? false,
  });
  const utils = trpc.useUtils();

  const isCrawling = runningStatus?.running ?? false;

  // ─── Brand Filter State ───────────────────────────────────────────────────────
  const [brandInput, setBrandInput] = useState("");
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);

  // Fetch brands from Algolia (debounced via category + query)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // searchForFacetValues supports prefix-match from 1 char; no need for >=2 guard
  const { data: brandsData, isLoading: brandsLoading } = (trpc.crawl as any).getBrands.useQuery(
    { category: selectedCategory, query: brandInput.length >= 1 ? brandInput : undefined },
    { enabled: showBrandDropdown }
  );

  const displayedBrands = useMemo(() => {
    if (!brandsData?.brands) return [];
    return brandsData.brands.slice(0, 50);
  }, [brandsData]);

  // ─── Mutations ────────────────────────────────────────────────────────────────
  const triggerCrawl = trpc.crawl.trigger.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setTimeout(() => {
        refetchJobs();
        refetchRunning();
        utils.crawl.latestJob.invalidate();
      }, 2000);
    },
    onError: () => toast.error("啟動爬蟲失敗"),
  });

  const resetStuck = trpc.crawl.resetStuck.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setTimeout(() => {
        refetchJobs();
        refetchRunning();
        utils.crawl.latestJob.invalidate();
      }, 500);
    },
    onError: () => toast.error("重置失敗"),
  });

  const hasStuckJobs = !isCrawling && jobs?.some((j) => j.status === "running");

  const deleteJob = trpc.crawl.deleteJob.useMutation({
    onSuccess: () => {
      toast.success("任務已刪除");
      refetchJobs();
    },
    onError: () => toast.error("刪除失敗"),
  });

  const deleteAllJobs = trpc.crawl.deleteAllJobs.useMutation({
    onSuccess: () => {
      toast.success("所有歷史記錄已清除");
      refetchJobs();
    },
    onError: () => toast.error("清除失敗"),
  });

  const stopCrawl = trpc.crawl.stop.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.info(data.message);
      }
      setTimeout(() => {
        refetchJobs();
        refetchRunning();
        utils.crawl.latestJob.invalidate();
      }, 2000);
    },
    onError: () => toast.error("停止爬蟲失敗"),
  });

  // Custom target crawl
  const { data: crawlTargets } = trpc.targets.list.useQuery();
  const activeTargets = (crawlTargets ?? []).filter((t: { isActive: boolean }) => t.isActive);
  const [runningTargetId, setRunningTargetId] = useState<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runCustomTarget = (trpc.crawl as any).runCustomTarget.useMutation({
    onSuccess: (data: { success: boolean; message: string }) => {
      toast.success(data.message || "爬蟲任務已啟動，請稍後查看結果");
      // Don't clear runningTargetId immediately - let the progress polling handle it
      // Refresh jobs list after a short delay to show the new job
      setTimeout(() => {
        refetchJobs();
        refetchRunning();
      }, 1500);
    },
    onError: (err: { message: string }) => {
      toast.error(`啟動失敗：${err.message}`);
      setRunningTargetId(null);
    },
  });

  // ─── Trigger helpers ──────────────────────────────────────────────────────────
  function handleTrigger(category: string, testMode = false) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (triggerCrawl as any).mutate({
      category,
      testMode,
      brandFilter: selectedBrand || undefined,
    });
  }

  function clearBrand() {
    setSelectedBrand("");
    setBrandInput("");
    setShowBrandDropdown(false);
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" />
          爬蟲管理
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          手動觸發爬蟲任務或查看爬取歷史記錄
        </p>
      </div>

      {/* Stuck Jobs Warning Banner */}
      {hasStuckJobs && (
        <div className="flex items-center justify-between rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-orange-400" />
            <div>
              <p className="text-sm font-medium text-orange-300">偵測到卡住的任務</p>
              <p className="text-xs text-orange-400/70">伺服器重啟後有任務狀態未更新，請點擊重置</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-orange-500/50 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300"
            disabled={resetStuck.isPending}
            onClick={() => resetStuck.mutate()}
          >
            {resetStuck.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            重置狀態
          </Button>
        </div>
      )}

      {/* Running Status Banner */}
      {isCrawling && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 text-yellow-400 animate-spin flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-yellow-300">
                  {crawlProgress?.isTestMode ? "測試模式執行中" : "爬蟲任務執行中"}
                </p>
                <p className="text-xs text-yellow-400/70">
                  {crawlProgress?.currentCategoryLabel
                    ? `目前品類：${crawlProgress.currentCategoryLabel}`
                    : "正在準備爬取..."
                  }
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              disabled={stopCrawl.isPending}
              onClick={() => stopCrawl.mutate()}
            >
              {stopCrawl.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5 fill-current" />
              )}
              停止爬取
            </Button>
          </div>
          {/* Progress bar */}
          {crawlProgress && crawlProgress.totalCategories > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-yellow-400/70">
                <span>進度</span>
                <span>{crawlProgress.completedCategories} / {crawlProgress.totalCategories} 個品類</span>
              </div>
              <div className="w-full bg-yellow-900/30 rounded-full h-1.5">
                <div
                  className="bg-yellow-400 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((crawlProgress.completedCategories / crawlProgress.totalCategories) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scheduler Status */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            自動排程狀態
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">排程狀態</span>
            <Badge
              variant={isCrawling ? "default" : schedulerStatus?.isRunning ? "secondary" : "outline"}
              className={isCrawling ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" : ""}
            >
              {isCrawling ? "爬蟲執行中" : schedulerStatus?.isRunning ? "排程已啟動（閒置）" : "未啟動"}
            </Badge>
          </div>
          {schedulerStatus?.nextRunTime && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">下次執行時間</span>
              <span className="text-sm text-foreground">{formatDate(schedulerStatus.nextRunTime)}</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            系統每週一上午 9:00（澳洲東部時間）自動執行全品類爬蟲任務
          </p>
        </CardContent>
      </Card>

      {/* Manual Trigger */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Play className="h-4 w-4 text-primary" />
            手動觸發爬蟲
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            選擇要爬取的品類，或一次爬取所有追蹤中的產品。爬蟲任務在背景執行，請稍後查看結果。
          </p>

          {/* ─── Brand Filter ─────────────────────────────────────────────── */}
          <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-3">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">品牌過濾器</span>
              <span className="text-xs text-muted-foreground">（選填）只爬取特定品牌的產品</span>
            </div>

            {/* Selected brand badge */}
            {selectedBrand && (
              <div className="flex items-center gap-2">
                <Badge className="bg-primary/20 text-primary border-primary/30 gap-1 pl-2 pr-1 py-1">
                  {selectedBrand}
                  <button
                    onClick={clearBrand}
                    className="ml-1 rounded-full hover:bg-primary/30 p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
                <span className="text-xs text-muted-foreground">已選擇品牌，爬蟲將只抓取此品牌的產品</span>
              </div>
            )}

            {/* Brand search input */}
            <div className="relative">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="輸入品牌名稱搜尋（如 Swisse、Blackmores）..."
                    value={brandInput}
                    onChange={(e) => {
                      setBrandInput(e.target.value);
                      setShowBrandDropdown(true);
                    }}
                    onFocus={() => setShowBrandDropdown(true)}
                    className="pl-8 h-8 text-sm bg-background border-border"
                  />
                </div>
                {brandInput && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-muted-foreground hover:text-foreground"
                    onClick={() => { setBrandInput(""); setShowBrandDropdown(false); }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {/* Dropdown */}
              {showBrandDropdown && (
                <div className="absolute z-50 top-full mt-1 left-0 right-0 rounded-lg border border-border bg-card shadow-lg max-h-56 overflow-y-auto">
                  {brandsLoading ? (
                    <div className="flex items-center justify-center py-4 gap-2 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      從 Chemist Warehouse 載入品牌...
                    </div>
                  ) : displayedBrands.length === 0 ? (
                    <div className="py-4 text-center text-muted-foreground text-sm">
                      {brandInput.length >= 1 ? "找不到符合的品牌" : "請輸入品牌名稱開始搜尋"}
                    </div>
                  ) : (
                    <div className="py-1">
                      {displayedBrands.map((brand: { name: string; count: number }) => (
                        <button
                          key={brand.name}
                          className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-secondary/50 text-left transition-colors"
                          onClick={() => {
                            setSelectedBrand(brand.name);
                            setBrandInput(brand.name);
                            setShowBrandDropdown(false);
                          }}
                        >
                          <span className="text-foreground">{brand.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">{brand.count.toLocaleString()} 個產品</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Popular brands quick select */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">常用品牌快速選擇：</p>
              <div className="flex flex-wrap gap-1.5">
                {POPULAR_BRANDS.map((brand: string) => (
                  <button
                    key={brand}
                    onClick={() => {
                      setSelectedBrand(brand);
                      setBrandInput(brand);
                      setShowBrandDropdown(false);
                    }}
                    className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                      selectedBrand === brand
                        ? "bg-primary/20 border-primary/50 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground bg-secondary/20"
                    }`}
                  >
                    {brand}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Test Mode */}
          <div className="p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-300">✨ 測試模式</p>
                <p className="text-xs text-blue-400/70 mt-0.5">只爬取第一個品類第 1 頁（約 20 個產品），快速驗證爬蟲是否正常運作</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-blue-500/50 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300 ml-4"
                disabled={triggerCrawl.isPending || isCrawling}
                onClick={() => handleTrigger("beauty_skincare", true)}
              >
                {triggerCrawl.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                啟動測試
              </Button>
            </div>
          </div>

          {/* Category buttons */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">選擇品類觸發爬蟲：</p>
            <div className="flex flex-wrap gap-2">
              {CRAWL_CATEGORIES.map((cat) => (
                <Button
                  key={cat.value}
                  variant={selectedCategory === cat.value ? "default" : "outline"}
                  size="sm"
                  className={`gap-2 ${
                    selectedCategory === cat.value
                      ? "bg-primary/20 border-primary/50 text-primary hover:bg-primary/30"
                      : "border-border hover:border-primary/50"
                  }`}
                  disabled={triggerCrawl.isPending || isCrawling}
                  onClick={() => {
                    setSelectedCategory(cat.value);
                    handleTrigger(cat.value);
                  }}
                >
                  {triggerCrawl.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {cat.label}
                  {selectedBrand && <span className="text-xs opacity-70">+ {selectedBrand}</span>}
                </Button>
              ))}
            </div>
          </div>

          {isCrawling && (
            <p className="text-xs text-yellow-400/70 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              爬蟲執行中，請先停止後再啟動新任務
            </p>
          )}
        </CardContent>
      </Card>

      {/* Custom Target Crawl */}
      {activeTargets.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              自訂目標網站爬取
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              選擇已啟用的自訂目標網站並啟動爬取，產品資料將儲存至資料庫。
            </p>
            <div className="space-y-2">
              {activeTargets.map((target: { id: number; name: string; baseUrl: string; productListSelector?: string | null }) => (
                <div key={target.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/20">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{target.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{target.baseUrl}</p>
                    {!target.productListSelector && (
                      <p className="text-xs text-yellow-400 mt-0.5">⚠️ 尚未設定選擇器，請先到「目標網站」設定</p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 border-border hover:border-primary/50 ml-3 shrink-0"
                    disabled={runningTargetId === target.id || !target.productListSelector}
                    onClick={() => {
                      setRunningTargetId(target.id);
                      runCustomTarget.mutate({ targetId: target.id });
                    }}
                  >
                    {runningTargetId === target.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {runningTargetId === target.id ? "爬取中...請稍候" : "啟動爬取"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Job History */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">爬蟲任務歷史</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => refetchJobs()} className="gap-2 text-xs">
                <RefreshCw className="h-3.5 w-3.5" />
                刷新
              </Button>
              {jobs && jobs.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      disabled={isCrawling}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      清除全部
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-card border-border">
                    <AlertDialogHeader>
                      <AlertDialogTitle>確認清除所有歷史？</AlertDialogTitle>
                      <AlertDialogDescription>
                        這將刪除所有非執行中的任務歷史記錄，此操作無法復原。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-red-600 hover:bg-red-700"
                        onClick={() => deleteAllJobs.mutate()}
                      >
                        確認清除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {jobsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !jobs || jobs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              尚無爬蟲任務記錄
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">任務 ID</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">類型</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">品類</th>
                    <th className="text-center px-4 py-3 text-muted-foreground font-medium">狀態</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium">爬取/失敗</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium">開始時間</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium">完成時間</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b border-border/50 hover:bg-secondary/20">
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">#{job.id}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs border-border">
                          {job.jobType === "scheduled" ? "自動" : "手動"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {CATEGORY_LABELS[job.category as keyof typeof CATEGORY_LABELS] ?? job.category ?? "全部"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {job.status === "running" ? (
                            <Loader2 className="h-3.5 w-3.5 text-yellow-400 animate-spin" />
                          ) : job.status === "completed" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                          ) : job.status === "stopped" ? (
                            <XCircle className="h-3.5 w-3.5 text-orange-400" />
                          ) : (
                            <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                          )}
                          {getStatusBadge(job.status)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        <span className="text-green-400">{job.crawledProducts ?? 0}</span>
                        <span className="text-muted-foreground mx-1">/</span>
                        <span className="text-red-400">{job.failedProducts ?? 0}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {formatDate(job.startedAt)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {job.completedAt ? formatDate(job.completedAt) : "-"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {job.status !== "running" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                            onClick={() => deleteJob.mutate({ id: job.id })}
                            disabled={deleteJob.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
