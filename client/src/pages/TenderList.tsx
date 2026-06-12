import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Search, RefreshCw, Brain, CheckCircle, XCircle, ChevronLeft, ChevronRight, ExternalLink, Download } from "lucide-react";

const PRIORITY_COLORS: Record<string, string> = {
  High: "bg-green-500/20 text-green-400 border-green-500/30",
  Medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  Low: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

const PRIORITY_LABELS: Record<string, string> = {
  High: "高優先",
  Medium: "中優先",
  Low: "低優先",
};

const CATEGORY_COLORS: Record<string, string> = {
  教育: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  AI: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  活動: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  系統: "bg-red-500/20 text-red-400 border-red-500/30",
  其他: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground text-xs">未評分</span>;
  const color = score >= 70 ? "text-green-400" : score >= 40 ? "text-yellow-400" : "text-red-400";
  return <span className={`font-bold text-lg ${color}`}>{score}</span>;
}

export default function TenderList() {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [inputKeyword, setInputKeyword] = useState("");
  const [priority, setPriority] = useState<string>("all");
  const [recommend, setRecommend] = useState<string>("all");
  const [scored, setScored] = useState<string>("all");
  const [selectedTender, setSelectedTender] = useState<string | null>(null);

  const { data, isLoading, refetch } = trpc.tender.list.useQuery({
    page,
    pageSize: 20,
    keyword: keyword || undefined,
    priority: priority !== "all" ? (priority as "High" | "Medium" | "Low") : undefined,
    recommend: recommend === "yes" ? true : recommend === "no" ? false : undefined,
    scored: scored === "scored" ? true : scored === "unscored" ? false : undefined,
  });

  const { data: tenderDetail } = trpc.tender.getById.useQuery(
    { id: selectedTender! },
    { enabled: !!selectedTender }
  );

  const rescoreMutation = trpc.tender.rescore.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`重新評分完成：${result.score} 分，${result.priority}`);
        refetch();
      }
    },
    onError: () => toast.error("評分失敗，請稍後再試"),
  });

  const scoreAllMutation = trpc.tender.scoreAll.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      setTimeout(() => refetch(), 3000);
    },
  });

  const exportMutation = trpc.tender.exportExcel.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        const link = document.createElement("a");
        link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.data}`;
        link.download = result.filename || "export.xlsx";
        link.click();
        toast.success(`已匯出 ${result.count} 筆標案`);
      } else {
        toast.error(result.message || "匯出失敗");
      }
    },
    onError: () => toast.error("匯出失敗，請稍後再試"),
  });

  const handleSearch = () => {
    setKeyword(inputKeyword);
    setPage(1);
  };

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">標案列表</h1>
          <p className="text-muted-foreground text-sm mt-1">
            共 {data?.total ?? 0} 筆標案
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => exportMutation.mutate({
              keyword: keyword || undefined,
              priority: priority !== "all" ? (priority as "High" | "Medium" | "Low") : undefined,
              recommend: recommend === "yes" ? true : recommend === "no" ? false : undefined,
            })}
            disabled={exportMutation.isPending}
            variant="outline"
            className="gap-2"
          >
            <Download className="w-4 h-4" />
            {exportMutation.isPending ? "匯出中..." : "匯出 Excel"}
          </Button>
          <Button
            onClick={() => scoreAllMutation.mutate()}
            disabled={scoreAllMutation.isPending}
            className="gap-2"
          >
            <Brain className="w-4 h-4" />
            {scoreAllMutation.isPending ? "評分中..." : "AI 批次評分"}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex gap-2 flex-1 min-w-[200px]">
              <Input
                placeholder="搜尋標案名稱或機關..."
                value={inputKeyword}
                onChange={(e) => setInputKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
              />
              <Button variant="outline" onClick={handleSearch} size="icon">
                <Search className="w-4 h-4" />
              </Button>
            </div>
            <Select value={priority} onValueChange={(v) => { setPriority(v); setPage(1); }}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="優先級" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部優先級</SelectItem>
                <SelectItem value="High">高優先</SelectItem>
                <SelectItem value="Medium">中優先</SelectItem>
                <SelectItem value="Low">低優先</SelectItem>
              </SelectContent>
            </Select>
            <Select value={recommend} onValueChange={(v) => { setRecommend(v); setPage(1); }}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="推薦" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="yes">推薦投標</SelectItem>
                <SelectItem value="no">不推薦</SelectItem>
              </SelectContent>
            </Select>
            <Select value={scored} onValueChange={(v) => { setScored(v); setPage(1); }}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="評分狀態" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="scored">已評分</SelectItem>
                <SelectItem value="unscored">未評分</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 font-medium text-muted-foreground">標案名稱</th>
                  <th className="text-left p-4 font-medium text-muted-foreground">機關</th>
                  <th className="text-right p-4 font-medium text-muted-foreground">預算</th>
                  <th className="text-center p-4 font-medium text-muted-foreground">AI 評分</th>
                  <th className="text-center p-4 font-medium text-muted-foreground">優先級</th>
                  <th className="text-center p-4 font-medium text-muted-foreground">類型</th>
                  <th className="text-center p-4 font-medium text-muted-foreground">推薦</th>
                  <th className="text-center p-4 font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="p-4"><Skeleton className="h-4 w-full" /></td>
                      <td className="p-4"><Skeleton className="h-4 w-24" /></td>
                      <td className="p-4"><Skeleton className="h-4 w-16" /></td>
                      <td className="p-4"><Skeleton className="h-4 w-10 mx-auto" /></td>
                      <td className="p-4"><Skeleton className="h-5 w-16 mx-auto" /></td>
                      <td className="p-4"><Skeleton className="h-5 w-12 mx-auto" /></td>
                      <td className="p-4"><Skeleton className="h-5 w-8 mx-auto" /></td>
                      <td className="p-4"><Skeleton className="h-8 w-16 mx-auto" /></td>
                    </tr>
                  ))
                ) : data?.items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-muted-foreground">
                      尚無標案資料，請先執行爬蟲
                    </td>
                  </tr>
                ) : (
                  data?.items.map((tender) => (
                    <tr
                      key={tender.id}
                      className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => setSelectedTender(tender.id)}
                    >
                      <td className="p-4 max-w-[280px]">
                        <span className="line-clamp-2 font-medium">{tender.projectName}</span>
                        {tender.submitDeadline && (
                          <span className="text-xs text-muted-foreground block mt-1">
                            截止：{new Date(tender.submitDeadline).toLocaleDateString("zh-TW")}
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-muted-foreground max-w-[160px]">
                        <span className="line-clamp-2">{tender.orgName ?? "—"}</span>
                      </td>
                      <td className="p-4 text-right whitespace-nowrap">
                        {tender.budget
                          ? `${(tender.budget / 10000).toFixed(0)} 萬`
                          : <span className="text-muted-foreground">未公開</span>}
                      </td>
                      <td className="p-4 text-center">
                        <ScoreBadge score={tender.aiScore} />
                      </td>
                      <td className="p-4 text-center">
                        {tender.aiPriority ? (
                          <Badge variant="outline" className={PRIORITY_COLORS[tender.aiPriority]}>
                            {PRIORITY_LABELS[tender.aiPriority]}
                          </Badge>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="p-4 text-center">
                        {tender.aiCategory ? (
                          <Badge variant="outline" className={CATEGORY_COLORS[tender.aiCategory] ?? ""}>
                            {tender.aiCategory}
                          </Badge>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="p-4 text-center">
                        {tender.aiRecommend === null ? (
                          <span className="text-muted-foreground text-xs">—</span>
                        ) : tender.aiRecommend ? (
                          <CheckCircle className="w-5 h-5 text-green-400 mx-auto" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-400 mx-auto" />
                        )}
                      </td>
                      <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => rescoreMutation.mutate({ id: tender.id })}
                          disabled={rescoreMutation.isPending}
                          className="gap-1 text-xs"
                        >
                          <Brain className="w-3 h-3" />
                          重評
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-border">
              <span className="text-sm text-muted-foreground">
                第 {page} / {totalPages} 頁
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tender Detail Dialog */}
      <Dialog open={!!selectedTender} onOpenChange={(open) => !open && setSelectedTender(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base leading-relaxed">
              {tenderDetail?.projectName ?? "載入中..."}
            </DialogTitle>
          </DialogHeader>
          {tenderDetail && (
            <div className="space-y-4">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">機關名稱</span>
                  <p className="font-medium mt-1">{tenderDetail.orgName ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">預算金額</span>
                  <p className="font-medium mt-1">
                    {tenderDetail.budget
                      ? `NT$ ${tenderDetail.budget.toLocaleString()}`
                      : "未公開"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">標案類別</span>
                  <p className="font-medium mt-1">{tenderDetail.catName ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">招標方式</span>
                  <p className="font-medium mt-1">{tenderDetail.typeofTender ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">公告日期</span>
                  <p className="font-medium mt-1">
                    {tenderDetail.postDate
                      ? new Date(tenderDetail.postDate).toLocaleDateString("zh-TW")
                      : "—"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">截止日期</span>
                  <p className="font-medium mt-1">
                    {tenderDetail.submitDeadline
                      ? new Date(tenderDetail.submitDeadline).toLocaleDateString("zh-TW")
                      : "—"}
                  </p>
                </div>
              </div>

              {/* AI Score */}
              {tenderDetail.aiScore !== null && (
                <div className="border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Brain className="w-4 h-4 text-purple-400" />
                      AI 評分結果
                    </h3>
                    <div className="flex items-center gap-3">
                      <ScoreBadge score={tenderDetail.aiScore} />
                      {tenderDetail.aiPriority && (
                        <Badge variant="outline" className={PRIORITY_COLORS[tenderDetail.aiPriority]}>
                          {PRIORITY_LABELS[tenderDetail.aiPriority]}
                        </Badge>
                      )}
                      {tenderDetail.aiRecommend ? (
                        <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30">
                          推薦投標
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/30">
                          不推薦
                        </Badge>
                      )}
                    </div>
                  </div>
                  {Array.isArray(tenderDetail.aiReasons) && (tenderDetail.aiReasons as string[]).length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">推薦原因</p>
                      <ul className="space-y-1">
                        {(tenderDetail.aiReasons as string[]).map((r, i) => (
                          <li key={i} className="text-sm flex items-start gap-2">
                            <CheckCircle className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(tenderDetail.aiRisks) && (tenderDetail.aiRisks as string[]).length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">風險提示</p>
                      <ul className="space-y-1">
                        {(tenderDetail.aiRisks as string[]).map((r, i) => (
                          <li key={i} className="text-sm flex items-start gap-2">
                            <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => rescoreMutation.mutate({ id: tenderDetail.id })}
                  disabled={rescoreMutation.isPending}
                >
                  <Brain className="w-4 h-4" />
                  {rescoreMutation.isPending ? "評分中..." : "重新 AI 評分"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => window.open(`https://app.acebidx.com/tender/${tenderDetail.id}`, "_blank")}
                >
                  <ExternalLink className="w-4 h-4" />
                  查看原始標案
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
