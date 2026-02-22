import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFileSync } from "fs";

chromium.use(StealthPlugin());

async function main() {
  console.log("=== 攔截 Algolia 完整請求（含 request body）===\n");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-AU",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  // 儲存 Algolia 請求和回應
  const algoliaData = [];

  // 攔截所有回應
  page.on("response", async (response) => {
    const url = response.url();
    const status = response.status();

    if (url.includes("algolia") || url.includes("algolianet")) {
      console.log(`\n[Algolia 回應] ${status} ${url.slice(0, 150)}`);
      try {
        const body = await response.json();
        const results = body.results || [];
        
        for (const result of results) {
          const hits = result.hits || [];
          console.log(`  Index: ${result.index || '?'}, nbHits: ${result.nbHits}, 本頁: ${hits.length}`);
          
          if (hits.length > 0) {
            const h = hits[0];
            console.log(`  Hit keys: ${Object.keys(h).join(', ')}`);
            
            // 找名稱
            const name = h.name || h.title || h.productName || 
                         h.attributes?.['cwr-name'] || h.attributes?.name || '?';
            console.log(`  名稱: ${name}`);
            
            // 找價格
            const attrs = h.attributes || {};
            const priceKeys = Object.keys(attrs).filter(k => k.toLowerCase().includes('price'));
            console.log(`  價格欄位: ${priceKeys.map(k => `${k}=${attrs[k]}`).join(', ')}`);
          }
        }
        
        algoliaData.push({ url, status, body });
      } catch (e) {
        console.log(`  解析失敗: ${e.message}`);
      }
    }
  });

  // 攔截請求以取得 request body
  await page.route("**/*algolia*", async (route) => {
    const req = route.request();
    const body = req.postData();
    if (body) {
      console.log(`\n[Algolia 請求 Body] ${req.url().slice(0, 100)}`);
      console.log(body.slice(0, 500));
    }
    await route.continue();
  });

  console.log("訪問 Vitamins 分類頁面...");
  await page.goto("https://www.chemistwarehouse.com.au/shop-online/81/vitamins-supplements", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // 等待更長時間讓 Cloudflare 驗證通過和 JS 執行
  console.log("等待 20 秒讓 Cloudflare 驗證通過和 JS 執行...");
  await page.waitForTimeout(20000);

  // 嘗試滾動頁面觸發懶載入
  console.log("滾動頁面...");
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight / 2);
  });
  await page.waitForTimeout(3000);

  console.log(`\n攔截到 ${algoliaData.length} 個 Algolia 回應`);

  if (algoliaData.length > 0) {
    // 儲存第一個完整回應
    const firstData = algoliaData[0];
    const output = {
      url: firstData.url,
      status: firstData.status,
      results: (firstData.body.results || []).map(result => ({
        index: result.index,
        nbHits: result.nbHits,
        page: result.page,
        hitsPerPage: result.hitsPerPage,
        params: result.params,
        hits: (result.hits || []).slice(0, 5)
      }))
    };
    
    writeFileSync('/home/ubuntu/cw_algolia_full.json', JSON.stringify(output, null, 2));
    console.log('\n已儲存至 /home/ubuntu/cw_algolia_full.json');
    
    // 顯示第一個完整 hit
    const firstResult = output.results[0];
    if (firstResult?.hits?.length > 0) {
      console.log('\n=== 第一個完整產品資料 ===');
      console.log(JSON.stringify(firstResult.hits[0], null, 2).substring(0, 5000));
    }
  } else {
    // 檢查頁面狀態
    const title = await page.title();
    const url = page.url();
    console.log(`\n頁面標題: ${title}`);
    console.log(`當前 URL: ${url}`);
    
    // 嘗試取得頁面 HTML 片段
    const html = await page.content();
    console.log(`\n頁面 HTML 長度: ${html.length}`);
    
    // 找是否有 Cloudflare 驗證
    if (html.includes('cloudflare') || html.includes('challenge')) {
      console.log('⚠️  頁面可能被 Cloudflare 阻擋');
    }
    
    // 找產品相關內容
    const hasProducts = html.includes('product') || html.includes('price');
    console.log(`頁面含產品資訊: ${hasProducts}`);
    
    writeFileSync('/home/ubuntu/cw_page_debug.html', html.substring(0, 50000));
    console.log('已儲存頁面 HTML 至 /home/ubuntu/cw_page_debug.html');
  }

  await browser.close();
  console.log("\n=== 完成 ===");
}

main().catch(console.error);
