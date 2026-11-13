/** SOFTM-ADFIT 공통 웹 광고 수명주기 / 토지이용한눈 2026-11-13.
 * 검색 결과 및 필지 상세별로 발급된 AdFit 단위만 사용한다.
 * 동일 단위 재요청, SDK 중복 주입, Android 네이티브 광고와의 중복을 방지한다.
 */
(function setupAdFit(root) {
  "use strict";

  const SDK_URL = "https://t1.kakaocdn.net/kas/static/ba.min.js";
  const SDK_ID = "tojiiyonghannun-adfit-sdk";
  const REQUEST_TIMEOUT = 30000;
  const SDK_TIMEOUT = 15000;
  const states = new Map();
  const usedUnits = new Set();
  const nativeAdsEnabled = /\bAdMobNative\/\d+\b/.test(root.navigator?.userAgent || "");
  const callbacks = Object.freeze({
    searchResults: {failed: "tojiIyongSearchResultsAdFailed", loaded: "tojiIyongSearchResultsAdLoaded"},
    parcelDetail: {failed: "tojiIyongParcelDetailAdFailed", loaded: "tojiIyongParcelDetailAdLoaded"},
    bottomMobile: {failed: "tojiIyongBottomMobileAdFailed", loaded: "tojiIyongBottomMobileAdLoaded"},
    bottomDesktop: {failed: "tojiIyongBottomDesktopAdFailed", loaded: "tojiIyongBottomDesktopAdLoaded"}
  });
  let sdkPromise;

  function config() {
    return root.TOJI_IYONG_AD_CONFIG || {};
  }

  function hostAllowed() {
    return config().enabled === true && root.location?.hostname === config().domain && !nativeAdsEnabled;
  }

  function validSlot(slot) {
    return /^DAN-[A-Za-z0-9]+$/.test(String(slot?.unit || "").trim()) &&
      ((Number(slot.width) === 320 && [50, 100].includes(Number(slot.height))) ||
       (Number(slot.width) === 728 && Number(slot.height) === 90));
  }

  function viewportReady() {
    return !root.document.hidden && root.navigator?.onLine !== false;
  }

  function hasRoom(state) {
    return (state.zone.parentElement?.clientWidth || 0) >= state.slot.width &&
      (root.document.documentElement?.clientWidth || root.innerWidth || 0) >= state.slot.width;
  }

  function disconnect(state) {
    state.observer?.disconnect();
    state.observer = null;
  }

  function hideZone(state, reason = "hidden") {
    state.zone.hidden = true;
    state.zone.dataset.state = reason;
  }

  function fail(state) {
    if (state.failed) return;
    state.failed = true;
    root.clearTimeout(state.timer);
    state.timer = 0;
    disconnect(state);
    try {
      if (state.ad && typeof root.adfit?.destroy === "function") root.adfit.destroy(state.ad);
    } catch {}
    state.host.replaceChildren();
    state.ad = null;
    hideZone(state, "unavailable");
    if (state.placement.startsWith("bottom") && bottomSelection === state.placement && bottomShell) {
      bottomPanel.hidden = true;
      bottomShell.hidden = true;
    }
  }

  function loaded(state) {
    if (state.failed || !state.ad) return;
    root.clearTimeout(state.timer);
    state.timer = 0;
    state.loaded = true;
    if (state.wants && viewportReady() && hasRoom(state)) {
      state.zone.hidden = false;
      state.zone.dataset.state = "loaded";
    } else {
      hideZone(state);
    }
  }

  function sdk() {
    if (typeof root.adfit?.render === "function") return Promise.resolve(root.adfit);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      let finished = false;
      const script = root.document.getElementById(SDK_ID) || root.document.createElement("script");
      const timer = root.setTimeout(() => done(Error("AdFit SDK timeout")), SDK_TIMEOUT);
      function done(error) {
        if (finished) return;
        finished = true;
        root.clearTimeout(timer);
        if (error || typeof root.adfit?.render !== "function") {
          reject(error || Error("AdFit render API unavailable"));
        } else {
          resolve(root.adfit);
        }
      }
      script.addEventListener("load", () => done(), {once: true});
      script.addEventListener("error", () => done(Error("AdFit SDK unavailable")), {once: true});
      if (!script.isConnected) {
        script.id = SDK_ID;
        script.async = true;
        script.charset = "utf-8";
        script.src = SDK_URL;
        root.document.head.append(script);
      }
    });
    return sdkPromise;
  }

  function requestAd(state) {
    if (!state.wants || state.requested || state.failed || !viewportReady() || !hasRoom(state)) return;
    state.requested = true; // 같은 지면에서는 한 번만 요청한다.
    state.zone.dataset.state = "loading";
    void sdk().then(api => {
      if (state.failed) return;
      if (!state.wants || !viewportReady() || !hasRoom(state)) {
        state.requested = false; // 서버에 광고를 요청하기 전에는 보류할 수 있다.
        return;
      }
      const ins = root.document.createElement("ins");
      ins.className = "kakao_ad_area";
      ins.style.display = "none";
      ins.dataset.adUnit = state.slot.unit;
      ins.dataset.adWidth = String(state.slot.width);
      ins.dataset.adHeight = String(state.slot.height);
      ins.dataset.adOnfail = callbacks[state.placement].failed;
      ins.dataset.adOnload = callbacks[state.placement].loaded;
      state.ad = ins;
      state.host.append(ins); // SDK를 불러온 다음 삽입해 자동스캔과 render 중복을 방지
      state.timer = root.setTimeout(() => {
        if (state.host.querySelector("iframe")) loaded(state);
        else fail(state);
      }, REQUEST_TIMEOUT);
      try {
        api.render(ins);
      } catch {
        fail(state);
      }
    }).catch(() => fail(state));
  }

  function observe(state) {
    if (state.observer || state.requested || state.loaded || state.failed || !state.wants || !viewportReady()) return;
    if (typeof root.IntersectionObserver !== "function") {
      requestAd(state);
      return;
    }
    state.observer = new root.IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      disconnect(state);
      requestAd(state);
    }, {rootMargin: "200px 0px"});
    state.observer.observe(state.zone);
  }

  function sync(state) {
    if (!state || state.failed || !state.enabled || !state.wants || !viewportReady() || !hasRoom(state)) {
      if (state) {
        disconnect(state);
        hideZone(state);
      }
      return;
    }
    state.zone.hidden = false;
    state.zone.dataset.state = state.loaded ? "loaded" : state.requested ? "loading" : "ready";
    if (!state.loaded) observe(state);
  }

  function register(id, placement) {
    const zone = root.document.getElementById(id);
    const host = zone?.matches?.("[data-adfit-host]") ? zone : zone?.querySelector("[data-adfit-host]");
    if (!zone || !host || states.has(placement)) return;
    const slot = config().placements?.[placement];
    const enabled = hostAllowed() && validSlot(slot) && !usedUnits.has(slot.unit);
    const state = {
      placement, zone, host, slot, enabled,
      wants: false, requested: false, loaded: false, failed: false, ad: null,
      observer: null, timer: 0
    };
    states.set(placement, state);
    if (enabled) usedUnits.add(slot.unit);
    hideZone(state);
  }

  function show(placement) {
    const state = states.get(placement);
    if (!state) return;
    state.wants = true;
    sync(state);
  }

  function hide(placement) {
    const state = states.get(placement);
    if (!state) return;
    state.wants = false;
    disconnect(state);
    hideZone(state);
  }

  for (const [placement, name] of Object.entries(callbacks)) {
    root[name.failed] = ins => {
      const state = states.get(placement);
      if (state?.ad === ins) fail(state);
    };
    root[name.loaded] = ins => {
      const state = states.get(placement);
      if (state?.ad === ins) loaded(state);
    };
  }

  const BOTTOM_STORAGE_KEY = "tojiiyonghannun.adfit.bottom.collapsed.v1";
  let bottomCollapsed = false;
  let bottomShell;
  let bottomPanel;
  let bottomToggle;
  let bottomSelection = null;

  function bottomAvailable() {
    return hostAllowed() && ["bottomMobile", "bottomDesktop"].some(key => states.get(key)?.enabled);
  }

  function bottomChoice() {
    const width = root.document.documentElement?.clientWidth || root.innerWidth || 0;
    if (width >= 728 && states.get("bottomDesktop")?.enabled) return "bottomDesktop";
    if (width >= 320 && states.get("bottomMobile")?.enabled) return "bottomMobile";
    return null;
  }

  function syncBottom() {
    if (!bottomShell || !bottomAvailable()) return;
    const choice = bottomChoice();
    const showBanner = !bottomCollapsed && Boolean(choice) && viewportReady();
    bottomShell.hidden = !choice;
    bottomPanel.hidden = !showBanner;
    bottomToggle.textContent = bottomCollapsed ? "광고 펼치기" : "광고 접기";
    bottomToggle.setAttribute("aria-expanded", String(!bottomCollapsed));
    if (bottomSelection !== choice) {
      for (const key of ["bottomMobile", "bottomDesktop"]) hide(key);
      bottomSelection = choice;
    }
    if (showBanner) {
      show(choice);
      const state = states.get(choice);
      if (state?.failed) {
        bottomPanel.hidden = true;
        bottomShell.hidden = true;
      }
    } else if (choice) {
      hide(choice);
    }
  }

  function initBottom() {
    bottomShell = root.document.getElementById("bottomAdFit");
    bottomPanel = root.document.getElementById("bottomAdFitPanel");
    bottomToggle = root.document.getElementById("bottomAdFitToggle");
    if (!bottomShell || !bottomPanel || !bottomToggle) return;
    register("bottomAdFitMobile", "bottomMobile");
    register("bottomAdFitDesktop", "bottomDesktop");
    try { bottomCollapsed = root.localStorage?.getItem(BOTTOM_STORAGE_KEY) === "1"; } catch {}
    bottomToggle.addEventListener("click", () => {
      bottomCollapsed = !bottomCollapsed;
      try { root.localStorage?.setItem(BOTTOM_STORAGE_KEY, bottomCollapsed ? "1" : "0"); } catch {}
      syncBottom();
    });
    syncBottom();
  }

  let initialized = false;
  function init() {
    if (initialized) return;
    initialized = true;
    register("searchResultsAd", "searchResults");
    register("parcelDetailAd", "parcelDetail");
    initBottom();
    root.document.addEventListener("visibilitychange", () => {
      for (const state of states.values()) sync(state);
      syncBottom();
    });
    root.addEventListener("online", () => {
      for (const state of states.values()) sync(state);
      syncBottom();
    });
    root.addEventListener("offline", () => {
      for (const state of states.values()) sync(state);
      syncBottom();
    });
    root.addEventListener("resize", () => {
      for (const state of states.values()) sync(state);
      syncBottom();
    }, {passive: true});
  }

  root.TojiIyongAds = Object.freeze({init, show, hide});
})(typeof window === "undefined" ? globalThis : window);
