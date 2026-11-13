import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const configSource = read("adfit-config.js");
const runtimeSource = read("adfit.js");
const appSource = read("app.js");
const htmlSource = read("index.html");

test("AdFit은 운영 도메인 전용 320x100 광고 지면 두 개만 사용한다", () => {
  const context = {globalThis: {}};
  vm.runInNewContext(configSource, context);
  const config = context.globalThis.TOJI_IYONG_AD_CONFIG;
  assert.equal(config.domain, "tojiiyonghannun.designboard.net");
  assert.deepEqual(Object.keys(config.placements).sort(), ["bottomDesktop", "bottomMobile", "parcelDetail", "searchResults"]);
  assert.equal(config.placements.searchResults.unit, "DAN-4nmORIg1At492nrf");
  assert.equal(config.placements.parcelDetail.unit, "DAN-71yamqyQ7AV0rxk2");
  assert.equal(config.placements.bottomMobile.unit, "DAN-b4E6afJ77CoU1PDr");
  assert.equal(config.placements.bottomMobile.height, 50);
  assert.equal(config.placements.bottomDesktop.unit, "DAN-qqDZXJ1WNQkVFw6o");
  assert.equal(config.placements.bottomDesktop.width, 728);
  const units = Object.values(config.placements).map(slot => slot.unit);
  assert.equal(new Set(units).size, units.length, "서로 다른 지면에 동일 DAN을 재사용하면 안 됩니다");
  for (const slot of Object.values(config.placements)) {
    assert.ok([320, 728].includes(slot.width));
    assert.ok([50, 90, 100].includes(slot.height));
  }
});

test("검색 결과 6개 뒤 1개와 필지 상세 광고 1개를 구분한다", () => {
  assert.match(htmlSource, /id="searchResultsAd"/);
  assert.match(htmlSource, /id="parcelDetailAd"/);
  assert.doesNotMatch(htmlSource, /searchResultsAd[23]/);
  assert.doesNotMatch(configSource, /searchResults[23]/);
  assert.match(appSource, /if\(items\.length>6\)globalThis\.TojiIyongAds\?\.show\("searchResults"\)/);
  assert.match(appSource, /show\("parcelDetail"\)/);
  assert.match(appSource, /hide\("parcelDetail"\)/);
  assert.match(appSource, /TojiIyongAds\?\.init\(\)/);
});

test("AdFit은 운영 환경에서만, 필요할 때 한 번 요청하고 실패하면 숨긴다", () => {
  assert.match(runtimeSource, /AdMobNative/);
  assert.match(runtimeSource, /root\.location\?\.hostname === config\(\)\.domain/);
  assert.match(runtimeSource, /IntersectionObserver/);
  assert.match(runtimeSource, /rootMargin: "200px 0px"/);
  assert.match(runtimeSource, /typeof root\.adfit\?\.destroy/);
  assert.match(runtimeSource, /api\.render\(ins\)/);
  assert.match(runtimeSource, /state\.host\.querySelector\("iframe"\)/);
  assert.match(runtimeSource, /state\.zone\.hidden = true/);
  assert.match(runtimeSource, /sdkPromise/);
  assert.doesNotMatch(runtimeSource, /setInterval/);
});

test("첫 화면 하단 접이식 광고는 PC 728x90, 모바일 320x50을 구분한다", () => {
  assert.match(htmlSource, /id="bottomAdFit"/);
  assert.match(htmlSource, /id="bottomAdFitToggle"/);
  assert.match(runtimeSource, /BOTTOM_STORAGE_KEY/);
  assert.match(runtimeSource, /bottomChoice\(\)/);
  assert.match(runtimeSource, /bottomDesktop/);
  assert.match(runtimeSource, /bottomMobile/);
});
