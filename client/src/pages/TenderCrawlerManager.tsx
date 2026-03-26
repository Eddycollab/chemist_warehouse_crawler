import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Bot, RefreshCw, Trash2, Brain, CheckCircle, XCircle, Clock, AlertCircle } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    running: { label: "執行中", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    completed: { label: "完成", className: "bg-green-500/20 text-green-400 border-green-500/30" },
    failed: { label: "失敗", className: "bg-red-500/20 text-red-400 border-red-500/30" },
  };
  const s = map[status] ?? { label: status, className: "" };
  return <Badge variant="outline" className={s.className}>{s.label}</Badge>;
}

export default function TenderCrawlerManager() {
  const { data: jobs, isLoading, refetch } = trpc.tenderCrawl.jobs.useQuery({ limit: 20 });
  const { data: stats, refetch: refetchStats } = trpc.tender.stats.useQuery();

  const triggerMutation = trpc.tenderCrawl.trigger.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      setTimeout(() => { refetch(); refetchStats(); }, 3000);
    },
    onError: () => toast.error("爬蟲啟動失敗，請稍後再試"),
  });

  const scoreAllMutation = trpc.tender.scoreAll.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
    },
  });

  const deleteJobMutation = trpc.tenderCrawl.deleteJob.useMutation({
    onSuccess: () => { toast.success("已刪除記錄"); refetch(); },
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">爬蟲管理</h1>
        <p className="text-muted-foreground text-sm mt-1">管理 acebidx 標案資料爬取任務</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "標案總數", value: stats?.total ?? 0, color: "text-foreground" },
          { label: "已評分", value: stats?.scored ?? 0, color: "text-blue-400" },
          { label: "未評分", value: stats?.unscored ?? 0, color: "text-yellow-400" },
          { label: "推薦投標", value: stats?.recommended ?? 0, color: "text-green-400" },
          { label: "高優先", value: stats?.highPriority ?? 0, color: "text-purple-400" },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className={`text-2xl font-bold mt-1 ${item.color}`}>{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Action Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="w-4 h-4" />
            手動觸發爬蟲
          </CardTitle>
          <CardDescription>
            從 acebidx API 抓取最新政府標案資料（最多 500 筆），完成後自動觸發 AI 評分
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
            className="gap-2"
          >
            <Bot className="w-4 h-4" />
            {triggerMutation.isPending ? "啟動中..." : "立即爬取標案"}
          </Button>
          <Button
            variant="outline"
            onClick={() => scoreAllMutation.mutate()}
            disabled={scoreAllMutation.isPending}
            className="gap-2"
          >
            <Brain className="w-4 h-4" />
            {scoreAllMutation.isPending ? "評分中..." : "AI 批次評分（未評分）"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { refetch(); refetchStats(); }}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>

      {/* Data Source Info */}
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <div className="text-sm space-y-1">
              <p className="font-medium text-blue-400">資料來源說明</p>
              <p className="text-muted-foreground">
                標案資料來自 <strong>app.acebidx.com</strong>，該平台彙整政府電子採購網（PCC）的公開標案資訊。
                每次爬取最多取得 500 筆最新標案，系統會自動去重，只儲存新增的標案。
              </p>
              <p className="text-muted-foreground">
                第二階段將直接整合政府電子採購網（web.pcc.gov.tw）以取得更完整的標案資料。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Job History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" />
            爬取記錄
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 font-medium text-muted-foreground">開始時間</th>
                  <th className="text-left p-4 font-medium text-muted-foreground">類型</th>
                  <th className="text-center p-4 font-medium text-muted-foreground">狀態</th>
                  <th className="text-right p-4 font-medium text-muted-foreground">爬取數</th>
                  <th className="text-right p-4 font-medium text-muted-foreground">新增數</th>
                  <th className="text-left p-4 font-medium text-muted-foreground">錯誤訊息</th>
                  <th className="text-center p-4 font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="p-4"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : !jobs || jobs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-muted-foreground">
                      尚無爬取記錄，請點擊「立即爬取標案」開始
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => (
                    <tr key={job.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="p-4 whitespace-nowrap text-muted-foreground">
                        {new Date(job.startedAt!).toLocaleString("zh-TW")}
                      </td>
                      <td className="p-4">
                        <Badge variant="outline" className="text-xs">
                          {job.jobType === "manual" ? "手動" : "排程"}
                        </Badge>
                      </td>
                      <td className="p-4 text-center">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="p-4 text-right font-mono">{job.totalFetched ?? 0}</td>
                      <td className="p-4 text-right font-mono text-green-400">{job.newTenders ?? 0}</td>
                      <td className="p-4 text-red-400 text-xs max-w-[200px]">
                        <span className="line-clamp-2">{job.errorMessage ?? "—"}</span>
                      </td>
                      <td className="p-4 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-red-400"
                          onClick={() => deleteJobMutation.mutate({ id: job.id })}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
