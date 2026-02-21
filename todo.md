# Chemist Warehouse 價格追蹤系統 TODO

## 資料庫 Schema
- [x] 建立 products 表（產品資訊）
- [x] 建立 price_history 表（價格歷史記錄）
- [x] 建立 crawl_jobs 表（爬蟲任務設定）
- [x] 建立 notifications 表（通知歷史）
- [x] 執行資料庫 migration

## 後端 API
- [x] 建立爬蟲核心模組（Chemist Warehouse 爬蟲，JSON-LD + HTML 解析）
- [x] 建立產品管理 tRPC 路由（CRUD）
- [x] 建立價格歷史查詢路由
- [x] 建立爬蟲任務管理路由
- [x] 建立通知歷史路由
- [x] 建立手動觸發爬蟲路由
- [x] 建立定時任務系統（每週一 9:00 AEST 自動執行）
- [x] 建立價格變化偵測與通知機制
- [x] 建立品類管理（美妝護膚、成人保健、兒童保健、純素保健、天然香皂）

## 前端儀表板
- [x] 設定深色主題（Nord 配色方案，OKLCH 色彩空間）
- [x] 建立 DashboardLayout 側邊欄導航
- [x] 建立首頁概覽（統計卡片、最新特價商品、排程狀態）
- [x] 建立產品列表頁面（含搜尋、篩選、分類標籤）
- [x] 建立產品詳情頁面（價格歷史折線圖、記錄明細）
- [x] 建立爬蟲管理頁面（手動觸發、任務歷史）
- [x] 建立通知歷史頁面（標記已讀、類型圖示）
- [x] 建立系統設定頁面（通知門檻、爬蟲設定）
- [x] 實作價格趨勢圖表（Recharts LineChart）
- [x] 建立特價商品高亮顯示（折扣百分比 Badge）

## 部署配置
- [x] 建立 railway.json 部署配置
- [x] 建立 nixpacks.toml 建置配置
- [x] 建立 README.md 完整使用說明（含 Railway 部署步驟）
- [ ] 建立 GitHub Repository 並推送代碼（需手動操作，Token 權限限制）

## 測試
- [x] 撰寫爬蟲邏輯單元測試（10 tests passed）
- [x] 撰寫 tRPC 路由測試（product, notification, crawl, settings）
- [x] 原有 auth.logout 測試通過

## 移除登入限制（固定網址直接訪問）
- [x] 移除 DashboardLayout 的登入牆（不再要求 Manus OAuth）
- [x] 移除側邊欄底部的用戶資訊顯示，改為通知未讀數量 Badge
- [x] 確保所有 tRPC 路由改為 publicProcedure（不需要 protectedProcedure）
- [x] 測試所有頁面無需登入即可訪問（10 tests passed）

## 簡單密碼保護功能
- [x] 後端：在 crawler_settings 加入 access_password 設定（預設 cw2024）
- [x] 後端：建立 access.verify 和 access.hasPassword tRPC 路由
- [x] 前端：建立 PasswordContext（管理已驗證狀態，儲存至 localStorage，7 天有效期）
- [x] 前端：建立密碼登入頁面（Nord 深色主題，CW Logo 風格）
- [x] 前端：在 App.tsx 包裝密碼保護邏輯
- [x] 系統設定：加入密碼修改功能（輸入新密碼並確認）與登出按鈕

## 密碼修改 + Excel 匯入 + Railway 部署指南
- [x] 修改資料庫預設密碼為 CW150721
- [x] 修改後端 fallback 密碼為 CW150721
- [x] 安裝 xlsx 套件（解析 Excel 檔案）
- [x] 後端：建立 product.importFromExcel tRPC 路由
- [x] 前端：建立 Excel 匯入 UI（拖曳上傳、欄位預覽、確認匯入）
- [x] 提供 Excel 範本下載功能
- [x] 撰寫完整 Railway 部署指南（RAILWAY_DEPLOY.md）

## 停止爬取功能
- [x] 後端：在 crawler.ts 加入全域停止旗標（isCrawlStopped）
- [x] 後端：在爬蟲主迴圈各關鍵點檢查停止旗標
- [x] 後端：在 routers.ts 加入 crawl.stop tRPC mutation
- [x] 前端：在 CrawlerManager.tsx 加入「停止爬取」按鈕（執行中才顯示）
- [x] 前端：停止後更新任務狀態顯示

## 修復爬蟲狀態卡住問題
- [x] 後端 db.ts：加入 resetStuckJobs() 函式，將 running 狀態的任務改為 stopped
- [x] 後端 server startup：啟動時自動呼叫 resetStuckJobs()（處理 Railway 重啟後殘留的 running 任務）
- [x] 後端 routers.ts：加入 crawl.resetStuck mutation（手動重置）
- [x] 前端 CrawlerManager.tsx：加入「重置卡住任務」按鈕（當有 running 任務但 isRunning=false 時顯示）

## 爬蟲反偵測強化
- [x] 安裝 playwright-extra + puppeteer-extra-plugin-stealth
- [x] 改用 stealth chromium 啟動
- [x] 加入隨機延遲（1-4 秒）
- [x] Cookie 持久化（保存 session）
- [x] 加入更多反偵測措施（隨機 viewport、滑鼠移動模擬）
- [x] 更新 nixpacks.toml 確保 Railway 部署包含新依賴

## 修復爬蟲選擇器（CW HTML 結構不符）
- [x] 檢查 CW 網站實際 HTML 結構
- [x] 修正產品卡片選擇器
- [x] 修正價格選擇器
- [x] 修正 browserContext 關閉錯誤（每個品類使用獨立 context）

## 測試模式按鈕 + 爬蟲進度顯示
- [x] 後端 crawler.ts：加入 testMode 參數（只爬第 1 頁，最多 1 個品類）
- [x] 後端 crawler.ts：加入全域進度狀態（currentCategory, completedCategories, totalCategories）
- [x] 後端 routers.ts：加入 crawl.progress query（回傳進度資訊）
- [x] 後端 routers.ts：crawl.start 接受 testMode 參數
- [x] 前端 CrawlerManager.tsx：加入「測試爬蟲」按鈕（選擇品類後可選測試模式）
- [x] 前端 CrawlerManager.tsx：執行中橫幅顯示目前品類和完成百分比

## 修復爬蟲核心 Bug（第二輪）
- [x] 修正等待策略：改用等待特定產品元素出現（而非 networkidle）
- [x] 修正 browserContext 生命週期：確保每個品類使用獨立且不會提前關閉的 context
- [x] 加入更詳細的 debug 日誌（輸出頁面 title 和 URL，確認頁面有正確載入）

## 新增 Oral Care 和 Medicines 分類
- [x] 從 CW 導航選單確認 Oral Care 的正確分類 ID（ID=159, slug=oral-care）
- [x] 從 CW 導航選單確認 Medicines 的正確分類 ID（ID=258, slug=medicines）
- [x] 更新 CATEGORY_URLS 新增兩個分類
- [x] 推送到 GitHub

## 修復 browserContext 提前關閉 Bug（第三輪）
- [x] 分析 crawler.ts 的 context 生命週期管理邏輯
- [x] 修復：移除 browser 單例模式，每個子品類建立獨立 browser + context，finally 內同時關閉 context 和 browser
- [x] 更新 schema.ts PRODUCT_CATEGORIES enum 新增 oral_care 和 medicines
- [x] 執行資料庫 migration 更新 crawl_jobs 和 products 表的 category enum
- [x] 更新前端品類選擇器（CrawlerManager、Products）
- [x] 更新 categoryLabels.ts 新增標籤和顏色
- [x] 更新 routers.ts catMap 和 categoryLabels
- [x] 推送到 GitHub

## 新功能：爬蟲任務歷史刪除
- [x] 後端 db.ts：新增 deleteCrawlJob() 和 deleteAllCrawlJobs() 函式
- [x] 後端 routers.ts：新增 crawl.deleteJob mutation 和 crawl.deleteAllJobs mutation
- [x] 前端 CrawlerManager.tsx：每筆任務新增刪除按鈕（垃圾桶圖示）
- [x] 前端 CrawlerManager.tsx：新增「清除全部歷史」按鈕（含確認對話框）

## 新功能：資料匯出 CSV/Excel
- [x] 後端 routers.ts：新增 export.products query（回傳所有產品資料）
- [x] 後端 routers.ts：新增 export.priceHistory query（回傳指定時間範圍的價格歷史）
- [x] 前端：新增「資料匯出」頁面（側邊欄導航）
- [x] 前端：支援匯出為 CSV 格式（產品清單 + 價格歷史）
- [x] 前端：支援匯出為 Excel 格式（使用 xlsx 套件，多工作表）

## 新功能：自訂爬取目標網站
- [x] 資料庫 schema：新增 crawl_targets 表（含 CSS 選擇器設定）
- [x] 執行資料庫 migration
- [x] 後端 db.ts：新增 crawl_targets CRUD 函式
- [x] 後端 routers.ts：新增 targetsRouter（list, create, update, delete, toggleActive）
- [x] 前端：新增「目標網站」管理頁面（CRUD + 啟用/停用）
- [x] 前端 App.tsx：新增路由和側邊欄導航項目

## 新功能：GitHub 授權條款
- [x] 新增 LICENSE 檔案（MIT + Commons Clause，禁止商業銷售）
- [x] commit 已建立，待 GitHub 帳號連接後推送
- [ ] 推送到 GitHub（需連接 GitHub 帳號）

## 新聞監控功能模組
- [x] schema.ts 新增 news_sources 表（新聞來源目標設定）
- [x] schema.ts 新增 news_articles 表（爬取的新聞文章）
- [x] schema.ts 新增 news_crawl_jobs 表（新聞爬蟲任務歷史）
- [x] 執行資料庫 migration
- [x] db.ts 新增 news_sources CRUD 函式
- [x] db.ts 新增 news_articles 查詢函式
- [x] db.ts 新增 news_crawl_jobs 函式
- [x] 新增 newsCrawler.ts 新聞爬蟲邏輯（通用 WordPress/部落格格式）
- [x] routers.ts 新增 newsRouter（sources CRUD + jobs + articles 查詢）
- [x] 前端：建立 NewsSources.tsx（新聞來源管理頁面）
- [x] 前端：建立 NewsCrawler.tsx（新聞爬蟲管理頁面）
- [x] 前端：建立 NewsArticles.tsx（新聞文章列表頁面）
- [x] 更新 DashboardLayout.tsx 側邊欄新增「新聞來源」「新聞爬蟲」「新聞文章」三個項目
- [x] 更新 App.tsx 新增三個新路由（/news/sources, /news/crawler, /news/articles）
- [x] 儲存 checkpoint 並推送

## 修復 Railway 生產環境 migration 問題
- [x] 確認 server startup 時自動執行 news 相關表格的 migration
- [x] 更新 checkpoint 並推送到 Railway 觸發重新部署
