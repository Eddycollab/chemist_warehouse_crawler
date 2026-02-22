import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFileSync } from "fs";

chromium.use(StealthPlugin());

async function main() {
  console.log("=== 分析 CW 產品分類和 _next/data JSON ===\n");

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
  const BUILD_ID = "c_zPYXot-rjmtKVHRm-uF";

  // 1. 取得 en.json（含完整導航結構）
  console.log("1. 取得 en.json（導航結構）...");
  const enJsonUrl = `https://www.chemistwarehouse.com.au/_next/data/${BUILD_ID}/en.json`;

  const enData = await page.evaluate(async (url) => {
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    const text = await res.text();
    return { status: res.status, body: text, size: text.length };
  }, enJsonUrl);

  console.log(`   狀態: ${enData.status}, 大小: ${enData.size} bytes`);

  if (enData.status === 200) {
    const data = JSON.parse(enData.body);
    writeFileSync("/home/ubuntu/cw_en.json", JSON.stringify(data, null, 2));
    console.log(`   已儲存至 /home/ubuntu/cw_en.json`);

    // 找出所有產品分類
    const categories = [];
    function findCategories(obj, path = "") {
      if (typeof obj !== "object" || obj === null) return;
      // 找含有 slug 和 children 的物件（分類結構）
      if (obj.slug && obj.name && (obj.children || obj.id)) {
        categories.push({
          id: obj.id,
          name: obj.name,
          slug: obj.slug,
          path: path,
          childCount: obj.children?.length || 0,
        });
      }
      for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) {
          v.forEach((item, i) => findCategories(item, `${path}.${k}[${i}]`));
        } else if (typeof v === "object") {
          findCategories(v, `${path}.${k}`);
        }
      }
    }
    findCategories(data);

    // 找 shop-online 相關分類
    const shopCategories = categories.filter(c =>
      c.slug && (c.slug.includes("vitamin") || c.slug.includes("health") || c.slug.includes("beauty") || c.slug.includes("supplement"))
    );

    console.log(`\n   找到 ${categories.length} 個分類`);
    console.log(`   相關分類（前 20）:`);
    shopCategories.slice(0, 20).forEach(c =>
      console.log(`     id:${c.id} name:${c.name} slug:${c.slug} children:${c.childCount}`)
    );

    // 找 navigation 結構
    const navKeys = Object.keys(data.pageProps || {});
    console.log(`\n   pageProps keys: ${navKeys.join(", ")}`);

    if (data.pageProps?.navigation) {
      const nav = data.pageProps.navigation;
      console.log(`   navigation keys: ${Object.keys(nav).join(", ")}`);
    }
  }

  // 2. 測試新的 URL 格式：/shop-online/{id}/{slug}
  console.log("\n2. 測試新的分類頁面 URL 格式...");

  // 先訪問首頁取得真實的分類 URL
  await page.goto("https://www.chemistwarehouse.com.au/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const navUrls = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a[href*='/shop-online/'], a[href*='/buy/']"));
    return [...new Set(links.map(a => a.href))].slice(0, 20);
  });

  console.log(`   導航中的分類 URL（前 20）:`);
  navUrls.forEach(u => console.log(`     ${u}`));

  // 3. 測試第一個有效的分類 URL 的 _next/data
  if (navUrls.length > 0) {
    const testUrl = navUrls.find(u => u.includes("/shop-online/")) || navUrls[0];
    console.log(`\n3. 測試分類頁面: ${testUrl}`);

    await page.goto(testUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(5000);

    const catTitle = await page.title();
    console.log(`   標題: ${catTitle}`);
    console.log(`   URL: ${page.url()}`);

    // 找產品元素
    const products = await page.evaluate(() => {
      const selectors = [
        '[data-testid*="product"]',
        '[class*="ProductCard"]',
        '[class*="product-card"]',
        '[class*="ProductTile"]',
        '[class*="product-tile"]',
        '[class*="Product"]',
        'article',
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 3) {
          return {
            selector: sel,
            count: els.length,
            firstHtml: els[0].outerHTML.slice(0, 1000),
          };
        }
      }
      // 嘗試找任何含價格的元素
      const priceEls = document.querySelectorAll('[class*="price"], [class*="Price"]');
      if (priceEls.length > 0) {
        return { selector: "[price]", count: priceEls.length, firstHtml: priceEls[0].outerHTML.slice(0, 500) };
      }
      return null;
    });

    if (products) {
      console.log(`   ✅ 找到元素: ${products.selector} (${products.count} 個)`);
      console.log(`   第一個 HTML:\n${products.firstHtml}`);
    } else {
      await page.screenshot({ path: "/home/ubuntu/cw_shopcat.png" });
      console.log(`   ❌ 未找到產品元素，截圖已儲存`);
    }

    // 測試 _next/data for this URL
    const urlPath = new URL(page.url()).pathname;
    const slugParts = urlPath.replace(/^\//, "").split("/");
    // 格式: /shop-online/{id}/{slug} 或 /shop-online/{slug}
    const nextDataUrl = `https://www.chemistwarehouse.com.au/_next/data/${BUILD_ID}/en${urlPath}.json`;
    console.log(`\n   _next/data URL: ${nextDataUrl}`);

    const nextData = await page.evaluate(async (url) => {
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      const text = await res.text();
      return { status: res.status, body: text.slice(0, 3000), size: text.length };
    }, nextDataUrl);

    console.log(`   狀態: ${nextData.status}, 大小: ${nextData.size} bytes`);
    if (nextData.status === 200) {
      try {
        const data = JSON.parse(nextData.body.length === nextData.size ? nextData.body : nextData.body + "...");
        console.log(`   ✅ _next/data 可存取！`);
        console.log(`   pageProps keys: ${Object.keys(data.pageProps || {}).join(", ")}`);

        // 找產品列表
        function findProducts(obj, path = "", depth = 0) {
          if (depth > 8) return null;
          if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === "object") {
            const keys = Object.keys(obj[0]);
            if (keys.some(k => ["price", "Price", "salePrice", "name", "title", "sku"].includes(k))) {
              return { path, count: obj.length, keys, sample: obj[0] };
            }
          }
          if (typeof obj === "object" && obj !== null) {
            for (const [k, v] of Object.entries(obj)) {
              const result = findProducts(v, `${path}.${k}`, depth + 1);
              if (result) return result;
            }
          }
          return null;
        }

        // 需要完整 JSON 才能找產品
        if (nextData.size < 50000) {
          const fullData = JSON.parse(nextData.body);
          const found = findProducts(fullData);
          if (found) {
            console.log(`   產品列表 at: ${found.path}`);
            console.log(`   數量: ${found.count}`);
            console.log(`   Keys: ${found.keys.join(", ")}`);
            console.log(`   第一個產品: ${JSON.stringify(found.sample).slice(0, 500)}`);
          }
        }
      } catch (e) {
        console.log(`   JSON 解析: ${e.message}`);
        console.log(`   回應前 500: ${nextData.body.slice(0, 500)}`);
      }
    } else {
      console.log(`   回應: ${nextData.body.slice(0, 200)}`);
    }
  }

  await browser.close();
  console.log("\n=== 完成 ===");
}

main().catch(console.error);
