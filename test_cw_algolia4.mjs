import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFileSync } from "fs";

chromium.use(StealthPlugin());

async function main() {
  console.log("=== 攔截所有 CW API 請求（儲存完整 Algolia 回應）===\n");

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

  // 儲存所有回應
  const allResponses = [];
  let algoliaFullBody = null;
  let algoliaRequestBody = null;

  // 攔截請求以取得 request body
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("algolia")) {
      const body = req.postData();
      console.log(`\n[Algolia 請求] ${req.method()} ${url.slice(0, 150)}`);
      if (body) {
        console.log(`Request Body: ${body.slice(0, 500)}`);
        algoliaRequestBody = body;
      }
    }
  });

  page.on("response", async (response) => {
    const url = response.url();
    const status = response.status();
    const ct = response.headers()["content-type"] || "";

    // 跳過靜態資源
    if (url.match(/\.(js|css|png|jpg|gif|svg|woff|ico)(\?|$)/)) return;
    if (url.includes("google-analytics") || url.includes("gtm") || url.includes("facebook")) return;

    if (ct.includes("json") || url.includes("/api/") || url.includes("algolia") || url.includes("search")) {
      try {
        const body = await response.text();
        if (body.length > 50) {
          const isProduct = body.includes('"price"') || body.includes('"Price"') || body.includes('"salePrice"') ||
                     body.includes('"productName"') || body.includes('"ProductName"') || body.includes('"hits"');
          
          allResponses.push({
            url: url.slice(0, 200),
            status,
            size: body.length,
            preview: body.slice(0, 400),
            isProduct,
          });
          
          if (url.includes("algolia")) {
            console.log(`\n[Algolia 回應] ${status} ${url.slice(0, 150)}`);
            console.log(`大小: ${body.length} bytes`);
            console.log(`預覽: ${body.slice(0, 300)}`);
            
            // 儲存完整 Algolia 回應
            try {
              algoliaFullBody = JSON.parse(body);
            } catch (e) {
              console.log(`解析失敗: ${e.message}`);
            }
          }
        }
      } catch {}
    }
  });

  console.log("訪問 Vitamins 分類頁面並等待完全載入...");
  await page.goto("https://www.chemistwarehouse.com.au/shop-online/81/vitamins-supplements", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // 等待更長時間讓所有 API 請求完成
  console.log("等待 15 秒讓所有 API 請求完成...");
  await page.waitForTimeout(15000);

  console.log(`\n攔截到 ${allResponses.length} 個 API 請求`);

  // 先顯示含產品資料的請求
  const productResponses = allResponses.filter(r => r.isProduct);
  console.log(`\n=== 含產品資料的請求 (${productResponses.length} 個) ===`);
  productResponses.forEach(r => {
    console.log(`\nURL: ${r.url}`);
    console.log(`狀態: ${r.status}, 大小: ${r.size} bytes`);
    console.log(`預覽: ${r.preview.slice(0, 300)}`);
    console.log("---");
  });

  // 儲存 Algolia 完整回應
  if (algoliaFullBody) {
    const results = algoliaFullBody.results || [];
    console.log(`\n=== Algolia 結果 (${results.length} 個) ===`);
    
    for (const result of results) {
      const hits = result.hits || [];
      console.log(`\nIndex: ${result.index || '?'}, nbHits: ${result.nbHits}, 本頁: ${hits.length}`);
      
      if (hits.length > 0) {
        const h = hits[0];
        console.log(`Hit keys: ${Object.keys(h).join(', ')}`);
        
        const attrs = h.attributes || {};
        const attrKeys = Object.keys(attrs);
        console.log(`Attributes (${attrKeys.length}): ${attrKeys.slice(0, 30).join(', ')}`);
        
        const priceKeys = attrKeys.filter(k => k.toLowerCase().includes('price'));
        console.log(`\n價格欄位:`);
        for (const pk of priceKeys) {
          console.log(`  ${pk}: ${attrs[pk]}`);
        }
        
        const name = h.name || attrs['cwr-name'] || attrs['name'] || attrs['title'] || '?';
        console.log(`\n名稱: ${name}`);
        
        const discountKeys = attrKeys.filter(k => k.toLowerCase().includes('discount') || k.toLowerCase().includes('special'));
        console.log(`\n折扣欄位:`);
        for (const dk of discountKeys) {
          console.log(`  ${dk}: ${attrs[dk]}`);
        }
      }
    }
    
    // 儲存前 5 個產品
    const output = {
      requestBody: algoliaRequestBody,
      results: results.map(result => ({
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
    if (results[0]?.hits?.length > 0) {
      console.log('\n=== 第一個完整產品資料 ===');
      console.log(JSON.stringify(results[0].hits[0], null, 2).substring(0, 5000));
    }
  } else {
    console.log('\n❌ 未找到 Algolia 回應');
    
    // 檢查頁面狀態
    const title = await page.title();
    console.log(`頁面標題: ${title}`);
    
    // 儲存所有 API 請求
    writeFileSync('/home/ubuntu/cw_all_api2.json', JSON.stringify(allResponses, null, 2));
    console.log('已儲存所有 API 請求至 /home/ubuntu/cw_all_api2.json');
  }

  await browser.close();
  console.log("\n=== 完成 ===");
}

main().catch(console.error);
