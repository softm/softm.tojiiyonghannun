import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configScript = fs.readFileSync(path.join(dir, "adfit-config.js"), "utf8");
const runtimeScript = fs.readFileSync(path.join(dir, "adfit.js"), "utf8");

function app({hostname = "tojiiyonghannun.designboard.net", userAgent = "", width = 380,
  failed = false, visible = true} = {}) {
  const listeners = new Map();
  const stats = {sdk: 0, renders: [], destroys: []};
  const zones = new Map();

  for (const name of ["searchResultsAd", "parcelDetailAd"]) {
    const host = {
      children: [],
      append(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
      querySelector(selector) {
        return selector === "iframe" ? this.children.find(child => child.tagName === "iframe") || null : null;
      }
    };
    const zone = {
      hidden: true, dataset: {}, parentElement: {clientWidth: width},
      querySelector(selector) { return selector === "[data-adfit-host]" ? host : null; }
    };
    zones.set(name, {zone, host});
  }

  function createElement(tag) {
    const events = new Map();
    return {
      tagName: tag,
      style: {},
      dataset: {},
      isConnected: false,
      addEventListener(name, handler) { events.set(name, handler); },
      fire(name) { events.get(name)?.(); }
    };
  }

  let workerScript = null;
  const document = {
    hidden: !visible,
    documentElement: {clientWidth: width},
    getElementById(id) {
      if (id === "tojiiyonghannun-adfit-sdk") return workerScript;
      return zones.get(id)?.zone || null;
    },
    createElement,
    addEventListener(name, callback) { listeners.set("document:" + name, callback); },
    head: {
      append(script) {
        workerScript = script;
        script.isConnected = true;
        stats.sdk++;
        queueMicrotask(() => {
          win.adfit = {
            render(ins) {
              stats.renders.push(ins.dataset.adUnit);
              win[ins.dataset[failed ? "adOnfail" : "adOnload"]]?.(ins);
            },
            destroy(ins) { stats.destroys.push(ins.dataset.adUnit); }
          };
          script.fire("load");
        });
      }
    }
  };
  const win = {
    document,
    navigator: {userAgent, onLine: true},
    location: {hostname},
    innerWidth: width,
    setTimeout,
    clearTimeout,
    addEventListener(name, callback) { listeners.set("window:" + name, callback); },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback([{isIntersecting: true}]); }
      disconnect() {}
    }
  };
  const env = vm.createContext({window: win, globalThis: win, Map, Set});
  vm.runInContext(configScript, env);
  vm.runInContext(runtimeScript, env);
  return {
    win, document, zones, stats,
    init() { win.TojiIyongAds.init(); },
    show(name) { win.TojiIyongAds.show(name); },
    hide(name) { win.TojiIyongAds.hide(name); },
    setWidth(next) {
      document.documentElement.clientWidth = next;
      for (const {zone} of zones.values()) zone.parentElement.clientWidth = next;
      listeners.get("window:resize")?.();
    },
    setVisible(next) {
      document.hidden = !next;
      listeners.get("document:visibilitychange")?.();
    }
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("공통 광고는 페이지당 AdFit SDK를 한 번만 가져오고 고유 단위만 요청한다", async () => {
  const fixture = app();
  fixture.init();
  fixture.init();
  fixture.show("searchResults");
  fixture.show("parcelDetail");
  await settle();
  assert.equal(fixture.stats.sdk, 1);
  assert.deepEqual(fixture.stats.renders.sort(), [
    "DAN-4nmORIg1At492nrf", "DAN-71yamqyQ7AV0rxk2"
  ].sort());
  assert.equal(fixture.zones.get("searchResultsAd").zone.dataset.state, "loaded");
  assert.equal(fixture.zones.get("parcelDetailAd").zone.dataset.state, "loaded");

  fixture.hide("searchResults");
  fixture.show("searchResults");
  fixture.show("searchResults");
  await settle();
  assert.equal(fixture.stats.renders.length, 2, "검색 전환은 같은 광고를 재요청하지 않는다");
});

test("AdFit NOAD는 광고 노출 공간과 DOM을 제거한다", async () => {
  const fixture = app({failed: true});
  fixture.init();
  fixture.show("searchResults");
  await settle();
  assert.equal(fixture.zones.get("searchResultsAd").zone.hidden, true);
  assert.equal(fixture.zones.get("searchResultsAd").zone.dataset.state, "unavailable");
  assert.equal(fixture.zones.get("searchResultsAd").host.children.length, 0);
  fixture.show("searchResults");
  await settle();
  assert.equal(fixture.stats.renders.length, 1);
});

test("다른 도메인과 AdMob 네이티브 Android는 광고 요청을 차단한다", async () => {
  for (const options of [
    {hostname: "localhost"},
    {hostname: "fake-tojiiyonghannun.designboard.net"},
    {userAgent: "Mozilla/5.0 AdMobNative/1"}
  ]) {
    const fixture = app(options);
    fixture.init();
    fixture.show("searchResults");
    fixture.show("parcelDetail");
    await settle();
    assert.equal(fixture.stats.sdk, 0);
    assert.equal(fixture.stats.renders.length, 0);
    assert.equal(fixture.zones.get("searchResultsAd").zone.hidden, true);
  }
});

test("320px 미만 또는 백그라운드에서는 요청하지 않고 조건 회복 시 1회 요청한다", async () => {
  const fixture = app({width: 280, visible: false});
  fixture.init();
  fixture.show("searchResults");
  await settle();
  assert.equal(fixture.stats.sdk, 0);
  fixture.setWidth(400);
  await settle();
  assert.equal(fixture.stats.sdk, 0);
  fixture.setVisible(true);
  await settle();
  assert.equal(fixture.stats.renders.length, 1);
});
