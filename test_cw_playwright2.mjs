import { chromium } from "playwright";
import { writeFileSync } from "fs";

const TARGET_URL = "https://www.chemistwarehouse.com.au/buy/86/vitamins";

async function main() {
  console.log("啟動 Playwright Chromium...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-AU",
  });

  const page = await context.newPage();
  const allJsonResponses = [];

  // 攔截所有 JSON 回應
  page.on("response", async (response) => {
    const url = response.url();
    const contentType = response.headers()["content-type"] || "";

    if (contentType.includes("application/json")) {
      try {
        const json = await response.json();
        const jsonStr = JSON.stringify(json);
        // 只記錄可能包含產品的 API（含 product/item/result 關鍵字）
        if (
          jsonStr.includes('"name"') &&
          (jsonStr.includes('"price"') || jsonStr.includes('"Price"')) &&
          jsonStr.length > 1000
        ) {
          allJsonResponses.push({ url, size: jsonStr.length, data: json });
          console.log(`[產品相關 JSON] ${url.slice(0, 120)}`);
          console.log(`  大小: ${jsonStr.length} bytes`);
        } else if (url.includes("chemistwarehouse") && !url.includes("klaviyo") && !url.includes("onetrust")) {
          console.log(`[CW JSON] ${url.slice(0, 120)} (${jsonStr.length} bytes)`);
        }
      } catch (e) {
        // ignore
      }
    }
  });

  console.log(`\n正在載入: ${TARGET_URL}`);
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 45000 });
  } catch (e) {
    console.log(`載入超時: ${e.message}`);
  }

  // 等待更多動態請求
  await page.waitForTimeout(5000);

  // 嘗試滾動頁面觸發懶加載
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(3000);

  console.log(`\n\n=== 找到 ${allJsonResponses.length} 個含產品資料的 JSON ===`);

  if (allJsonResponses.length > 0) {
    // 找最大的（通常是產品列表）
    allJsonResponses.sort((a, b) => b.size - a.size);
    const best = allJsonResponses[0];
    console.log(`\n最大的產品 JSON: ${best.url}`);
    console.log(`大小: ${best.size} bytes`);

    // 遞迴尋找產品列表
    function findProductList(obj, path = "", depth = 0) {
      if (depth > 6) return [];
      if (Array.isArray(obj) && obj.length > 2) {
        if (typeof obj[0] === "object" && obj[0] !== null) {
          const keys = Object.keys(obj[0]);
          if (keys.some((k) => ["name", "title", "sku", "productId", "product_id"].includes(k))) {
            return [{ path, count: obj.length, keys, sample: obj[0] }];
          }
        }
      }
      const results = [];
      if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) {
          results.push(...findProductList(v, `${path}.${k}`, depth + 1));
        }
      } else if (Array.isArray(obj)) {
        for (let i = 0; i < Math.min(obj.length, 3); i++) {
          results.push(...findProductList(obj[i], `${path}[${i}]`, depth + 1));
        }
      }
      return results;
    }

    const productLists = findProductList(best.data);
    if (productLists.length > 0) {
      console.log(`\n找到 ${productLists.length} 個產品列表：`);
      for (const pl of productLists) {
        console.log(`\n  路徑: ${pl.path}`);
        console.log(`  數量: ${pl.count}`);
        console.log(`  Keys: ${pl.keys.join(", ")}`);
        console.log(`  第一個產品：`);
        console.log(JSON.stringify(pl.sample, null, 2).slice(0, 1500));
      }
    }

    writeFileSync("/home/ubuntu/cw_products_api.json", JSON.stringify(best.data, null, 2));
    console.log(`\n完整資料已儲存至 /home/ubuntu/cw_products_api.json`);
  } else {
    console.log("未找到產品 JSON，嘗試從頁面 DOM 分析...");
    // 嘗試從 window 物件找產品資料
    const windowData = await page.evaluate(() => {
      const keys = Object.keys(window).filter(k =>
        k.includes("product") || k.includes("Product") || k.includes("catalog") || k.includes("data")
      );
      return keys.slice(0, 20);
    });
    console.log("window 物件中的相關 keys:", windowData);

    // 嘗試找頁面上的產品元素
    const productCount = await page.locator('[data-testid*="product"], .product-tile, .product-card, [class*="ProductTile"]').count();
    console.log(`頁面上的產品元素數量: ${productCount}`);

    if (productCount > 0) {
      const firstProduct = await page.locator('[data-testid*="product"], .product-tile, .product-card, [class*="ProductTile"]').first();
      const html = await firstProduct.innerHTML();
      console.log(`第一個產品 HTML: ${html.slice(0, 500)}`);
    }
  }

  await browser.close();
  console.log("\n完成！");
}

main().catch(console.error);
