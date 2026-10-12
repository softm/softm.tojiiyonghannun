export const TRANSACTION_TYPES = Object.freeze({
  land: {
    label: "토지",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade",
    areaKind: "토지면적"
  },
  apartment: {
    label: "아파트",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
    areaKind: "전용면적"
  },
  officetel: {
    label: "오피스텔",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade",
    areaKind: "전용면적"
  },
  rowHouse: {
    label: "연립·다세대",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade",
    areaKind: "전용면적"
  },
  detached: {
    label: "단독·다가구",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade",
    areaKind: "연면적"
  },
  commercial: {
    label: "상업·업무",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade",
    areaKind: "건물면적"
  },
  factory: {
    label: "공장·창고",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcInduTrade/getRTMSDataSvcInduTrade",
    areaKind: "연면적"
  }
});

export function recommendTransactionType({buildingName = "", buildings} = {}) {
  const hasBuildingData = Array.isArray(buildings);
  const buildingItems = hasBuildingData ? buildings : [];
  const description = [
    hasBuildingData && !buildingItems.length ? "" : buildingName,
    ...buildingItems.flatMap((building) => [building?.name, building?.dongName, building?.use])
  ].filter(Boolean).join(" ");

  if (/공장|창고|제조소|산업시설/i.test(description)) return "factory";
  if (/오피스텔/i.test(description)) return "officetel";
  if (/연립|다세대|빌라/i.test(description)) return "rowHouse";
  if (/단독|다가구|다중주택/i.test(description)) return "detached";
  if (/아파트|공동주택/i.test(description)) return "apartment";
  if (/상가|근린생활|판매시설|업무시설|타워|플라자|센터|숙박시설|위락시설/i.test(description)) return "commercial";
  return description && !hasBuildingData ? "apartment" : "land";
}

const FIELD_ALIASES = Object.freeze({
  amount: ["dealAmount", "거래금액"],
  year: ["dealYear", "년"],
  month: ["dealMonth", "월"],
  day: ["dealDay", "일"],
  legalDong: ["umdNm", "법정동"],
  jibun: ["jibun", "지번"],
  buildingName: ["aptNm", "offiNm", "mhouseNm", "houseType", "buildingNm", "아파트", "단지", "연립다세대", "주택유형", "건물명"],
  exclusiveArea: ["excluUseAr", "excluUseArea", "전용면적"],
  landArea: ["dealArea", "landAr", "plottageAr", "대지면적", "토지면적", "거래면적"],
  buildingArea: ["totalFloorAr", "buildArea", "buildingAr", "연면적", "건물면적"],
  floor: ["floor", "층"],
  landCategory: ["landUse", "landCategory", "지목"],
  useRegion: ["useArea", "용도지역"],
  mainUse: ["buildingUse", "mainPurpsCdNm", "주용도"],
  cancellationDate: ["cdealDay", "해제사유발생일"],
  cancellationType: ["cdealType", "해제여부"],
  dealType: ["dealingGbn", "거래유형"]
});

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function readTag(xml, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(xml).match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
    if (match) return decodeXml(match[1]);
  }
  return "";
}

function numberValue(value) {
  const number = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function integerValue(value) {
  return Math.trunc(numberValue(value));
}

function normalizeJibun(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  const mountain = /^산\s*/.test(text);
  const match = text.replace(/^산\s*/, "").match(/(\d+)(?:-(\d+))?/);
  if (!match) return text.replace(/\s+/g, "");
  const main = String(Number(match[1]));
  const sub = Number(match[2] || 0);
  return `${mountain ? "산" : ""}${main}${sub ? `-${sub}` : ""}`;
}

function pickArea(raw, type) {
  const definition = TRANSACTION_TYPES[type];
  const exclusiveArea = numberValue(readTag(raw, FIELD_ALIASES.exclusiveArea));
  const landArea = numberValue(readTag(raw, FIELD_ALIASES.landArea));
  const buildingArea = numberValue(readTag(raw, FIELD_ALIASES.buildingArea));
  if (["apartment", "officetel", "rowHouse"].includes(type)) return exclusiveArea || buildingArea || landArea;
  if (type === "land") return landArea || buildingArea || exclusiveArea;
  return buildingArea || landArea || exclusiveArea || (definition ? 0 : exclusiveArea);
}

function normalizeItem(raw, type) {
  const amount = numberValue(readTag(raw, FIELD_ALIASES.amount));
  const area = pickArea(raw, type);
  const year = integerValue(readTag(raw, FIELD_ALIASES.year));
  const month = integerValue(readTag(raw, FIELD_ALIASES.month));
  const day = integerValue(readTag(raw, FIELD_ALIASES.day));
  const cancellationDate = readTag(raw, FIELD_ALIASES.cancellationDate);
  const cancellationType = readTag(raw, FIELD_ALIASES.cancellationType);
  const cancelled = Boolean(cancellationDate || /^(?:O|Y|1|해제)$/i.test(cancellationType));
  return {
    type,
    legalDong: readTag(raw, FIELD_ALIASES.legalDong),
    jibun: readTag(raw, FIELD_ALIASES.jibun),
    normalizedJibun: normalizeJibun(readTag(raw, FIELD_ALIASES.jibun)),
    buildingName: readTag(raw, FIELD_ALIASES.buildingName),
    contractDate: year && month ? `${year}-${String(month).padStart(2, "0")}-${String(day || 1).padStart(2, "0")}` : "",
    yearMonth: year && month ? `${year}${String(month).padStart(2, "0")}` : "",
    amount,
    area,
    unitPrice: amount > 0 && area > 0 ? amount * 10000 / area : 0,
    floor: readTag(raw, FIELD_ALIASES.floor),
    landCategory: readTag(raw, FIELD_ALIASES.landCategory),
    useRegion: readTag(raw, FIELD_ALIASES.useRegion),
    mainUse: readTag(raw, FIELD_ALIASES.mainUse),
    dealType: readTag(raw, FIELD_ALIASES.dealType),
    cancelled,
    cancellationDate
  };
}

export function parcelIdentity(pnu) {
  const value = String(pnu || "");
  if (!/^\d{19}$/.test(value)) throw new Error("19자리 PNU가 필요합니다.");
  const mountain = value[10] === "2";
  const main = Number(value.slice(11, 15));
  const sub = Number(value.slice(15, 19));
  const jibun = `${mountain ? "산 " : ""}${main}${sub ? `-${sub}` : ""}`;
  return {
    lawdCd: value.slice(0, 5),
    legalDongCode: value.slice(0, 10),
    mountain,
    main,
    sub,
    jibun,
    normalizedJibun: normalizeJibun(jibun)
  };
}

export function recentMonths(count = 24, now = new Date()) {
  const months = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    months.push(`${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export function parseTransactionXml(xml, type) {
  if (!TRANSACTION_TYPES[type]) throw new Error("지원하지 않는 거래 유형입니다.");
  const resultCode = readTag(xml, ["resultCode", "returnReasonCode"]);
  const resultMessage = readTag(xml, ["resultMsg", "returnAuthMsg", "errMsg"]);
  const totalCount = integerValue(readTag(xml, ["totalCount"]));
  const items = [...String(xml || "").matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
    .map((match) => normalizeItem(match[1], type))
    .filter((item) => item.amount > 0 || item.contractDate || item.jibun);
  return {resultCode, resultMessage, totalCount: totalCount || items.length, items};
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function selectedAreaValue(area) {
  return numberValue(String(area || "").replace(/,/g, ""));
}

function sameLegalDong(item, parcelAddress) {
  return !item.legalDong || !parcelAddress || String(parcelAddress).includes(item.legalDong);
}

export function analyzeTransactions(items, {type, pnu, parcelAddress = "", selectedArea = 0} = {}) {
  const identity = parcelIdentity(pnu);
  const valid = items.filter((item) => !item.cancelled && item.amount > 0);
  const cancelledCount = items.filter((item) => item.cancelled).length;
  const exact = valid.filter((item) => item.normalizedJibun && item.normalizedJibun === identity.normalizedJibun && sameLegalDong(item, parcelAddress));
  const targetArea = selectedAreaValue(selectedArea);
  const areaComparable = type === "land" && targetArea > 0
    ? valid.filter((item) => item.area >= targetArea * .5 && item.area <= targetArea * 2 && sameLegalDong(item, parcelAddress))
    : valid.filter((item) => sameLegalDong(item, parcelAddress));
  const comparable = exact.length ? exact : areaComparable;
  const scope = exact.length ? "exact" : "nearby";
  const ordered = [...comparable].sort((a, b) => b.contractDate.localeCompare(a.contractDate));
  const amounts = ordered.map((item) => item.amount);
  const unitPrices = ordered.map((item) => item.unitPrice).filter(Boolean);
  const trendMap = new Map();
  ordered.forEach((item) => {
    if (!item.yearMonth || !item.unitPrice) return;
    const values = trendMap.get(item.yearMonth) || [];
    values.push(item.unitPrice);
    trendMap.set(item.yearMonth, values);
  });
  const trend = [...trendMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, values]) => ({month, medianUnitPrice: median(values), count: values.length}));
  return {
    type,
    scope,
    totalCount: ordered.length,
    cancelledCount,
    latestDate: ordered[0]?.contractDate || "",
    medianAmount: median(amounts),
    medianUnitPrice: median(unitPrices),
    minUnitPrice: unitPrices.length ? Math.min(...unitPrices) : 0,
    maxUnitPrice: unitPrices.length ? Math.max(...unitPrices) : 0,
    trend,
    items: ordered
  };
}

export function cacheTtlForMonth(month, now = new Date()) {
  const recent = new Set(recentMonths(2, now));
  return recent.has(String(month)) ? 6 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
}

export function pruneCacheRecords(records, limit = 200) {
  return [...records].sort((a, b) => Number(b.storedAt || 0) - Number(a.storedAt || 0)).slice(0, limit);
}

export async function runWithConcurrency(tasks, limit, onSettled = () => {}) {
  const results = new Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = {status: "fulfilled", value: await tasks[index]()};
      } catch (reason) {
        results[index] = {status: "rejected", reason};
      }
      onSettled(results[index], index);
    }
  }
  await Promise.all(Array.from({length: Math.min(Math.max(1, limit), tasks.length)}, () => worker()));
  return results;
}
