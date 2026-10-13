import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configSource = fs.readFileSync(path.join(root, "adfit-config.js"), "utf8");
const runtimeSource = fs.readFileSync(path.join(root, "adfit.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");

test("AdFit은 운영 도메인 전용 320x100 지면 두 개를 사용한다", () => {
  assert.match(configSource, /domain:\s*"tojiiyonghannun\.designboard\.net"/);
  assert.match(configSource, /searchResults:[\s\S]*unit:\s*"DAN-4nmORIg1At492nrf"[\s\S]*width:\s*320[\s\S]*height:\s*100/);
  assert.match(configSource, /parcelDetail:[\s\S]*unit:\s*"DAN-71yamqyQ7AV0rxk2"[\s\S]*width:\s*320[\s\S]*height:\s*100/);
});

test("AdFit은 보이는 시점에만 요청하고 앱 중복 광고와 빈 지면을 방지한다", () => {
  assert.ok(runtimeSource.includes("/\\bAdMobNative\\/\\d+\\b/"));
  assert.match(runtimeSource, /location\?\.hostname === config\(\)\.domain/);
  assert.match(runtimeSource, /IntersectionObserver/);
  assert.match(runtimeSource, /rootMargin:\s*"200px 0px"/);
  assert.match(runtimeSource, /if \(!state\.host\.querySelector\("iframe"\)\) conceal\(state, \{failed: true\}\)/);
  assert.match(runtimeSource, /state\.zone\.hidden = true/);
});

test("검색 결과와 필지 상세 상태에 맞춰 각 광고 지면을 열고 닫는다", () => {
  assert.match(appSource, /show\("searchResults"\)/);
  assert.match(appSource, /hide\("searchResults"\)/);
  assert.match(appSource, /show\("parcelDetail"\)/);
  assert.match(appSource, /hide\("parcelDetail"\)/);
  assert.match(appSource, /TojiIyongAds\?\.init\(\)/);
});
