import * as cheerio from "cheerio";

export const EUM_DETAIL_URL = "https://www.eum.go.kr/web/ar/lu/luLandDet.jsp";

export function isValidPnu(value) {
  return /^\d{19}$/.test(String(value || ""));
}

export function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function buildEumLandUseParams(pnu) {
  if (!isValidPnu(pnu)) throw new TypeError("19자리 PNU가 필요합니다.");
  return new URLSearchParams({
    selGbn: "umd",
    isNoScr: "script",
    s_type: "1",
    viewType: "",
    p_location: "",
    p_type: "",
    p_type1: "",
    p_type2: "",
    p_type3: "",
    p_type4: "",
    p_type5: "",
    p_type6: "",
    p_type7: "",
    mode: "search",
    sggcd: "",
    pnu,
    ucodes: "",
    markUcodes: "",
    adzoom: "",
    scale: "",
    scaleFlag: "",
    hash: "",
    mobile_yn: "",
    add: "land",
    selSido: pnu.slice(0, 2),
    selSgg: pnu.slice(2, 5),
    selUmd: pnu.slice(4, 8),
    selRi: pnu.slice(8, 10),
    landGbn: pnu.slice(10, 11),
    bobn: String(Number(pnu.slice(11, 15))),
    bubn: String(Number(pnu.slice(15, 19)))
  });
}

export function buildOfficialUrl(pnu) {
  const params = buildEumLandUseParams(pnu);
  const url = new URL(EUM_DETAIL_URL);
  ["add", "isNoScr", "mode", "pnu", "s_type", "selGbn", "landGbn", "bobn", "bubn"].forEach((key) => {
    url.searchParams.set(key, params.get(key) || "");
  });
  return url.toString();
}

export function normalizeSearchItems(payload, category) {
  const response = payload?.response;
  if (response?.status && !["OK", "NOT_FOUND"].includes(response.status)) {
    throw new Error(response?.error?.text || response.status);
  }
  return (response?.result?.items || []).flatMap((item) => {
    const pnu = String(item?.id || "");
    if (!isValidPnu(pnu)) return [];
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
  const response = payload?.response;
  if (response?.status && !["OK", "NOT_FOUND"].includes(response.status)) {
    throw new Error(response?.error?.text || response.status);
  }
  const candidates = (response?.result?.items || []).flatMap((item) => {
    const parcelAddress = cleanText(item?.address?.parcel);
    const roadAddress = cleanText(item?.address?.road);
    const title = cleanText(item?.title);
    const longitude = Number(item?.point?.x);
    const latitude = Number(item?.point?.y);
    if (!title || (!parcelAddress && !roadAddress)) return [];
    return [{
      placeId: cleanText(item?.id),
      title,
      category: cleanText(item?.category),
      primaryAddress: parcelAddress || roadAddress,
      parcelAddress,
      roadAddress,
      longitude: Number.isFinite(longitude) ? longitude : null,
      latitude: Number.isFinite(latitude) ? latitude : null
    }];
  });
  return candidates.filter((item, index, items) => items.findIndex((candidate) => candidate.primaryAddress === item.primaryAddress) === index).slice(0, 6);
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

function parseZoneGroup($, selector, category) {
  const container = $(selector).first();
  if (!container.length) return [];
  const linked = [];
  container.children("a.link").each((_, node) => {
    const link = $(node);
    const name = cleanText(link.text());
    if (!name) return;
    const onclick = link.attr("onclick") || "";
    const code = onclick.match(/live_layer_([A-Z0-9]+)/)?.[1] || "";
    const description = cleanText(link.nextAll(".layer_pop").first().find(".layer_body strong").first().text());
    linked.push({category, code, name, description});
  });

  const clone = container.clone();
  clone.find(".layer_pop, input, script, style").remove();
  const linkedNames = new Set(linked.map((item) => item.name));
  const plain = cleanText(clone.text()).split(/\s*,\s*/).map(cleanText).filter(Boolean)
    .filter((name) => !linkedNames.has(name))
    .map((name) => ({category, code: "", name, description: ""}));
  return [...linked, ...plain].filter((item, index, items) => items.findIndex((candidate) => candidate.name === item.name) === index);
}

export function parseEumLandUseHtml(html, expectedPnu) {
  const $ = cheerio.load(String(html || ""));
  const responsePnu = String($("#pnu").val() || "");
  if (responsePnu !== expectedPnu) throw new Error("토지이음 조회 결과의 PNU가 일치하지 않습니다.");

  const addressCell = $("#present_addr").parent().clone();
  addressCell.find("#present_addr, script, style").remove();
  const nationalPlan = parseZoneGroup($, "#present_mark1", "국토계획법");
  const otherLaws = parseZoneGroup($, "#present_mark2", "다른 법령");
  const decreeText = cleanText($("#present_mark3").text());
  const decree = decreeText ? [{category: "토지이용규제법 시행령", code: "", name: decreeText, description: ""}] : [];
  const restrictions = [];

  $("#act_content .act_contxt").each((_, groupNode) => {
    const group = $(groupNode);
    const zone = cleanText(group.children(".title").first().text());
    const rules = [];
    group.children("p").each((__, rowNode) => {
      const row = $(rowNode);
      const law = cleanText(row.find("strong").first().text());
      const article = cleanText(row.find("a.link").first().text())
        .replace(/근거법령\s*접기펴기.*$/, "")
        .replace(law, "")
        .trim();
      const subject = cleanText(row.find(".mblock").first().text()).replace(/^\(|\)$/g, "");
      if (law || article || subject) rules.push({law, article, subject});
    });
    if (zone && rules.length) restrictions.push({zone, rules});
  });

  return {
    pnu: expectedPnu,
    address: cleanText(addressCell.text()),
    landCategory: cleanText($("#present_class_val").val() || $("#present_class").clone().find(".ico_q").remove().end().text()),
    area: cleanText($("#present_area").text()),
    price: null,
    priceYear: "",
    nationalPlan,
    otherLaws,
    decree,
    restrictions,
    officialUrl: buildOfficialUrl(expectedPnu)
  };
}

export function normalizePricePayload(payload) {
  const field = payload?.indvdLandPrices?.field;
  const rows = Array.isArray(field) ? field : field ? [field] : [];
  const latest = [...rows].sort((a, b) => {
    const aKey = `${a?.stdrYear || ""}${a?.stdrMt || ""}${a?.lastUpdtDt || ""}`;
    const bKey = `${b?.stdrYear || ""}${b?.stdrMt || ""}${b?.lastUpdtDt || ""}`;
    return bKey.localeCompare(aKey);
  })[0];
  const amount = Number(latest?.pblntfPclnd || 0);
  return {
    price: Number.isFinite(amount) && amount > 0 ? amount : null,
    priceYear: cleanText(latest?.stdrYear)
  };
}
