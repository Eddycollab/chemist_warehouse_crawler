import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Plus, Pencil, Trash2, Globe, Rss, Play, Clock, FlaskConical, CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";

type NewsSource = {
  id: number;
  name: string;
  url: string;
  articleSelector: string;
  titleSelector: string;
  dateSelector?: string | null;
  excerptSelector?: string | null;
  imageSelector?: string | null;
  paginationSelector?: string | null;
  maxPages: number;
  isActive: boolean;
  notes?: string | null;
  lastCrawledAt?: Date | null;
  createdAt: Date;
};

type TestResult = {
  success: boolean;
  articles: Array<{ title: string; url: string; publishedAt?: string; excerpt?: string }>;
  totalFound: number;
  errorMessage?: string;
};

const defaultForm = {
  name: "",
  url: "",
  articleSelector: "article",
  titleSelector: ".entry-title a",
  dateSelector: ".entry-date",
  excerptSelector: ".entry-summary",
  imageSelector: ".wp-post-image",
  paginationSelector: ".pagination a.next",
  maxPages: 5,
  notes: "",
};

export default function NewsSources() {
  const utils = trpc.useUtils();
  const { data: sources = [], isLoading } = trpc.news.getSources.useQuery();

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<NewsSource | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NewsSource | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const createMutation = trpc.news.createSource.useMutation({
    onSuccess: () => {
      utils.news.getSources.invalidate();
      toast.success("已新增新聞來源");
      setShowForm(false);
      setForm(defaultForm);
      setTestResult(null);
    },
    onError: (e) => toast.error("新增失敗：" + e.message),
  });

  const updateMutation = trpc.news.updateSource.useMutation({
    onSuccess: () => {
      utils.news.getSources.invalidate();
      toast.success("已更新新聞來源");
      setEditTarget(null);
      setTestResult(null);
    },
    onError: (e) => toast.error("更新失敗：" + e.message),
  });

  const deleteMutation = trpc.news.deleteSource.useMutation({
    onSuccess: () => {
      utils.news.getSources.invalidate();
      toast.success("已刪除新聞來源及其所有文章");
      setDeleteTarget(null);
    },
    onError: (e) => toast.error("刪除失敗：" + e.message),
  });

  const toggleMutation = trpc.news.toggleSourceActive.useMutation({
    onSuccess: () => utils.news.getSources.invalidate(),
    onError: (e) => toast.error("操作失敗：" + e.message),
  });

  const crawlMutation = trpc.news.startCrawl.useMutation({
    onSuccess: (data) => {
      utils.news.getJobs.invalidate();
      toast.success(data.message);
    },
    onError: (e) => toast.error("啟動失敗：" + e.message),
  });

  const testSelectorMutation = trpc.news.testSelector.useMutation({
    onSuccess: (data) => {
      setTestResult(data);
      if (data.success) {
        toast.success(`測試成功！找到 ${data.totalFound} 個文章容器，預覽前 ${data.articles.length} 筆`);
      } else {
        toast.error("測試失敗：" + (data.errorMessage ?? "未知錯誤"));
      }
    },
    onError: (e) => toast.error("測試失敗：" + e.message),
  });

  function openEdit(source: NewsSource) {
    setEditTarget(source);
    setTestResult(null);
    setForm({
      name: source.name,
      url: source.url,
      articleSelector: source.articleSelector,
      titleSelector: source.titleSelector,
      dateSelector: source.dateSelector ?? "",
      excerptSelector: source.excerptSelector ?? "",
      imageSelector: source.imageSelector ?? "",
      paginationSelector: source.paginationSelector ?? "",
      maxPages: source.maxPages,
      notes: source.notes ?? "",
    });
  }

  function handleSubmit() {
    if (!form.name.trim() || !form.url.trim()) {
      toast.error("請填寫名稱和 URL");
      return;
    }
    const payload = {
      ...form,
      dateSelector: form.dateSelector || undefined,
      excerptSelector: form.excerptSelector || undefined,
      imageSelector: form.imageSelector || undefined,
      paginationSelector: form.paginationSelector || undefined,
      notes: form.notes || undefined,
    };
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function handleTestSelector() {
    if (!form.url.trim()) {
      toast.error("請先填寫起始 URL");
      return;
    }
    if (!form.articleSelector.trim() || !form.titleSelector.trim()) {
      toast.error("請填寫文章卡片選擇器和標題連結選擇器");
      return;
    }
    setTestResult(null);
    testSelectorMutation.mutate({
      url: form.url,
      articleSelector: form.articleSelector,
      titleSelector: form.titleSelector,
      dateSelector: form.dateSelector || undefined,
      excerptSelector: form.excerptSelector || undefined,
      imageSelector: form.imageSelector || undefined,
    });
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isTesting = testSelectorMutation.isPending;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Rss className="w-6 h-6 text-primary" />
            新聞來源管理
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            設定要監控的新聞網站或部落格，系統將定期抓取最新文章
          </p>
        </div>
        <Button onClick={() => { setEditTarget(null); setForm(defaultForm); setTestResult(null); setShowForm(true); }}>
          <Plus className="w-4 h-4 mr-2" />
          新增來源
        </Button>
      </div>

      {/* Tips Card */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="pt-4 pb-3">
          <p className="text-sm text-blue-400 font-medium mb-1">如何取得 CSS 選擇器？</p>
          <p className="text-xs text-muted-foreground">
            在目標網站按 <kbd className="px-1 py-0.5 bg-muted rounded text-xs">F12</kbd> 開啟開發者工具，找到文章卡片的 HTML 元素，右鍵選「複製 &gt; 複製選擇器」即可。
            填好選擇器後，可點擊「測試選擇器」按鈕預覽爬取結果，確認無誤後再儲存。
          </p>
        </CardContent>
      </Card>

      {/* Sources List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">載入中...</div>
      ) : sources.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Globe className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-muted-foreground">尚未設定任何新聞來源</p>
            <p className="text-sm text-muted-foreground/70 mt-1">點擊「新增來源」開始監控新聞</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {sources.map((source) => (
            <Card key={source.id} className={source.isActive ? "" : "opacity-60"}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-base">{source.name}</CardTitle>
                      <Badge variant={source.isActive ? "default" : "secondary"}>
                        {source.isActive ? "啟用" : "停用"}
                      </Badge>
                    </div>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline truncate block mt-0.5"
                    >
                      {source.url}
                    </a>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => crawlMutation.mutate({ sourceId: source.id })}
                      disabled={crawlMutation.isPending}
                      title="立即爬取"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(source)} title="編輯">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(source as NewsSource)}
                      title="刪除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                    <Switch
                      checked={source.isActive}
                      onCheckedChange={(v) => toggleMutation.mutate({ id: source.id, isActive: v })}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>文章選擇器：<code className="text-foreground">{source.articleSelector}</code></span>
                  <span>標題選擇器：<code className="text-foreground">{source.titleSelector}</code></span>
                  <span>最大頁數：<span className="text-foreground">{source.maxPages}</span></span>
                  {source.lastCrawledAt && (
                    <span className="flex items-center gap-1 col-span-2 md:col-span-3">
                      <Clock className="w-3 h-3" />
                      上次爬取：{new Date(source.lastCrawledAt).toLocaleString()}
                    </span>
                  )}
                </div>
                {source.notes && (
                  <p className="text-xs text-muted-foreground mt-2 italic">{source.notes}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showForm || !!editTarget} onOpenChange={(o) => { if (!o) { setShowForm(false); setEditTarget(null); setTestResult(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? "編輯新聞來源" : "新增新聞來源"}</DialogTitle>
            <DialogDescription>設定要監控的網站 URL 和 CSS 選擇器，填好後可先測試選擇器是否正確</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>來源名稱 *</Label>
                <Input
                  placeholder="例如：天下雜誌教育版"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>最大爬取頁數</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={form.maxPages}
                  onChange={(e) => setForm({ ...form, maxPages: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>起始 URL *</Label>
              <Input
                placeholder="https://www.example.com/news/"
                value={form.url}
                onChange={(e) => { setForm({ ...form, url: e.target.value }); setTestResult(null); }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>文章卡片選擇器 *</Label>
                <Input
                  placeholder="article"
                  value={form.articleSelector}
                  onChange={(e) => { setForm({ ...form, articleSelector: e.target.value }); setTestResult(null); }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>標題連結選擇器 *</Label>
                <Input
                  placeholder=".entry-title a"
                  value={form.titleSelector}
                  onChange={(e) => { setForm({ ...form, titleSelector: e.target.value }); setTestResult(null); }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>日期選擇器（選填）</Label>
                <Input
                  placeholder=".entry-date"
                  value={form.dateSelector}
                  onChange={(e) => setForm({ ...form, dateSelector: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>摘要選擇器（選填）</Label>
                <Input
                  placeholder=".entry-summary"
                  value={form.excerptSelector}
                  onChange={(e) => setForm({ ...form, excerptSelector: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>封面圖選擇器（選填）</Label>
                <Input
                  placeholder=".wp-post-image"
                  value={form.imageSelector}
                  onChange={(e) => setForm({ ...form, imageSelector: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>下一頁選擇器（選填）</Label>
                <Input
                  placeholder=".pagination a.next"
                  value={form.paginationSelector}
                  onChange={(e) => setForm({ ...form, paginationSelector: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>備註（選填）</Label>
              <Textarea
                placeholder="關於這個來源的備注..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
              />
            </div>

            {/* Test Selector Button */}
            <div className="border-t pt-3">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleTestSelector}
                disabled={isTesting}
              >
                <FlaskConical className="w-4 h-4 mr-2" />
                {isTesting ? "測試中，請稍候（約 15-30 秒）..." : "測試選擇器（預覽爬取結果）"}
              </Button>
            </div>

            {/* Test Result Preview */}
            {testResult && (
              <div className={`rounded-lg border p-4 space-y-3 ${testResult.success ? "border-green-500/40 bg-green-500/5" : "border-red-500/40 bg-red-500/5"}`}>
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500 shrink-0" />
                  )}
                  <span className={`text-sm font-medium ${testResult.success ? "text-green-400" : "text-red-400"}`}>
                    {testResult.success
                      ? `測試成功！共找到 ${testResult.totalFound} 個文章容器，以下為前 ${testResult.articles.length} 筆預覽`
                      : `測試失敗：${testResult.errorMessage}`}
                  </span>
                </div>
                {testResult.success && testResult.articles.length > 0 && (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {testResult.articles.map((article, i) => (
                      <div key={i} className="text-xs bg-background/50 rounded p-2 border border-border/50">
                        <div className="flex items-start gap-2">
                          <span className="text-muted-foreground shrink-0 w-5 text-right">{i + 1}.</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium text-foreground line-clamp-2">{article.title || "(無標題)"}</span>
                              {article.url && (
                                <a
                                  href={article.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline shrink-0"
                                  title={article.url}
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            {article.publishedAt && (
                              <span className="text-muted-foreground mt-0.5 block">日期：{article.publishedAt}</span>
                            )}
                            {article.excerpt && (
                              <span className="text-muted-foreground mt-0.5 block line-clamp-2">摘要：{article.excerpt}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditTarget(null); setTestResult(null); }}>取消</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? "儲存中..." : editTarget ? "更新" : "新增"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認刪除</AlertDialogTitle>
            <AlertDialogDescription>
              確定要刪除「{deleteTarget?.name}」嗎？此操作將同時刪除該來源的所有已爬取文章，且無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })}
            >
              確認刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
