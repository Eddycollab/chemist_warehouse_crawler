import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

chromium.use(StealthPlugin());

const TARGET_URL = 'https://www.chemistwarehouse.com.au/shop-online/81/vitamins';

async function main() {
  console.log('=== 攔截 Algolia 請求 v2 ===\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  
  const page = await context.newPage();
  
  const allRequests = [];
  const algoliaResponses = [];
  
  // 監聽所有請求
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('algolia') || url.includes('search') || url.includes('api')) {
      allRequests.push({
        url,
        method: request.method(),
        body: request.postData(),
      });
      if (url.includes('algolia')) {
        console.log(`\n[Algolia 請求] ${request.method()} ${url.substring(0, 120)}`);
        const body = request.postData();
        if (body) console.log(`Body: ${body.substring(0, 300)}`);
      }
    }
  });
  
  // 監聽所有回應
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('algolia')) {
      console.log(`\n[Algolia 回應] ${response.status()} ${url.substring(0, 120)}`);
      try {
        const body = await response.json();
        const results = body.results || [];
        for (const result of results) {
          const hits = result.hits || [];
          const indexName = result.index || 'unknown';
          console.log(`  Index: ${indexName}, nbHits: ${result.nbHits}, 本頁: ${hits.length}`);
          
          if (hits.length > 0) {
            const h = hits[0];
            console.log(`  Hit keys: ${Object.keys(h).join(', ')}`);
            const attrs = h.attributes || {};
            const attrKeys = Object.keys(attrs);
            const priceKeys = attrKeys.filter(k => k.toLowerCase().includes('price'));
            console.log(`  價格欄位: ${priceKeys.map(k => `${k}=${attrs[k]}`).join(', ')}`);
            const name = h.name || attrs['cwr-name'] || attrs['name'] || '未知';
            console.log(`  名稱: ${name}`);
          }
        }
        algoliaResponses.push({ url, status: response.status(), body });
      } catch (e) {
        console.log(`  解析失敗: ${e.message}`);
        try {
          const text = await response.text();
          console.log(`  文字回應: ${text.substring(0, 200)}`);
        } catch {}
      }
    }
  });
  
  console.log(`正在訪問: ${TARGET_URL}`);
  
  try {
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('DOM 載入完成，等待 8 秒讓 JS 執行...');
    await page.waitForTimeout(8000);
    
    console.log(`\n總共攔截到 ${allRequests.length} 個 API 請求`);
    console.log(`Algolia 回應: ${algoliaResponses.length} 個`);
    
    // 儲存結果
    if (algoliaResponses.length > 0) {
      const output = {
        requests: allRequests.filter(r => r.url.includes('algolia')),
        responses: algoliaResponses.map(r => ({
          url: r.url,
          status: r.status,
          body: {
            ...r.body,
            results: (r.body.results || []).map(result => ({
              index: result.index,
              nbHits: result.nbHits,
              page: result.page,
              hitsPerPage: result.hitsPerPage,
              params: result.params,
              hits: (result.hits || []).slice(0, 3)
            }))
          }
        }))
      };
      
      fs.writeFileSync('/home/ubuntu/cw_algolia_data2.json', JSON.stringify(output, null, 2));
      console.log('\n已儲存至 /home/ubuntu/cw_algolia_data2.json');
      
      // 顯示第一個完整 hit
      const firstResult = algoliaResponses[0].body.results?.[0];
      if (firstResult?.hits?.length > 0) {
        console.log('\n=== 第一個完整產品資料 ===');
        console.log(JSON.stringify(firstResult.hits[0], null, 2).substring(0, 4000));
      }
    } else {
      // 顯示所有 API 請求
      console.log('\n=== 所有 API 請求 ===');
      for (const r of allRequests.slice(0, 20)) {
        console.log(`${r.method} ${r.url.substring(0, 100)}`);
      }
    }
    
  } catch (e) {
    console.error(`錯誤: ${e.message}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(console.error);
