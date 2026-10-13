(function setupAdFit(root) {
  "use strict";

  const states = new Map();
  const nativeAdsEnabled = /\bAdMobNative\/\d+\b/.test(root.navigator?.userAgent || "");
  const callbacks = Object.freeze({
    searchResults: {failed: "tojiIyongSearchResultsAdFailed", loaded: "tojiIyongSearchResultsAdLoaded"},
    parcelDetail: {failed: "tojiIyongParcelDetailAdFailed", loaded: "tojiIyongParcelDetailAdLoaded"}
  });

  function config() {
    return root.TOJI_IYONG_AD_CONFIG || {};
  }

  function isProductionHost() {
    return root.location?.hostname === config().domain;
  }

  function isValidSlot(slot) {
    return /^DAN-[A-Za-z0-9]+$/.test(String(slot?.unit || "").trim())
      && Number(slot?.width) === 320
      && Number(slot?.height) === 100;
  }

  function clearRequestTimer(state) {
    root.clearTimeout(state.timeout);
    state.timeout = 0;
  }

  function conceal(state, {failed = false} = {}) {
    clearRequestTimer(state);
    if (failed) {
      state.failed = true;
      state.host.replaceChildren();
      state.ad = null;
    }
    state.zone.hidden = true;
    state.zone.dataset.state = failed ? "unavailable" : "hidden";
  }

  function reveal(state) {
    if (state.failed || !state.enabled) return;
    state.zone.hidden = false;
    state.zone.dataset.state = state.loaded ? "loaded" : "ready";
  }

  function requestAd(state) {
    if (state.requested || state.failed || !state.enabled || root.document.hidden) return;
    const settings = config();
    const slot = settings.placements?.[state.placement];
    if (state.host.clientWidth < Number(slot.width)) {
      conceal(state, {failed: true});
      return;
    }

    state.requested = true;
    state.zone.dataset.state = "loading";
    const ad = root.document.createElement("ins");
    ad.className = "kakao_ad_area";
    ad.style.display = "none";
    ad.dataset.adUnit = slot.unit;
    ad.dataset.adWidth = String(slot.width);
    ad.dataset.adHeight = String(slot.height);
    ad.dataset.adOnfail = callbacks[state.placement].failed;
    ad.dataset.adOnload = callbacks[state.placement].loaded;
    state.ad = ad;
    state.host.append(ad);

    const script = root.document.createElement("script");
    script.async = true;
    script.charset = "utf-8";
    script.src = settings.script;
    script.onerror = () => conceal(state, {failed: true});
    script.onload = () => {
      script.remove();
      state.timeout = root.setTimeout(() => {
        if (!state.host.querySelector("iframe")) conceal(state, {failed: true});
      }, 30000);
    };
    root.document.head.append(script);
  }

  function observe(state) {
    if (state.observer || state.requested || state.failed || !state.enabled) return;
    if (!root.IntersectionObserver) {
      requestAd(state);
      return;
    }
    state.observer = new root.IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      state.observer.disconnect();
      state.observer = null;
      requestAd(state);
    }, {rootMargin: "200px 0px"});
    state.observer.observe(state.zone);
  }

  function register(id, placement) {
    const zone = root.document.getElementById(id);
    const host = zone?.querySelector("[data-adfit-host]");
    if (!zone || !host || states.has(placement)) return;
    const settings = config();
    const enabled = Boolean(settings.enabled)
      && isProductionHost()
      && !nativeAdsEnabled
      && isValidSlot(settings.placements?.[placement]);
    const state = {
      zone,
      host,
      placement,
      enabled,
      requested: false,
      loaded: false,
      failed: false,
      ad: null,
      timeout: 0,
      observer: null
    };
    states.set(placement, state);
    conceal(state);
  }

  function show(placement) {
    const state = states.get(placement);
    if (!state || !state.enabled || state.failed) return;
    reveal(state);
    if (!state.loaded) observe(state);
  }

  function hide(placement) {
    const state = states.get(placement);
    if (state) conceal(state);
  }

  for (const [placement, names] of Object.entries(callbacks)) {
    root[names.failed] = (ad) => {
      const state = states.get(placement);
      if (state?.ad === ad) conceal(state, {failed: true});
    };
    root[names.loaded] = (ad) => {
      const state = states.get(placement);
      if (state?.ad !== ad || state.failed) return;
      clearRequestTimer(state);
      state.loaded = true;
      state.zone.dataset.state = "loaded";
    };
  }

  function init() {
    register("searchResultsAd", "searchResults");
    register("parcelDetailAd", "parcelDetail");
    root.document.addEventListener("visibilitychange", () => {
      if (root.document.hidden) return;
      for (const state of states.values()) {
        if (!state.zone.hidden && !state.loaded) observe(state);
      }
    });
  }

  root.TojiIyongAds = Object.freeze({init, show, hide});
})(typeof window === "undefined" ? globalThis : window);
