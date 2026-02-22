import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Play, Trash2, RefreshCw, Activity, CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";

type JobStatus = "pending" | "running" | "completed" | "failed" | "stopped";

type NewsJob = {
  id: number;
  sourceId: number | null;
  sourceName?: string | null;
  status: JobStatus | "stopped";
  newArticles: number | null;
  totalArticles: number | null;
  errorMessage?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
};

function StatusBadge({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
    pending: { label: "等待中", variant: "secondary", icon: <Clock className="w-3 h-3" /> },
    running: { label: "執行中", variant: "default", icon: <Activity className="w-3 h-3 animate-pulse" /> },
    completed: { label: "已完成", variant: "outline", icon: <CheckCircle2 className="w-3 h-3 text-green-500" /> },
    failed: { label: "失敗", variant: "destructive", icon: <XCircle className="w-3 h-3" /> },
    stopped: { label: "已中止", variant: "secondary", icon: <XCircle className="w-3 h-3" /> },
  };
  const { label, variant, icon } = map[status] ?? map.pending;
  return (
    <Badge variant={variant} className="flex items-center gap-1">
      {icon}
      {label}
    </Badge>
  );
}

export default function NewsCrawler() {
  const utils = trpc.useUtils();
  const { data: jobs = [], isLoading, refetch } = trpc.news.getJobs.useQuery(undefined, { refetchInterval: 5000 });
  const { data: sources = [] } = trpc.news.getSources.useQuery();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const crawlMutation = trpc.news.startCrawl.useMutation({
    onSuccess: (data) => {
      utils.news.getJobs.invalidate();
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.warning(data.message);
      }
    },
    onError: (e) => toast.error("啟動失敗：" + e.message),
  });

  const resetStuckMutation = trpc.news.resetStuck.useMutation({
    onSuccess: () => {
      utils.news.getJobs.invalidate();
      toast.success("已重置卡住的任務狀態");
    },
    onError: (e) => toast.error("重置失敗：" + e.message),
  });

  const deleteJobMutation = trpc.news.deleteJob.useMutation({
    onSuccess: () => {
      utils.news.getJobs.invalidate();
      toast.success("已刪除任務記錄");
    },
    onError: (e) => toast.error("刪除失敗：" + e.message),
  });

  const deleteAllMutation = trpc.news.deleteAllJobs.useMutation({
    onSuccess: () => {
      utils.news.getJobs.invalidate();
      toast.success("已清除所有任務記錄");
      setShowClearConfirm(false);
    },
    onError: (e) => toast.error("清除失敗：" + e.message),
  });

  const activeSources = sources.filter((s) => s.isActive);
  const typedJobs = jobs as unknown as NewsJob[];
  const runningJobs = typedJobs.filter((j) => j.status === "running" || j.status === "pending");

  function formatDuration(job: NewsJob) {
    if (!job.startedAt || !job.completedAt) return null;
    const ms = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            新聞爬蟲管理
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            手動觸發爬取任務，或查看歷史執行記錄
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />
            重新整理
          </Button>
          {typedJobs.length > 0 && (
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowClearConfirm(true)}>
              <Trash2 className="w-4 h-4 mr-1" />
              清除記錄
            </Button>
          )}
        </div>
      </div>

      {/* Running indicator */}
      {runningJobs.length > 0 && (
        <div className="flex items-center justify-between gap-2 bg-primary/10 border border-primary/30 rounded-lg px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary animate-pulse" />
            <span>目前有 <strong>{runningJobs.length}</strong> 個爬取任務正在執行中，每 5 秒自動更新狀態</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-amber-500 border-amber-500/30 hover:bg-amber-500/10 shrink-0"
            onClick={() => resetStuckMutation.mutate()}
            disabled={resetStuckMutation.isPending}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            重置卡住任務
          </Button>
        </div>
      )}

      {/* Quick Launch */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">快速啟動爬取</CardTitle>
        </CardHeader>
        <CardContent>
          {activeSources.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚無啟用的新聞來源，請先至「新聞來源管理」設定</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {activeSources.map((source) => {
                const isSourceRunning = typedJobs.some(
                  (j) => j.sourceId === source.id && (j.status === "running" || j.status === "pending")
                );
                return (
                  <Button
                    key={source.id}
                    variant="outline"
                    size="sm"
                    onClick={() => crawlMutation.mutate({ sourceId: source.id })}
                    disabled={crawlMutation.isPending || isSourceRunning}
                    title={isSourceRunning ? "該來源正在爬取中" : undefined}
                  >
                    {isSourceRunning ? (
                      <Activity className="w-3.5 h-3.5 mr-1.5 animate-pulse text-primary" />
                    ) : (
                      <Play className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    {source.name}
                    {isSourceRunning && <span className="ml-1 text-xs text-muted-foreground">(執行中)</span>}
                  </Button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job History */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">執行記錄（最近 30 筆）</h2>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">載入中...</div>
        ) : typedJobs.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-muted-foreground">尚無執行記錄</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {typedJobs.map((job) => {
              const duration = formatDuration(job);
              return (
                <Card key={job.id} className="hover:bg-muted/20 transition-colors">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <StatusBadge status={job.status} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{job.sourceName ?? `來源 #${job.sourceId}`}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(job.createdAt).toLocaleString()}
                            {duration && <span className="ml-2">耗時 {duration}</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {job.status === "completed" && (
                          <div className="text-right text-xs">
                            <p className="text-green-500 font-medium">+{job.newArticles ?? 0} 篇新文章</p>
                            <p className="text-muted-foreground">共 {job.totalArticles ?? 0} 篇</p>
                          </div>
                        )}
                        {job.status === "failed" && job.errorMessage && (
                          <p className="text-xs text-destructive max-w-48 truncate" title={job.errorMessage}>
                            {job.errorMessage}
                          </p>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => deleteJobMutation.mutate({ id: job.id })}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Clear Confirm */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清除所有任務記錄</AlertDialogTitle>
            <AlertDialogDescription>
              確定要清除所有爬取任務記錄嗎？此操作不會影響已抓取的文章。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteAllMutation.mutate()}
            >
              確認清除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
