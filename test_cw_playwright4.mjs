import { chromium } from "playwright";
import { writeFileSync } from "fs";

// 嘗試不同的 CW 分類 URL
const TEST_URLS = [
  "https://www.chemistwarehouse.com.au/shop-online/vitamins-supplements",
  "https://www.chemistwarehouse.com.au/shop-online/vitamins-supplements/vitamins",
  "https://www.chemistwarehouse.com.au/buy/86/vitamins",
  "https://www.chemistwarehouse.com.au/",
];

async function testUrl(browser, url) {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-AU",
  });
  const page = await context.newPage();
  const contentfulApis = [];
  const productJsons = [];

  page.on("response", async (response) => {
    const respUrl = response.url();
    const contentType = response.headers()["content-type"] || "";
    if (respUrl.includes("contentful.com") && contentType.includes("application/json")) {
      try {
        const json = await response.json();
        const jsonStr = JSON.stringify(json);
        contentfulApis.push({ url: respUrl.slice(0, 200), size: jsonStr.length, data: json });
      } catch (e) {}
    }
    // 也攔截 CW 自己的 API
    if (respUrl.includes("chemistwarehouse.com.au") && !respUrl.includes("_next/data") && !respUrl.includes("_next/static") && contentType.includes("application/json")) {
      try {
        const json = await response.json();
        const jsonStr = JSON.stringify(json);
        if (jsonStr.length > 200) {
          productJsons.push({ url: respUrl.slice(0, 200), size: jsonStr.length, data: json });
        }
      } catch (e) {}
    }
  });

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  } catch (e) {}
  await page.waitForTimeout(3000);

  const title = await page.title();
  const pageUrl = page.url();
  const screenshot = `/home/ubuntu/cw_test_${Date.now()}.png`;
  await page.screenshot({ path: screenshot });

  await context.close();
  return { url, title, pageUrl, contentfulApis, productJsons, screenshot };
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // 先測試首頁，找出正確的分類 URL
  console.log("測試 CW 首頁...");
  const result = await testUrl(browser, "https://www.chemistwarehouse.com.au/");
  console.log(`標題: ${result.title}`);
  console.log(`URL: ${result.pageUrl}`);
  console.log(`Contentful APIs: ${result.contentfulApis.length}`);
  console.log(`CW APIs: ${result.productJsons.length}`);

  if (result.contentfulApis.length > 0) {
    console.log("\nContentful API 回應：");
    for (const api of result.contentfulApis.slice(0, 3)) {
      console.log(`  URL: ${api.url}`);
      console.log(`  大小: ${api.size} bytes`);
      const items = api.data.items || [];
      if (items.length > 0) {
        console.log(`  items 數量: ${items.length}`);
        console.log(`  第一個 item keys: ${Object.keys(items[0]).join(", ")}`);
        if (items[0].fields) {
          console.log(`  fields keys: ${Object.keys(items[0].fields).join(", ")}`);
        }
      }
    }
  }

  if (result.productJsons.length > 0) {
    console.log("\nCW 自己的 API 回應：");
    for (const api of result.productJsons) {
      console.log(`  URL: ${api.url}`);
      console.log(`  大小: ${api.size} bytes`);
      console.log(`  頂層 keys: ${Object.keys(api.data).join(", ")}`);
    }
  }

  // 嘗試找出產品分類頁面
  console.log("\n\n尋找產品分類頁面...");
  const categoryResult = await testUrl(browser, "https://www.chemistwarehouse.com.au/shop-online/vitamins-supplements");
  console.log(`分類頁標題: ${categoryResult.title}`);
  console.log(`分類頁 URL: ${categoryResult.pageUrl}`);
  console.log(`Contentful APIs: ${categoryResult.contentfulApis.length}`);
  console.log(`CW APIs: ${categoryResult.productJsons.length}`);

  if (categoryResult.contentfulApis.length > 0) {
    console.log("\nContentful API 回應（分類頁）：");
    for (const api of categoryResult.contentfulApis) {
      console.log(`  URL: ${api.url}`);
      const items = api.data.items || [];
      if (items.length > 0 && items[0].fields) {
        const fields = items[0].fields;
        // 找含有 price 的 fields
        const priceKey = Object.keys(fields).find(k => k.toLowerCase().includes("price"));
        if (priceKey || fields.name || fields.title) {
          console.log(`  *** 可能是產品 API ***`);
          console.log(`  items: ${items.length}`);
          console.log(`  fields keys: ${Object.keys(fields).join(", ")}`);
          console.log(`  第一個 item fields: ${JSON.stringify(fields).slice(0, 500)}`);
          writeFileSync("/home/ubuntu/cw_contentful_products.json", JSON.stringify(api.data, null, 2));
          console.log(`  已儲存至 /home/ubuntu/cw_contentful_products.json`);
        }
      }
    }
  }

  await browser.close();
  console.log("\n完成！");
}

main().catch(console.error);
