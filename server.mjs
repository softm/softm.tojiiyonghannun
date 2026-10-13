import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {
  EUM_DETAIL_URL,
  buildEumLandUseParams,
  isValidPnu,
  mergeSearchItems,
  normalizePlaceCandidates,
  normalizePricePayload,
  normalizeSearchItems,
  parseEumLandUseHtml
} from "./lib/land-use.mjs";
import {normalizeBuildingRecords, normalizeLandRegisterRecord} from "./property-documents.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const defaultPort = Number(process.env.PORT || 4173);
const deniedFiles = new Set(["/config.local.js", "/config.example.js", "/.gitignore", "/package-lock.json", "/package.json"]);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
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
  const molitApiKey = process.env.MOLIT_API_KEY || text.match(/molitApiKey:\s*["']([^"']+)["']/)?.[1] || "";
  if (!vworldApiKey || vworldApiKey === "YOUR_VWORLD_API_KEY") throw new Error("VWorld API key is not configured");
  return {vworldApiKey, vworldDomain, molitApiKey: molitApiKey === "YOUR_MOLIT_API_KEY" ? "" : molitApiKey};
}

function writeRuntimeConfig(response, getConfig) {
  let molitApiKey = "";
  try {
    molitApiKey = String(getConfig()?.molitApiKey || "");
  } catch {
    // VWorld 설정과 무관하게 실거래 카드가 비활성 상태로 표시되도록 빈 설정을 제공한다.
  }
  response.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(`globalThis.__TOJI_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify({molitApiKey})});\n`);
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

async function fetchPlaceCandidates(fetchImpl, config, query) {
  const target = new URL("https://api.vworld.kr/req/search");
  Object.entries({
    service: "search",
    request: "search",
    version: "2.0",
    crs: "EPSG:4326",
    size: "10",
    page: "1",
    query,
    type: "place",
    format: "json",
    errorformat: "json",
    key: config.vworldApiKey,
    domain: config.vworldDomain
  }).forEach(([key, value]) => target.searchParams.set(key, value));
  const payload = await fetchJson(fetchImpl, target, {
    headers: {"Accept": "application/json", "Referer": `https://${config.vworldDomain}/`, "User-Agent": "TojiIyongHannun/1.0"},
    signal: AbortSignal.timeout(12000)
  });
  return normalizePlaceCandidates(payload);
}

async function resolvePlaceCandidates(fetchImpl, config, candidates) {
  const settled = await Promise.allSettled(candidates.map(async (candidate) => {
    const queries = [candidate.parcelAddress, candidate.roadAddress].filter(Boolean);
    for (const address of queries) {
      for (const category of ["parcel", "road"]) {
        const matches = await fetchAddressCategory(fetchImpl, config, address, category);
        if (!matches.length) continue;
        return {
          ...matches[0],
          matchTypes: ["place"],
          buildingName: candidate.title,
          longitude: candidate.longitude ?? matches[0].longitude,
          latitude: candidate.latitude ?? matches[0].latitude
        };
      }
    }
    throw new Error("장소 주소에 연결된 필지를 찾지 못했습니다.");
  }));
  return settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
}

async function handleAddressSearch(response, incomingUrl, fetchImpl, getConfig) {
  const query = String(incomingUrl.searchParams.get("q") || "").replace(/\s+/g, " ").trim();
  if (query.length < 2 || query.length > 100) {
    writeJson(response, 400, {error: "주소나 지번을 2~100자로 입력해 주세요."});
    return;
  }
  try {
    const config = getConfig();
    const settled = await Promise.allSettled([
      fetchAddressCategory(fetchImpl, config, query, "road"),
      fetchAddressCategory(fetchImpl, config, query, "parcel"),
      fetchPlaceCandidates(fetchImpl, config, query)
    ]);
    const addressResults = settled.slice(0, 2).filter((result) => result.status === "fulfilled").map((result) => result.value);
    const placeCandidates = settled[2].status === "fulfilled" ? settled[2].value : [];
    const placeResults = placeCandidates.length ? await resolvePlaceCandidates(fetchImpl, config, placeCandidates) : [];
    if (!addressResults.length && settled[2].status === "rejected") throw settled[0]?.reason || settled[2].reason || new Error("Address search failed");
    writeJson(response, 200, {
      items: mergeSearchItems([...addressResults, placeResults]),
      partial: addressResults.length < 2 || settled[2].status === "rejected"
    }, "private, max-age=300");
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

function isValidKoreaCoordinate(longitude, latitude) {
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    && longitude >= 124 && longitude <= 132
    && latitude >= 33 && latitude <= 39;
}

async function handleVicinityMap(response, incomingUrl, fetchImpl, getConfig) {
  const pnu = String(incomingUrl.searchParams.get("pnu") || "");
  const longitude = Number(incomingUrl.searchParams.get("x"));
  const latitude = Number(incomingUrl.searchParams.get("y"));
  if (!isValidPnu(pnu) || !isValidKoreaCoordinate(longitude, latitude)) {
    writeJson(response, 400, {error: "유효한 PNU와 국내 필지 좌표가 필요합니다."});
    return;
  }
  try {
    const config = getConfig();
    const target = new URL("https://api.vworld.kr/req/image");
    Object.entries({
      service: "image",
      request: "getmap",
      version: "2.0",
      format: "png",
      basemap: "PHOTO_HYBRID",
      crs: "EPSG:4326",
      zoom: "18",
      size: "1024,620",
      center: `${longitude},${latitude}`,
      marker: `label:선택 필지|color:red|point:${longitude} ${latitude}`,
      key: config.vworldApiKey,
      domain: config.vworldDomain
    }).forEach(([key, value]) => target.searchParams.set(key, value));
    const upstream = await fetchImpl(target, {
      headers: {"Accept": "image/png", "Referer": `https://${config.vworldDomain}/`, "User-Agent": "TojiIyongHannun/1.0"},
      signal: AbortSignal.timeout(20000)
    });
    const contentType = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !contentType.toLowerCase().startsWith("image/png")) {
      throw new Error(`VWorld static map HTTP ${upstream.status}`);
    }
    const image = Buffer.from(await upstream.arrayBuffer());
    if (image.length < 8 || image.length > 8 * 1024 * 1024 || image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      throw new Error("VWorld static map response is not a valid PNG");
    }
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": image.length,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(image);
  } catch (error) {
    console.error("필지 부근 이미지 연결 실패:", error.message);
    writeJson(response, 502, {error: "필지 부근 이미지를 불러오지 못했습니다."});
  }
}

async function fetchParcelFeature(fetchImpl, config, longitude, latitude, pnu = "") {
  const datasets = ["LP_PA_CBND_BUBUN", "LP_PA_CBND_BONBUN"];
  const settled = await Promise.allSettled(datasets.map(async (dataset) => {
    const target = new URL("https://api.vworld.kr/req/data");
    Object.entries({
      service: "data",
      request: "GetFeature",
      data: dataset,
      size: "10",
      page: "1",
      format: "json",
      geometry: "true",
      attribute: "true",
      crs: "EPSG:4326",
      geomFilter: `POINT(${longitude} ${latitude})`,
      key: config.vworldApiKey,
      domain: config.vworldDomain
    }).forEach(([key, value]) => target.searchParams.set(key, value));
    const payload = await fetchJson(fetchImpl, target, {
      headers: {"Accept": "application/json", "Referer": `https://${config.vworldDomain}/`, "User-Agent": "TojiIyongHannun/1.0"},
      signal: AbortSignal.timeout(12000)
    });
    const features = payload?.response?.result?.featureCollection?.features || [];
    const feature = pnu
      ? features.find((item) => String(item?.properties?.pnu || "") === pnu)
      : features.find((item) => isValidPnu(String(item?.properties?.pnu || "")));
    return feature?.geometry ? {dataset, feature} : null;
  }));
  return settled.find((result) => result.status === "fulfilled" && result.value)?.value || null;
}

async function handleParcelGeometry(response, incomingUrl, fetchImpl, getConfig) {
  const pnu = String(incomingUrl.searchParams.get("pnu") || "");
  const longitude = Number(incomingUrl.searchParams.get("x"));
  const latitude = Number(incomingUrl.searchParams.get("y"));
  if (!isValidPnu(pnu) || !isValidKoreaCoordinate(longitude, latitude)) {
    writeJson(response, 400, {error: "유효한 PNU와 국내 필지 좌표가 필요합니다."});
    return;
  }
  try {
    const result = await fetchParcelFeature(fetchImpl, getConfig(), longitude, latitude, pnu);
    if (!result) {
      writeJson(response, 404, {error: "선택한 필지의 경계를 찾지 못했습니다."});
      return;
    }
    writeJson(response, 200, result, "private, max-age=86400");
  } catch (error) {
    console.error("필지 경계 연결 실패:", error.message);
    writeJson(response, 502, {error: "선택한 필지의 경계를 불러오지 못했습니다."});
  }
}

async function handleParcelAtPoint(response, incomingUrl, fetchImpl, getConfig) {
  const longitude = Number(incomingUrl.searchParams.get("x"));
  const latitude = Number(incomingUrl.searchParams.get("y"));
  if (!isValidKoreaCoordinate(longitude, latitude)) {
    writeJson(response, 400, {error: "국내 지도 좌표가 필요합니다."});
    return;
  }
  try {
    const result = await fetchParcelFeature(fetchImpl, getConfig(), longitude, latitude);
    if (!result) {
      writeJson(response, 404, {error: "이 위치에서 필지를 찾지 못했습니다."});
      return;
    }
    const properties = result.feature.properties || {};
    const pnu = String(properties.pnu || "");
    const parcelAddress = String(properties.addr || properties.jibun || "선택한 필지").trim();
    writeJson(response, 200, {
      ...result,
      item: {
        pnu,
        primaryAddress: parcelAddress,
        parcelAddress,
        roadAddress: "",
        buildingName: "",
        matchTypes: ["parcel"],
        longitude,
        latitude
      }
    }, "private, max-age=3600");
  } catch (error) {
    console.error("지도 필지 선택 연결 실패:", error.message);
    writeJson(response, 502, {error: "지도에서 필지를 확인하지 못했습니다."});
  }
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

async function handleBuildings(response, incomingUrl, fetchImpl, getConfig) {
  const pnu = String(incomingUrl.searchParams.get("pnu") || "");
  if (!isValidPnu(pnu)) {
    writeJson(response, 400, {error: "19자리 PNU가 필요합니다."});
    return;
  }
  try {
    const config = getConfig();
    const target = new URL("https://api.vworld.kr/ned/data/getBuildingUse");
    Object.entries({pnu, pageNo: "1", numOfRows: "100", format: "json", key: config.vworldApiKey, domain: config.vworldDomain})
      .forEach(([key, value]) => target.searchParams.set(key, value));
    const payload = await fetchJson(fetchImpl, target, {
      headers: {"Accept": "application/json", "Referer": `https://${config.vworldDomain}/`, "User-Agent": "TojiIyongHannun/1.0"},
      signal: AbortSignal.timeout(12000)
    });
    writeJson(response, 200, {items: normalizeBuildingRecords(payload)}, "private, max-age=3600");
  } catch (error) {
    console.error("건축물 공개정보 연결 실패:", error.message);
    writeJson(response, 502, {error: "건축물 공개정보를 불러오지 못했습니다."});
  }
}

async function handleLandRegister(response, incomingUrl, fetchImpl, getConfig) {
  const pnu = String(incomingUrl.searchParams.get("pnu") || "");
  if (!isValidPnu(pnu)) {
    writeJson(response, 400, {error: "19자리 PNU가 필요합니다."});
    return;
  }
  try {
    const config = getConfig();
    const target = new URL("https://api.vworld.kr/ned/data/ladfrlList");
    Object.entries({pnu, pageNo: "1", numOfRows: "10", format: "json", key: config.vworldApiKey, domain: config.vworldDomain})
      .forEach(([key, value]) => target.searchParams.set(key, value));
    const payload = await fetchJson(fetchImpl, target, {
      headers: {"Accept": "application/json", "Referer": `https://${config.vworldDomain}/`, "User-Agent": "TojiIyongHannun/1.0"},
      signal: AbortSignal.timeout(12000)
    });
    writeJson(response, 200, {record: normalizeLandRegisterRecord(payload)}, "private, max-age=3600");
  } catch (error) {
    console.error("토지대장 공개정보 연결 실패:", error.message);
    writeJson(response, 502, {error: "토지대장 공개정보를 불러오지 못했습니다."});
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
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'self' https://cdn.jsdelivr.net https://api.vworld.kr; img-src 'self' data: blob: https://xdworld.vworld.kr https://api.vworld.kr; connect-src 'self' https://xdworld.vworld.kr https://api.vworld.kr https://www.eum.go.kr https://apis.data.go.kr; frame-src 'self' blob: https://irts.molit.go.kr https://www.eum.go.kr https://urban.seoul.go.kr https://blcm.go.kr; base-uri 'none'; form-action 'self' https://www.eum.go.kr https://irts.molit.go.kr; frame-ancestors 'none'",
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
    if (incomingUrl.pathname === "/runtime-config.js") {
      writeRuntimeConfig(response, getConfig);
      return;
    }
    if (incomingUrl.pathname === "/api/land-use") {
      await handleLandUse(response, incomingUrl, fetchImpl, getConfig);
      return;
    }
    if (incomingUrl.pathname === "/api/buildings") {
      await handleBuildings(response, incomingUrl, fetchImpl, getConfig);
      return;
    }
    if (incomingUrl.pathname === "/api/land-register") {
      await handleLandRegister(response, incomingUrl, fetchImpl, getConfig);
      return;
    }
    if (incomingUrl.pathname === "/api/vicinity-map") {
      await handleVicinityMap(response, incomingUrl, fetchImpl, getConfig);
      return;
    }
    if (incomingUrl.pathname === "/api/parcel-geometry") {
      await handleParcelGeometry(response, incomingUrl, fetchImpl, getConfig);
      return;
    }
    if (incomingUrl.pathname === "/api/parcel-at-point") {
      await handleParcelAtPoint(response, incomingUrl, fetchImpl, getConfig);
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
