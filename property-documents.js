export const PROPERTY_DOCUMENT_URLS = Object.freeze({
  building: "https://irts.molit.go.kr/usr/estate/cntc/kab/RtecsBildRegstrInfoPreview.do",
  landRegister: "https://irts.molit.go.kr/usr/estate/cntc/kab/RtecsTBookOfLandRegstrPreview.do",
  landUse: "https://irts.molit.go.kr/usr/estate/cntc/kab/RtecsLandUseOfLandRegstrPreview.do",
  eum: "https://www.eum.go.kr/web/ar/lu/luLandDet.jsp",
  districtPlan: "https://urban.seoul.go.kr/view/map/mapRegInfo.pop",
  lifecycle: "https://blcm.go.kr/lim/bldSumInfo/BldSumInfoView.do",
  landRegisterIssue: "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000026",
  cadastralMapIssue: "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000027",
  registryIssue: "https://www.iros.go.kr/"
});

export const PROPERTY_DOCUMENT_VIEWER_TARGET = "tojiiyonghannunPropertyDetails";

const PROPERTY_DOCUMENT_TABS = new Set([
  "building",
  "landRegister",
  "cadastralMap",
  "coOwnerRegister",
  "registry",
  "landUse",
  "eum",
  "districtPlan",
  "lifecycle"
]);

export function normalizePropertyDocumentTab(value) {
  const tab = String(value || "");
  return PROPERTY_DOCUMENT_TABS.has(tab) ? tab : "building";
}

export function propertyDocumentTabStorageKey(pnu) {
  const value = String(pnu || "");
  return /^\d{19}$/.test(value) ? `tojiiyonghannun.property-document-tab.v1.${value}` : "";
}

export function resolvePropertyDocumentTab(requestedTab, storedTab) {
  return normalizePropertyDocumentTab(requestedTab == null ? storedTab : requestedTab);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toRows(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

export function normalizeBuildingRecords(payload) {
  const root = payload?.buildingUses || payload?.response?.buildingUses || payload?.response || {};
  return toRows(root.field).map((item) => ({
    id: String(item?.buldIdntfcNo || "").replace(/\D/g, ""),
    ledgerKind: String(item?.agbldgSeCode || "1").replace(/\D/g, "") || "1",
    name: cleanText(item?.buldNm || item?.buldDongNm),
    dongName: cleanText(item?.buldDongNm),
    use: cleanText(item?.mainPrposCodeNm || item?.detailPrposCodeNm),
    groundFloors: Number(item?.groundFloorCo || 0),
    undergroundFloors: Number(item?.undgrndFloorCo || 0),
    buildingArea: Number(item?.buldBildngAr || 0),
    totalArea: Number(item?.buldTotar || 0),
    buildingCoverage: Number(item?.btlRt || 0),
    floorAreaRatio: Number(item?.measrmtRt || 0),
    approvalDate: String(item?.useConfmDe || ""),
    lastUpdated: String(item?.lastUpdtDt || ""),
    isMain: String(item?.buldMainAtachSeCode || "") === "0"
  })).filter((item) => /^\d{1,20}$/.test(item.id))
    .sort((left, right) => Number(right.isMain) - Number(left.isMain) || right.totalArea - left.totalArea);
}

export function normalizeLandRegisterRecord(payload) {
  const root = payload?.ladfrlVOList || payload?.response?.ladfrlVOList || payload?.response || {};
  const item = toRows(root.ladfrlVOList || root.field)[0];
  if (!item || !/^\d{19}$/.test(String(item.pnu || ""))) return null;
  const areaText = String(item.lndpclAr ?? "").trim();
  const coOwnerCountText = String(item.cnrsPsnCo ?? "").trim();
  const area = areaText ? Number(areaText) : Number.NaN;
  const coOwnerCount = coOwnerCountText ? Number(coOwnerCountText) : Number.NaN;
  const isForest = String(item.regstrSeCode || "") === "2" || String(item.pnu)[10] === "2";
  return {
    pnu: String(item.pnu),
    legalDong: cleanText(item.ldCodeNm),
    lotNumber: cleanText(item.mnnmSlno),
    ledgerType: cleanText(item.regstrSeCodeNm) || (isForest ? "임야대장" : "토지대장"),
    landCategory: cleanText(item.lndcgrCodeNm),
    area: Number.isFinite(area) && area > 0 ? area : null,
    ownershipType: cleanText(item.posesnSeCodeNm),
    coOwnerCount: Number.isFinite(coOwnerCount) && coOwnerCount >= 0 ? coOwnerCount : null,
    cadastralMapType: isForest ? "임야도" : "지적도",
    cadastralScale: cleanText(item.ladFrtlScNm),
    lastUpdated: cleanText(item.lastUpdtDt)
  };
}

export function parcelDocumentIdentity(pnu) {
  const value = String(pnu || "");
  if (!/^\d{19}$/.test(value)) throw new Error("19자리 PNU가 필요합니다.");
  const mountain = value[10] === "2";
  return {
    pnu: value,
    registryPnu: `${value.slice(0, 10)}${mountain ? "1" : "0"}${value.slice(11)}`,
    mainNumber: value.slice(11, 15),
    subNumber: value.slice(15, 19),
    displayJibun: `${mountain ? "산 " : ""}${Number(value.slice(11, 15))}${Number(value.slice(15, 19)) ? `-${Number(value.slice(15, 19))}` : ""}`
  };
}

export function buildingPostFields(pnu, building) {
  const identity = parcelDocumentIdentity(pnu);
  const id = String(building?.id || "").replace(/\D/g, "");
  if (!/^\d{1,20}$/.test(id)) throw new Error("유효한 건축물 식별번호가 필요합니다.");
  return {
    mgmBldrgstPk: id,
    regstrKindCd: String(building?.ledgerKind || "1").replace(/\D/g, "") || "1",
    pnuCode: identity.registryPnu
  };
}

export function landRegisterPostFields(pnu) {
  const identity = parcelDocumentIdentity(pnu);
  return {pnuCode: identity.registryPnu, jibunBonbun: identity.mainNumber, jibunBubun: identity.subNumber};
}

export function landUsePostFields(pnu) {
  const identity = parcelDocumentIdentity(pnu);
  return {pnuCode: identity.pnu, jibunBonbun: identity.mainNumber, jibunBubun: identity.subNumber};
}

export function buildEumLandUseUrl(pnu) {
  const identity = parcelDocumentIdentity(pnu);
  const url = new URL(PROPERTY_DOCUMENT_URLS.eum);
  url.search = new URLSearchParams({
    selSido: identity.pnu.slice(0, 2),
    selSgg: identity.pnu.slice(2, 5),
    selUmd: identity.pnu.slice(5, 8).padStart(4, "0"),
    selRi: identity.pnu.slice(8, 10),
    landGbn: identity.pnu[10],
    bobn: identity.mainNumber,
    bubn: identity.subNumber,
    pnu: identity.pnu,
    scale: "",
    isNoScr: "script",
    chk: "0",
    mode: "search",
    selGbn: "umd"
  }).toString();
  return url.toString();
}

export function buildBuildingLifecycleUrl(pnu, buildingId) {
  const identity = parcelDocumentIdentity(pnu);
  const id = String(buildingId || "").replace(/\D/g, "");
  if (id.length <= 5) return "";
  const url = new URL(PROPERTY_DOCUMENT_URLS.lifecycle);
  url.search = new URLSearchParams({
    bldrgstPk: `${identity.pnu.slice(0, 5)}-${id.slice(5)}`,
    searchPnu: identity.registryPnu,
    searchType: "B"
  }).toString();
  return url.toString();
}

export function buildDistrictPlanUrl(pnu) {
  const identity = parcelDocumentIdentity(pnu);
  if (!identity.pnu.startsWith("11")) return "";
  const url = new URL(PROPERTY_DOCUMENT_URLS.districtPlan);
  url.searchParams.set("pnu", identity.pnu);
  return url.toString();
}

export function hasDistrictPlan(data, pnu) {
  if (!String(pnu || "").startsWith("11")) return false;
  const zones = [...(data?.nationalPlan || []), ...(data?.otherLaws || []), ...(data?.decree || [])];
  return zones.some((zone) => /지구단위계획/.test(String(zone?.name || zone || "")));
}
