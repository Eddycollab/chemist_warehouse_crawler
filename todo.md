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

## 修復新聞爬蟲重複啟動和卡住問題
- [x] 後端：加入全域 isNewsCrawlRunning 旗標，防止同一來源重複啟動
- [x] 後端：修復 newsCrawler.ts 確保 finally 區塊一定釋放鎖，防止永遠卡住
- [x] 後端：加入 resetStuckNewsCrawlJobs 函式 + news.resetStuck mutation
- [x] 前端： NewsCrawler.tsx 啟動按鈕加入 disabled 狀態防止重複點擊
- [x] 前端：加入「重置卡住任務」按鈕（有執行中任務時顯示）
- [x] 儲存 checkpoint 並推送

## 自動偵測選擇器功能（目標網站 + 新聞來源）
- [x] 後端：新增 crawlTarget.detectSelectors procedure，抓取目標 URL 的 HTML 並用規則式分析建議選擇器（不依賴 LLM API）
- [x] 後端：安裝 cheerio 套件做 HTML 解析
- [x] 後端：修復 merge conflict markers（移除 LLM 版本，保留規則式版本）
- [x] 前端：在「目標網站」表單加入「自動偵測」按鈕，點擊後自動填入建議選擇器，並顯示信心度和分析說明
- [ ] 前端：在「新聞來源」表單加入「自動偵測」按鈕
- [x] 儲存 checkpoint 並推送

## Bug 修復：新增目標網站表單驗證錯誤
- [x] 後端 routers.ts：targets.create 和 targets.update 的 zod schema 中，CSS 選擇器欄位改為 z.string().default("")(允許空字串)
- [x] 確認前端表單提交不再出現 "Too small: expected string to have >=1 characters" 錯誤

## 新功能：目標網站測試爬取
- [x] 後端 routers.ts：新增 targets.testCrawl procedure，用 cheerio 抓取目標 URL 第一頁，套用 CSS 選擇器，回傳前 10 筆產品預覽（名稱、價格、連結、圖片）
- [x] 前端 CrawlTargets.tsx：每個目標網站卡片加入「測試爆取」按鈕（PlayCircle 圖示）
- [x] 前端 CrawlTargets.tsx：測試結果顯示 Dialog（產品數量、產品列表預覽、錯誤訊息）

## Bug 修復：爬蟲管理頁面排程狀態顯示錯誤- [x] 前端 CrawlerManager.tsx：修正「排程狀態」 badge，區分「排程已啟動（閒置）」和「爬蟲執行中」
- [x] 前端 CrawlerManager.tsx：爬蟲執行中時顯示黄色 badge，閒置時顯示灰色 secondary badge

## Bug 修復：爬蟲資料品質問題
- [x] 後端爬蟲：去除重複產品（以產品 URL 為 key 去重，避免同一產品被抓取兩次）
- [x] 後端爬蟲：清理價格格式，優先取 <ins> 標籤（WooCommerce 特價），去除 <del>（原價），過濾 NT$ 換算文字
- [x] 後端 testCrawl：同步修正預覽資料的去重和價格清理邏輯

## 新功能：爬蟲管理支援自訂目標網站觸發
- [x] 後端 crawler.ts：新增 crawlCustomTarget(targetId) 函式，用 cheerio 抓取多頁產品並存入資料庫（去重、價格清理）
- [x] 後端 routers.ts：新增 crawl.runCustomTarget mutation（觸發自訂目標爬蟲）
- [x] 前端 CrawlerManager.tsx：加入「自訂目標網站」爬取區塊，列出所有啟用的目標，可選擇單一目標觸發爬取
- [x] 前端 CrawlerManager.tsx：顯示自訂目標爬取的任務狀態和結果（爬取數量）

## 修正：系統名稱與錯字
- [x] 系統名稱全站改為「電商爬蟲資訊站」（DashboardLayout、Home.tsx、PasswordGate.tsx）
- [x] 修正「美妚護膚」錯字為「美妚護膚」（Products.tsx、CrawlerManager.tsx）

## 重大改造：Chemist Warehouse 爬蟲改為 Playwright + JSON 攔截
- [ ] 安裝 playwright 套件（Node.js 版）並安裝 Chromium 瀏覽器
- [ ] 分析 _next/data JSON 的產品資料結構（name、price、url、image 的 key 路徑）
- [ ] 改寫 crawler.ts：用 Playwright 載入頁面，攔截 _next/data JSON 回應，解析產品資料
- [ ] 確保多頁爬取（pagination）正常運作
- [ ] 測試爬蟲並確認產品資料正確存入資料庫

## 重大改造：Chemist Warehouse 爬蟲改為 Algolia API（2026-02-22）
- [x] 分析 CW 網站的產品資料來源（使用 Playwright CDP 攔截發現 Algolia API）
- [x] 確認 Algolia 設定：App ID=42NP1V2I98, API Key=3ce54af79eae81a18144a7aa7ee10ec2, Index=prod_cwr-cw-au_products_en
- [x] 改寫 crawler.ts：完全移除 Playwright 依賴，改用 Algolia REST API 直接抓取
- [x] 實作 fetchAlgoliaProducts()：支援分頁（hitsPerPage=100），自動遍歷所有頁面
- [x] 實作 parseAlgoliaHit()：解析產品名稱、價格（分→元）、原價（RRP）、折扣、圖片、品牌、URL
- [x] 更新 CATEGORY_ALGOLIA_FILTERS：將內部分類對應到 Algolia categoryKeys.en 過濾器
- [x] TypeScript 零錯誤，10 個 vitest 測試全數通過

## 重大改造：Chemist Warehouse 爬蟲改為 Algolia API（2026-02-22）
- [x] 分析 CW 網站的產品資料來源（使用 Playwright CDP 攔截發現 Algolia API）
- [x] 確認 Algolia 設定：App ID=42NP1V2I98, API Key=3ce54af79eae81a18144a7aa7ee10ec2, Index=prod_cwr-cw-au_products_en
- [x] 改寫 crawler.ts：完全移除 Playwright 依賴，改用 Algolia REST API 直接抓取
- [x] 實作 fetchAlgoliaProducts()：支援分頁（hitsPerPage=100），自動遍歷所有頁面
- [x] 實作 parseAlgoliaHit()：解析產品名稱、價格（分→元）、原價（RRP）、折扣、圖片、品牌、URL
- [x] 更新 CATEGORY_ALGOLIA_FILTERS：將內部分類對應到 Algolia categoryKeys.en 過濾器
- [x] TypeScript 零錯誤，10 個 vitest 測試全數通過

## 品牌過濾器功能（2026-02-23）
- [x] 後端：crawler.ts 加入 brandFilter 參數，在 Algolia API 查詢時加上品牌過濾條件
- [x] 後端：routers.ts crawl.trigger 加入 brandFilter 參數
- [x] 後端：新增 crawl.getBrands API，從 Algolia 取得品牌列表（或從 DB 取得已爬取的品牌）
- [x] 前端：CrawlerManager.tsx 加入品牌過濾器 UI（搜尋輸入框 + 常用品牌快速選擇）
- [x] 前端：品牌過濾器與分類選擇器整合，觸發爬蟲時帶入品牌參數
