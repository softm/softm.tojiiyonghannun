import {buildReportModel} from "./report-model.js?v=20261013-11";
import {addHistoryItem, filterHistoryItems, parseHistory, shouldShowRecentHistory} from "./history-model.js?v=20261012-9";
import {buildParcelShareUrl, parseParcelShareUrl} from "./share-model.js?v=20261013-15";
import {TRANSACTION_TYPES, hasMolitApiKey, recommendTransactionType, requestTransactions} from "./transaction-api.js?v=20261013-11";
import {PROPERTY_DOCUMENT_VIEWER_TARGET, hasDistrictPlan} from "./property-documents.js?v=20261013-16";
import {
  requestAddressSearch,
  requestBuildingRecords,
  requestLandUse,
  requestParcelAtPoint,
  requestParcelGeometry,
  usesDirectBrowserApi
} from "./browser-api.js?v=20261012-9";

const {Map: OLMap, View, Feature} = ol;
const TileLayer = ol.layer.Tile;
const VectorLayer = ol.layer.Vector;
const XYZ = ol.source.XYZ;
const VectorSource = ol.source.Vector;
const Point = ol.geom.Point;
const GeoJSON = ol.format.GeoJSON;
const {fromLonLat, toLonLat} = ol.proj;
const Style = ol.style.Style;
const Stroke = ol.style.Stroke;
const Fill = ol.style.Fill;
const CircleStyle = ol.style.Circle;

const HISTORY_STORAGE_KEY = "tojiiyonghannun.recent-parcels.v1";

const $ = (selector) => document.querySelector(selector);

const elements = {
  form: $("#searchForm"),
  input: $("#searchInput"),
  button: $("#searchButton"),
  historyAutocomplete: $("#historyAutocomplete"),
  historyAutocompleteList: $("#historyAutocompleteList"),
  historyAutocompleteCount: $("#historyAutocompleteCount"),
  status: $("#status"),
  results: $("#searchResults"),
  resultQuery: $("#searchResultQuery"),
  resultList: $("#resultList"),
  resultCount: $("#resultCount"),
  recentHistory: $("#recentHistory"),
  historyList: $("#historyList"),
  clearHistory: $("#clearHistory"),
  lookupProgress: $("#lookupProgress"),
  lookupProgressAddress: $("#lookupProgressAddress"),
  lookupProgressValue: $("#lookupProgressValue"),
  lookupProgressBar: $("#lookupProgressBar"),
  summary: $("#summary"),
  summaryTitle: $("#summaryTitle"),
  summaryRoad: $("#summaryRoad"),
  factGrid: $("#factGrid"),
  buildingSummaryStatus: $("#buildingSummaryStatus"),
  buildingSummaryDetail: $("#buildingSummaryDetail"),
  openPropertyDocuments: $("#openPropertyDocuments"),
  propertyDocumentsLink: $("#propertyDocumentsLink"),
  landRegisterLink: $("#landRegisterLink"),
  landUseLink: $("#landUseLink"),
  transactionCard: $("#transactionCard"),
  transactionTypeTabs: $("#transactionTypeTabs"),
  transactionQueryTitle: $("#transactionQueryTitle"),
  transactionQueryHint: $("#transactionQueryHint"),
  loadTransactions: $("#loadTransactions"),
  transactionProgress: $("#transactionProgress"),
  transactionProgressText: $("#transactionProgressText"),
  transactionProgressValue: $("#transactionProgressValue"),
  transactionProgressBar: $("#transactionProgressBar"),
  transactionMessage: $("#transactionMessage"),
  transactionResults: $("#transactionResults"),
  transactionScopeBadge: $("#transactionScopeBadge"),
  transactionResultTitle: $("#transactionResultTitle"),
  transactionResultMeta: $("#transactionResultMeta"),
  transactionStats: $("#transactionStats"),
  transactionTrendChart: $("#transactionTrendChart"),
  transactionList: $("#transactionList"),
  auctionAddress: $("#auctionAddress"),
  copyAuctionAddress: $("#copyAuctionAddress"),
  nationalPlan: $("#nationalPlan"),
  otherLaws: $("#otherLaws"),
  restrictions: $("#restrictions"),
  officialLink: $("#officialLink"),
  findOnMap: $("#findOnMap"),
  viewMap: $("#viewMap"),
  mapDialog: $("#mapDialog"),
  mapDialogTitle: $("#mapDialogTitle"),
  mapDialogAddress: $("#mapDialogAddress"),
  mapCoordinate: $("#mapCoordinate"),
  interactiveMap: $("#interactiveMap"),
  mapLoading: $("#mapLoading"),
  mapError: $("#mapError"),
  mapSearchForm: $("#mapSearchForm"),
  mapSearchInput: $("#mapSearchInput"),
  mapSearchButton: $("#mapSearchButton"),
  mapSearchResults: $("#mapSearchResults"),
  currentLocation: $("#currentLocation"),
  mapSelectionTitle: $("#mapSelectionTitle"),
  mapSelectionHint: $("#mapSelectionHint"),
  mapSelectParcel: $("#mapSelectParcel"),
  closeMap: $("#closeMap"),
  downloadReport: $("#downloadReport"),
  shareParcel: $("#shareParcel"),
  shareParcelLabel: $("#shareParcelLabel"),
  reportDialog: $("#reportDialog"),
  reportDialogAddress: $("#reportDialogAddress"),
  reportPreview: $("#reportPreview"),
  reportDownload: $("#reportDownload"),
  closeReport: $("#closeReport"),
  exportProgress: $("#exportProgress"),
  exportProgressMessage: $("#exportProgressMessage"),
  exportProgressValue: $("#exportProgressValue"),
  exportProgressBar: $("#exportProgressBar"),
  searchAgain: $("#searchAgain")
};

let searchController;
let detailController;
let selectedItem;
let selectedData;
let lookupProgressTimer;
let lookupPercent = 12;
let recentHistory = loadHistory();
let searchViewMode = "idle";
let reportObjectUrl = "";
let autocompleteItems = [];
let autocompleteIndex = -1;
let parcelMap;
let mapBaseLayer;
let mapSatelliteLayer;
let mapHybridLayer;
let mapSelectionSource;
let mapMarkerSource;
let mapSelectedItem;
let mapSearchController;
let mapClickController;
let mapLocationRequestId = 0;
let transactionController;
let transactionAutoSelectionToken = 0;
let selectedTransactionType = "land";
let selectedTransactionResult = null;
let transactionInitializationPromise = Promise.resolve();
let buildingController;
let selectedBuildings = [];

const mapGeoJson = new GeoJSON();
const mapBoundaryStyle = [
  new Style({stroke: new Stroke({color: "rgba(255,255,255,.96)", width: 9})}),
  new Style({fill: new Fill({color: "rgba(245,29,118,.22)"}), stroke: new Stroke({color: "#f51d76", width: 5})})
];
const mapMarkerStyle = new Style({
  image: new CircleStyle({radius: 9, fill: new Fill({color: "#f51d76"}), stroke: new Stroke({color: "#fff", width: 3})})
});

function loadHistory() {
  try {
    return parseHistory(window.localStorage.getItem(HISTORY_STORAGE_KEY));
  } catch {
    return [];
  }
}

function persistHistory() {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(recentHistory));
  } catch {
    // 브라우저 저장소가 차단되어도 필지 조회는 계속 동작한다.
  }
}

function formatHistoryDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "최근 조회";
  return new Intl.DateTimeFormat("ko-KR", {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"}).format(date);
}

function renderHistory() {
  elements.historyList.replaceChildren();
  elements.recentHistory.hidden = !shouldShowRecentHistory(recentHistory, searchViewMode);
  recentHistory.forEach((item) => {
    const button = createElement("button", "recent-history__item");
    button.type = "button";
    button.setAttribute("aria-label", `${item.parcelAddress || item.primaryAddress} 다시 조회`);
    const icon = createElement("span", "recent-history__icon", "↻");
    icon.setAttribute("aria-hidden", "true");
    const copy = createElement("span", "recent-history__copy");
    copy.append(createElement("strong", "", item.parcelAddress || item.primaryAddress || `PNU ${item.pnu}`));
    copy.append(createElement("small", "", [item.roadAddress, formatHistoryDate(item.viewedAt)].filter(Boolean).join(" · ")));
    button.append(icon, copy, createElement("span", "recent-history__arrow", "›"));
    button.addEventListener("click", () => {
      elements.input.value = item.parcelAddress || item.primaryAddress;
      selectParcel(item);
    });
    elements.historyList.append(button);
  });
}

function setSearchViewMode(mode) {
  searchViewMode = mode;
  elements.recentHistory.hidden = !shouldShowRecentHistory(recentHistory, searchViewMode);
}

function closeHistoryAutocomplete() {
  autocompleteItems = [];
  autocompleteIndex = -1;
  elements.historyAutocomplete.hidden = true;
  elements.input.setAttribute("aria-expanded", "false");
  elements.input.removeAttribute("aria-activedescendant");
}

function setAutocompleteIndex(index) {
  if (!autocompleteItems.length) return;
  autocompleteIndex = (index + autocompleteItems.length) % autocompleteItems.length;
  const options = [...elements.historyAutocompleteList.querySelectorAll("[role='option']")];
  options.forEach((option, optionIndex) => {
    const active = optionIndex === autocompleteIndex;
    option.classList.toggle("active", active);
    option.setAttribute("aria-selected", String(active));
    if (active) {
      elements.input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({block: "nearest"});
    }
  });
}

function chooseHistoryAutocomplete(item) {
  elements.input.value = item.parcelAddress || item.primaryAddress || item.roadAddress;
  closeHistoryAutocomplete();
  selectParcel(item);
}

function renderHistoryAutocomplete() {
  autocompleteItems = filterHistoryItems(recentHistory, elements.input.value);
  autocompleteIndex = -1;
  elements.historyAutocompleteList.replaceChildren();
  if (!autocompleteItems.length) {
    closeHistoryAutocomplete();
    return;
  }
  elements.historyAutocompleteCount.textContent = `${autocompleteItems.length}개`;
  autocompleteItems.forEach((item, index) => {
    const option = createElement("button", "history-autocomplete__item");
    option.type = "button";
    option.id = `historyAutocompleteOption${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.tabIndex = -1;
    const copy = createElement("span", "history-autocomplete__copy");
    copy.append(createElement("strong", "", item.parcelAddress || item.primaryAddress || `PNU ${item.pnu}`));
    copy.append(createElement("small", "", [item.roadAddress, item.buildingName, formatHistoryDate(item.viewedAt)].filter(Boolean).join(" · ")));
    option.append(createElement("span", "history-autocomplete__icon", "↻"), copy, createElement("span", "history-autocomplete__arrow", "›"));
    option.addEventListener("pointerdown", (event) => event.preventDefault());
    option.addEventListener("pointermove", () => setAutocompleteIndex(index));
    option.addEventListener("click", () => chooseHistoryAutocomplete(item));
    elements.historyAutocompleteList.append(option);
  });
  elements.historyAutocomplete.hidden = false;
  elements.input.setAttribute("aria-expanded", "true");
}

function rememberParcel(item) {
  recentHistory = addHistoryItem(recentHistory, item);
  persistHistory();
  renderHistory();
}

function setStatus(message = "", type = "") {
  elements.status.textContent = message;
  elements.status.className = `status${type ? ` ${type}` : ""}`;
}

function setSearchLoading(loading) {
  elements.button.disabled = loading;
  elements.button.textContent = loading ? "찾는 중…" : "주소 찾기";
  elements.input.setAttribute("aria-busy", String(loading));
}

function updateLookupProgress(percent) {
  lookupPercent = Math.max(0, Math.min(100, percent));
  elements.lookupProgressValue.textContent = `${Math.round(lookupPercent)}%`;
  elements.lookupProgressBar.style.width = `${lookupPercent}%`;
  const activeStep = lookupPercent < 36 ? 1 : lookupPercent < 72 ? 2 : 3;
  document.querySelectorAll("[data-lookup-step]").forEach((step) => {
    const number = Number(step.dataset.lookupStep);
    step.classList.toggle("done", number < activeStep || lookupPercent === 100);
    step.classList.toggle("active", number === activeStep && lookupPercent < 100);
  });
}

function showLookupProgress(item) {
  window.clearInterval(lookupProgressTimer);
  elements.lookupProgressAddress.textContent = item.parcelAddress || item.primaryAddress;
  elements.lookupProgress.hidden = false;
  updateLookupProgress(12);
  lookupProgressTimer = window.setInterval(() => {
    const increment = lookupPercent < 36 ? 7 : lookupPercent < 72 ? 4 : 2;
    updateLookupProgress(Math.min(90, lookupPercent + increment));
  }, 300);
  elements.lookupProgress.scrollIntoView({behavior: "smooth", block: "center"});
}

function hideLookupProgress(completed = false) {
  window.clearInterval(lookupProgressTimer);
  if (completed) updateLookupProgress(100);
  window.setTimeout(() => {
    elements.lookupProgress.hidden = true;
  }, completed ? 260 : 0);
}

function updateExportProgress({percent, message}) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  elements.exportProgressValue.textContent = `${Math.round(value)}%`;
  elements.exportProgressBar.style.width = `${value}%`;
  elements.exportProgressMessage.textContent = message;
}

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderSearchResults(items, query) {
  globalThis.TojiIyongAds?.hide("searchResults");
  elements.resultList.replaceChildren();
  elements.results.hidden = false;
  elements.resultQuery.textContent = `“${query}” 검색 결과`;
  elements.resultCount.textContent = `${items.length}개 결과`;
  if (!items.length) {
    elements.resultList.append(createElement("p", "empty-result", "일치하는 필지를 찾지 못했어요. 시·군·구와 읍면동, 지번을 함께 입력해 보세요."));
    return;
  }

  items.forEach((item) => {
    const button = createElement("button", "result-item");
    button.type = "button";
    button.dataset.pnu = item.pnu;
    const type = item.matchTypes.includes("place") ? "건물" : item.matchTypes.includes("road") && item.matchTypes.includes("parcel") ? "주소" : item.matchTypes.includes("road") ? "도로" : "지번";
    button.append(createElement("span", "result-type", type));
    const copy = createElement("span", "result-copy");
    copy.append(createElement("strong", "", item.parcelAddress || item.primaryAddress));
    copy.append(createElement("small", "", [item.roadAddress, item.buildingName].filter(Boolean).join(" · ") || `PNU ${item.pnu}`));
    button.append(copy, createElement("span", "result-arrow", "›"));
    button.addEventListener("click", () => selectParcel(item));
    elements.resultList.append(button);
  });
  globalThis.TojiIyongAds?.show("searchResults");
}

async function searchAddress(query) {
  searchController?.abort();
  searchController = new AbortController();
  closeHistoryAutocomplete();
  setSearchViewMode("active");
  setSearchLoading(true);
  setStatus("주소와 연결된 필지를 찾고 있어요.");
  hideLookupProgress();
  globalThis.TojiIyongAds?.hide("searchResults");
  globalThis.TojiIyongAds?.hide("parcelDetail");
  elements.results.hidden = true;
  elements.summary.hidden = true;
  try {
    const payload = await requestAddressSearch(query, searchController.signal);
    renderSearchResults(payload.items || [], query);
    setStatus(payload.partial ? "일부 주소 검색 결과만 표시했습니다." : "");
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.results.hidden = true;
    setStatus(error.message, "error");
  } finally {
    setSearchLoading(false);
  }
}

function formatPrice(amount, year) {
  if (!amount) return {value: "미제공", note: "공시지가 정보 없음"};
  return {value: `${new Intl.NumberFormat("ko-KR").format(amount)}원`, note: `${year ? `${year}년` : "기준연도 미제공"} · ㎡당`};
}

function renderFacts(data, item) {
  const price = formatPrice(data.price, data.priceYear);
  const facts = [
    ["소재지", data.address || item.parcelAddress || item.primaryAddress, `PNU ${item.pnu}`],
    ["지목", data.landCategory || "미제공", "토지이음 기준"],
    ["면적", data.area || "미제공", "공부상 면적"],
    ["개별공시지가", price.value, price.note]
  ];
  elements.factGrid.replaceChildren();
  facts.forEach(([label, value, note]) => {
    const group = document.createElement("div");
    group.append(createElement("dt", "", label));
    const dd = createElement("dd", "", value);
    dd.append(createElement("small", "", note));
    group.append(dd);
    elements.factGrid.append(group);
  });
}

function formatBuildingMetric(value, unit = "㎡") {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "-";
  return `${new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 2}).format(number)}${unit}`;
}

function formatBuildingApprovalDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 4) return "미제공";
  return digits.length >= 8 ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}` : `${digits.slice(0, 4)}년`;
}

function buildingDisplayName(building, fallback = "건축물") {
  return [building?.name, building?.dongName && building.dongName !== building.name ? building.dongName : ""].filter(Boolean).join(" · ") || fallback;
}

function renderBuildingSummary(items, {error = false} = {}) {
  selectedBuildings = Array.isArray(items) ? items : [];
  elements.buildingSummaryDetail.replaceChildren();
  elements.buildingSummaryDetail.hidden = true;
  if (!selectedBuildings.length) {
    elements.buildingSummaryStatus.textContent = error
      ? "건축물 공개정보를 불러오지 못했습니다. 통합 보기에서 토지대장은 계속 확인할 수 있어요."
      : "이 필지에서 확인된 건축물이 없습니다. 토지대장·토지이용계획확인원은 조회할 수 있어요.";
    return;
  }
  const primary = selectedBuildings[0];
  const floors = [primary.groundFloors ? `지상 ${primary.groundFloors}층` : "", primary.undergroundFloors ? `지하 ${primary.undergroundFloors}층` : ""].filter(Boolean).join(" · ");
  elements.buildingSummaryStatus.textContent = `${selectedBuildings.length}개 건축물이 확인됐습니다. 통합 보기에서 전체 또는 개별 건축물을 선택하세요.`;
  [
    ["대표 건축물", buildingDisplayName(primary, "명칭 미제공")],
    ["주용도", primary.use || "미제공"],
    ["층수", floors || "미제공"],
    ["연면적", formatBuildingMetric(primary.totalArea)],
    ["사용승인", formatBuildingApprovalDate(primary.approvalDate)]
  ].forEach(([label, value]) => {
    const span = createElement("span");
    span.append(createElement("small", "", label), createElement("b", "", value));
    elements.buildingSummaryDetail.append(span);
  });
  elements.buildingSummaryDetail.hidden = false;
}

async function loadBuildingSummary(item) {
  buildingController?.abort();
  buildingController = new AbortController();
  selectedBuildings = [];
  elements.buildingSummaryStatus.textContent = "이 필지의 건축물 정보를 확인하고 있어요.";
  elements.buildingSummaryDetail.hidden = true;
  try {
    const payload = await requestBuildingRecords(item.pnu, buildingController.signal);
    if (selectedItem?.pnu !== item.pnu) return null;
    const items = payload.items || [];
    renderBuildingSummary(items);
    return items;
  } catch (error) {
    if (error.name === "AbortError" || selectedItem?.pnu !== item.pnu) return null;
    renderBuildingSummary([], {error: true});
    return [];
  }
}

function buildPropertyDocumentViewerUrl(item, data, tab = "building") {
  const params = new URLSearchParams({
    pnu: item.pnu,
    address: data?.address || item.parcelAddress || item.primaryAddress || "선택한 필지",
    districtPlan: hasDistrictPlan(data, item.pnu) ? "1" : "0",
    tab
  });
  return `./building-ledger.html?${params}`;
}

function updatePropertyDocumentLinks(item, data) {
  elements.propertyDocumentsLink.href = buildPropertyDocumentViewerUrl(item, data, "building");
  elements.landRegisterLink.href = buildPropertyDocumentViewerUrl(item, data, "landRegister");
  elements.landUseLink.href = buildPropertyDocumentViewerUrl(item, data, "landUse");
  elements.officialLink.href = buildPropertyDocumentViewerUrl(item, data, "eum");
}

function openPropertyDocumentViewer() {
  if (!selectedItem || !selectedData) return;
  openPropertyDocumentViewerUrl(buildPropertyDocumentViewerUrl(selectedItem, selectedData));
}

function openPropertyDocumentViewerUrl(url) {
  const viewer = window.open(url, PROPERTY_DOCUMENT_VIEWER_TARGET);
  viewer?.focus();
}

function handlePropertyDocumentLink(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  openPropertyDocumentViewerUrl(event.currentTarget.href);
}

function formatDealAmount(amount) {
  const value = Math.round(Number(amount) || 0);
  if (!value) return "-";
  if (value >= 10000) {
    const billions = Math.floor(value / 10000);
    const remainder = value % 10000;
    return `${billions}억${remainder ? ` ${new Intl.NumberFormat("ko-KR").format(remainder)}만원` : ""}`;
  }
  return `${new Intl.NumberFormat("ko-KR").format(value)}만원`;
}

function formatUnitPrice(value) {
  const amount = Number(value) || 0;
  return amount ? `${new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 0}).format(amount)}원/㎡` : "-";
}

function formatContractDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : "날짜 미제공";
}

function updateTransactionType(type) {
  if (!TRANSACTION_TYPES[type]) return;
  transactionController?.abort();
  selectedTransactionType = type;
  selectedTransactionResult = null;
  elements.transactionTypeTabs.querySelectorAll("[data-transaction-type]").forEach((button) => {
    const active = button.dataset.transactionType === type;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements.transactionQueryTitle.textContent = `${TRANSACTION_TYPES[type].label} 매매 실거래`;
  elements.transactionQueryHint.textContent = "버튼을 누르면 선택 지역의 최근 24개월 자료를 조회합니다.";
  elements.transactionProgress.hidden = true;
  elements.transactionResults.hidden = true;
  elements.transactionMessage.textContent = hasMolitApiKey()
    ? ""
    : "실거래 조회용 공공데이터 인증키가 설정되지 않았습니다.";
  elements.transactionMessage.className = `transaction-message${hasMolitApiKey() ? "" : " error"}`;
  elements.loadTransactions.disabled = !hasMolitApiKey();
}

function resetTransactionPanel(item, data) {
  transactionAutoSelectionToken += 1;
  transactionController?.abort();
  elements.transactionCard.open = false;
  elements.transactionResults.hidden = true;
  elements.transactionProgress.hidden = true;
  elements.transactionStats.replaceChildren();
  elements.transactionTrendChart.replaceChildren();
  elements.transactionList.replaceChildren();
  elements.transactionTypeTabs.querySelectorAll("[data-transaction-type]").forEach((button) => button.classList.remove("recommended"));
  updateTransactionType("land");
  const address = data.address || item.parcelAddress || item.primaryAddress || "선택한 필지";
  elements.auctionAddress.textContent = address;
  elements.copyAuctionAddress.dataset.address = address;
  elements.copyAuctionAddress.textContent = "주소 복사";
}

async function initializeTransactionPanel(item, data) {
  const token = transactionAutoSelectionToken;
  elements.transactionCard.open = true;
  elements.transactionQueryHint.textContent = "필지의 건축물 용도를 확인해 기본 유형을 선택하고 있어요.";
  const buildings = await loadBuildingSummary(item);
  if (buildings === null || token !== transactionAutoSelectionToken || selectedItem?.pnu !== item.pnu) return;

  const recommendation = recommendTransactionType({buildingName: item.buildingName, buildings});
  elements.transactionTypeTabs.querySelector(`[data-transaction-type="${recommendation}"]`)?.classList.add("recommended");
  updateTransactionType(recommendation);
  elements.transactionQueryHint.textContent = `${TRANSACTION_TYPES[recommendation].label} 유형으로 최근 24개월을 자동 조회합니다.`;
  if (hasMolitApiKey()) await loadTransactionsForSelectedParcel({automatic: true});
}

function appendTransactionStat(label, value, note = "") {
  const group = document.createElement("div");
  group.append(createElement("dt", "", label));
  const detail = createElement("dd", "", value);
  if (note) detail.append(createElement("small", "", note));
  group.append(detail);
  elements.transactionStats.append(group);
}

function renderTransactionTrend(trend) {
  elements.transactionTrendChart.replaceChildren();
  if (!trend.length) {
    elements.transactionTrendChart.append(createElement("p", "transaction-empty", "㎡당 가격을 계산할 수 있는 거래가 없습니다."));
    return;
  }
  const max = Math.max(...trend.map((item) => item.medianUnitPrice));
  const chart = createElement("div", "transaction-bars");
  trend.forEach((item) => {
    const bar = createElement("span", "transaction-bar");
    bar.style.setProperty("--bar-height", `${Math.max(8, item.medianUnitPrice / max * 100)}%`);
    bar.title = `${item.month.slice(0, 4)}.${item.month.slice(4)} · ${formatUnitPrice(item.medianUnitPrice)} · ${item.count}건`;
    bar.setAttribute("aria-label", bar.title);
    bar.append(createElement("i"), createElement("small", "", `${Number(item.month.slice(4))}월`));
    chart.append(bar);
  });
  elements.transactionTrendChart.append(chart);
}

function renderTransactionList(items, definition) {
  elements.transactionList.replaceChildren();
  if (!items.length) {
    elements.transactionList.append(createElement("p", "transaction-empty", "표시할 거래가 없습니다."));
    return;
  }
  items.slice(0, 12).forEach((item) => {
    const article = createElement("article", "transaction-item");
    const head = createElement("div", "transaction-item__head");
    head.append(createElement("strong", "", formatDealAmount(item.amount)), createElement("time", "", formatContractDate(item.contractDate)));
    const title = item.buildingName || [item.legalDong, item.jibun].filter(Boolean).join(" ") || TRANSACTION_TYPES[item.type].label;
    const meta = [item.area ? `${definition.areaKind} ${new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 2}).format(item.area)}㎡` : "", item.floor ? `${item.floor}층` : "", formatUnitPrice(item.unitPrice)].filter(Boolean);
    article.append(head, createElement("b", "transaction-item__title", title), createElement("p", "", meta.join(" · ")));
    elements.transactionList.append(article);
  });
}

function renderTransactionResult(result) {
  selectedTransactionResult = result;
  elements.transactionResults.hidden = false;
  const exact = result.scope === "exact";
  elements.transactionScopeBadge.textContent = exact ? "해당 필지·단지 거래" : "법정동 유사 거래";
  elements.transactionScopeBadge.classList.toggle("exact", exact);
  elements.transactionResultTitle.textContent = `${result.definition.label} 최근 24개월 요약`;
  const notes = [`정상 거래 ${result.totalCount}건`];
  if (result.cancelledCount) notes.push(`취소 ${result.cancelledCount}건 제외`);
  if (result.failedMonths) notes.push(`${result.failedMonths}개월 불러오기 실패`);
  if (result.truncated) notes.push("일부 월 최대 5페이지 표시");
  elements.transactionResultMeta.textContent = notes.join(" · ");
  elements.transactionStats.replaceChildren();
  appendTransactionStat("거래 건수", `${result.totalCount}건`, exact ? "공개 지번 일치" : "비교 가능한 공개 거래");
  appendTransactionStat("최근 거래일", result.latestDate ? formatContractDate(result.latestDate) : "-");
  appendTransactionStat("거래금액 중앙값", formatDealAmount(result.medianAmount));
  appendTransactionStat("㎡당 중앙값", formatUnitPrice(result.medianUnitPrice), result.minUnitPrice ? `${formatUnitPrice(result.minUnitPrice)} ~ ${formatUnitPrice(result.maxUnitPrice)}` : "면적 정보 없음");
  renderTransactionTrend(result.trend);
  renderTransactionList(result.items, result.definition);
  if (!result.totalCount) {
    elements.transactionMessage.textContent = exact
      ? "최근 24개월 동안 공개된 해당 필지·단지 거래가 없습니다."
      : "최근 24개월 동안 비교 가능한 공개 거래가 없습니다.";
    elements.transactionMessage.className = "transaction-message empty";
  } else if (result.failedMonths) {
    elements.transactionMessage.textContent = `일부 자료를 불러오지 못해 ${24 - result.failedMonths}개월 결과만 표시합니다.`;
    elements.transactionMessage.className = "transaction-message warning";
  } else {
    elements.transactionMessage.textContent = result.cachedMonths ? `${result.cachedMonths}개월 자료는 이 브라우저의 캐시를 사용했습니다.` : "";
    elements.transactionMessage.className = "transaction-message";
  }
}

async function loadTransactionsForSelectedParcel({automatic = false} = {}) {
  if (!selectedItem || !selectedData) return;
  transactionController?.abort();
  transactionController = new AbortController();
  selectedTransactionResult = null;
  elements.loadTransactions.disabled = true;
  elements.loadTransactions.textContent = "조회 중…";
  elements.transactionResults.hidden = true;
  elements.transactionMessage.textContent = "";
  elements.transactionMessage.className = "transaction-message";
  elements.transactionProgress.hidden = false;
  elements.transactionProgressValue.textContent = "0 / 24개월";
  elements.transactionProgressBar.style.width = "0%";
  try {
    const result = await requestTransactions({
      type: selectedTransactionType,
      pnu: selectedItem.pnu,
      parcelAddress: selectedData.address || selectedItem.parcelAddress || selectedItem.primaryAddress,
      selectedArea: selectedData.area,
      signal: transactionController.signal,
      onProgress: ({completed, total, percent}) => {
        elements.transactionProgressValue.textContent = `${completed} / ${total}개월`;
        elements.transactionProgressBar.style.width = `${percent}%`;
      }
    });
    renderTransactionResult(result);
    elements.transactionQueryHint.textContent = automatic
      ? "선택한 필지를 기준으로 자동 조회했습니다. 필요하면 다시 조회할 수 있어요."
      : "선택한 유형의 최근 24개월 자료입니다.";
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.transactionMessage.textContent = error.message;
    elements.transactionMessage.className = "transaction-message error";
    if (automatic) elements.transactionQueryHint.textContent = "자동 조회하지 못했습니다. 잠시 후 다시 조회해 주세요.";
  } finally {
    elements.transactionProgress.hidden = true;
    elements.loadTransactions.disabled = !hasMolitApiKey();
    elements.loadTransactions.textContent = "최근 24개월 조회";
  }
}

async function copyAuctionAddress() {
  const address = elements.copyAuctionAddress.dataset.address || "";
  if (!address) return;
  try {
    await writeClipboardText(address);
  } catch {
    setStatus("주소를 복사하지 못했습니다. 직접 선택해 복사해 주세요.", "error");
    return;
  }
  elements.copyAuctionAddress.textContent = "복사됨";
  window.setTimeout(() => { elements.copyAuctionAddress.textContent = "주소 복사"; }, 1600);
}

async function writeClipboardText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("클립보드 복사 실패");
}

function showShareFeedback(label) {
  elements.shareParcelLabel.textContent = label;
  window.setTimeout(() => { elements.shareParcelLabel.textContent = "필지 공유"; }, 1800);
}

async function shareSelectedParcel() {
  if (!selectedItem) return;
  const address = selectedData?.address || selectedItem.parcelAddress || selectedItem.primaryAddress || `PNU ${selectedItem.pnu}`;
  const url = buildParcelShareUrl(window.location.href, {...selectedItem, parcelAddress: address});
  const shareData = {title: `토지이용한눈 · ${address}`, text: `${address} 토지이용계획 열람 요약`, url};
  try {
    if (typeof navigator.share === "function") {
      await navigator.share(shareData);
      showShareFeedback("공유 완료");
      return;
    }
    await writeClipboardText(url);
    showShareFeedback("링크 복사됨");
  } catch (error) {
    if (error?.name === "AbortError") return;
    try {
      await writeClipboardText(url);
      showShareFeedback("링크 복사됨");
    } catch {
      setStatus("공유 링크를 복사하지 못했습니다.", "error");
    }
  }
}

function renderZoneList(target, zones) {
  target.replaceChildren();
  if (!zones?.length) {
    target.append(createElement("p", "empty-data", "조회된 지정 정보가 없습니다."));
    return;
  }
  const visible = createElement("div", "tag-list");
  zones.slice(0, 5).forEach((zone) => visible.append(createElement("span", "zone-tag", zone.name)));
  target.append(visible);
  if (zones.length > 5) {
    const details = createElement("details", "more-data");
    details.append(createElement("summary", "", `나머지 ${zones.length - 5}개 전체 보기`));
    const rest = createElement("div", "tag-list");
    zones.slice(5).forEach((zone) => rest.append(createElement("span", "zone-tag", zone.name)));
    details.append(rest);
    target.append(details);
  }
}

function createRestrictionGroup(group) {
  const article = createElement("article", "restriction-group");
  article.append(createElement("strong", "", group.zone));
  const list = document.createElement("ul");
  group.rules.forEach((rule) => {
    const item = document.createElement("li");
    item.append(createElement("b", "", rule.law || "관련 법령"));
    const detail = [rule.article, rule.subject].filter(Boolean).join(" · ");
    if (detail) item.append(createElement("span", "", detail));
    list.append(item);
  });
  article.append(list);
  return article;
}

function renderRestrictions(groups) {
  elements.restrictions.replaceChildren();
  if (!groups?.length) {
    elements.restrictions.append(createElement("p", "empty-data", "화면에서 바로 표시할 행위제한 근거가 없습니다. 토지이음 원문에서 전체 내용을 확인해 주세요."));
    return;
  }
  const visible = createElement("div", "restriction-list");
  groups.slice(0, 2).forEach((group) => visible.append(createRestrictionGroup(group)));
  elements.restrictions.append(visible);
  if (groups.length > 2) {
    const details = createElement("details", "more-data");
    details.append(createElement("summary", "", `나머지 ${groups.length - 2}개 지역·지구 전체 보기`));
    const rest = createElement("div", "restriction-list");
    groups.slice(2).forEach((group) => rest.append(createRestrictionGroup(group)));
    details.append(rest);
    elements.restrictions.append(details);
  }
}

function renderSummary(data, item) {
  elements.summaryTitle.textContent = data.address || item.parcelAddress || item.primaryAddress;
  elements.summaryRoad.textContent = item.roadAddress ? `도로명 ${item.roadAddress}` : `필지고유번호 ${item.pnu}`;
  renderFacts(data, item);
  renderZoneList(elements.nationalPlan, data.nationalPlan);
  renderZoneList(elements.otherLaws, [...(data.otherLaws || []), ...(data.decree || [])]);
  renderRestrictions(data.restrictions);
  resetTransactionPanel(item, data);
  transactionInitializationPromise = initializeTransactionPanel(item, data);
  updatePropertyDocumentLinks(item, data);
  elements.viewMap.hidden = !(Number.isFinite(Number(item.longitude)) && Number.isFinite(Number(item.latitude)));
  elements.summary.hidden = false;
  globalThis.TojiIyongAds?.show("parcelDetail");
}

function setMapLoading(loading, message = "지도를 불러오고 있어요.") {
  elements.mapLoading.hidden = !loading;
  elements.mapLoading.querySelector("span").textContent = message;
}

function setMapLayer(mode) {
  const satellite = mode === "satellite";
  mapBaseLayer?.setVisible(!satellite);
  mapSatelliteLayer?.setVisible(satellite);
  mapHybridLayer?.setVisible(satellite);
  document.querySelectorAll("[data-map-layer]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mapLayer === mode);
  });
}

function ensureParcelMap() {
  if (parcelMap) return parcelMap;
  const sourceOptions = {crossOrigin: "anonymous", maxZoom: 19, transition: 0};
  mapBaseLayer = new TileLayer({source: new XYZ({...sourceOptions, url: "https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png"}), visible: false});
  mapSatelliteLayer = new TileLayer({source: new XYZ({...sourceOptions, url: "https://xdworld.vworld.kr/2d/Satellite/service/{z}/{x}/{y}.jpeg"})});
  mapHybridLayer = new TileLayer({source: new XYZ({...sourceOptions, url: "https://xdworld.vworld.kr/2d/Hybrid/service/{z}/{x}/{y}.png"})});
  mapSelectionSource = new VectorSource();
  mapMarkerSource = new VectorSource();
  parcelMap = new OLMap({
    target: elements.interactiveMap,
    layers: [
      mapBaseLayer,
      mapSatelliteLayer,
      mapHybridLayer,
      new VectorLayer({source: mapSelectionSource, style: mapBoundaryStyle, zIndex: 18}),
      new VectorLayer({source: mapMarkerSource, style: mapMarkerStyle, zIndex: 20})
    ],
    view: new View({center: fromLonLat([126.978, 37.5665]), zoom: 12, minZoom: 6, maxZoom: 19})
  });
  parcelMap.once("rendercomplete", () => setMapLoading(false));
  parcelMap.on("singleclick", (event) => void chooseMapPoint(toLonLat(event.coordinate)));
  setMapLayer("satellite");
  return parcelMap;
}

function setMapSelectionCopy(item, {loading = false, error = ""} = {}) {
  const longitude = Number(item?.longitude);
  const latitude = Number(item?.latitude);
  elements.mapSelectionTitle.textContent = item?.parcelAddress || item?.primaryAddress || (loading ? "필지를 확인하고 있어요" : "선택한 필지");
  elements.mapCoordinate.textContent = Number.isFinite(longitude) && Number.isFinite(latitude)
    ? `좌표 ${longitude.toFixed(6)}, ${latitude.toFixed(6)}`
    : "";
  elements.mapSelectionHint.textContent = error || (loading
    ? "연속지적도에서 이 위치의 필지를 찾고 있습니다."
    : item ? `PNU ${item.pnu} · 경계는 참고용입니다.` : "검색 결과를 고르거나 지도를 눌러 필지를 선택하세요.");
  elements.mapSelectParcel.disabled = loading || !item;
}

function drawMapSelection(item, rawFeature, {fit = true} = {}) {
  const longitude = Number(item?.longitude);
  const latitude = Number(item?.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
  mapSelectedItem = item;
  mapSelectionSource.clear();
  mapMarkerSource.clear();
  let boundaryFeature = null;
  if (rawFeature?.geometry) {
    try {
      boundaryFeature = mapGeoJson.readFeature(rawFeature, {dataProjection: "EPSG:4326", featureProjection: "EPSG:3857"});
      mapSelectionSource.addFeature(boundaryFeature);
    } catch (error) {
      console.warn("Map parcel geometry could not be rendered", error);
    }
  }
  mapMarkerSource.addFeature(new Feature({geometry: new Point(fromLonLat([longitude, latitude]))}));
  if (fit && boundaryFeature) {
    parcelMap.getView().fit(boundaryFeature.getGeometry().getExtent(), {padding: [70, 100, 70, 100], maxZoom: 18, duration: 420});
  } else {
    parcelMap.getView().animate({center: fromLonLat([longitude, latitude]), zoom: Math.max(17, parcelMap.getView().getZoom() || 17), duration: 420});
  }
  elements.mapDialogAddress.textContent = item.parcelAddress || item.primaryAddress || "선택한 필지";
  setMapSelectionCopy(item);
}

async function loadMapCandidate(item) {
  setMapSelectionCopy(item, {loading: true});
  elements.mapSearchResults.hidden = true;
  try {
    const payload = await requestParcelGeometry(item);
    drawMapSelection(item, payload.feature);
  } catch (error) {
    drawMapSelection(item, null);
    elements.mapSelectionHint.textContent = "위치는 찾았지만 필지 경계는 표시하지 못했습니다. 이 위치를 선택할 수 있습니다.";
  }
}

function renderMapSearchResults(items) {
  elements.mapSearchResults.replaceChildren();
  elements.mapSearchResults.hidden = false;
  if (!items.length) {
    elements.mapSearchResults.append(createElement("p", "map-search-empty", "일치하는 필지를 찾지 못했습니다."));
    return;
  }
  items.forEach((item) => {
    const button = createElement("button", "map-search-result");
    button.type = "button";
    const type = item.matchTypes.includes("place") ? "건물" : item.matchTypes.includes("road") ? "주소" : "지번";
    const copy = document.createElement("div");
    copy.append(createElement("strong", "", item.parcelAddress || item.primaryAddress));
    copy.append(createElement("small", "", [item.roadAddress, item.buildingName].filter(Boolean).join(" · ") || `PNU ${item.pnu}`));
    button.append(createElement("span", "", type), copy, createElement("i", "", "›"));
    button.addEventListener("click", () => void loadMapCandidate(item));
    elements.mapSearchResults.append(button);
  });
}

async function searchInMap(query) {
  mapSearchController?.abort();
  mapSearchController = new AbortController();
  elements.mapSearchButton.disabled = true;
  elements.mapSearchButton.textContent = "검색 중";
  try {
    const payload = await requestAddressSearch(query, mapSearchController.signal);
    renderMapSearchResults(payload.items || []);
  } catch (error) {
    if (error.name !== "AbortError") {
      elements.mapSearchResults.replaceChildren(createElement("p", "map-search-empty", error.message));
      elements.mapSearchResults.hidden = false;
    }
  } finally {
    elements.mapSearchButton.disabled = false;
    elements.mapSearchButton.textContent = "검색";
  }
}

async function chooseMapPoint([longitude, latitude]) {
  mapClickController?.abort();
  mapClickController = new AbortController();
  mapSelectedItem = null;
  setMapSelectionCopy({longitude, latitude}, {loading: true});
  elements.mapSearchResults.hidden = true;
  try {
    const payload = await requestParcelAtPoint(longitude, latitude, mapClickController.signal);
    drawMapSelection(payload.item, payload.feature, {fit: false});
  } catch (error) {
    if (error.name !== "AbortError") setMapSelectionCopy({longitude, latitude}, {error: error.message});
  }
}

function currentLocationErrorMessage(error) {
  if (error?.code === 1) return "위치 권한이 꺼져 있습니다. 브라우저 설정에서 이 사이트의 위치 권한을 허용해 주세요.";
  if (error?.code === 2) return "현재 위치를 확인할 수 없습니다. GPS 또는 네트워크 연결을 확인해 주세요.";
  if (error?.code === 3) return "현재 위치 확인 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
  return "현재 위치를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function setCurrentLocationButton(loading) {
  elements.currentLocation.disabled = loading;
  elements.currentLocation.classList.toggle("is-loading", loading);
  elements.currentLocation.setAttribute("aria-busy", String(loading));
  elements.currentLocation.querySelector("span").textContent = loading ? "위치 확인 중" : "현재 위치";
}

async function locateCurrentPosition() {
  if (!navigator.geolocation) {
    elements.mapSelectionTitle.textContent = "현재 위치를 사용할 수 없어요";
    elements.mapSelectionHint.textContent = "이 브라우저는 위치정보 기능을 지원하지 않습니다.";
    return;
  }

  const requestId = ++mapLocationRequestId;
  mapSelectedItem = null;
  elements.mapSearchResults.hidden = true;
  elements.mapSelectionTitle.textContent = "현재 위치를 확인하고 있어요";
  elements.mapCoordinate.textContent = "";
  elements.mapSelectionHint.textContent = "위치 권한을 허용하면 현재 지점의 필지를 찾아드립니다.";
  elements.mapSelectParcel.disabled = true;
  setCurrentLocationButton(true);

  navigator.geolocation.getCurrentPosition(async ({coords}) => {
    if (requestId !== mapLocationRequestId || !elements.mapDialog.open) return;
    const longitude = Number(coords.longitude);
    const latitude = Number(coords.latitude);
    if (!(longitude >= 124 && longitude <= 132 && latitude >= 33 && latitude <= 39)) {
      elements.mapSelectionTitle.textContent = "현재 위치가 국내 범위를 벗어났어요";
      elements.mapSelectionHint.textContent = "토지 필지 조회는 대한민국 내 위치에서만 이용할 수 있습니다.";
      setCurrentLocationButton(false);
      return;
    }

    parcelMap.getView().animate({center: fromLonLat([longitude, latitude]), zoom: 17, duration: 420});
    mapSelectionSource.clear();
    mapMarkerSource.clear();
    mapMarkerSource.addFeature(new Feature({geometry: new Point(fromLonLat([longitude, latitude]))}));
    elements.mapDialogTitle.textContent = "현재 위치의 필지를 확인하세요";
    elements.mapDialogAddress.textContent = "기기 위치정보를 기준으로 조회했습니다.";
    await chooseMapPoint([longitude, latitude]);
    if (requestId === mapLocationRequestId) setCurrentLocationButton(false);
  }, (error) => {
    if (requestId !== mapLocationRequestId || !elements.mapDialog.open) return;
    elements.mapSelectionTitle.textContent = "현재 위치를 확인하지 못했어요";
    elements.mapCoordinate.textContent = "";
    elements.mapSelectionHint.textContent = currentLocationErrorMessage(error);
    elements.mapSelectParcel.disabled = true;
    setCurrentLocationButton(false);
  }, {enableHighAccuracy: true, timeout: 12000, maximumAge: 30000});
}

function openMap({initialItem = null, query = ""} = {}) {
  const longitude = Number(initialItem?.longitude);
  const latitude = Number(initialItem?.latitude);
  const hasInitialItem = initialItem && Number.isFinite(longitude) && Number.isFinite(latitude);
  elements.mapDialogTitle.textContent = hasInitialItem ? "선택한 필지를 지도에서 확인하세요" : "지도로 필지를 찾아보세요";
  elements.mapDialogAddress.textContent = "주소·건물명 검색 또는 지도 클릭으로 선택";
  elements.mapError.hidden = true;
  elements.mapSearchResults.hidden = true;
  elements.mapSearchInput.value = query;
  mapSelectedItem = null;
  setMapLoading(!parcelMap);
  elements.mapDialog.showModal();
  ensureParcelMap();
  window.setTimeout(() => {
    parcelMap.updateSize();
    mapSelectionSource.clear();
    mapMarkerSource.clear();
    setMapSelectionCopy(null);
    if (hasInitialItem) {
      void loadMapCandidate(initialItem);
    } else if (query.length >= 2) {
      void searchInMap(query);
    } else {
      elements.mapSearchInput.focus();
    }
  }, 0);
}

function closeMap() {
  mapLocationRequestId += 1;
  setCurrentLocationButton(false);
  mapSearchController?.abort();
  mapClickController?.abort();
  elements.mapSearchResults.hidden = true;
  if (elements.mapDialog.open) elements.mapDialog.close();
}

function fallbackOfficialUrl(pnu) {
  const url = new URL("https://www.eum.go.kr/web/ar/lu/luLandDet.jsp");
  url.searchParams.set("add", "land");
  url.searchParams.set("isNoScr", "script");
  url.searchParams.set("mode", "search");
  url.searchParams.set("pnu", pnu);
  url.searchParams.set("s_type", "1");
  url.searchParams.set("selGbn", "umd");
  return url.toString();
}

async function selectParcel(item) {
  detailController?.abort();
  detailController = new AbortController();
  selectedItem = item;
  selectedData = null;
  setSearchViewMode("active");
  rememberParcel(item);
  globalThis.TojiIyongAds?.hide("searchResults");
  globalThis.TojiIyongAds?.hide("parcelDetail");
  elements.results.hidden = true;
  elements.summary.hidden = true;
  showLookupProgress(item);
  setStatus("토지이음에서 토지이용계획을 확인하고 있어요.");
  updatePropertyDocumentLinks(item, null);
  try {
    const payload = await requestLandUse(item.pnu, detailController.signal);
    selectedData = payload.data;
    renderSummary(payload.data, item);
    hideLookupProgress(true);
    setStatus("");
    elements.summary.scrollIntoView({behavior: "smooth", block: "start"});
  } catch (error) {
    if (error.name === "AbortError") {
      hideLookupProgress();
      return;
    }
    selectedData = {
      address: item.parcelAddress || item.primaryAddress,
      nationalPlan: [],
      otherLaws: [],
      decree: [],
      restrictions: [],
      officialUrl: fallbackOfficialUrl(item.pnu)
    };
    renderSummary(selectedData, item);
    hideLookupProgress();
    setStatus(error.message, "error");
  }
}

elements.downloadReport.addEventListener("click", async () => {
  if (!selectedItem || !selectedData) {
    setStatus("보고서에 담을 조회 결과가 없습니다.", "error");
    return;
  }
  if (!window.TojiIyongReport?.generatePdf) {
    setStatus("PDF 생성 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.", "error");
    return;
  }
  elements.downloadReport.disabled = true;
  elements.exportProgress.hidden = false;
  updateExportProgress({percent: 5, message: "조회 내용을 정리하는 중입니다."});
  try {
    updateExportProgress({percent: 7, message: "건축물·실거래 정보를 보고서에 모으고 있어요."});
    await transactionInitializationPromise;
    const model = buildReportModel(selectedData, selectedItem, new Date(), {
      buildings: selectedBuildings,
      transaction: selectedTransactionResult
    });
    if (usesDirectBrowserApi() && model.vicinity) {
      model.vicinity.imageUrl = "";
      model.vicinity.useTileMap = true;
      try {
        const geometry = await requestParcelGeometry(selectedItem);
        model.vicinity.geometry = geometry.feature?.geometry || null;
        model.vicinity.geometryUrl = "";
      } catch (error) {
        console.warn("Parcel geometry unavailable for report", error);
      }
    }
    const result = await window.TojiIyongReport.generatePdf(model, updateExportProgress);
    if (reportObjectUrl) URL.revokeObjectURL(reportObjectUrl);
    reportObjectUrl = URL.createObjectURL(result.blob);
    elements.reportPreview.innerHTML = result.previewHtml;
    elements.reportDownload.href = reportObjectUrl;
    elements.reportDownload.download = result.fileName;
    elements.reportDialogAddress.textContent = model.address;
    elements.exportProgress.hidden = true;
    elements.reportDialog.showModal();
    setStatus("보고서 미리보기를 열었습니다. PDF 파일은 상단에서 다운로드할 수 있어요.");
  } catch (error) {
    console.error("PDF report export failed", error);
    elements.exportProgress.hidden = true;
    setStatus("PDF 보고서를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", "error");
  } finally {
    elements.downloadReport.disabled = false;
  }
});

function closeReportViewer() {
  if (elements.reportDialog.open) elements.reportDialog.close();
}

elements.closeReport.addEventListener("click", closeReportViewer);
elements.reportDialog.addEventListener("click", (event) => {
  if (event.target === elements.reportDialog) closeReportViewer();
});
elements.reportDialog.addEventListener("close", () => {
  elements.reportPreview.replaceChildren();
  elements.reportDownload.removeAttribute("href");
  if (reportObjectUrl) URL.revokeObjectURL(reportObjectUrl);
  reportObjectUrl = "";
});

elements.findOnMap.addEventListener("click", () => {
  closeHistoryAutocomplete();
  openMap({query: elements.input.value.replace(/\s+/g, " ").trim()});
});
elements.viewMap.addEventListener("click", () => openMap({initialItem: selectedItem}));
elements.closeMap.addEventListener("click", closeMap);
elements.mapDialog.addEventListener("click", (event) => {
  if (event.target === elements.mapDialog) closeMap();
});
elements.mapDialog.addEventListener("close", () => {
  mapLocationRequestId += 1;
  setCurrentLocationButton(false);
  mapSearchController?.abort();
  mapClickController?.abort();
  elements.mapSearchResults.hidden = true;
});
elements.mapSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = elements.mapSearchInput.value.replace(/\s+/g, " ").trim();
  if (query.length < 2) {
    elements.mapSelectionHint.textContent = "주소·지번·건물명을 두 글자 이상 입력해 주세요.";
    elements.mapSearchInput.focus();
    return;
  }
  void searchInMap(query);
});
elements.currentLocation.addEventListener("click", () => void locateCurrentPosition());
elements.mapSelectParcel.addEventListener("click", () => {
  if (!mapSelectedItem) return;
  const item = mapSelectedItem;
  elements.input.value = item.parcelAddress || item.primaryAddress || item.roadAddress;
  closeMap();
  void selectParcel(item);
});
document.querySelectorAll("[data-map-layer]").forEach((button) => {
  button.addEventListener("click", () => setMapLayer(button.dataset.mapLayer));
});
elements.transactionTypeTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-transaction-type]");
  if (button) {
    transactionAutoSelectionToken += 1;
    updateTransactionType(button.dataset.transactionType);
    if (selectedItem && selectedData && hasMolitApiKey()) {
      elements.transactionQueryHint.textContent = `${TRANSACTION_TYPES[selectedTransactionType].label} 유형으로 최근 24개월을 바로 조회합니다.`;
      transactionInitializationPromise = loadTransactionsForSelectedParcel();
    }
  }
});
elements.loadTransactions.addEventListener("click", () => {
  transactionInitializationPromise = loadTransactionsForSelectedParcel();
});
elements.copyAuctionAddress.addEventListener("click", () => void copyAuctionAddress());
elements.openPropertyDocuments.addEventListener("click", openPropertyDocumentViewer);
[elements.propertyDocumentsLink, elements.landRegisterLink, elements.landUseLink, elements.officialLink]
  .forEach((link) => link.addEventListener("click", handlePropertyDocumentLink));
elements.shareParcel.addEventListener("click", () => void shareSelectedParcel());

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = elements.input.value.replace(/\s+/g, " ").trim();
  if (query.length < 2) {
    setStatus("주소나 지번을 두 글자 이상 입력해 주세요.", "error");
    elements.input.focus();
    return;
  }
  searchAddress(query);
});

elements.input.addEventListener("focus", renderHistoryAutocomplete);
elements.input.addEventListener("input", () => {
  renderHistoryAutocomplete();
  if (!elements.input.value.trim() && elements.summary.hidden) {
    searchController?.abort();
    globalThis.TojiIyongAds?.hide("searchResults");
    elements.results.hidden = true;
    setStatus("");
    setSearchViewMode("idle");
  }
});
elements.input.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (elements.historyAutocomplete.hidden) renderHistoryAutocomplete();
    if (!autocompleteItems.length) return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    setAutocompleteIndex(autocompleteIndex < 0 ? (direction > 0 ? 0 : autocompleteItems.length - 1) : autocompleteIndex + direction);
    return;
  }
  if (event.key === "Enter" && !elements.historyAutocomplete.hidden && autocompleteIndex >= 0) {
    event.preventDefault();
    chooseHistoryAutocomplete(autocompleteItems[autocompleteIndex]);
    return;
  }
  if (event.key === "Escape") {
    closeHistoryAutocomplete();
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!elements.form.contains(event.target)) closeHistoryAutocomplete();
});

elements.searchAgain.addEventListener("click", () => {
  detailController?.abort();
  transactionController?.abort();
  closeMap();
  closeReportViewer();
  selectedItem = null;
  selectedData = null;
  selectedTransactionResult = null;
  transactionInitializationPromise = Promise.resolve();
  buildingController?.abort();
  selectedBuildings = [];
  hideLookupProgress();
  globalThis.TojiIyongAds?.hide("searchResults");
  globalThis.TojiIyongAds?.hide("parcelDetail");
  elements.summary.hidden = true;
  elements.results.hidden = true;
  setSearchViewMode("idle");
  setStatus("");
  elements.input.select();
  elements.input.focus();
  window.scrollTo({top: elements.form.offsetTop - 40, behavior: "smooth"});
});

elements.clearHistory.addEventListener("click", () => {
  recentHistory = [];
  try {
    window.localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // 저장소 접근이 차단된 경우 현재 화면에서만 제거한다.
  }
  renderHistory();
  closeHistoryAutocomplete();
  setStatus("최근 조회 기록을 삭제했습니다.");
});

globalThis.TojiIyongAds?.init();
renderHistory();
const sharedParcel = parseParcelShareUrl(window.location.href);
if (sharedParcel) {
  elements.input.value = sharedParcel.parcelAddress || sharedParcel.primaryAddress;
  void selectParcel(sharedParcel);
}
