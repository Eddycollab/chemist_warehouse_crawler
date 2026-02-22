import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFileSync } from "fs";

chromium.use(StealthPlugin());

async function main() {
  console.log("=== 使用 CDP 攔截 Algolia 請求 body ===\n");

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
  
  // 使用 CDP 啟用網路監控
  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  
  const requestBodies = {};
  const algoliaData = [];
  
  // 監聽請求
  client.on('Network.requestWillBeSent', (event) => {
    const url = event.request.url;
    if (url.includes('algolia')) {
      const requestId = event.requestId;
      const body = event.request.postData;
      console.log(`\n[CDP Algolia 請求] ${event.request.method} ${url.slice(0, 150)}`);
      if (body) {
        console.log(`Request Body: ${body.slice(0, 500)}`);
        requestBodies[requestId] = { url, body };
      }
    }
  });
  
  // 監聽回應
  client.on('Network.responseReceived', async (event) => {
    const url = event.response.url;
    if (url.includes('algolia')) {
      const requestId = event.requestId;
      console.log(`\n[CDP Algolia 回應] ${event.response.status} ${url.slice(0, 150)}`);
      
      try {
        // 取得回應 body
        const responseBody = await client.send('Network.getResponseBody', { requestId });
        const bodyText = responseBody.body;
        console.log(`大小: ${bodyText.length} bytes`);
        console.log(`預覽: ${bodyText.slice(0, 300)}`);
        
        const data = JSON.parse(bodyText);
        algoliaData.push({
          url,
          requestBody: requestBodies[requestId]?.body,
          responseBody: data
        });
      } catch (e) {
        console.log(`取得回應 body 失敗: ${e.message}`);
      }
    }
  });

  console.log("訪問 Vitamins 分類頁面...");
  
  try {
    await page.goto("https://www.chemistwarehouse.com.au/shop-online/81/vitamins-supplements", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  } catch (e) {
    console.log(`goto 錯誤: ${e.message}`);
  }

  console.log("等待 15 秒...");
  await page.waitForTimeout(15000);

  const title = await page.title();
  console.log(`\n頁面標題: ${title}`);
  console.log(`攔截到 ${algoliaData.length} 個 Algolia 回應`);

  if (algoliaData.length > 0) {
    const firstData = algoliaData[0];
    
    // 解析 request body
    if (firstData.requestBody) {
      try {
        const reqBody = JSON.parse(firstData.requestBody);
        console.log('\n=== Request Body ===');
        console.log(JSON.stringify(reqBody, null, 2).substring(0, 1000));
        
        const requests = reqBody.requests || [];
        for (const req of requests) {
          console.log(`\nIndex: ${req.indexName}`);
          console.log(`Params: ${req.params}`);
        }
      } catch (e) {
        console.log(`解析 request body 失敗: ${e.message}`);
        console.log(firstData.requestBody.substring(0, 500));
      }
    }
    
    // 分析 response
    const results = firstData.responseBody.results || [];
    for (const result of results) {
      const hits = result.hits || [];
      console.log(`\nIndex: ${result.index || '?'}, nbHits: ${result.nbHits}, 本頁: ${hits.length}`);
      
      if (hits.length > 0) {
        const h = hits[0];
        const attrs = h.attributes || {};
        const priceKeys = Object.keys(attrs).filter(k => k.toLowerCase().includes('price'));
        console.log(`價格欄位: ${priceKeys.map(k => `${k}=${attrs[k]}`).join(', ')}`);
        const name = h.name || attrs['cwr-name'] || '?';
        console.log(`名稱: ${name}`);
      }
    }
    
    // 儲存
    const output = {
      url: firstData.url,
      requestBody: firstData.requestBody ? JSON.parse(firstData.requestBody) : null,
      results: results.map(result => ({
        index: result.index,
        nbHits: result.nbHits,
        params: result.params,
        hits: (result.hits || []).slice(0, 5)
      }))
    };
    
    writeFileSync('/home/ubuntu/cw_algolia_cdp.json', JSON.stringify(output, null, 2));
    console.log('\n已儲存至 /home/ubuntu/cw_algolia_cdp.json');
    
    if (results[0]?.hits?.length > 0) {
      console.log('\n=== 第一個完整產品資料 ===');
      console.log(JSON.stringify(results[0].hits[0], null, 2).substring(0, 5000));
    }
  }

  await browser.close();
  console.log("\n=== 完成 ===");
}

main().catch(console.error);
