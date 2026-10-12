import test from "node:test";
import assert from "node:assert/strict";
import {hasMolitApiKey, requestTransactions} from "../transaction-api.js";

function responseXml({month = "202610", page = 1, totalCount = 1, code = "00", message = "OK"} = {}) {
  const year = month.slice(0, 4);
  const monthNumber = Number(month.slice(4));
  const item = code === "00" ? `<item><dealAmount>${page === 1 ? "10,000" : "11,000"}</dealAmount><dealYear>${year}</dealYear><dealMonth>${monthNumber}</dealMonth><dealDay>${page}</dealDay><umdNm>옥길동</umdNm><jibun>168-8</jibun><dealArea>100</dealArea></item>` : "";
  return `<?xml version="1.0"?><response><header><resultCode>${code}</resultCode><resultMsg>${message}</resultMsg></header><body><items>${item}</items><numOfRows>1000</numOfRows><pageNo>${page}</pageNo><totalCount>${totalCount}</totalCount></body></response>`;
}

test("24개월을 최대 3개씩 호출하고 페이지네이션·부분 실패를 집계한다", async () => {
  globalThis.__TOJI_RUNTIME_CONFIG__ = {molitApiKey: "encoded-test-key"};
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const progress = [];
  const fetchImpl = async (url) => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    const target = new URL(url);
    const month = target.searchParams.get("DEAL_YMD");
    const page = Number(target.searchParams.get("pageNo"));
    assert.equal(target.searchParams.get("LAWD_CD"), "41194");
    if (month === "202609") return new Response("temporary", {status: 503});
    return new Response(responseXml({month, page, totalCount: month === "202610" ? 1001 : 1}), {
      status: 200,
      headers: {"Content-Type": "application/xml"}
    });
  };

  assert.equal(hasMolitApiKey(), true);
  const result = await requestTransactions({
    type: "land",
    pnu: "4119410400101680008",
    parcelAddress: "경기도 부천시 옥길동 168-8",
    selectedArea: 100,
    now: new Date(2026, 9, 12),
    fetchImpl,
    onProgress: ({completed}) => progress.push(completed)
  });

  assert.equal(maxActive, 3);
  assert.equal(calls, 25);
  assert.equal(result.requestedMonths, 24);
  assert.equal(result.failedMonths, 1);
  assert.equal(result.scope, "exact");
  assert.equal(result.totalCount, 24);
  assert.equal(progress.at(-1), 24);
});

test("키 누락 상태를 별도 오류로 안내한다", async () => {
  globalThis.__TOJI_RUNTIME_CONFIG__ = {molitApiKey: ""};
  await assert.rejects(
    requestTransactions({
      type: "apartment",
      pnu: "1111010100100010001",
      now: new Date(2026, 9, 12),
      fetchImpl: async () => { throw new Error("호출되면 안 됨"); }
    }),
    (error) => error.code === "MISSING_KEY"
  );
});

test("인증 오류와 쿼터 초과를 구분한다", async () => {
  globalThis.__TOJI_RUNTIME_CONFIG__ = {molitApiKey: "test-key"};
  const base = {type: "factory", pnu: "1111010100100020001", now: new Date(2026, 8, 12)};
  await assert.rejects(
    requestTransactions({...base, fetchImpl: async () => new Response(responseXml({code: "30", message: "SERVICE KEY IS NOT REGISTERED"}), {status: 200})}),
    (error) => error.code === "AUTH"
  );
  await assert.rejects(
    requestTransactions({...base, pnu: "1111010100100030001", fetchImpl: async () => new Response(responseXml({code: "22", message: "LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS"}), {status: 200})}),
    (error) => error.code === "QUOTA"
  );
});
