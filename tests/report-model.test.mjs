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

test("건축물·실거래·경매와 공식 확인 경로를 PDF 보고서에 모두 포함한다", () => {
  const model = buildReportModel({
    address: "경기도 부천시 소사구 옥길동 742-1",
    officialUrl: "https://www.eum.go.kr/example",
    nationalPlan: [],
    otherLaws: [],
    decree: [],
    restrictions: []
  }, {
    pnu: "4119410600107420001",
    roadAddress: "경기도 부천시 소사구 양지로 234-10"
  }, new Date("2026-10-13T03:00:00Z"), {
    buildings: [{
      name: "옥길 한신더휴",
      dongName: "102동",
      use: "공동주택",
      groundFloors: 29,
      undergroundFloors: 2,
      buildingArea: 612.34,
      totalArea: 14396.11,
      approvalDate: "20171027"
    }],
    transaction: {
      type: "apartment",
      definition: {label: "아파트"},
      scope: "exact",
      totalCount: 56,
      cancelledCount: 2,
      latestDate: "2026-09-12",
      medianAmount: 81625,
      medianUnitPrice: 8353802,
      minUnitPrice: 7757477,
      maxUnitPrice: 8676125,
      trend: [{month: "202609", medianUnitPrice: 8145351, count: 3}],
      items: [{contractDate: "2026-09-12", buildingName: "옥길한신더휴", amount: 79800, area: 97.97, floor: "11", unitPrice: 8145351}]
    }
  });

  const [building, transaction, trend, recent, official] = model.supplementSections;
  assert.deepEqual(building.rows[0], ["옥길 한신더휴 · 102동", "공동주택", "지상 29층 · 지하 2층", "612.34㎡ / 14,396.11㎡", "2017.10.27"]);
  assert.equal(transaction.rows[0][1], "해당 필지·단지 거래");
  assert.equal(transaction.rows[4][1], "8억 1,625만원");
  assert.deepEqual(trend.rows[0], ["2026.09", "8,145,351원/㎡", "3건"]);
  assert.deepEqual(recent.rows[0], ["2026.09.12", "옥길한신더휴", "7억 9,800만원", "97.97㎡ · 11층", "8,145,351원/㎡"]);
  assert.match(official.rows[1][1], /building-ledger\.html\?pnu=4119410600107420001/);
  assert.match(official.rows[3][1], /courtauction\.go\.kr/);
});
