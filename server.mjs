import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {
  EUM_DETAIL_URL,
  buildEumLandUseParams,
  isValidPnu,
  mergeSearchItems,
  normalizePricePayload,
  normalizeSearchItems,
  parseEumLandUseHtml
} from "./lib/land-use.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const defaultPort = Number(process.env.PORT || 4173);
const deniedFiles = new Set(["/config.local.js", "/config.example.js", "/.gitignore", "/package-lock.json", "/package.json"]);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function readLocalConfig() {
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, "config.local.js"), "utf8");
  } catch {
    // 운영 환경에서는 환경변수를 사용한다.
  }
  const vworldApiKey = process.env.VWORLD_API_KEY || text.match(/vworldApiKey:\s*["']([^"']+)["']/)?.[1] || "";
  const vworldDomain = process.env.VWORLD_DOMAIN || text.match(/vworldDomain:\s*["']([^"']+)["']/)?.[1] || "localhost";
  if (!vworldApiKey || vworldApiKey === "YOUR_VWORLD_API_KEY") throw new Error("VWorld API key is not configured");
  return {vworldApiKey, vworldDomain};
}

function writeJson(response, status, body, cacheControl = "no-store") {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

async function fetchJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return response.json();
}

async function fetchAddressCategory(fetchImpl, config, query, category) {
  const target = new URL("https://api.vworld.kr/req/search");
  Object.entries({
    service: "search",
    request: "search",
    version: "2.0",
    crs: "EPSG:4326",
    size: "10",
    page: "1",
    query,
    type: "address",
    category,
    format: "json",
    errorformat: "json",
    key: config.vworldApiKey,
    domain: config.vworldDomain
  }).forEach(([key, value]) => target.searchParams.set(key, value));
  const payload = await fetchJson(fetchImpl, target, {
    headers: {"Accept": "application/json", "Referer": `https://${config.vworldDomain}/`, "User-Agent": "TojiIyongHannun/1.0"},
    signal: AbortSignal.timeout(12000)
  });
  return normalizeSearchItems(payload, category);
}

async function handleAddressSearch(response, incomingUrl, fetchImpl, getConfig) {
  const query = String(incomingUrl.searchParams.get("q") || "").replace(/\s+/g, " ").trim();
  if (query.length < 2 || query.length > 100) {
    writeJson(response, 400, {error: "주소나 지번을 2~100자로 입력해 주세요."});
    return;
  }
  try {
    const config = getConfig();
    const settled = await Promise.allSettled(["road", "parcel"].map((category) => fetchAddressCategory(fetchImpl, config, query, category)));
    const successful = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
    if (!successful.length) throw settled[0]?.reason || new Error("Address search failed");
    writeJson(response, 200, {items: mergeSearchItems(successful), partial: successful.length < 2}, "private, max-age=300");
  } catch (error) {
    console.error("주소 검색 연결 실패:", error.message);
    writeJson(response, 502, {error: "주소 검색 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."});
  }
}

async function fetchEumHtml(fetchImpl, pnu) {
  const response = await fetchImpl(EUM_DETAIL_URL, {
    method: "POST",
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://www.eum.go.kr",
      "Referer": "https://www.eum.go.kr/web/am/amMain.jsp",
      "User-Agent": "Mozilla/5.0 (compatible; TojiIyongHannun/1.0)"
    },
    body: buildEumLandUseParams(pnu),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`토지이음 HTTP ${response.status}`);
  const charset = /euc-kr/i.test(response.headers.get("content-type") || "") ? "euc-kr" : "utf-8";
  return new TextDecoder(charset).decode(await response.arrayBuffer());
}

async function fetchLandPrice(fetchImpl, config, pnu) {
  const target = new URL("https://api.vworld.kr/ned/data/getIndvdLandPriceAttr");
  Object.entries({pnu, pageNo: "1", numOfRows: "100", format: "json", key: config.vworldApiKey, domain: config.vworldDomain})
    .forEach(([key, value]) => target.searchParams.set(key, value));
  return normalizePricePayload(await fetchJson(fetchImpl, target, {
    headers: {"Accept": "application/json", "Referer": `https://${config.vworldDomain}/`, "User-Agent": "TojiIyongHannun/1.0"},
    signal: AbortSignal.timeout(12000)
  }));
}

async function handleLandUse(response, incomingUrl, fetchImpl, getConfig) {
  const pnu = String(incomingUrl.searchParams.get("pnu") || "");
  if (!isValidPnu(pnu)) {
    writeJson(response, 400, {error: "19자리 PNU가 필요합니다."});
    return;
  }
  try {
    const config = getConfig();
    const [eumHtml, priceResult] = await Promise.all([
      fetchEumHtml(fetchImpl, pnu),
      fetchLandPrice(fetchImpl, config, pnu).catch(() => ({price: null, priceYear: ""}))
    ]);
    const data = parseEumLandUseHtml(eumHtml, pnu);
    data.price = priceResult.price;
    data.priceYear = priceResult.priceYear;
    data.fetchedAt = new Date().toISOString();
    writeJson(response, 200, {data}, "private, max-age=600");
  } catch (error) {
    console.error("토지이용계획 연결 실패:", error.message);
    writeJson(response, 502, {error: "현재 요약 정보를 불러오지 못했습니다. 토지이음 원문에서 직접 확인해 주세요."});
  }
}

function serveStatic(response, pathname) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  if (deniedFiles.has(requestPath) || requestPath.startsWith("/.") || requestPath.startsWith("/lib/") || requestPath.startsWith("/tests/")) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  const filePath = path.resolve(root, `.${decodedPath}`);
  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self' https://www.eum.go.kr; frame-ancestors 'none'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff"
  });
  fs.createReadStream(filePath).pipe(response);
}

export function createAppServer({fetchImpl = fetch, getConfig = readLocalConfig} = {}) {
  return http.createServer(async (request, response) => {
    const incomingUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {Allow: "GET, HEAD"});
      response.end("Method not allowed");
      return;
    }
    if (incomingUrl.pathname === "/api/address-search") {
      await handleAddressSearch(response, incomingUrl, fetchImpl, getConfig);
      return;
    }
    if (incomingUrl.pathname === "/api/land-use") {
      await handleLandUse(response, incomingUrl, fetchImpl, getConfig);
      return;
    }
    serveStatic(response, incomingUrl.pathname);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  createAppServer().listen(defaultPort, () => {
    console.log(`토지이용한눈: http://localhost:${defaultPort}`);
  });
}
