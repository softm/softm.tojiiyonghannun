import test from "node:test";
import assert from "node:assert/strict";
import {buildReportModel} from "../report-model.js";

test("조회 결과를 PDF 보고서 모델로 변환한다", () => {
  const model = buildReportModel({
    pnu: "2714010200105510023",
    address: "대구광역시 동구 신천동 551-23",
    landCategory: "대",
    area: "17,997 ㎡",
    price: 2152000,
    priceYear: "2026",
    nationalPlan: [{name: "제3종일반주거지역", description: ""}],
    otherLaws: [{name: "가축사육제한구역", description: ""}],
    decree: [],
    restrictions: [{zone: "제3종일반주거지역", rules: [{law: "국토계획법", article: "제56조", subject: "개발행위의 허가"}]}]
  }, {
    pnu: "2714010200105510023",
    roadAddress: "신암로16길 16",
    longitude: 128.609748,
    latitude: 35.876527
  }, new Date("2026-10-12T03:00:00Z"));

  assert.equal(model.address, "대구광역시 동구 신천동 551-23");
  assert.equal(model.sections[0].rows.at(-1)[1], "2,152,000원/㎡ (2026년 기준)");
  assert.deepEqual(model.sections[3].rows[0], ["제3종일반주거지역", "국토계획법", "제56조 · 개발행위의 허가"]);
  assert.equal(model.vicinity.imageUrl, "/api/vicinity-map?pnu=2714010200105510023&x=128.609748&y=35.876527");
  assert.equal(model.vicinity.geometryUrl, "/api/parcel-geometry?pnu=2714010200105510023&x=128.609748&y=35.876527");
  assert.match(model.notice, /공식 토지이용계획확인서가 아닙니다/);
});
