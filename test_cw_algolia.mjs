import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

chromium.use(StealthPlugin());

const TARGET_URL = 'https://www.chemistwarehouse.com.au/shop-online/81/vitamins';

async function main() {
  console.log('=== 攔截 Algolia 請求 ===\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  
  const page = await context.newPage();
  
  const algoliaRequests = [];
  const algoliaResponses = [];
  
  // 攔截所有請求
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    
    if (url.includes('algolia')) {
      const body = req.postData();
      console.log(`\n[攔截 Algolia 請求]`);
      console.log(`URL: ${url}`);
      console.log(`Method: ${req.method()}`);
      console.log(`Body: ${body}`);
      algoliaRequests.push({ url, method: req.method(), body });
    }
    
    await route.continue();
  });
  
  // 監聽回應
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('algolia')) {
      try {
        const body = await response.json();
        console.log(`\n[Algolia 回應]`);
        console.log(`URL: ${url}`);
        console.log(`狀態: ${response.status()}`);
        
        const results = body.results || [];
        for (const result of results) {
          const hits = result.hits || [];
          console.log(`Index: ${result.index || 'unknown'}, 總數: ${result.nbHits}, 本頁: ${hits.length}`);
          
          if (hits.length > 0) {
            const h = hits[0];
            console.log(`\n第一個 hit keys: ${Object.keys(h).join(', ')}`);
            const attrs = h.attributes || {};
            const attrKeys = Object.keys(attrs);
            console.log(`attributes keys (${attrKeys.length}): ${attrKeys.slice(0, 30).join(', ')}`);
            
            // 找價格
            const priceKeys = attrKeys.filter(k => k.toLowerCase().includes('price'));
            console.log(`\n價格欄位:`);
            for (const pk of priceKeys) {
              console.log(`  ${pk}: ${attrs[pk]}`);
            }
            
            // 找名稱
            const nameVal = h.name || attrs['cwr-name'] || attrs['name'] || attrs['title'] || '未知';
            console.log(`\n產品名稱: ${nameVal}`);
            
            // 找折扣
            const discountKeys = attrKeys.filter(k => k.toLowerCase().includes('discount') || k.toLowerCase().includes('special'));
            console.log(`\n折扣欄位:`);
            for (const dk of discountKeys) {
              console.log(`  ${dk}: ${attrs[dk]}`);
            }
          }
        }
        
        algoliaResponses.push({ url, status: response.status(), body });
      } catch (e) {
        console.log(`[Algolia 回應解析失敗] ${url}: ${e.message}`);
      }
    }
  });
  
  console.log(`\n正在訪問: ${TARGET_URL}`);
  
  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('\n頁面載入完成，等待 3 秒...');
    await page.waitForTimeout(3000);
    
    // 儲存結果
    const output = {
      requests: algoliaRequests,
      responses: algoliaResponses.map(r => ({
        url: r.url,
        status: r.status,
        // 只儲存前 2 個 hits 避免太大
        body: {
          ...r.body,
          results: (r.body.results || []).map(result => ({
            ...result,
            hits: (result.hits || []).slice(0, 2)
          }))
        }
      }))
    };
    
    fs.writeFileSync('/home/ubuntu/cw_algolia_data.json', JSON.stringify(output, null, 2));
    console.log('\n已儲存至 /home/ubuntu/cw_algolia_data.json');
    
    // 顯示第一個完整 hit
    if (algoliaResponses.length > 0) {
      const firstResult = algoliaResponses[0].body.results?.[0];
      if (firstResult?.hits?.length > 0) {
        console.log('\n=== 第一個完整產品資料 ===');
        console.log(JSON.stringify(firstResult.hits[0], null, 2).substring(0, 3000));
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
