import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFileSync } from "fs";

chromium.use(StealthPlugin());

async function main() {
  console.log("=== 攔截 Algolia 完整請求（等待頁面完全載入）===\n");

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

  let algoliaRequestBody = null;
  let algoliaResponseBody = null;
  let algoliaUrl = null;

  // 使用 page.route 攔截 Algolia 請求並取得 request body
  await page.route("**/*algolianet*", async (route) => {
    const req = route.request();
    const body = req.postData();
    const url = req.url();
    
    console.log(`\n[攔截 Algolia 請求]`);
    console.log(`URL: ${url.slice(0, 200)}`);
    console.log(`Method: ${req.method()}`);
    if (body) {
      console.log(`Request Body: ${body.slice(0, 500)}`);
      algoliaRequestBody = body;
      algoliaUrl = url;
    }
    
    // 繼續請求並取得回應
    const response = await route.fetch();
    const responseBody = await response.text();
    console.log(`\n[Algolia 回應] 狀態: ${response.status()}, 大小: ${responseBody.length} bytes`);
    console.log(`預覽: ${responseBody.slice(0, 500)}`);
    algoliaResponseBody = responseBody;
    
    await route.fulfill({ response });
  });

  console.log("訪問 Vitamins 分類頁面...");
  
  try {
    await page.goto("https://www.chemistwarehouse.com.au/shop-online/81/vitamins-supplements", {
      waitUntil: "networkidle",
      timeout: 60000,
    });
  } catch (e) {
    console.log(`goto 超時或錯誤: ${e.message}`);
  }

  console.log("等待額外 5 秒...");
  await page.waitForTimeout(5000);

  const title = await page.title();
  console.log(`\n頁面標題: ${title}`);

  if (algoliaResponseBody) {
    try {
      const data = JSON.parse(algoliaResponseBody);
      const results = data.results || [];
      
      console.log(`\n=== Algolia 結果 (${results.length} 個) ===`);
      for (const result of results) {
        const hits = result.hits || [];
        console.log(`\nIndex: ${result.index || '?'}, nbHits: ${result.nbHits}, 本頁: ${hits.length}`);
        
        if (hits.length > 0) {
          const h = hits[0];
          console.log(`Hit keys: ${Object.keys(h).join(', ')}`);
          
          const attrs = h.attributes || {};
          const attrKeys = Object.keys(attrs);
          
          const priceKeys = attrKeys.filter(k => k.toLowerCase().includes('price'));
          console.log(`\n價格欄位:`);
          for (const pk of priceKeys) {
            console.log(`  ${pk}: ${attrs[pk]}`);
          }
          
          const name = h.name || attrs['cwr-name'] || attrs['name'] || attrs['title'] || '?';
          console.log(`\n名稱: ${name}`);
        }
      }
      
      // 儲存結果
      const output = {
        algoliaUrl,
        requestBody: algoliaRequestBody ? JSON.parse(algoliaRequestBody) : null,
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
    } catch (e) {
      console.log(`解析失敗: ${e.message}`);
      writeFileSync('/home/ubuntu/cw_algolia_raw.txt', algoliaResponseBody.substring(0, 10000));
    }
  } else {
    console.log('\n❌ 未攔截到 Algolia 請求');
    
    // 嘗試從頁面 HTML 找線索
    const html = await page.content();
    console.log(`頁面 HTML 長度: ${html.length}`);
    
    // 找 algolia 相關設定
    const algoliaMatch = html.match(/algolia[^"']*["'][^"']+["']/gi);
    if (algoliaMatch) {
      console.log(`\n找到 Algolia 相關設定:`);
      algoliaMatch.slice(0, 10).forEach(m => console.log(`  ${m}`));
    }
    
    writeFileSync('/home/ubuntu/cw_page_debug2.html', html.substring(0, 50000));
    console.log('已儲存頁面 HTML 至 /home/ubuntu/cw_page_debug2.html');
  }

  await browser.close();
  console.log("\n=== 完成 ===");
}

main().catch(console.error);
