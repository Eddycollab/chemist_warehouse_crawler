import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFileSync } from "fs";

chromium.use(StealthPlugin());

const BUILD_ID = "c_zPYXot-rjmtKVHRm-uF";

async function main() {
  console.log("=== 分析 CW _next/data JSON 產品結構 ===\n");

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

  // 攔截 _next/data JSON
  let capturedJson = null;
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/_next/data/") && url.includes("vitamins") && url.endsWith(".json")) {
      try {
        const body = await response.text();
        if (body.length > 1000) {
          capturedJson = { url, body, size: body.length };
          console.log(`   ✅ 攔截到: ${url} (${body.length} bytes)`);
        }
      } catch {}
    }
  });

  console.log("1. 訪問 Vitamins 分類頁面...");
  await page.goto("https://www.chemistwarehouse.com.au/shop-online/81/vitamins-supplements", {
    waitUntil: "networkidle",
    timeout: 45000,
  });

  console.log(`   標題: ${await page.title()}`);

  // 如果沒有攔截到，嘗試直接用 context.request 取得
  if (!capturedJson) {
    console.log("\n   嘗試用 context.request 取得 JSON...");
    const url = `https://www.chemistwarehouse.com.au/_next/data/${BUILD_ID}/en/shop-online/81/vitamins-supplements.json?slug=81&slug=vitamins-supplements`;
    const res = await context.request.get(url, {
      headers: {
        "Accept": "application/json",
        "Referer": "https://www.chemistwarehouse.com.au/shop-online/81/vitamins-supplements",
      }
    });
    console.log(`   狀態: ${res.status()}`);
    if (res.ok()) {
      const body = await res.text();
      capturedJson = { url, body, size: body.length };
    }
  }

  if (capturedJson) {
    console.log(`\n2. 分析 JSON 結構 (${capturedJson.size} bytes)...`);
    writeFileSync("/home/ubuntu/cw_vitamins_next.json", capturedJson.body);
    console.log("   已儲存至 /home/ubuntu/cw_vitamins_next.json");

    const data = JSON.parse(capturedJson.body);
    const pageProps = data.pageProps || {};
    console.log(`   pageProps keys: ${Object.keys(pageProps).join(", ")}`);

    // 分析 category
    if (pageProps.category) {
      const cat = pageProps.category;
      console.log(`\n   category keys: ${Object.keys(cat).join(", ")}`);
      console.log(`   name: ${cat.name}`);
      console.log(`   slug: ${cat.slug}`);

      // 找產品列表
      function findArrays(obj, path = "", depth = 0) {
        if (depth > 6) return;
        if (Array.isArray(obj)) {
          if (obj.length > 2 && typeof obj[0] === "object") {
            const keys = Object.keys(obj[0]);
            console.log(`\n   Array at ${path}: ${obj.length} items, keys: [${keys.join(", ")}]`);
            if (keys.length > 3) {
              console.log(`   Sample[0]: ${JSON.stringify(obj[0]).slice(0, 500)}`);
            }
          }
          obj.forEach((item, i) => findArrays(item, `${path}[${i}]`, depth + 1));
        } else if (typeof obj === "object" && obj !== null) {
          for (const [k, v] of Object.entries(obj)) {
            findArrays(v, `${path}.${k}`, depth + 1);
          }
        }
      }
      findArrays(cat, "category");
    }

    // 找所有 products/items 相關 key
    function findProductKeys(obj, path = "", depth = 0) {
      if (depth > 8) return;
      if (typeof obj !== "object" || obj === null) return;
      for (const [k, v] of Object.entries(obj)) {
        const lk = k.toLowerCase();
        if (lk.includes("product") || lk.includes("item") || lk.includes("result")) {
          if (Array.isArray(v) && v.length > 0) {
            console.log(`\n   ✅ 找到 ${path}.${k}: Array(${v.length})`);
            if (typeof v[0] === "object") {
              console.log(`      keys: [${Object.keys(v[0]).join(", ")}]`);
              console.log(`      sample: ${JSON.stringify(v[0]).slice(0, 600)}`);
            }
          }
        }
        findProductKeys(v, `${path}.${k}`, depth + 1);
      }
    }
    console.log("\n3. 搜尋 product/item 相關 key:");
    findProductKeys(data, "root");

  } else {
    console.log("\n❌ 未能取得 _next/data JSON");
  }

  // 4. 嘗試找到 API 端點（如 Algolia、GraphQL 等）
  console.log("\n4. 等待更多 API 請求...");
  await page.waitForTimeout(5000);

  await browser.close();
  console.log("\n=== 完成 ===");
}

main().catch(console.error);
