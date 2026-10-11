import {buildReportModel} from "./report-model.js";
import {addHistoryItem, parseHistory} from "./history-model.js";

const HISTORY_STORAGE_KEY = "tojiiyonghannun.recent-parcels.v1";

const $ = (selector) => document.querySelector(selector);

const elements = {
  form: $("#searchForm"),
  input: $("#searchInput"),
  button: $("#searchButton"),
  status: $("#status"),
  results: $("#searchResults"),
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
  viewMap: $("#viewMap"),
  mapDialog: $("#mapDialog"),
  mapDialogTitle: $("#mapDialogTitle"),
  mapDialogAddress: $("#mapDialogAddress"),
  mapCoordinate: $("#mapCoordinate"),
  mapImage: $("#mapImage"),
  mapLoading: $("#mapLoading"),
  mapError: $("#mapError"),
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
let reportObjectUrl = "";

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
  elements.recentHistory.hidden = recentHistory.length === 0;
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

async function fetchJson(url, signal) {
  const response = await fetch(url, {headers: {Accept: "application/json"}, signal});
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "요청을 처리하지 못했습니다.");
  return payload;
}

function renderSearchResults(items) {
  elements.resultList.replaceChildren();
  elements.results.hidden = false;
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
  setSearchLoading(true);
  setStatus("주소와 연결된 필지를 찾고 있어요.");
  hideLookupProgress();
  elements.summary.hidden = true;
  try {
    const payload = await fetchJson(`/api/address-search?q=${encodeURIComponent(query)}`, searchController.signal);
    renderSearchResults(payload.items || []);
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

function vicinityMapUrl(item) {
  const params = new URLSearchParams({
    pnu: item.pnu,
    x: String(item.longitude),
    y: String(item.latitude)
  });
  return `/api/vicinity-map?${params}`;
}

function openMap() {
  const longitude = Number(selectedItem?.longitude);
  const latitude = Number(selectedItem?.latitude);
  if (!selectedItem || !Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    setStatus("선택한 필지의 지도 좌표가 없습니다.", "error");
    return;
  }
  elements.mapDialogTitle.textContent = "선택한 필지 주변";
  elements.mapDialogAddress.textContent = selectedItem.parcelAddress || selectedItem.primaryAddress;
  elements.mapCoordinate.textContent = `좌표 ${longitude.toFixed(6)}, ${latitude.toFixed(6)}`;
  elements.mapImage.alt = `${selectedItem.parcelAddress || selectedItem.primaryAddress} 주변 항공·도로 혼합 지도`;
  elements.mapImage.hidden = true;
  elements.mapError.hidden = true;
  elements.mapLoading.hidden = false;
  elements.mapImage.onload = () => {
    elements.mapLoading.hidden = true;
    elements.mapImage.hidden = false;
  };
  elements.mapImage.onerror = () => {
    elements.mapLoading.hidden = true;
    elements.mapImage.hidden = true;
    elements.mapError.hidden = false;
  };
  elements.mapImage.src = vicinityMapUrl(selectedItem);
  elements.mapDialog.showModal();
}

function closeMap() {
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
  rememberParcel(item);
  elements.results.hidden = true;
  elements.summary.hidden = true;
  showLookupProgress(item);
  setStatus("토지이음에서 토지이용계획을 확인하고 있어요.");
  elements.officialLink.href = fallbackOfficialUrl(item.pnu);
  try {
    const payload = await fetchJson(`/api/land-use?pnu=${encodeURIComponent(item.pnu)}`, detailController.signal);
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

elements.viewMap.addEventListener("click", openMap);
elements.closeMap.addEventListener("click", closeMap);
elements.mapDialog.addEventListener("click", (event) => {
  if (event.target === elements.mapDialog) closeMap();
});
elements.mapDialog.addEventListener("close", () => {
  elements.mapImage.onload = null;
  elements.mapImage.onerror = null;
  elements.mapImage.removeAttribute("src");
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

elements.searchAgain.addEventListener("click", () => {
  detailController?.abort();
  closeMap();
  closeReportViewer();
  selectedItem = null;
  selectedData = null;
  hideLookupProgress();
  elements.summary.hidden = true;
  elements.results.hidden = true;
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
  setStatus("최근 조회 기록을 삭제했습니다.");
});

renderHistory();
