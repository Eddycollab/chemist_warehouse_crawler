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
  const allRequests = [];
  const productJsons = [];

  // 攔截所有請求（記錄 URL）
  page.on("request", (request) => {
    const url = request.url();
    if (
      !url.includes("klaviyo") &&
      !url.includes("onetrust") &&
      !url.includes("google") &&
      !url.includes("facebook") &&
      !url.includes("_next/static") &&
      !url.endsWith(".js") &&
      !url.endsWith(".css") &&
      !url.endsWith(".png") &&
      !url.endsWith(".jpg") &&
      !url.endsWith(".svg") &&
      !url.endsWith(".woff") &&
      !url.endsWith(".woff2")
    ) {
      allRequests.push({ method: request.method(), url });
    }
  });

  // 攔截所有 JSON 回應
  page.on("response", async (response) => {
    const url = response.url();
    const contentType = response.headers()["content-type"] || "";
    const status = response.status();

    if (
      contentType.includes("application/json") &&
      !url.includes("klaviyo") &&
      !url.includes("onetrust") &&
      !url.includes("google") &&
      !url.includes("facebook") &&
      status === 200
    ) {
      try {
        const json = await response.json();
        const jsonStr = JSON.stringify(json);

        // 找含有 price 的 JSON
        if (
          (jsonStr.includes('"price"') || jsonStr.includes('"Price"') || jsonStr.includes('"salePrice"')) &&
          jsonStr.length > 500
        ) {
          productJsons.push({ url, size: jsonStr.length, data: json });
          console.log(`[含價格 JSON] ${url.slice(0, 120)}`);
          console.log(`  大小: ${jsonStr.length} bytes`);
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

  await page.waitForTimeout(5000);

  // 嘗試滾動觸發懶加載
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3000);

  console.log("\n=== 所有非靜態請求 ===");
  for (const req of allRequests) {
    if (!req.url.includes("_next/data") || req.url.includes("/buy/")) {
      console.log(`${req.method} ${req.url.slice(0, 120)}`);
    }
  }

  console.log(`\n=== 找到 ${productJsons.length} 個含價格的 JSON ===`);

  if (productJsons.length > 0) {
    productJsons.sort((a, b) => b.size - a.size);
    for (const pj of productJsons) {
      console.log(`\nURL: ${pj.url}`);
      console.log(`大小: ${pj.size} bytes`);

      // 尋找產品列表
      function findWithPrice(obj, path = "", depth = 0) {
        if (depth > 6) return null;
        if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === "object") {
          const keys = Object.keys(obj[0]);
          if (keys.some((k) => ["price", "Price", "salePrice", "name", "title"].includes(k))) {
            return { path, count: obj.length, keys, sample: obj[0] };
          }
        }
        if (typeof obj === "object" && obj !== null) {
          for (const [k, v] of Object.entries(obj)) {
            const result = findWithPrice(v, `${path}.${k}`, depth + 1);
            if (result) return result;
          }
        }
        return null;
      }

      const found = findWithPrice(pj.data);
      if (found) {
        console.log(`  產品列表 at: ${found.path}`);
        console.log(`  數量: ${found.count}`);
        console.log(`  Keys: ${found.keys.join(", ")}`);
        console.log(`  第一個產品：`);
        console.log(JSON.stringify(found.sample, null, 2).slice(0, 2000));
        writeFileSync("/home/ubuntu/cw_product_data.json", JSON.stringify(pj.data, null, 2));
        console.log(`  已儲存至 /home/ubuntu/cw_product_data.json`);
        break;
      }
    }
  } else {
    // 嘗試從頁面 DOM 直接抓取產品
    console.log("\n嘗試從 DOM 抓取產品...");
    const products = await page.evaluate(() => {
      // 嘗試各種選擇器
      const selectors = [
        '[data-testid*="product"]',
        '.product-tile',
        '[class*="ProductTile"]',
        '[class*="product-card"]',
        'article[class*="product"]',
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          return {
            selector: sel,
            count: els.length,
            firstHtml: els[0].outerHTML.slice(0, 1000),
          };
        }
      }
      return null;
    });

    if (products) {
      console.log(`找到產品元素: ${products.selector} (${products.count} 個)`);
      console.log(`第一個 HTML: ${products.firstHtml}`);
    } else {
      // 截圖看看頁面狀態
      await page.screenshot({ path: "/home/ubuntu/cw_page.png" });
      console.log("截圖已儲存至 /home/ubuntu/cw_page.png");
      console.log(`頁面標題: ${await page.title()}`);
      console.log(`頁面 URL: ${page.url()}`);
    }
  }

  await browser.close();
  console.log("\n完成！");
}

main().catch(console.error);
