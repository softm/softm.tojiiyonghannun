import {buildReportModel} from "./report-model.js?v=20261012-4";
import {addHistoryItem, filterHistoryItems, parseHistory, shouldShowRecentHistory} from "./history-model.js?v=20261012-4";
import {
  requestAddressSearch,
  requestLandUse,
  requestParcelAtPoint,
  requestParcelGeometry,
  usesDirectBrowserApi
} from "./browser-api.js?v=20261012-4";

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
  mapSelectionTitle: $("#mapSelectionTitle"),
  mapSelectionHint: $("#mapSelectionHint"),
  mapSelectParcel: $("#mapSelectParcel"),
  closeMap: $("#closeMap"),
  downloadReport: $("#downloadReport"),
  reportDialog: $("#reportDialog"),
  reportDialogAddress: $("#reportDialogAddress"),
  reportFrame: $("#reportFrame"),
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
}

async function searchAddress(query) {
  searchController?.abort();
  searchController = new AbortController();
  closeHistoryAutocomplete();
  setSearchViewMode("active");
  setSearchLoading(true);
  setStatus("주소와 연결된 필지를 찾고 있어요.");
  hideLookupProgress();
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
  elements.officialLink.href = data.officialUrl;
  elements.viewMap.hidden = !(Number.isFinite(Number(item.longitude)) && Number.isFinite(Number(item.latitude)));
  elements.summary.hidden = false;
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
  elements.results.hidden = true;
  elements.summary.hidden = true;
  showLookupProgress(item);
  setStatus("토지이음에서 토지이용계획을 확인하고 있어요.");
  elements.officialLink.href = fallbackOfficialUrl(item.pnu);
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
    const model = buildReportModel(selectedData, selectedItem);
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
    elements.reportFrame.src = reportObjectUrl;
    elements.reportDownload.href = reportObjectUrl;
    elements.reportDownload.download = result.fileName;
    elements.reportDialogAddress.textContent = model.address;
    elements.exportProgress.hidden = true;
    elements.reportDialog.showModal();
    setStatus("PDF 보고서 미리보기를 열었습니다.");
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
  elements.reportFrame.removeAttribute("src");
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
  closeMap();
  closeReportViewer();
  selectedItem = null;
  selectedData = null;
  hideLookupProgress();
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

renderHistory();
