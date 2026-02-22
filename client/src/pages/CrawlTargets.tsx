import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Plus, Pencil, Trash2, Globe, Info, Wand2, CheckCircle, AlertCircle, HelpCircle, PlayCircle, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

type TargetForm = {
  name: string;
  baseUrl: string;
  productListSelector: string;
  productNameSelector: string;
  productPriceSelector: string;
  productOriginalPriceSelector: string;
  productLinkSelector: string;
  productImageSelector: string;
  paginationParam: string;
  maxPages: number;
  isActive: boolean;
  notes: string;
};

const defaultForm: TargetForm = {
  name: "",
  baseUrl: "",
  productListSelector: "",
  productNameSelector: "",
  productPriceSelector: "",
  productOriginalPriceSelector: "",
  productLinkSelector: "",
  productImageSelector: "",
  paginationParam: "page",
  maxPages: 10,
  isActive: true,
  notes: "",
};

export default function CrawlTargets() {
  const utils = trpc.useUtils();

  const { data: targets = [], isLoading } = trpc.targets.list.useQuery();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TargetForm>(defaultForm);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [detectResult, setDetectResult] = useState<{
    confidence: "high" | "medium" | "low";
    notes: string;
    containerCount: number;
  } | null>(null);
  const [testCrawlOpen, setTestCrawlOpen] = useState(false);
  const [testCrawlResult, setTestCrawlResult] = useState<{
    totalFound: number;
    products: Array<{ name: string; price: string; link: string; image: string }>;
    url: string;
    selector: string;
  } | null>(null);
  const [testCrawlError, setTestCrawlError] = useState<string | null>(null);
  const testCrawlMutation = trpc.targets.testCrawl.useMutation({
    onSuccess: (data) => {
      setTestCrawlResult(data);
      setTestCrawlError(null);
    },
    onError: (e) => {
      setTestCrawlError(e.message);
      setTestCrawlResult(null);
    },
  });

  const createMutation = trpc.targets.create.useMutation({
    onSuccess: () => {
      utils.targets.list.invalidate();
      setDialogOpen(false);
      toast.success("已新增目標網站");
    },
    onError: (e) => toast.error("新增失敗：" + e.message),
  });

  const updateMutation = trpc.targets.update.useMutation({
    onSuccess: () => {
      utils.targets.list.invalidate();
      setDialogOpen(false);
      toast.success("已更新目標網站");
    },
    onError: (e) => toast.error("更新失敗：" + e.message),
  });

  const deleteMutation = trpc.targets.delete.useMutation({
    onSuccess: () => {
      utils.targets.list.invalidate();
      setDeleteId(null);
      toast.success("已刪除目標網站");
    },
    onError: (e) => toast.error("刪除失敗：" + e.message),
  });

  const toggleMutation = trpc.targets.toggleActive.useMutation({
    onSuccess: () => utils.targets.list.invalidate(),
    onError: (e) => toast.error("操作失敗：" + e.message),
  });

  const detectMutation = trpc.targets.detectSelectors.useMutation({
    onSuccess: (data) => {
      setForm((prev) => ({
        ...prev,
        productListSelector: data.productListSelector || prev.productListSelector,
        productNameSelector: data.productNameSelector || prev.productNameSelector,
        productPriceSelector: data.productPriceSelector || prev.productPriceSelector,
        productOriginalPriceSelector: data.productOriginalPriceSelector || prev.productOriginalPriceSelector,
        productLinkSelector: data.productLinkSelector || prev.productLinkSelector,
        productImageSelector: data.productImageSelector || prev.productImageSelector,
        paginationParam: data.paginationParam || prev.paginationParam,
      }));
      setDetectResult({
        confidence: data.confidence,
        notes: data.notes,
        containerCount: data.containerCount,
      });
      const confidenceLabel = data.confidence === "high" ? "高" : data.confidence === "medium" ? "中" : "低";
      toast.success(`自動偵測完成（信心度：${confidenceLabel}），已填入選擇器`);
    },
    onError: (e) => {
      toast.error("自動偵測失敗：" + e.message);
    },
  });

  function openCreate() {
    setEditingId(null);
    setForm(defaultForm);
    setDetectResult(null);
    setDialogOpen(true);
  }

  function openEdit(target: typeof targets[0]) {
    setEditingId(target.id);
    setDetectResult(null);
    setForm({
      name: target.name,
      baseUrl: target.baseUrl,
      productListSelector: target.productListSelector,
      productNameSelector: target.productNameSelector,
      productPriceSelector: target.productPriceSelector,
      productOriginalPriceSelector: target.productOriginalPriceSelector ?? "",
      productLinkSelector: target.productLinkSelector,
      productImageSelector: target.productImageSelector ?? "",
      paginationParam: target.paginationParam,
      maxPages: target.maxPages,
      isActive: target.isActive,
      notes: target.notes ?? "",
    });
    setDialogOpen(true);
  }

  function handleDetect() {
    if (!form.baseUrl) {
      toast.error("請先填入目標 URL");
      return;
    }
    try {
      new URL(form.baseUrl);
    } catch {
      toast.error("URL 格式不正確，請輸入完整網址（含 https://）");
      return;
    }
    setDetectResult(null);
    detectMutation.mutate({ url: form.baseUrl });
  }

  function handleSubmit() {
    const payload = {
      ...form,
      maxPages: Number(form.maxPages),
      productOriginalPriceSelector: form.productOriginalPriceSelector || undefined,
      productImageSelector: form.productImageSelector || undefined,
      notes: form.notes || undefined,
    };
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDetecting = detectMutation.isPending;

  const confidenceColor = detectResult?.confidence === "high"
    ? "text-green-600 dark:text-green-400"
    : detectResult?.confidence === "medium"
    ? "text-yellow-600 dark:text-yellow-400"
    : "text-red-600 dark:text-red-400";

  const ConfidenceIcon = detectResult?.confidence === "high"
    ? CheckCircle
    : detectResult?.confidence === "medium"
    ? HelpCircle
    : AlertCircle;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">爬取目標網站</h1>
          <p className="text-muted-foreground text-sm mt-1">
            設定自訂電商網站的 CSS 選擇器，讓爬蟲抓取任意網站的產品資料
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          新增目標網站
        </Button>
      </div>

      {/* Info card */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3">
            <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
              <p className="font-medium">如何設定 CSS 選擇器？</p>
              <p>輸入目標 URL 後，點擊「<Wand2 className="h-3 w-3 inline" /> 自動偵測選擇器」按鈕，系統會自動分析網頁結構並填入建議的選擇器。</p>
              <p>若自動偵測結果不準確，可在目標網站按 F12 開啟開發者工具，手動複製正確的 CSS 選擇器。</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Target list */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">載入中...</div>
      ) : targets.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">尚未設定任何目標網站</p>
            <Button className="mt-4" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              新增第一個目標網站
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {targets.map((target) => (
            <Card key={target.id} className={!target.isActive ? "opacity-60" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-base">{target.name}</CardTitle>
                      <Badge variant={target.isActive ? "default" : "secondary"}>
                        {target.isActive ? "啟用" : "停用"}
                      </Badge>
                    </div>
                    <CardDescription className="mt-1 truncate">{target.baseUrl}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={target.isActive}
                      onCheckedChange={(checked) =>
                        toggleMutation.mutate({ id: target.id, isActive: checked })
                      }
                    />
                    <Button variant="ghost" size="icon" onClick={() => openEdit(target)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(target.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium">產品容器：</span>
                    <code className="ml-1 text-foreground">{target.productListSelector}</code>
                  </div>
                  <div>
                    <span className="font-medium">名稱：</span>
                    <code className="ml-1 text-foreground">{target.productNameSelector}</code>
                  </div>
                  <div>
                    <span className="font-medium">價格：</span>
                    <code className="ml-1 text-foreground">{target.productPriceSelector}</code>
                  </div>
                  <div>
                    <span className="font-medium">連結：</span>
                    <code className="ml-1 text-foreground">{target.productLinkSelector}</code>
                  </div>
                  <div>
                    <span className="font-medium">分頁參數：</span>
                    <code className="ml-1 text-foreground">{target.paginationParam}</code>
                  </div>
                  <div>
                    <span className="font-medium">最大頁數：</span>
                    <span className="ml-1 text-foreground">{target.maxPages}</span>
                  </div>
                  {target.notes && (
                    <div className="md:col-span-3">
                      <span className="font-medium">備註：</span>
                      <span className="ml-1">{target.notes}</span>
                    </div>
                  )}
                </div>
                {target.isActive && (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 text-xs"
                      disabled={testCrawlMutation.isPending}
                      onClick={() => {
                        setTestCrawlResult(null);
                        setTestCrawlError(null);
                        setTestCrawlOpen(true);
                        testCrawlMutation.mutate({ id: target.id });
                      }}
                    >
                      {testCrawlMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <PlayCircle className="h-3.5 w-3.5" />
                      )}
                      測試爆取
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Test Crawl Result Dialog */}
      <Dialog open={testCrawlOpen} onOpenChange={setTestCrawlOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5 text-primary" />
              測試爆取結果
            </DialogTitle>
            <DialogDescription>
              使用已設定的 CSS 選擇器實際抓取第一頁產品資料
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {testCrawlMutation.isPending && (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">正在抓取網頁資料，請稍候...</p>
              </div>
            )}
            {testCrawlError && (
              <div className="flex items-start gap-3 p-4 rounded-lg border border-red-500/30 bg-red-500/10">
                <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-300">爆取失敗</p>
                  <p className="text-xs text-red-400/80 mt-1">{testCrawlError}</p>
                  <p className="text-xs text-muted-foreground mt-2">請先點擊「編輯」並使用「自動偵測」填入選擇器，或手動輸入正確的 CSS 選擇器。</p>
                </div>
              </div>
            )}
            {testCrawlResult && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 rounded-lg border border-green-500/30 bg-green-500/10">
                  <CheckCircle className="h-5 w-5 text-green-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-300">爆取成功</p>
                    <p className="text-xs text-green-400/70">共發現 <strong>{testCrawlResult.totalFound}</strong> 個產品容器，顯示前 {testCrawlResult.products.length} 筆預覽</p>
                  </div>
                </div>
                {testCrawlResult.products.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 text-yellow-400" />
                    <p>找到容器但無法解析產品資料，請檢查名稱和價格選擇器是否正確。</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {testCrawlResult.products.map((p, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-secondary/20">
                        {p.image && (
                          <img src={p.image} alt={p.name} className="w-12 h-12 object-cover rounded shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-sm text-primary font-semibold">{p.price}</p>
                          {p.link && (
                            <a href={p.link.startsWith('http') ? p.link : testCrawlResult.url.replace(/\/[^/]*$/, '') + p.link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline flex items-center gap-1 mt-0.5">
                              <ExternalLink className="h-3 w-3" />檢視產品
                            </a>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">#{i + 1}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestCrawlOpen(false)}>關閉</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setDetectResult(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId !== null ? "編輯目標網站" : "新增目標網站"}</DialogTitle>
            <DialogDescription>
              設定目標網站的基本資訊和 CSS 選擇器，讓爬蟲能正確抓取產品資料
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>網站名稱 *</Label>
                <Input
                  placeholder="例：Priceline"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>目標 URL *</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://www.example.com/products"
                    value={form.baseUrl}
                    onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDetect}
                    disabled={isDetecting || !form.baseUrl}
                    className="shrink-0 gap-1.5"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    {isDetecting ? "偵測中..." : "自動偵測"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  輸入 URL 後點擊「自動偵測」，系統會分析網頁結構並自動填入選擇器
                </p>
              </div>
            </div>

            {/* Detection result banner */}
            {detectResult && (
              <div className={`flex items-start gap-2 p-3 rounded-md border text-sm ${
                detectResult.confidence === "high"
                  ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
                  : detectResult.confidence === "medium"
                  ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800"
                  : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
              }`}>
                <ConfidenceIcon className={`h-4 w-4 shrink-0 mt-0.5 ${confidenceColor}`} />
                <div className="space-y-0.5">
                  <p className={`font-medium ${confidenceColor}`}>
                    偵測信心度：{detectResult.confidence === "high" ? "高" : detectResult.confidence === "medium" ? "中" : "低"}
                    {detectResult.containerCount > 0 && `（找到 ${detectResult.containerCount} 個產品）`}
                  </p>
                  {detectResult.notes && (
                    <p className="text-muted-foreground">{detectResult.notes}</p>
                  )}
                  {detectResult.confidence === "low" && (
                    <p className="text-muted-foreground">建議手動確認選擇器是否正確，或嘗試使用 F12 開發者工具查找正確的 CSS 選擇器。</p>
                  )}
                </div>
              </div>
            )}

            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-3">CSS 選擇器設定</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>產品列表容器選擇器 *</Label>
                  <Input
                    placeholder="ul.product-list li"
                    value={form.productListSelector}
                    onChange={(e) => setForm({ ...form, productListSelector: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>產品名稱選擇器 *</Label>
                  <Input
                    placeholder="h2.product-name"
                    value={form.productNameSelector}
                    onChange={(e) => setForm({ ...form, productNameSelector: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>當前價格選擇器 *</Label>
                  <Input
                    placeholder="span.price"
                    value={form.productPriceSelector}
                    onChange={(e) => setForm({ ...form, productPriceSelector: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>原價選擇器（選填）</Label>
                  <Input
                    placeholder="span.original-price"
                    value={form.productOriginalPriceSelector}
                    onChange={(e) => setForm({ ...form, productOriginalPriceSelector: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>產品連結選擇器 *</Label>
                  <Input
                    placeholder="a.product-link"
                    value={form.productLinkSelector}
                    onChange={(e) => setForm({ ...form, productLinkSelector: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>產品圖片選擇器（選填）</Label>
                  <Input
                    placeholder="img.product-image"
                    value={form.productImageSelector}
                    onChange={(e) => setForm({ ...form, productImageSelector: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-3">分頁設定</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>分頁 URL 參數名稱</Label>
                  <Input
                    placeholder="page"
                    value={form.paginationParam}
                    onChange={(e) => setForm({ ...form, paginationParam: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">URL 中的分頁參數，例如 ?page=2</p>
                </div>
                <div className="space-y-2">
                  <Label>最大爬取頁數</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={form.maxPages}
                    onChange={(e) => setForm({ ...form, maxPages: parseInt(e.target.value) || 10 })}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>備註（選填）</Label>
              <Textarea
                placeholder="記錄此目標網站的特殊設定或注意事項..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={form.isActive}
                onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
              />
              <Label>立即啟用此目標網站</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? "儲存中..." : editingId !== null ? "儲存變更" : "新增"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認刪除</AlertDialogTitle>
            <AlertDialogDescription>
              刪除後無法復原，確定要刪除這個目標網站設定嗎？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId !== null && deleteMutation.mutate({ id: deleteId })}
            >
              確認刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
