import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFileSync } from "fs";

// 使用 stealth 插件
chromium.use(StealthPlugin());

async function main() {
  console.log("=== Playwright Stealth 模式測試 ===\n");

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-AU",
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: {
      "Accept-Language": "en-AU,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },
  });

  const page = await context.newPage();

  // 攔截所有 JSON 回應
  const jsonResponses = [];
  page.on("response", async (response) => {
    const url = response.url();
    const ct = response.headers()["content-type"] || "";
    if (ct.includes("application/json") && response.status() === 200 &&
        !url.includes("nr-data") && !url.includes("klaviyo") && !url.includes("challenge-platform")) {
      try {
        const text = await response.text();
        if (text.length > 200) {
          jsonResponses.push({ url: url.slice(0, 150), size: text.length });
        }
      } catch (e) {}
    }
  });

  // 1. 測試首頁
  console.log("1. 測試首頁...");
  try {
    await page.goto("https://www.chemistwarehouse.com.au/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(5000);

    const title = await page.title();
    const isBlocked = title.includes("Just a moment") || title.includes("Attention Required");
    console.log(`   標題: ${title}`);
    console.log(`   Cloudflare 封鎖: ${isBlocked ? "是 ❌" : "否 ✅"}`);

    if (!isBlocked) {
      // 取得 buildId
      const buildId = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll("script"));
        for (const s of scripts) {
          const match = s.textContent?.match(/"buildId":"([^"]+)"/);
          if (match) return match[1];
        }
        // 也嘗試 window.__NEXT_DATA__
        return window.__NEXT_DATA__?.buildId || null;
      });
      console.log(`   buildId: ${buildId || "未找到"}`);

      if (buildId) {
        // 2. 測試 sitemap
        console.log("\n2. 測試 sitemap.xml...");
        await page.goto(`https://www.chemistwarehouse.com.au/sitemap.xml`, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await page.waitForTimeout(2000);
        const sitemapContent = await page.content();
        const sitemapStatus = sitemapContent.includes("<urlset") || sitemapContent.includes("<sitemapindex");
        console.log(`   Sitemap 可存取: ${sitemapStatus ? "是 ✅" : "否 ❌"}`);
        if (sitemapStatus) {
          const urlCount = (sitemapContent.match(/<loc>/g) || []).length;
          console.log(`   URL 數量: ${urlCount}`);
          const locMatches = sitemapContent.match(/<loc>(.*?)<\/loc>/g) || [];
          const urls = locMatches.map(m => m.replace(/<\/?loc>/g, "")).slice(0, 20);
          console.log(`   前 20 個 URL:`);
          urls.forEach(u => console.log(`     ${u}`));
          writeFileSync("/home/ubuntu/cw_sitemap_stealth.xml", sitemapContent);
          console.log(`   已儲存至 /home/ubuntu/cw_sitemap_stealth.xml`);
        } else {
          console.log(`   內容前 300 字: ${sitemapContent.slice(0, 300)}`);
        }

        // 3. 測試 _next/data
        console.log("\n3. 測試 _next/data JSON...");
        const nextDataUrl = `https://www.chemistwarehouse.com.au/_next/data/${buildId}/en/buy/86/vitamins.json`;
        console.log(`   URL: ${nextDataUrl}`);

        const nextDataRes = await page.evaluate(async (url) => {
          try {
            const res = await fetch(url, {
              headers: { "Accept": "application/json" }
            });
            const text = await res.text();
            return { status: res.status, body: text.slice(0, 2000), size: text.length };
          } catch (e) {
            return { error: e.message };
          }
        }, nextDataUrl);

        console.log(`   狀態: ${nextDataRes.status}`);
        console.log(`   大小: ${nextDataRes.size} bytes`);
        if (nextDataRes.status === 200) {
          try {
            const data = JSON.parse(nextDataRes.body);
            console.log(`   頂層 keys: ${Object.keys(data).join(", ")}`);
            if (data.pageProps) {
              console.log(`   pageProps keys: ${Object.keys(data.pageProps).join(", ")}`);
            }
            console.log(`   ✅ _next/data JSON 可存取！`);
          } catch (e) {
            console.log(`   JSON 解析失敗: ${nextDataRes.body.slice(0, 200)}`);
          }
        } else {
          console.log(`   回應: ${nextDataRes.body?.slice(0, 200)}`);
        }

        // 4. 測試產品頁面
        console.log("\n4. 測試產品分類頁面...");
        await page.goto("https://www.chemistwarehouse.com.au/buy/86/vitamins", {
          waitUntil: "networkidle",
          timeout: 30000,
        });
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
            'article',
          ];
          for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            if (els.length > 3) {
              const first = els[0];
              return {
                selector: sel,
                count: els.length,
                firstHtml: first.outerHTML.slice(0, 800),
              };
            }
          }
          return null;
        });

        if (products) {
          console.log(`   ✅ 找到產品元素: ${products.selector} (${products.count} 個)`);
          console.log(`   第一個產品 HTML:\n${products.firstHtml}`);
        } else {
          console.log(`   ❌ 未找到產品元素`);
          await page.screenshot({ path: "/home/ubuntu/cw_category_stealth.png" });
          console.log(`   截圖已儲存至 /home/ubuntu/cw_category_stealth.png`);
        }
      }
    } else {
      await page.screenshot({ path: "/home/ubuntu/cw_blocked.png" });
      console.log(`   截圖已儲存至 /home/ubuntu/cw_blocked.png`);
    }
  } catch (e) {
    console.log(`   錯誤: ${e.message}`);
  }

  console.log(`\n攔截到的 JSON 回應: ${jsonResponses.length} 個`);
  jsonResponses.slice(0, 10).forEach(r => console.log(`  ${r.url} (${r.size} bytes)`));

  await browser.close();
  console.log("\n=== 完成 ===");
}

main().catch(console.error);
