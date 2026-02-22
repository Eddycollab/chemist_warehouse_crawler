import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFileSync } from "fs";

chromium.use(StealthPlugin());

async function main() {
  console.log("=== 攔截所有 CW API 請求，找出產品列表來源 ===\n");

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

  // 攔截所有回應
  const allResponses = [];
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
          allResponses.push({
            url: url.slice(0, 200),
            status,
            size: body.length,
            preview: body.slice(0, 400),
            isProduct: body.includes('"price"') || body.includes('"Price"') || body.includes('"salePrice"') ||
                       body.includes('"productName"') || body.includes('"ProductName"') || body.includes('"hits"'),
          });
        }
      } catch {}
    }
  });

  console.log("訪問 Vitamins 分類頁面並等待完全載入...");
  await page.goto("https://www.chemistwarehouse.com.au/shop-online/81/vitamins-supplements", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // 等待更長時間讓所有 API 請求完成
  console.log("等待 15 秒讓所有 API 請求完成...");
  await page.waitForTimeout(15000);

  console.log(`\n攔截到 ${allResponses.length} 個 API 請求:\n`);

  // 先顯示含產品資料的請求
  const productResponses = allResponses.filter(r => r.isProduct);
  console.log(`=== 含產品資料的請求 (${productResponses.length} 個) ===`);
  productResponses.forEach(r => {
    console.log(`\nURL: ${r.url}`);
    console.log(`狀態: ${r.status}, 大小: ${r.size} bytes`);
    console.log(`預覽: ${r.preview.slice(0, 500)}`);
    console.log("---");
  });

  // 再顯示其他 JSON 請求
  const otherResponses = allResponses.filter(r => !r.isProduct);
  console.log(`\n=== 其他 JSON 請求 (${otherResponses.length} 個) ===`);
  otherResponses.forEach(r => {
    console.log(`URL: ${r.url} [${r.status}] ${r.size}b`);
  });

  // 儲存所有回應摘要
  writeFileSync("/home/ubuntu/cw_all_api.json", JSON.stringify(allResponses, null, 2));
  console.log(`\n已儲存至 /home/ubuntu/cw_all_api.json`);

  // 如果找到含產品的 API，嘗試儲存完整回應
  if (productResponses.length > 0) {
    console.log("\n嘗試取得最大的產品 API 完整回應...");
    const largest = productResponses.sort((a, b) => b.size - a.size)[0];
    console.log(`最大: ${largest.url} (${largest.size} bytes)`);
  }

  await browser.close();
  console.log("\n=== 完成 ===");
}

main().catch(console.error);
