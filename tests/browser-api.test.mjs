import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeSearchItems,
  normalizePlaceCandidates,
  normalizeSearchItems,
  usesDirectBrowserApi
} from "../browser-api.js";

const pnu = "4119410600107420001";

test("운영 도메인과 GitHub Pages에서 브라우저 직접 API를 사용한다", () => {
  assert.equal(usesDirectBrowserApi({hostname: "tojiiyonghannun.designboard.net"}), true);
  assert.equal(usesDirectBrowserApi({hostname: "softm.github.io"}), true);
  assert.equal(usesDirectBrowserApi({hostname: "localhost"}), false);
});

test("브라우저 주소 검색 결과를 PNU 기준으로 합친다", () => {
  const item = {
    id: pnu,
    address: {parcel: "경기도 부천시 소사구 옥길동 742-1", road: "경기도 부천시 소사구 양지로 234-10"},
    point: {x: "126.825088", y: "37.466096"}
  };
  const result = mergeSearchItems([
    normalizeSearchItems({response: {status: "OK", result: {items: [item]}}}, "road"),
    normalizeSearchItems({response: {status: "OK", result: {items: [item]}}}, "parcel")
  ]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].matchTypes, ["road", "parcel"]);
});

test("브라우저 건물명 검색 후보를 주소와 함께 정규화한다", () => {
  const result = normalizePlaceCandidates({response: {status: "OK", result: {items: [{
    title: "옥길한신더휴",
    address: {parcel: "경기도 부천시 소사구 옥길동 742-1", road: "경기도 부천시 소사구 양지로 234-10"},
    point: {x: "126.825088", y: "37.466096"}
  }]}}});
  assert.equal(result[0].title, "옥길한신더휴");
  assert.equal(result[0].parcelAddress, "경기도 부천시 소사구 옥길동 742-1");
});
