import test from "node:test";
import assert from "node:assert/strict";
import {buildTransactionParcelQuery,buildTransactionTrend} from "../transaction-explorer.js";

test("가격 흐름은 월 대표값으로 합치지 않고 개별 계약을 날짜순으로 유지한다", () => {
  const items=[
    {contractDate:"2026-02-03",yearMonth:"202602",unitPrice:12000000,amount:72000},
    {contractDate:"2026-01-20",yearMonth:"202601",unitPrice:11000000,amount:66000},
    {contractDate:"2026-02-03",yearMonth:"202602",unitPrice:12500000,amount:75000},
    {contractDate:"",yearMonth:"202602",unitPrice:99999999,amount:1}
  ];
  const trend=buildTransactionTrend(items);
  assert.deepEqual(trend.points.map(x=>[x.contractDate,x.unitPrice]),[
    ["2026-01-20",11000000],
    ["2026-02-03",12000000],
    ["2026-02-03",12500000]
  ]);
  assert.deepEqual(trend.months,[{month:"2026-01",count:1},{month:"2026-02",count:2}]);
});

test("법정동 비교 거래에서 클릭할 필지 주소를 만든다", () => {
  assert.equal(buildTransactionParcelQuery("서울특별시 구로구 온수동 155",{legalDong:"온수동",jibun:"155-2",normalizedJibun:"155-2"}),"서울특별시 구로구 온수동 155-2");
  assert.equal(buildTransactionParcelQuery("서울특별시 구로구 온수동 155",{legalDong:"온수동",jibun:"",normalizedJibun:""}),"");
});
