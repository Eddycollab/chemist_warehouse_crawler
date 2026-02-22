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

  let capturedJson = null;
  let buildId = null;

  // 攔截所有 JSON 回應
  page.on("response", async (response) => {
    const url = response.url();
    const contentType = response.headers()["content-type"] || "";

    if (url.includes("/_next/data/") && url.includes("/buy/") && contentType.includes("application/json")) {
      console.log(`\n[攔截到目標 JSON] ${url}`);
      try {
        const json = await response.json();
        capturedJson = json;
        // 提取 buildId
        const match = url.match(/_next\/data\/([^/]+)\//);
        if (match) buildId = match[1];
        console.log(`  buildId: ${buildId}`);
        console.log(`  pageProps keys: ${Object.keys(json.pageProps || {}).join(", ")}`);
      } catch (e) {
        console.log(`  解析失敗: ${e.message}`);
      }
    }
  });

  console.log(`\n正在載入: ${TARGET_URL}`);
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 45000 });
  } catch (e) {
    console.log(`載入超時（可能已有資料）: ${e.message}`);
  }

  await page.waitForTimeout(3000);

  if (capturedJson) {
    console.log("\n=== 分析產品資料結構 ===");
    const pageProps = capturedJson.pageProps || {};

    // 遞迴尋找產品列表
    function findProducts(obj, path = "", depth = 0) {
      if (depth > 5) return null;
      if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === "object") {
        const keys = Object.keys(obj[0]);
        if (keys.some((k) => ["name", "title", "price", "sku", "id"].includes(k))) {
          return { path, count: obj.length, sampleKeys: keys.slice(0, 15), sample: obj[0] };
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

    const found = findProducts(pageProps);
    if (found) {
      console.log(`\n找到產品列表 at: pageProps${found.path}`);
      console.log(`產品數量: ${found.count}`);
      console.log(`產品 keys: ${found.sampleKeys.join(", ")}`);
      console.log("\n第一個產品的完整資料：");
      console.log(JSON.stringify(found.sample, null, 2).slice(0, 2000));
    } else {
      console.log("未找到產品列表，顯示 pageProps 頂層結構：");
      for (const [k, v] of Object.entries(pageProps)) {
        const type = Array.isArray(v) ? `Array(${v.length})` : typeof v;
        console.log(`  ${k}: ${type}`);
      }
    }

    // 儲存完整 JSON 供分析
    writeFileSync("/home/ubuntu/cw_next_data.json", JSON.stringify(capturedJson, null, 2));
    console.log("\n完整 JSON 已儲存至 /home/ubuntu/cw_next_data.json");
  } else {
    console.log("\n未攔截到 _next/data JSON，嘗試從頁面 __NEXT_DATA__ 提取...");
    const nextData = await page.evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__");
      return el ? JSON.parse(el.textContent) : null;
    });

    if (nextData) {
      console.log("從 __NEXT_DATA__ 找到資料！");
      console.log(`buildId: ${nextData.buildId}`);
      console.log(`pageProps keys: ${Object.keys(nextData.props?.pageProps || {}).join(", ")}`);
      writeFileSync("/home/ubuntu/cw_next_data.json", JSON.stringify(nextData, null, 2));
      console.log("已儲存至 /home/ubuntu/cw_next_data.json");
    } else {
      console.log("無法取得資料，可能被 Cloudflare 封鎖");
      const title = await page.title();
      console.log(`頁面標題: ${title}`);
    }
  }

  await browser.close();
  console.log("\n完成！");
}

main().catch(console.error);
