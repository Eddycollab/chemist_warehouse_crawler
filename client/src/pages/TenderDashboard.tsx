import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import {
  FileText,
  Brain,
  Bot,
  CheckCircle,
  XCircle,
  TrendingUp,
  Landmark,
  ArrowRight,
  RefreshCw,
} from "lucide-react";

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

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <Card
      className={`transition-colors ${onClick ? "cursor-pointer hover:bg-muted/30" : ""}`}
      onClick={onClick}
    >
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
          <div className={`p-3 rounded-full bg-muted/50`}>
            <Icon className={`w-5 h-5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TenderDashboard() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.tender.stats.useQuery();
  const { data: recentData, isLoading: recentLoading, refetch: refetchRecent } = trpc.tender.list.useQuery({
    page: 1,
    pageSize: 8,
    recommend: true,
    scored: true,
  });

  const triggerMutation = trpc.tenderCrawl.trigger.useMutation({
    onSuccess: () => {
      setTimeout(() => { refetchStats(); refetchRecent(); }, 5000);
    },
  });

  const scoreAllMutation = trpc.tender.scoreAll.useMutation();

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Landmark className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">政府標案資訊網</h1>
            <p className="text-muted-foreground text-sm">AI 驅動的標案商機篩選系統</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
            className="gap-2"
          >
            <Bot className="w-4 h-4" />
            {triggerMutation.isPending ? "爬取中..." : "立即爬取"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => scoreAllMutation.mutate()}
            disabled={scoreAllMutation.isPending}
            className="gap-2"
          >
            <Brain className="w-4 h-4" />
            {scoreAllMutation.isPending ? "評分中..." : "AI 評分"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { refetchStats(); refetchRecent(); }}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {statsLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-5 pb-5"><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))
        ) : (
          <>
            <StatCard
              icon={FileText}
              label="標案總數"
              value={stats?.total ?? 0}
              color="text-foreground"
              onClick={() => setLocation("/tenders")}
            />
            <StatCard
              icon={Brain}
              label="已 AI 評分"
              value={stats?.scored ?? 0}
              color="text-blue-400"
              onClick={() => setLocation("/tenders?scored=scored")}
            />
            <StatCard
              icon={TrendingUp}
              label="待評分"
              value={stats?.unscored ?? 0}
              color="text-yellow-400"
              onClick={() => setLocation("/tenders?scored=unscored")}
            />
            <StatCard
              icon={CheckCircle}
              label="推薦投標"
              value={stats?.recommended ?? 0}
              color="text-green-400"
              onClick={() => setLocation("/tenders?recommend=yes")}
            />
            <StatCard
              icon={TrendingUp}
              label="高優先標案"
              value={stats?.highPriority ?? 0}
              color="text-purple-400"
              onClick={() => setLocation("/tenders?priority=High")}
            />
          </>
        )}
      </div>

      {/* Recommended Tenders */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-400" />
            推薦投標標案
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-xs"
            onClick={() => setLocation("/tenders")}
          >
            查看全部
            <ArrowRight className="w-3 h-3" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {recentLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !recentData?.items.length ? (
            <div className="p-12 text-center text-muted-foreground">
              <Brain className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p>尚無推薦標案</p>
              <p className="text-xs mt-1">請先執行爬蟲並進行 AI 評分</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {recentData.items.map((tender) => (
                <div
                  key={tender.id}
                  className="p-4 hover:bg-muted/20 cursor-pointer transition-colors"
                  onClick={() => setLocation("/tenders")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm line-clamp-1">{tender.projectName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {tender.orgName ?? "未知機關"}
                        {tender.budget && ` · ${(tender.budget / 10000).toFixed(0)} 萬`}
                        {tender.submitDeadline && ` · 截止 ${new Date(tender.submitDeadline).toLocaleDateString("zh-TW")}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {tender.aiScore !== null && (
                        <span className={`font-bold text-sm ${
                          tender.aiScore >= 70 ? "text-green-400" :
                          tender.aiScore >= 40 ? "text-yellow-400" : "text-red-400"
                        }`}>
                          {tender.aiScore}
                        </span>
                      )}
                      {tender.aiPriority && (
                        <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[tender.aiPriority]}`}>
                          {PRIORITY_LABELS[tender.aiPriority]}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card
          className="cursor-pointer hover:bg-muted/20 transition-colors"
          onClick={() => setLocation("/tenders")}
        >
          <CardContent className="pt-5 pb-5 flex items-center gap-4">
            <div className="p-3 rounded-full bg-blue-500/10">
              <FileText className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="font-medium">瀏覽所有標案</p>
              <p className="text-xs text-muted-foreground">搜尋、篩選、查看詳情</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto" />
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:bg-muted/20 transition-colors"
          onClick={() => setLocation("/tender-crawler")}
        >
          <CardContent className="pt-5 pb-5 flex items-center gap-4">
            <div className="p-3 rounded-full bg-green-500/10">
              <Bot className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="font-medium">爬蟲管理</p>
              <p className="text-xs text-muted-foreground">手動觸發、查看記錄</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto" />
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:bg-muted/20 transition-colors"
          onClick={() => setLocation("/tenders/scoring")}
        >
          <CardContent className="pt-5 pb-5 flex items-center gap-4">
            <div className="p-3 rounded-full bg-purple-500/10">
              <Brain className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="font-medium">AI 評分管理</p>
              <p className="text-xs text-muted-foreground">批次評分、重新評分</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
