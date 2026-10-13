import {normalizeBuildingRecords, normalizeLandRegisterRecord} from "./property-documents.js?v=20261013-17";

const PRODUCTION_HOST = "tojiiyonghannun.designboard.net";
// VWorld 브라우저 키는 등록된 운영 도메인에서만 사용하는 공개 클라이언트 식별자다.
const VWORLD_BROWSER_KEY = "97B1FE7B-CE7B-4F22-9718-B71DFA7B5685";
const EUM_DETAIL_URL = "https://www.eum.go.kr/web/ar/lu/luLandDet.jsp";
const VWORLD_API_URL = "https://api.vworld.kr";

let jsonpSequence = 0;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validPnu(value) {
  return /^\d{19}$/.test(String(value || ""));
}

function validKoreaCoordinate(longitude, latitude) {
  return Number.isFinite(Number(longitude)) && Number.isFinite(Number(latitude))
    && Number(longitude) >= 124 && Number(longitude) <= 132
    && Number(latitude) >= 33 && Number(latitude) <= 39;
}

export function usesDirectBrowserApi(location = window.location) {
  return location.hostname === PRODUCTION_HOST || location.hostname.endsWith(".github.io");
}

function currentDomain() {
  return window.location.hostname;
}

function vworldUrl(pathname, params = {}) {
  const target = new URL(pathname, VWORLD_API_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") target.searchParams.set(key, String(value));
  });
  target.searchParams.set("key", VWORLD_BROWSER_KEY);
  target.searchParams.set("domain", currentDomain());
  return target;
}

function abortError() {
  return new DOMException("요청이 취소되었습니다.", "AbortError");
}

function fetchJsonp(target, {signal, timeout = 12000} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const callbackName = `tojiIyongHannunVWorld${Date.now()}${jsonpSequence += 1}`;
    const script = document.createElement("script");
    let timer;
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      script.remove();
      delete window[callbackName];
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => finish(reject, abortError());
    window[callbackName] = (payload) => finish(resolve, payload);
    script.onerror = () => finish(reject, new Error("VWorld 연결에 실패했습니다. 인증키의 서비스 URL을 확인해 주세요."));
    timer = window.setTimeout(() => finish(reject, new DOMException("VWorld 요청 시간이 초과되었습니다.", "TimeoutError")), timeout);
    signal?.addEventListener("abort", onAbort, {once: true});
    target.searchParams.set("callback", callbackName);
    script.src = target.toString();
    document.head.append(script);
  });
}

async function fetchLocalJson(url, signal) {
  const response = await fetch(url, {headers: {Accept: "application/json"}, signal});
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "요청을 처리하지 못했습니다.");
  return payload;
}

function assertVworldResponse(payload) {
  const response = payload?.response;
  if (response?.status && !["OK", "NOT_FOUND"].includes(response.status)) {
    throw new Error(response?.error?.text || "VWorld 요청을 처리하지 못했습니다.");
  }
  return payload;
}

export function normalizeSearchItems(payload, category) {
  assertVworldResponse(payload);
  return (payload?.response?.result?.items || []).flatMap((item) => {
    const pnu = String(item?.id || "");
    if (!validPnu(pnu)) return [];
    const roadAddress = cleanText(item?.address?.road);
    const parcelAddress = cleanText(item?.address?.parcel);
    const buildingName = cleanText(item?.address?.bldnm || item?.title);
    const longitude = Number(item?.point?.x);
    const latitude = Number(item?.point?.y);
    return [{
      pnu,
      matchTypes: [category],
      primaryAddress: category === "parcel" ? parcelAddress || roadAddress : roadAddress || parcelAddress,
      roadAddress,
      parcelAddress,
      buildingName,
      longitude: Number.isFinite(longitude) ? longitude : null,
      latitude: Number.isFinite(latitude) ? latitude : null
    }];
  });
}

export function normalizePlaceCandidates(payload) {
  assertVworldResponse(payload);
  const candidates = (payload?.response?.result?.items || []).flatMap((item) => {
    const parcelAddress = cleanText(item?.address?.parcel);
    const roadAddress = cleanText(item?.address?.road);
    const title = cleanText(item?.title);
    const longitude = Number(item?.point?.x);
    const latitude = Number(item?.point?.y);
    if (!title || (!parcelAddress && !roadAddress)) return [];
    return [{
      title,
      parcelAddress,
      roadAddress,
      longitude: Number.isFinite(longitude) ? longitude : null,
      latitude: Number.isFinite(latitude) ? latitude : null
    }];
  });
  return candidates.filter((item, index, items) => items.findIndex((candidate) => candidate.parcelAddress === item.parcelAddress && candidate.roadAddress === item.roadAddress) === index).slice(0, 6);
}

export function mergeSearchItems(groups) {
  const merged = new Map();
  groups.flat().forEach((item) => {
    const current = merged.get(item.pnu);
    if (!current) {
      merged.set(item.pnu, {...item});
      return;
    }
    current.matchTypes = [...new Set([...current.matchTypes, ...item.matchTypes])];
    current.roadAddress ||= item.roadAddress;
    current.parcelAddress ||= item.parcelAddress;
    current.buildingName ||= item.buildingName;
    current.longitude ??= item.longitude;
    current.latitude ??= item.latitude;
    current.primaryAddress = current.parcelAddress || current.roadAddress || item.primaryAddress;
  });
  return [...merged.values()].slice(0, 15);
}

function searchVworld(query, type, category, signal) {
  return fetchJsonp(vworldUrl("/req/search", {
    service: "search",
    request: "search",
    version: "2.0",
    crs: "EPSG:4326",
    size: "10",
    page: "1",
    query,
    type,
    category,
    format: "json",
    errorformat: "json"
  }), {signal}).then(assertVworldResponse);
}

async function resolvePlaceCandidate(candidate, signal) {
  const queries = [candidate.parcelAddress, candidate.roadAddress].filter(Boolean);
  for (const address of queries) {
    for (const category of ["parcel", "road"]) {
      const payload = await searchVworld(address, "address", category, signal);
      const matches = normalizeSearchItems(payload, category);
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
  throw new Error("건물명과 연결된 필지를 찾지 못했습니다.");
}

async function directAddressSearch(query, signal) {
  const settled = await Promise.allSettled([
    searchVworld(query, "address", "road", signal),
    searchVworld(query, "address", "parcel", signal),
    searchVworld(query, "place", "", signal)
  ]);
  if (signal?.aborted) throw abortError();
  const addressResults = settled.slice(0, 2).flatMap((result, index) => result.status === "fulfilled"
    ? [normalizeSearchItems(result.value, index === 0 ? "road" : "parcel")]
    : []);
  const placeCandidates = settled[2].status === "fulfilled" ? normalizePlaceCandidates(settled[2].value) : [];
  const resolvedPlaces = await Promise.allSettled(placeCandidates.map((candidate) => resolvePlaceCandidate(candidate, signal)));
  const placeResults = resolvedPlaces.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (!addressResults.length && settled[2].status === "rejected") {
    throw new Error("주소 검색 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return {
    items: mergeSearchItems([...addressResults, placeResults]),
    partial: addressResults.length < 2 || settled[2].status === "rejected"
  };
}

export async function requestAddressSearch(query, signal) {
  const normalized = cleanText(query);
  if (normalized.length < 2 || normalized.length > 100) throw new Error("주소나 지번을 2~100자로 입력해 주세요.");
  if (!usesDirectBrowserApi()) return fetchLocalJson(`/api/address-search?q=${encodeURIComponent(normalized)}`, signal);
  return directAddressSearch(normalized, signal);
}

async function directParcelFeature(longitude, latitude, {pnu = "", signal} = {}) {
  if (!validKoreaCoordinate(longitude, latitude)) throw new Error("국내 지도 좌표가 필요합니다.");
  const datasets = ["LP_PA_CBND_BUBUN", "LP_PA_CBND_BONBUN"];
  const settled = await Promise.allSettled(datasets.map(async (dataset) => {
    const payload = assertVworldResponse(await fetchJsonp(vworldUrl("/req/data", {
      service: "data",
      request: "GetFeature",
      data: dataset,
      size: "10",
      page: "1",
      format: "json",
      geometry: "true",
      attribute: "true",
      crs: "EPSG:4326",
      geomFilter: `POINT(${longitude} ${latitude})`
    }), {signal}));
    const features = payload?.response?.result?.featureCollection?.features || [];
    const feature = pnu
      ? features.find((item) => String(item?.properties?.pnu || "") === pnu)
      : features.find((item) => validPnu(item?.properties?.pnu));
    return feature?.geometry ? {dataset, feature} : null;
  }));
  if (signal?.aborted) throw abortError();
  return settled.find((result) => result.status === "fulfilled" && result.value)?.value || null;
}

export async function requestParcelGeometry(item, signal) {
  const params = new URLSearchParams({pnu: item.pnu, x: String(item.longitude), y: String(item.latitude)});
  if (!usesDirectBrowserApi()) return fetchLocalJson(`/api/parcel-geometry?${params}`, signal);
  if (!validPnu(item.pnu)) throw new Error("19자리 PNU가 필요합니다.");
  const result = await directParcelFeature(item.longitude, item.latitude, {pnu: item.pnu, signal});
  if (!result) throw new Error("선택한 필지의 경계를 찾지 못했습니다.");
  return result;
}

export async function requestParcelAtPoint(longitude, latitude, signal) {
  const params = new URLSearchParams({x: String(longitude), y: String(latitude)});
  if (!usesDirectBrowserApi()) return fetchLocalJson(`/api/parcel-at-point?${params}`, signal);
  const result = await directParcelFeature(longitude, latitude, {signal});
  if (!result) throw new Error("이 위치에서 필지를 찾지 못했습니다.");
  const properties = result.feature.properties || {};
  const pnu = String(properties.pnu || "");
  const parcelAddress = cleanText(properties.addr || properties.jibun || "선택한 필지");
  return {
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
  };
}

function buildEumParams(pnu) {
  if (!validPnu(pnu)) throw new Error("19자리 PNU가 필요합니다.");
  return new URLSearchParams({
    selGbn: "umd", isNoScr: "script", s_type: "1", viewType: "", p_location: "",
    p_type: "", p_type1: "", p_type2: "", p_type3: "", p_type4: "", p_type5: "", p_type6: "", p_type7: "",
    mode: "search", sggcd: "", pnu, ucodes: "", markUcodes: "", adzoom: "", scale: "", scaleFlag: "", hash: "",
    mobile_yn: "", add: "land", selSido: pnu.slice(0, 2), selSgg: pnu.slice(2, 5), selUmd: pnu.slice(4, 8),
    selRi: pnu.slice(8, 10), landGbn: pnu.slice(10, 11), bobn: String(Number(pnu.slice(11, 15))), bubn: String(Number(pnu.slice(15, 19)))
  });
}

function officialUrl(pnu) {
  const params = buildEumParams(pnu);
  const target = new URL(EUM_DETAIL_URL);
  ["add", "isNoScr", "mode", "pnu", "s_type", "selGbn", "landGbn", "bobn", "bubn"].forEach((key) => target.searchParams.set(key, params.get(key) || ""));
  return target.toString();
}

async function fetchTextWithTimeout(url, options, signal, timeout = 22000) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  signal?.addEventListener("abort", onAbort, {once: true});
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function fetchEumHtml(pnu, signal) {
  const response = await fetchTextWithTimeout(EUM_DETAIL_URL, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: buildEumParams(pnu)
  }, signal);
  if (!response.ok) throw new Error(`토지이음 HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const charset = /euc-kr/i.test(response.headers.get("content-type") || "") ? "euc-kr" : "utf-8";
  return new TextDecoder(charset).decode(bytes);
}

function parseZoneGroup(documentNode, selector, category) {
  const container = documentNode.querySelector(selector);
  if (!container) return [];
  const linked = [...container.children].filter((node) => node.matches?.("a.link")).map((link) => {
    let layer = link.nextElementSibling;
    while (layer && !layer.classList.contains("layer_pop")) layer = layer.nextElementSibling;
    return {
      category,
      code: link.getAttribute("onclick")?.match(/live_layer_([A-Z0-9]+)/)?.[1] || "",
      name: cleanText(link.textContent),
      description: cleanText(layer?.querySelector(".layer_body strong")?.textContent)
    };
  }).filter((item) => item.name);
  const clone = container.cloneNode(true);
  clone.querySelectorAll(".layer_pop, input, script, style").forEach((node) => node.remove());
  const plain = cleanText(clone.textContent).split(/\s*,\s*/).map(cleanText).filter(Boolean)
    .filter((name) => !linked.some((item) => item.name === name))
    .map((name) => ({category, code: "", name, description: ""}));
  return [...linked, ...plain].filter((item, index, items) => items.findIndex((candidate) => candidate.name === item.name) === index);
}

function parseEumHtml(html, pnu) {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  if (documentNode.querySelector("#pnu")?.value !== pnu) throw new Error("토지이음 조회 결과의 PNU가 일치하지 않습니다.");
  const addressCell = documentNode.querySelector("#present_addr")?.parentElement?.cloneNode(true);
  addressCell?.querySelectorAll("#present_addr, script, style").forEach((node) => node.remove());
  const nationalPlan = parseZoneGroup(documentNode, "#present_mark1", "국토계획법");
  const otherLaws = parseZoneGroup(documentNode, "#present_mark2", "다른 법령");
  const decreeText = cleanText(documentNode.querySelector("#present_mark3")?.textContent);
  const decree = decreeText ? [{category: "토지이용규제법 시행령", code: "", name: decreeText, description: ""}] : [];
  const restrictions = [...documentNode.querySelectorAll("#act_content .act_contxt")].map((group) => ({
    zone: cleanText(group.querySelector(":scope > .title")?.textContent),
    rules: [...group.querySelectorAll(":scope > p")].map((row) => {
      const law = cleanText(row.querySelector("strong")?.textContent);
      const article = cleanText(row.querySelector("a.link")?.textContent).replace(/근거법령\s*접기펴기.*$/, "").replace(law, "").trim();
      return {law, article, subject: cleanText(row.querySelector(".mblock")?.textContent).replace(/^\(|\)$/g, "")};
    }).filter((item) => item.law || item.article || item.subject)
  })).filter((group) => group.zone && group.rules.length);
  return {
    pnu,
    address: cleanText(addressCell?.textContent),
    landCategory: cleanText(documentNode.querySelector("#present_class_val")?.value || documentNode.querySelector("#present_class")?.textContent),
    area: cleanText(documentNode.querySelector("#present_area")?.textContent),
    nationalPlan,
    otherLaws,
    decree,
    restrictions,
    officialUrl: officialUrl(pnu)
  };
}

function normalizePrice(payload) {
  const field = payload?.indvdLandPrices?.field;
  const rows = Array.isArray(field) ? field : field ? [field] : [];
  const latest = [...rows].sort((a, b) => `${b?.stdrYear || ""}${b?.stdrMt || ""}${b?.lastUpdtDt || ""}`.localeCompare(`${a?.stdrYear || ""}${a?.stdrMt || ""}${a?.lastUpdtDt || ""}`))[0];
  const amount = Number(latest?.pblntfPclnd || 0);
  return {price: Number.isFinite(amount) && amount > 0 ? amount : null, priceYear: cleanText(latest?.stdrYear)};
}

async function directLandUse(pnu, signal) {
  const [html, priceResult] = await Promise.all([
    fetchEumHtml(pnu, signal),
    fetchJsonp(vworldUrl("/ned/data/getIndvdLandPriceAttr", {pnu, pageNo: "1", numOfRows: "100", format: "json"}), {signal})
      .then(normalizePrice).catch(() => ({price: null, priceYear: ""}))
  ]);
  const data = parseEumHtml(html, pnu);
  data.price = priceResult.price;
  data.priceYear = priceResult.priceYear;
  data.fetchedAt = new Date().toISOString();
  return {data};
}

export async function requestLandUse(pnu, signal) {
  if (!validPnu(pnu)) throw new Error("19자리 PNU가 필요합니다.");
  if (!usesDirectBrowserApi()) return fetchLocalJson(`/api/land-use?pnu=${encodeURIComponent(pnu)}`, signal);
  try {
    return await directLandUse(pnu, signal);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("현재 요약 정보를 불러오지 못했습니다. 토지이음 원문에서 직접 확인해 주세요.");
  }
}

export async function requestBuildingRecords(pnu, signal) {
  if (!validPnu(pnu)) throw new Error("19자리 PNU가 필요합니다.");
  if (!usesDirectBrowserApi()) return fetchLocalJson(`/api/buildings?pnu=${encodeURIComponent(pnu)}`, signal);
  const payload = assertVworldResponse(await fetchJsonp(vworldUrl("/ned/data/getBuildingUse", {
    pnu,
    pageNo: "1",
    numOfRows: "100",
    format: "json"
  }), {signal}));
  return {items: normalizeBuildingRecords(payload)};
}

export async function requestLandRegisterRecord(pnu, signal) {
  if (!validPnu(pnu)) throw new Error("19자리 PNU가 필요합니다.");
  if (!usesDirectBrowserApi()) return fetchLocalJson(`/api/land-register?pnu=${encodeURIComponent(pnu)}`, signal);
  const payload = await fetchJsonp(vworldUrl("/ned/data/ladfrlList", {
    pnu,
    pageNo: "1",
    numOfRows: "10",
    format: "json"
  }), {signal});
  return {record: normalizeLandRegisterRecord(payload)};
}

