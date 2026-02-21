import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Newspaper, ExternalLink, Search, Trash2, CheckCheck, RefreshCw, Filter } from "lucide-react";
import { toast } from "sonner";

const PAGE_SIZE = 20;

export default function NewsArticles() {
  const utils = trpc.useUtils();
  const { data: sources = [] } = trpc.news.getSources.useQuery();

  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterRead, setFilterRead] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const queryInput = useMemo(() => ({
    sourceId: filterSource !== "all" ? Number(filterSource) : undefined,
    isRead: filterRead === "unread" ? false : filterRead === "read" ? true : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [filterSource, filterRead, page]);

  const { data, isLoading, refetch } = trpc.news.getArticles.useQuery(queryInput);
  const articles = data?.articles ?? [];
  const total = data?.total ?? 0;

  const markReadMutation = trpc.news.markRead.useMutation({
    onSuccess: () => utils.news.getArticles.invalidate(),
    onError: (e) => toast.error("操作失敗：" + e.message),
  });

  const markAllReadMutation = trpc.news.markAllRead.useMutation({
    onSuccess: () => {
      utils.news.getArticles.invalidate();
      toast.success("已全部標記為已讀");
    },
    onError: (e) => toast.error("操作失敗：" + e.message),
  });

  const deleteArticleMutation = trpc.news.deleteArticle.useMutation({
    onSuccess: () => {
      utils.news.getArticles.invalidate();
      toast.success("已刪除文章");
    },
    onError: (e) => toast.error("刪除失敗：" + e.message),
  });

  const deleteAllMutation = trpc.news.deleteAllArticles.useMutation({
    onSuccess: () => {
      utils.news.getArticles.invalidate();
      toast.success("已清除所有文章");
      setShowClearConfirm(false);
    },
    onError: (e) => toast.error("清除失敗：" + e.message),
  });

  // Client-side search filter
  const filteredArticles = useMemo(() => {
    if (!search.trim()) return articles;
    const kw = search.toLowerCase();
    return articles.filter(
      (a) =>
        a.title.toLowerCase().includes(kw) ||
        (a.excerpt ?? "").toLowerCase().includes(kw) ||
        (a.sourceName ?? "").toLowerCase().includes(kw)
    );
  }, [articles, search]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const unreadCount = articles.filter((a) => !a.isRead).length;

  function handleSourceFilter(v: string) {
    setFilterSource(v);
    setPage(0);
  }

  function handleReadFilter(v: string) {
    setFilterRead(v);
    setPage(0);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Newspaper className="w-6 h-6 text-primary" />
            新聞文章列表
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            共 {total} 篇文章
            {unreadCount > 0 && <span className="ml-2 text-primary font-medium">（{unreadCount} 篇未讀）</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />
            重新整理
          </Button>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAllReadMutation.mutate(
              filterSource !== "all" ? { sourceId: Number(filterSource) } : undefined
            )}>
              <CheckCheck className="w-4 h-4 mr-1" />
              全部標為已讀
            </Button>
          )}
          {total > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setShowClearConfirm(true)}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              清除文章
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜尋標題或摘要..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterSource} onValueChange={handleSourceFilter}>
          <SelectTrigger className="w-44">
            <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="所有來源" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有來源</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterRead} onValueChange={handleReadFilter}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="全部" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="unread">未讀</SelectItem>
            <SelectItem value="read">已讀</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Articles */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">載入中...</div>
      ) : filteredArticles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Newspaper className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              {search ? "找不到符合條件的文章" : "尚無文章，請先執行爬取任務"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredArticles.map((article) => (
            <Card
              key={article.id}
              className={`transition-colors hover:bg-muted/20 ${!article.isRead ? "border-primary/30 bg-primary/5" : ""}`}
            >
              <CardContent className="py-3 px-4">
                <div className="flex gap-3">
                  {/* Thumbnail */}
                  {article.imageUrl && (
                    <img
                      src={article.imageUrl}
                      alt=""
                      className="w-16 h-12 object-cover rounded shrink-0 hidden sm:block"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          {!article.isRead && (
                            <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          )}
                          <a
                            href={article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium hover:text-primary hover:underline line-clamp-2 leading-snug"
                            onClick={() => !article.isRead && markReadMutation.mutate({ id: article.id, isRead: true })}
                          >
                            {article.title}
                          </a>
                          <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                          <Badge variant="secondary" className="text-xs py-0">
                            {article.sourceName ?? `來源 #${article.sourceId}`}
                          </Badge>
                          {article.publishedAt && (
                            <span>{new Date(article.publishedAt).toLocaleDateString()}</span>
                          )}
                          <span>{new Date(article.crawledAt).toLocaleString()} 爬取</span>
                        </div>
                        {article.excerpt && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{article.excerpt}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {!article.isRead && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-muted-foreground"
                            onClick={() => markReadMutation.mutate({ id: article.id, isRead: true })}
                          >
                            標為已讀
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteArticleMutation.mutate({ id: article.id })}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            上一頁
          </Button>
          <span className="text-sm text-muted-foreground">
            第 {page + 1} / {totalPages} 頁
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            下一頁
          </Button>
        </div>
      )}

      {/* Clear Confirm */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清除文章</AlertDialogTitle>
            <AlertDialogDescription>
              確定要清除
              {filterSource !== "all"
                ? `「${sources.find((s) => String(s.id) === filterSource)?.name}」的所有文章`
                : "所有來源的所有文章"}
              嗎？此操作無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deleteAllMutation.mutate(
                  filterSource !== "all" ? { sourceId: Number(filterSource) } : undefined
                )
              }
            >
              確認清除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
