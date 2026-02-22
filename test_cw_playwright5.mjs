import { chromium } from "playwright";
import { writeFileSync } from "fs";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-AU",
    extraHTTPHeaders: {
      "Accept-Language": "en-AU,en;q=0.9",
    },
  });
  const page = await context.newPage();

  const allResponses = [];

  // 攔截所有回應
  page.on("response", async (response) => {
    const url = response.url();
    const contentType = response.headers()["content-type"] || "";
    const status = response.status();

    if (
      contentType.includes("application/json") &&
      status === 200 &&
      !url.includes("_next/static") &&
      !url.endsWith(".js") &&
      !url.includes("klaviyo") &&
      !url.includes("nr-data") &&
      !url.includes("challenge-platform")
    ) {
      try {
        const text = await response.text();
        if (text.length > 100) {
          allResponses.push({ url: url.slice(0, 200), size: text.length, snippet: text.slice(0, 300) });
        }
      } catch (e) {}
    }
  });

  // 先訪問首頁
  console.log("載入首頁...");
  await page.goto("https://www.chemistwarehouse.com.au/", { timeout: 30000 });
  await page.waitForTimeout(8000);

  // 截圖首頁
  await page.screenshot({ path: "/home/ubuntu/cw_home.png", fullPage: false });
  console.log(`首頁標題: ${await page.title()}`);

  // 找導航連結
  const navLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("nav a, header a, [class*='nav'] a, [class*='Nav'] a"));
    return links
      .map(a => ({ text: a.textContent?.trim().slice(0, 50), href: a.href }))
      .filter(l => l.href && l.href.includes("chemistwarehouse") && l.text)
      .slice(0, 30);
  });
  console.log("\n導航連結：");
  for (const link of navLinks) {
    console.log(`  ${link.text} -> ${link.href}`);
  }

  // 找含 "vitamin" 或 "shop" 的連結
  const shopLinks = navLinks.filter(l =>
    l.href.includes("vitamin") || l.href.includes("shop") || l.href.includes("buy") || l.href.includes("health")
  );
  console.log("\n商店相關連結：");
  for (const link of shopLinks) {
    console.log(`  ${link.text} -> ${link.href}`);
  }

  console.log(`\n攔截到的 JSON 回應數量: ${allResponses.length}`);
  for (const r of allResponses.slice(0, 10)) {
    console.log(`  ${r.url} (${r.size} bytes)`);
  }

  // 嘗試訪問 CW 的 specials 頁面（通常有產品列表）
  console.log("\n\n載入 specials 頁面...");
  allResponses.length = 0;

  try {
    await page.goto("https://www.chemistwarehouse.com.au/specials", { timeout: 30000 });
  } catch (e) {
    console.log(`specials 頁面載入: ${e.message}`);
  }
  await page.waitForTimeout(8000);

  const specialsTitle = await page.title();
  const specialsUrl = page.url();
  console.log(`specials 標題: ${specialsTitle}`);
  console.log(`specials URL: ${specialsUrl}`);

  await page.screenshot({ path: "/home/ubuntu/cw_specials.png", fullPage: false });

  // 找產品元素
  const productCount = await page.evaluate(() => {
    const selectors = [
      '[data-testid*="product"]',
      '[class*="ProductCard"]',
      '[class*="product-card"]',
      '[class*="ProductTile"]',
      '[class*="product-tile"]',
      'article',
      '[class*="Product"]',
    ];
    for (const sel of selectors) {
      const count = document.querySelectorAll(sel).length;
      if (count > 3) return { selector: sel, count };
    }
    return null;
  });

  if (productCount) {
    console.log(`\n找到產品元素: ${productCount.selector} (${productCount.count} 個)`);

    // 取第一個產品的 HTML
    const firstProduct = await page.locator(productCount.selector).first().innerHTML();
    console.log(`第一個產品 HTML: ${firstProduct.slice(0, 800)}`);
  } else {
    console.log("\n未找到產品元素");
    // 顯示頁面 body 的前 1000 字元
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.log(`頁面文字: ${bodyText}`);
  }

  console.log(`\n攔截到的 JSON 回應數量: ${allResponses.length}`);
  for (const r of allResponses.slice(0, 15)) {
    console.log(`  ${r.url} (${r.size} bytes)`);
    if (r.snippet.includes('"price"') || r.snippet.includes('"Price"') || r.snippet.includes('"name"')) {
      console.log(`    *** 含產品資料 ***`);
      console.log(`    片段: ${r.snippet.slice(0, 200)}`);
    }
  }

  await browser.close();
  console.log("\n完成！截圖已儲存至 /home/ubuntu/cw_home.png 和 /home/ubuntu/cw_specials.png");
}

main().catch(console.error);
