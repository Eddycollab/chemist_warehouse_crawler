import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFileSync } from "fs";

chromium.use(StealthPlugin());

const BUILD_ID = "c_zPYXot-rjmtKVHRm-uF";

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

  // 先訪問首頁通過 Cloudflare
  console.log("0. 訪問首頁通過 Cloudflare...");
  await page.goto("https://www.chemistwarehouse.com.au/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log(`   標題: ${await page.title()}`);

  // 1. 用 page.request 取得 en.json
  console.log("\n1. 取得 en.json（導航結構）...");
  const enJsonUrl = `https://www.chemistwarehouse.com.au/_next/data/${BUILD_ID}/en.json`;
  const enRes = await context.request.get(enJsonUrl, {
    headers: { "Accept": "application/json", "Referer": "https://www.chemistwarehouse.com.au/" }
  });
  console.log(`   狀態: ${enRes.status()}`);

  if (enRes.ok()) {
    const enData = await enRes.json();
    const enStr = JSON.stringify(enData, null, 2);
    writeFileSync("/home/ubuntu/cw_en.json", enStr);
    console.log(`   大小: ${enStr.length} bytes，已儲存至 /home/ubuntu/cw_en.json`);

    // 找分類結構
    const pageProps = enData.pageProps || {};
    console.log(`   pageProps keys: ${Object.keys(pageProps).join(", ")}`);

    // 找 navigation/menu 結構
    function findMenuItems(obj, depth = 0) {
      if (depth > 5 || typeof obj !== "object" || obj === null) return [];
      const items = [];
      if (obj.slug && obj.name && obj.children) {
        items.push({ name: obj.name, slug: obj.slug, id: obj.id, childCount: obj.children.length });
        for (const child of obj.children) {
          items.push(...findMenuItems(child, depth + 1));
        }
      } else {
        for (const v of Object.values(obj)) {
          items.push(...findMenuItems(v, depth + 1));
        }
      }
      return items;
    }

    const menuItems = findMenuItems(pageProps);
    const shopItems = menuItems.filter(i => i.slug && !i.slug.includes("cwr-cw-au-root"));
    console.log(`\n   找到 ${shopItems.length} 個分類項目（前 30）:`);
    shopItems.slice(0, 30).forEach(i =>
      console.log(`     id:${i.id || "?"} name:"${i.name}" slug:"${i.slug}" children:${i.childCount}`)
    );
  }

  // 2. 取得首頁導航連結
  console.log("\n2. 取得首頁導航連結...");
  const navUrls = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a[href*='/shop-online/'], a[href*='/buy/']"));
    return [...new Set(links.map(a => a.href))].slice(0, 30);
  });
  console.log(`   找到 ${navUrls.length} 個連結:`);
  navUrls.forEach(u => console.log(`     ${u}`));

  // 3. 測試第一個 shop-online URL 的 _next/data
  const shopUrl = navUrls.find(u => u.includes("/shop-online/"));
  if (shopUrl) {
    console.log(`\n3. 測試分類頁面: ${shopUrl}`);
    await page.goto(shopUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);

    const catTitle = await page.title();
    const catUrl = page.url();
    console.log(`   標題: ${catTitle}`);
    console.log(`   URL: ${catUrl}`);

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
        'li[class*="item"]',
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 3) {
          return {
            selector: sel,
            count: els.length,
            firstHtml: els[0].outerHTML.slice(0, 1200),
          };
        }
      }
      return null;
    });

    if (products) {
      console.log(`   ✅ 找到元素: ${products.selector} (${products.count} 個)`);
      console.log(`   第一個 HTML:\n${products.firstHtml}`);
      writeFileSync("/home/ubuntu/cw_first_product.html", products.firstHtml);
    } else {
      await page.screenshot({ path: "/home/ubuntu/cw_shopcat.png" });
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
      console.log(`   ❌ 未找到產品元素`);
      console.log(`   頁面文字: ${bodyText}`);
    }

    // 測試 _next/data
    const urlPath = new URL(catUrl).pathname;
    const nextDataUrl = `https://www.chemistwarehouse.com.au/_next/data/${BUILD_ID}/en${urlPath}.json`;
    console.log(`\n   _next/data URL: ${nextDataUrl}`);

    const nextRes = await context.request.get(nextDataUrl, {
      headers: { "Accept": "application/json", "Referer": catUrl }
    });
    console.log(`   狀態: ${nextRes.status()}`);

    if (nextRes.ok()) {
      const nextData = await nextRes.json();
      const nextStr = JSON.stringify(nextData, null, 2);
      console.log(`   ✅ _next/data 可存取！大小: ${nextStr.length} bytes`);
      console.log(`   pageProps keys: ${Object.keys(nextData.pageProps || {}).join(", ")}`);

      // 找產品列表
      function findProducts(obj, path = "", depth = 0) {
        if (depth > 8) return null;
        if (Array.isArray(obj) && obj.length > 2 && typeof obj[0] === "object") {
          const keys = Object.keys(obj[0]);
          if (keys.some(k => ["price", "Price", "salePrice", "name", "title", "sku", "id"].includes(k)) &&
              keys.length > 2) {
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

      const found = findProducts(nextData);
      if (found) {
        console.log(`\n   ✅ 找到產品列表 at: ${found.path}`);
        console.log(`   數量: ${found.count}`);
        console.log(`   Keys: ${found.keys.join(", ")}`);
        console.log(`   第一個產品:\n${JSON.stringify(found.sample, null, 2).slice(0, 1000)}`);
        writeFileSync("/home/ubuntu/cw_next_data_cat.json", nextStr);
        console.log(`   已儲存至 /home/ubuntu/cw_next_data_cat.json`);
      } else {
        console.log(`   ⚠️  未在 _next/data 中找到產品列表`);
        // 儲存前 50KB 供分析
        writeFileSync("/home/ubuntu/cw_next_data_cat.json", nextStr.slice(0, 50000));
        console.log(`   已儲存前 50KB 至 /home/ubuntu/cw_next_data_cat.json`);
      }
    } else {
      const errText = await nextRes.text();
      console.log(`   ❌ 失敗: ${errText.slice(0, 200)}`);
    }
  }

  await browser.close();
  console.log("\n=== 完成 ===");
}

main().catch(console.error);
