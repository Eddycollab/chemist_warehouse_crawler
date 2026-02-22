import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFileSync } from "fs";

chromium.use(StealthPlugin());

async function main() {
  console.log("=== 等待 CW 產品載入並找出 CSS 選擇器 ===\n");

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

  // 攔截 API 請求
  const apiCalls = [];
  page.on("response", async (response) => {
    const url = response.url();
    const ct = response.headers()["content-type"] || "";
    if (ct.includes("application/json") && !url.includes("onetrust") && !url.includes("analytics")) {
      try {
        const body = await response.text();
        if (body.length > 100 && body.length < 5000000) {
          apiCalls.push({ url, size: body.length, preview: body.slice(0, 300) });
        }
      } catch {}
    }
  });

  console.log("1. 訪問 Vitamins 分類頁面...");
  await page.goto("https://www.chemistwarehouse.com.au/shop-online/81/vitamins-supplements", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // 等待更長時間讓 JS 渲染
  console.log("   等待 JavaScript 渲染（10 秒）...");
  await page.waitForTimeout(10000);

  const title = await page.title();
  console.log(`   標題: ${title}`);

  // 截圖
  await page.screenshot({ path: "/home/ubuntu/cw_vitamins.png", fullPage: false });
  console.log("   截圖已儲存至 /home/ubuntu/cw_vitamins.png");

  // 找所有可能的產品選擇器
  const selectorTest = await page.evaluate(() => {
    const results = {};
    const selectors = [
      '[data-testid]',
      '[class*="ProductCard"]',
      '[class*="product-card"]',
      '[class*="ProductTile"]',
      '[class*="product-tile"]',
      '[class*="Product"]',
      '[class*="product"]',
      'article',
      'li[class*="item"]',
      '[class*="Item"]',
      '[class*="Tile"]',
      '[class*="tile"]',
      '[class*="Card"]',
      '[class*="card"]',
    ];

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        results[sel] = {
          count: els.length,
          firstClass: els[0].className.slice(0, 100),
          firstHtml: els[0].outerHTML.slice(0, 500),
        };
      }
    }

    // 找含有價格的元素
    const priceEls = document.querySelectorAll('[class*="price"], [class*="Price"]');
    if (priceEls.length > 0) {
      results["[price]"] = {
        count: priceEls.length,
        firstClass: priceEls[0].className.slice(0, 100),
        firstHtml: priceEls[0].outerHTML.slice(0, 500),
      };
    }

    // 找含有 AU$ 的文字元素
    const allText = document.querySelectorAll("*");
    const priceTexts = [];
    for (const el of allText) {
      if (el.children.length === 0 && el.textContent && el.textContent.includes("AU$")) {
        priceTexts.push({
          tag: el.tagName,
          class: el.className.slice(0, 80),
          text: el.textContent.trim().slice(0, 50),
          parentClass: el.parentElement?.className.slice(0, 80),
        });
        if (priceTexts.length >= 5) break;
      }
    }
    results["_priceTexts"] = priceTexts;

    // 找含有產品名稱的 h3/h2/h4
    const headings = document.querySelectorAll("h2, h3, h4");
    const productHeadings = [];
    for (const h of headings) {
      if (h.textContent && h.textContent.length > 10 && h.textContent.length < 200) {
        productHeadings.push({
          tag: h.tagName,
          class: h.className.slice(0, 80),
          text: h.textContent.trim().slice(0, 80),
          parentClass: h.parentElement?.className.slice(0, 80),
          grandParentClass: h.parentElement?.parentElement?.className.slice(0, 80),
        });
        if (productHeadings.length >= 10) break;
      }
    }
    results["_headings"] = productHeadings;

    return results;
  });

  console.log("\n2. 選擇器測試結果:");
  for (const [sel, info] of Object.entries(selectorTest)) {
    if (sel === "_priceTexts") {
      console.log(`\n   價格文字元素:`);
      info.forEach(p => console.log(`     <${p.tag} class="${p.class}"> "${p.text}" (parent: "${p.parentClass}")`));
    } else if (sel === "_headings") {
      console.log(`\n   標題元素（前 10）:`);
      info.forEach(h => console.log(`     <${h.tag} class="${h.class}"> "${h.text}"`));
      console.log(`     (parent: "${info[0]?.parentClass}", grandparent: "${info[0]?.grandParentClass}")`);
    } else if (info.count > 3) {
      console.log(`\n   ✅ ${sel}: ${info.count} 個`);
      console.log(`      class: ${info.firstClass}`);
      console.log(`      html: ${info.firstHtml.slice(0, 300)}`);
    }
  }

  console.log("\n3. 攔截到的 API 請求:");
  apiCalls.forEach(a => console.log(`   ${a.url} (${a.size} bytes)\n   preview: ${a.preview.slice(0, 200)}\n`));

  // 儲存頁面 HTML 供分析
  const html = await page.content();
  writeFileSync("/home/ubuntu/cw_vitamins.html", html);
  console.log(`\n4. 頁面 HTML 已儲存至 /home/ubuntu/cw_vitamins.html (${html.length} bytes)`);

  await browser.close();
  console.log("\n=== 完成 ===");
}

main().catch(console.error);
