import test from "node:test";
import assert from "node:assert/strict";
import {buildParcelShareUrl, parseParcelShareUrl} from "../share-model.js";

test("선택 필지 정보를 다시 열 수 있는 공유 URL로 만든다", () => {
  const url = new URL(buildParcelShareUrl("https://tojiiyonghannun.designboard.net/?deploy=old#result", {
    pnu: "4119410600107420001",
    parcelAddress: "경기도 부천시 소사구 옥길동 742-1",
    roadAddress: "경기도 부천시 소사구 양지로 234-10",
    buildingName: "옥길한신더휴",
    longitude: 126.825088,
    latitude: 37.466096
  }));
  assert.equal(url.pathname, "/");
  assert.equal(url.searchParams.get("deploy"), null);
  assert.equal(url.searchParams.get("pnu"), "4119410600107420001");
  assert.equal(url.searchParams.get("address"), "경기도 부천시 소사구 옥길동 742-1");
  assert.equal(url.searchParams.get("lng"), "126.825088");
});

test("공유 URL에서 자동 조회용 필지 정보를 복원한다", () => {
  const item = parseParcelShareUrl("https://tojiiyonghannun.designboard.net/?pnu=4119410600107420001&address=%EC%98%A5%EA%B8%B8%EB%8F%99+742-1&road=%EC%96%91%EC%A7%80%EB%A1%9C+234-10&lng=126.825088&lat=37.466096");
  assert.equal(item.pnu, "4119410600107420001");
  assert.equal(item.parcelAddress, "옥길동 742-1");
  assert.equal(item.roadAddress, "양지로 234-10");
  assert.equal(item.longitude, 126.825088);
  assert.equal(item.latitude, 37.466096);
  const withoutCoordinates = parseParcelShareUrl("https://example.com/?pnu=4119410600107420001");
  assert.equal("longitude" in withoutCoordinates, false);
  assert.equal(parseParcelShareUrl("https://example.com/?pnu=123"), null);
});
