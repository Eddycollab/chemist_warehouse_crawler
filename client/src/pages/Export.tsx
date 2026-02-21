import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, FileSpreadsheet, FileText, Loader2, Package, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { CATEGORY_LABELS } from "../lib/categoryLabels";
import * as XLSX from "xlsx";

const CATEGORY_OPTIONS = [
  { value: "all", label: "全部品類" },
  { value: "beauty_skincare", label: "美妝護膚" },
  { value: "adult_health", label: "成人保健" },
  { value: "childrens_health", label: "兒童保健" },
  { value: "vegan_health", label: "純素保健" },
  { value: "natural_soap", label: "天然香皂" },
  { value: "oral_care", label: "口腔保健" },
  { value: "medicines", label: "藥品" },
];

const DAYS_OPTIONS = [
  { value: "7", label: "最近 7 天" },
  { value: "30", label: "最近 30 天" },
  { value: "90", label: "最近 90 天" },
  { value: "180", label: "最近 180 天" },
  { value: "365", label: "最近 365 天" },
];

type ProductCategory = "beauty_skincare" | "adult_health" | "childrens_health" | "vegan_health" | "natural_soap" | "oral_care" | "medicines" | "other";

export default function Export() {
  const [productCategory, setProductCategory] = useState("all");
  const [onSaleOnly, setOnSaleOnly] = useState(false);
  const [historyDays, setHistoryDays] = useState("90");
  const [isExporting, setIsExporting] = useState(false);

  const { data: products, isLoading: productsLoading } = trpc.export.products.useQuery({
    category: productCategory !== "all" ? (productCategory as ProductCategory) : undefined,
    isOnSale: onSaleOnly ? true : undefined,
  });

  const { data: priceHistory, isLoading: historyLoading } = trpc.export.priceHistory.useQuery({
    days: parseInt(historyDays),
  });

  function formatDate(date: Date | string | null | undefined): string {
    if (!date) return "";
    return new Date(date).toLocaleString("zh-TW", {
      timeZone: "Australia/Sydney",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function exportProductsCSV() {
    if (!products || products.length === 0) {
      toast.error("沒有可匯出的產品資料");
      return;
    }
    const headers = ["ID", "產品名稱", "品牌", "SKU", "品類", "當前價格", "原價", "折扣%", "是否特價", "是否追蹤中", "最後爬取時間", "建立時間", "產品連結"];
    const rows = products.map((p) => [
      p.id,
      p.name,
      p.brand ?? "",
      p.sku ?? "",
      CATEGORY_LABELS[p.category as keyof typeof CATEGORY_LABELS] ?? p.category,
      p.currentPrice ?? "",
      p.originalPrice ?? "",
      p.discountPercent ?? "",
      p.isOnSale ? "是" : "否",
      p.isActive ? "是" : "否",
      formatDate(p.lastCrawledAt),
      formatDate(p.createdAt),
      p.url,
    ]);
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cw_products_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已匯出 ${products.length} 筆產品資料（CSV）`);
  }

  function exportPriceHistoryCSV() {
    if (!priceHistory || priceHistory.length === 0) {
      toast.error("沒有可匯出的價格歷史資料");
      return;
    }
    const headers = ["記錄ID", "產品ID", "價格", "原價", "是否特價", "折扣%", "爬取時間"];
    const rows = priceHistory.map((h) => [
      h.id,
      h.productId,
      h.price,
      h.originalPrice ?? "",
      h.isOnSale ? "是" : "否",
      h.discountPercent ?? "",
      formatDate(h.crawledAt),
    ]);
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cw_price_history_${historyDays}days_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已匯出 ${priceHistory.length} 筆價格歷史資料（CSV）`);
  }

  async function exportExcel() {
    if ((!products || products.length === 0) && (!priceHistory || priceHistory.length === 0)) {
      toast.error("沒有可匯出的資料");
      return;
    }
    setIsExporting(true);
    try {
      const wb = XLSX.utils.book_new();

      // Products sheet
      if (products && products.length > 0) {
        const productData = products.map((p) => ({
          "ID": p.id,
          "產品名稱": p.name,
          "品牌": p.brand ?? "",
          "SKU": p.sku ?? "",
          "品類": CATEGORY_LABELS[p.category as keyof typeof CATEGORY_LABELS] ?? p.category,
          "當前價格": p.currentPrice ? Number(p.currentPrice) : "",
          "原價": p.originalPrice ? Number(p.originalPrice) : "",
          "折扣%": p.discountPercent ? Number(p.discountPercent) : "",
          "是否特價": p.isOnSale ? "是" : "否",
          "是否追蹤中": p.isActive ? "是" : "否",
          "最後爬取時間": formatDate(p.lastCrawledAt),
          "建立時間": formatDate(p.createdAt),
          "產品連結": p.url,
        }));
        const ws = XLSX.utils.json_to_sheet(productData);
        ws["!cols"] = [
          { wch: 6 }, { wch: 50 }, { wch: 20 }, { wch: 12 }, { wch: 12 },
          { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 10 },
          { wch: 18 }, { wch: 18 }, { wch: 60 },
        ];
        XLSX.utils.book_append_sheet(wb, ws, "產品清單");
      }

      // Price History sheet
      if (priceHistory && priceHistory.length > 0) {
        const historyData = priceHistory.map((h) => ({
          "記錄ID": h.id,
          "產品ID": h.productId,
          "價格": Number(h.price),
          "原價": h.originalPrice ? Number(h.originalPrice) : "",
          "是否特價": h.isOnSale ? "是" : "否",
          "折扣%": h.discountPercent ? Number(h.discountPercent) : "",
          "爬取時間": formatDate(h.crawledAt),
        }));
        const ws2 = XLSX.utils.json_to_sheet(historyData);
        ws2["!cols"] = [
          { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 18 },
        ];
        XLSX.utils.book_append_sheet(wb, ws2, `價格歷史(${historyDays}天)`);
      }

      XLSX.writeFile(wb, `cw_data_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Excel 檔案已匯出（含產品清單和價格歷史兩個工作表）");
    } catch (err) {
      toast.error("匯出失敗，請重試");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Download className="h-6 w-6 text-primary" />
          資料匯出
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          將產品清單和價格歷史匯出為 CSV 或 Excel 格式，供後續數據分析使用
        </p>
      </div>

      {/* Filter Options */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">匯出設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">產品品類篩選</label>
              <Select value={productCategory} onValueChange={setProductCategory}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">特價篩選</label>
              <Select value={onSaleOnly ? "sale" : "all"} onValueChange={(v) => setOnSaleOnly(v === "sale")}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部產品</SelectItem>
                  <SelectItem value="sale">僅特價產品</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">價格歷史範圍</label>
              <Select value={historyDays} onValueChange={setHistoryDays}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Data Preview */}
          <div className="flex items-center gap-4 pt-2 border-t border-border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Package className="h-4 w-4 text-primary" />
              {productsLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <span>
                  <span className="text-foreground font-medium">{products?.length ?? 0}</span> 筆產品
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingDown className="h-4 w-4 text-primary" />
              {historyLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <span>
                  <span className="text-foreground font-medium">{priceHistory?.length ?? 0}</span> 筆價格歷史
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Export Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Products CSV */}
        <Card className="bg-card border-border hover:border-primary/30 transition-colors">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-green-500/10">
                <FileText className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="font-medium text-sm">產品清單 CSV</p>
                <p className="text-xs text-muted-foreground">含名稱、品牌、價格、連結等欄位</p>
              </div>
            </div>
            <Badge variant="outline" className="text-xs border-green-500/30 text-green-400">
              {products?.length ?? 0} 筆資料
            </Badge>
            <Button
              className="w-full gap-2"
              variant="outline"
              onClick={exportProductsCSV}
              disabled={productsLoading || !products || products.length === 0}
            >
              <Download className="h-4 w-4" />
              下載 CSV
            </Button>
          </CardContent>
        </Card>

        {/* Price History CSV */}
        <Card className="bg-card border-border hover:border-primary/30 transition-colors">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-blue-500/10">
                <TrendingDown className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="font-medium text-sm">價格歷史 CSV</p>
                <p className="text-xs text-muted-foreground">含產品ID、價格、爬取時間等欄位</p>
              </div>
            </div>
            <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400">
              {priceHistory?.length ?? 0} 筆資料（{historyDays} 天）
            </Badge>
            <Button
              className="w-full gap-2"
              variant="outline"
              onClick={exportPriceHistoryCSV}
              disabled={historyLoading || !priceHistory || priceHistory.length === 0}
            >
              <Download className="h-4 w-4" />
              下載 CSV
            </Button>
          </CardContent>
        </Card>

        {/* Excel (Both) */}
        <Card className="bg-card border-primary/30 hover:border-primary/60 transition-colors">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">完整 Excel 匯出</p>
                <p className="text-xs text-muted-foreground">產品清單 + 價格歷史，兩個工作表</p>
              </div>
            </div>
            <Badge variant="outline" className="text-xs border-primary/30 text-primary">
              推薦格式
            </Badge>
            <Button
              className="w-full gap-2 bg-primary hover:bg-primary/90"
              onClick={exportExcel}
              disabled={isExporting || (productsLoading && historyLoading)}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              下載 Excel
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Tips */}
      <Card className="bg-card border-border">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">使用提示：</span>
            匯出的 Excel 檔案包含兩個工作表——「產品清單」和「價格歷史」。
            可將此檔案匯入 Google Sheets、Power BI 或 Tableau 進行進階數據分析和視覺化。
            CSV 格式採用 UTF-8 BOM 編碼，可直接用 Excel 開啟並正確顯示中文字符。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
