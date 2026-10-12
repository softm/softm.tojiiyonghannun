import {requestBuildingRecords} from "./browser-api.js?v=20261012-9";
import {
  PROPERTY_DOCUMENT_URLS,
  buildBuildingLifecycleUrl,
  buildDistrictPlanUrl,
  buildingPostFields,
  landRegisterPostFields,
  landUsePostFields,
  parcelDocumentIdentity
} from "./property-documents.js?v=20261012-9";

const params = new URLSearchParams(window.location.search);
const pnu = String(params.get("pnu") || "");
const address = String(params.get("address") || "선택한 필지").slice(0, 160);
const districtPlanEnabled = params.get("districtPlan") === "1";
const valid = /^\d{19}$/.test(pnu);
const loadedTabs = new Set();
let buildings = [];
let activeTab = "building";
let selectedBuildingIndex = -1;

const $ = (selector) => document.querySelector(selector);
const elements = {
  tabs: $("#viewerTabs"),
  address: $("#viewerAddress"),
  openExternal: $("#openExternal"),
  close: $("#closeViewer"),
  error: $("#viewerError"),
  buildingSelector: $("#buildingSelector"),
  buildingOverview: $("#buildingOverview"),
  buildingFrameShell: $("#buildingFrameShell"),
  buildingFrame: $("#buildingFrame"),
  lifecycleTab: $("#tabLifecycle"),
  districtPlanTab: $("#tabDistrictPlan")
};

const frameConfig = {
  building: {frame: $("#buildingFrame"), status: $("#buildingStatus")},
  landRegister: {frame: $("#landRegisterFrame"), status: $("#landRegisterStatus")},
  landUse: {frame: $("#landUseFrame"), status: $("#landUseStatus")},
  districtPlan: {frame: $("#districtPlanFrame"), status: $("#districtPlanStatus")},
  lifecycle: {frame: $("#lifecycleFrame"), status: $("#lifecycleStatus")}
};

function createElement(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function formatMetric(value, unit = "㎡") {
  const number = Number(value || 0);
  return number > 0 ? `${new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 2}).format(number)}${unit}` : "-";
}

function formatDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}` : digits.slice(0, 4) || "미제공";
}

function buildingDisplayName(building, fallback = "건축물") {
  return [building?.name, building?.dongName && building.dongName !== building.name ? building.dongName : ""].filter(Boolean).join(" · ") || fallback;
}

function submitPost(action, fields, target) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.target = target;
  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  });
  document.body.append(form);
  form.submit();
  form.remove();
}

function showFrameLoading(type) {
  const config = frameConfig[type];
  config.status.hidden = false;
  config.frame.addEventListener("load", () => { config.status.hidden = true; }, {once: true});
}

function submitPostToFrame(type, action, fields) {
  const config = frameConfig[type];
  showFrameLoading(type);
  submitPost(action, fields, config.frame.name);
}

function setLifecycleAvailability() {
  const available = selectedBuildingIndex >= 0 && Boolean(buildBuildingLifecycleUrl(pnu, buildings[selectedBuildingIndex]?.id));
  elements.lifecycleTab.hidden = !available;
  if (!available && activeTab === "lifecycle") activateTab("building");
}

function updateExternalButton() {
  const unavailable = activeTab === "building" && selectedBuildingIndex < 0;
  elements.openExternal.disabled = unavailable;
  elements.openExternal.textContent = unavailable ? "개별 건축물을 선택하세요" : "새 창으로 열기";
}

function loadSelectedBuilding(index) {
  selectedBuildingIndex = index;
  loadedTabs.delete("lifecycle");
  frameConfig.lifecycle.frame.removeAttribute("src");
  elements.buildingSelector.value = String(index);
  elements.buildingOverview.hidden = true;
  elements.buildingFrameShell.hidden = false;
  loadedTabs.delete("building");
  loadTab("building");
  setLifecycleAvailability();
  updateExternalButton();
}

function renderBuildingOverview() {
  elements.buildingOverview.replaceChildren();
  elements.buildingOverview.hidden = false;
  elements.buildingFrameShell.hidden = true;
  if (!buildings.length) {
    elements.buildingOverview.append(createElement("div", "panel-empty", "이 필지에서 확인된 건축물이 없습니다. 토지대장과 토지이용계획확인원 탭은 계속 이용할 수 있어요."));
    return;
  }
  const head = createElement("header", "building-overview__head");
  head.append(createElement("h2", "", "필지 내 전체 건축물"), createElement("span", "", `${buildings.length}개`));
  const grid = createElement("div", "building-grid");
  buildings.forEach((building, index) => {
    const article = createElement("article", "building-item");
    const header = document.createElement("header");
    header.append(createElement("h3", "", buildingDisplayName(building, `건축물 ${index + 1}`)));
    if (building.isMain) header.append(createElement("span", "", "주건축물"));
    article.append(header, createElement("p", "", building.use || "주용도 미제공"));
    const list = document.createElement("dl");
    [["층수", [building.groundFloors ? `지상 ${building.groundFloors}층` : "", building.undergroundFloors ? `지하 ${building.undergroundFloors}층` : ""].filter(Boolean).join(" · ") || "-"], ["연면적", formatMetric(building.totalArea)], ["건축면적", formatMetric(building.buildingArea)], ["사용승인", formatDate(building.approvalDate)]].forEach(([label, value]) => {
      const row = document.createElement("div");
      row.append(createElement("dt", "", label), createElement("dd", "", value));
      list.append(row);
    });
    const button = createElement("button", "", "이 건축물 원문 보기");
    button.type = "button";
    button.addEventListener("click", () => loadSelectedBuilding(index));
    article.append(list, button);
    grid.append(article);
  });
  elements.buildingOverview.append(head, grid);
}

function renderBuildingSelector() {
  elements.buildingSelector.replaceChildren(new Option(`전체 건축물 (${buildings.length}개)`, "all"));
  buildings.forEach((building, index) => {
    const label = `${buildingDisplayName(building, `건축물 ${index + 1}`)}${building.isMain ? " · 주건축물" : ""}`;
    elements.buildingSelector.append(new Option(label, String(index)));
  });
  elements.buildingSelector.disabled = false;
  elements.buildingSelector.value = "all";
  selectedBuildingIndex = -1;
  renderBuildingOverview();
  setLifecycleAvailability();
  updateExternalButton();
}

async function loadBuildings() {
  try {
    const payload = await requestBuildingRecords(pnu);
    buildings = payload.items || [];
    renderBuildingSelector();
  } catch (error) {
    buildings = [];
    elements.buildingSelector.replaceChildren(new Option("건축물 정보를 불러오지 못함", "all"));
    elements.buildingSelector.disabled = true;
    elements.buildingOverview.replaceChildren(createElement("div", "panel-empty", "건축물 공개정보를 불러오지 못했습니다. 다른 문서 탭은 계속 이용할 수 있어요."));
  }
}

function loadTab(type) {
  if (type === "building") {
    if (selectedBuildingIndex < 0) {
      renderBuildingOverview();
      return;
    }
    if (loadedTabs.has(`building:${selectedBuildingIndex}`)) return;
    submitPostToFrame("building", PROPERTY_DOCUMENT_URLS.building, buildingPostFields(pnu, buildings[selectedBuildingIndex]));
    loadedTabs.add(`building:${selectedBuildingIndex}`);
    return;
  }
  if (loadedTabs.has(type)) return;
  if (type === "landRegister") submitPostToFrame(type, PROPERTY_DOCUMENT_URLS.landRegister, landRegisterPostFields(pnu));
  if (type === "landUse") submitPostToFrame(type, PROPERTY_DOCUMENT_URLS.landUse, landUsePostFields(pnu));
  if (type === "districtPlan") {
    showFrameLoading(type);
    frameConfig[type].frame.src = buildDistrictPlanUrl(pnu);
  }
  if (type === "lifecycle") {
    showFrameLoading(type);
    frameConfig[type].frame.src = buildBuildingLifecycleUrl(pnu, buildings[selectedBuildingIndex]?.id);
  }
  loadedTabs.add(type);
}

function activateTab(type) {
  const button = elements.tabs.querySelector(`[data-document-tab="${type}"]`);
  if (!button || button.hidden) return;
  activeTab = type;
  elements.tabs.querySelectorAll("[data-document-tab]").forEach((tab) => {
    const active = tab === button;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-document-panel]").forEach((panel) => {
    const active = panel.dataset.documentPanel === type;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  loadTab(type);
  updateExternalButton();
}

function openActiveDocument() {
  if (activeTab === "building") {
    if (selectedBuildingIndex < 0) return;
    submitPost(PROPERTY_DOCUMENT_URLS.building, buildingPostFields(pnu, buildings[selectedBuildingIndex]), "_blank");
  }
  if (activeTab === "landRegister") submitPost(PROPERTY_DOCUMENT_URLS.landRegister, landRegisterPostFields(pnu), "_blank");
  if (activeTab === "landUse") submitPost(PROPERTY_DOCUMENT_URLS.landUse, landUsePostFields(pnu), "_blank");
  if (activeTab === "districtPlan") window.open(buildDistrictPlanUrl(pnu), "_blank", "noopener,noreferrer");
  if (activeTab === "lifecycle") window.open(buildBuildingLifecycleUrl(pnu, buildings[selectedBuildingIndex]?.id), "_blank", "noopener,noreferrer");
}

elements.address.textContent = valid ? `${address} · PNU ${pnu}` : "필지 정보가 올바르지 않습니다.";
elements.districtPlanTab.hidden = !(valid && districtPlanEnabled && pnu.startsWith("11"));
elements.tabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-document-tab]");
  if (button) activateTab(button.dataset.documentTab);
});
elements.tabs.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const tabs = [...elements.tabs.querySelectorAll("[data-document-tab]:not([hidden])")];
  const current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  event.preventDefault();
  const next = tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
  next.focus();
  activateTab(next.dataset.documentTab);
});
elements.buildingSelector.addEventListener("change", () => {
  if (elements.buildingSelector.value === "all") {
    selectedBuildingIndex = -1;
    renderBuildingOverview();
    setLifecycleAvailability();
    updateExternalButton();
    return;
  }
  loadSelectedBuilding(Number(elements.buildingSelector.value));
});
elements.openExternal.addEventListener("click", openActiveDocument);
elements.close.addEventListener("click", () => {
  window.close();
  window.setTimeout(() => { if (!window.closed) window.location.href = "./"; }, 100);
});

if (!valid) {
  elements.tabs.hidden = true;
  document.querySelectorAll("[data-document-panel]").forEach((panel) => { panel.hidden = true; });
  elements.error.hidden = false;
} else {
  parcelDocumentIdentity(pnu);
  void loadBuildings();
}
