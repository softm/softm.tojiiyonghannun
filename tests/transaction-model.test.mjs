import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSACTION_TYPES,
  analyzeTransactions,
  cacheTtlForMonth,
  parcelIdentity,
  parseTransactionXml,
  pruneCacheRecords,
  recommendTransactionType,
  recentMonths,
  runWithConcurrency
} from "../transaction-model.js";

function xmlItem(fields, {totalCount = 1, resultCode = "00"} = {}) {
  const body = Object.entries(fields).map(([name, value]) => `<${name}>${value}</${name}>`).join("");
  return `<response><header><resultCode>${resultCode}</resultCode><resultMsg>OK</resultMsg></header><body><items><item>${body}</item></items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${totalCount}</totalCount></body></response>`;
}

test("PNU에서 지역코드와 일반·산 지번을 구분한다", () => {
  assert.deepEqual(parcelIdentity("4119410400101680008"), {
    lawdCd: "41194",
    legalDongCode: "4119410400",
    mountain: false,
    main: 168,
    sub: 8,
    jibun: "168-8",
    normalizedJibun: "168-8"
  });
  assert.equal(parcelIdentity("4119410400201680008").jibun, "산 168-8");
  assert.throws(() => parcelIdentity("123"), /19자리 PNU/);
});

test("최근 24개월을 현재 월부터 역순으로 만든다", () => {
  const months = recentMonths(24, new Date(2026, 9, 12));
  assert.equal(months.length, 24);
  assert.equal(months[0], "202610");
  assert.equal(months.at(-1), "202411");
});

test("검색 명칭과 건축물 주용도로 기본 실거래 유형을 선택한다", () => {
  assert.equal(recommendTransactionType({buildingName: "옥길한신더휴"}), "apartment");
  assert.equal(recommendTransactionType({buildingName: "옥길한신더휴", buildings: []}), "land");
  assert.equal(recommendTransactionType({buildings: [{use: "공동주택(아파트)"}]}), "apartment");
  assert.equal(recommendTransactionType({buildings: [{use: "업무시설(오피스텔)"}]}), "officetel");
  assert.equal(recommendTransactionType({buildings: [{use: "연립주택"}]}), "rowHouse");
  assert.equal(recommendTransactionType({buildings: [{use: "단독주택(다가구주택)"}]}), "detached");
  assert.equal(recommendTransactionType({buildings: [{use: "제2종근린생활시설"}]}), "commercial");
  assert.equal(recommendTransactionType({buildings: [{use: "창고시설"}]}), "factory");
  assert.equal(recommendTransactionType({}), "land");
});

test("7개 매매 API XML을 공통 거래 모델로 정규화한다", () => {
  const fixtures = {
    land: {거래금액: "12,500", 년: "2026", 월: "9", 일: "3", 법정동: "옥길동", 지번: "168-8", 거래면적: "100.5", 지목: "대"},
    apartment: {dealAmount: "55,000", dealYear: "2026", dealMonth: "9", dealDay: "4", umdNm: "옥길동", jibun: "168-8", aptNm: "한신더휴", excluUseAr: "84.9", floor: "12"},
    officetel: {거래금액: "21,000", 년: "2026", 월: "9", 일: "5", 법정동: "옥길동", 지번: "168-8", 단지: "스마트타워", 전용면적: "42.1", 층: "7"},
    rowHouse: {dealAmount: "32,000", dealYear: "2026", dealMonth: "8", dealDay: "6", umdNm: "옥길동", jibun: "168-8", mhouseNm: "그린빌", excluUseArea: "59.9"},
    detached: {거래금액: "90,000", 년: "2026", 월: "7", 일: "7", 법정동: "옥길동", 지번: "168-8", 주택유형: "다가구", 연면적: "188.2"},
    commercial: {dealAmount: "130,000", dealYear: "2026", dealMonth: "6", dealDay: "8", umdNm: "옥길동", jibun: "168-8", buildingNm: "상가", buildingAr: "201.5", buildingUse: "근린생활시설"},
    factory: {거래금액: "250,000", 년: "2026", 월: "5", 일: "9", 법정동: "옥길동", 지번: "168-8", 건물명: "창고", 연면적: "400", 주용도: "창고시설"}
  };

  for (const type of Object.keys(TRANSACTION_TYPES)) {
    const parsed = parseTransactionXml(xmlItem(fixtures[type]), type);
    assert.equal(parsed.resultCode, "00", type);
    assert.equal(parsed.items.length, 1, type);
    assert.equal(parsed.items[0].type, type);
    assert.equal(parsed.items[0].normalizedJibun, "168-8");
    assert.ok(parsed.items[0].amount > 0, type);
    assert.ok(parsed.items[0].area > 0, type);
    assert.ok(parsed.items[0].unitPrice > 0, type);
  }
});

test("정확 일치 거래와 유사 거래를 섞지 않고 취소 거래를 제외한다", () => {
  const base = {type: "land", legalDong: "옥길동", buildingName: "", floor: "", landCategory: "대", useRegion: "", mainUse: "", dealType: "중개거래", cancellationDate: ""};
  const exact = {...base, jibun: "168-8", normalizedJibun: "168-8", contractDate: "2026-09-01", yearMonth: "202609", amount: 10000, area: 100, unitPrice: 1000000, cancelled: false};
  const nearby = {...base, jibun: "170-1", normalizedJibun: "170-1", contractDate: "2026-08-01", yearMonth: "202608", amount: 9000, area: 95, unitPrice: 947368, cancelled: false};
  const cancelled = {...exact, contractDate: "2026-07-01", yearMonth: "202607", cancelled: true, cancellationDate: "26.07.05"};
  const result = analyzeTransactions([nearby, exact, cancelled], {
    type: "land",
    pnu: "4119410400101680008",
    parcelAddress: "경기도 부천시 옥길동 168-8",
    selectedArea: 100
  });
  assert.equal(result.scope, "exact");
  assert.equal(result.totalCount, 1);
  assert.equal(result.items[0].normalizedJibun, "168-8");
  assert.equal(result.cancelledCount, 1);
});

test("월별 캐시 만료시간과 최대 200개 정리 기준을 적용한다", () => {
  const now = new Date(2026, 9, 12);
  assert.equal(cacheTtlForMonth("202610", now), 6 * 60 * 60 * 1000);
  assert.equal(cacheTtlForMonth("202609", now), 6 * 60 * 60 * 1000);
  assert.equal(cacheTtlForMonth("202608", now), 7 * 24 * 60 * 60 * 1000);
  const records = Array.from({length: 205}, (_, index) => ({key: String(index), storedAt: index}));
  const retained = pruneCacheRecords(records);
  assert.equal(retained.length, 200);
  assert.equal(retained[0].storedAt, 204);
  assert.equal(retained.at(-1).storedAt, 5);
});

test("월별 요청 동시 실행 수를 3개로 제한한다", async () => {
  let active = 0;
  let maxActive = 0;
  const tasks = Array.from({length: 12}, (_, index) => async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return index;
  });
  const results = await runWithConcurrency(tasks, 3);
  assert.equal(maxActive, 3);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 12);
});
