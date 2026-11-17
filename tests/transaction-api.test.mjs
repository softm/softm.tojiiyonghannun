import test from "node:test";
import assert from "node:assert/strict";
import {gzipSync} from "node:zlib";
import {hasMolitApiKey, requestTransactions} from "../transaction-api.js";
import {recentMonths} from "../transaction-model.js";

function responseXml({month = "202610", page = 1, totalCount = 1, code = "00", message = "OK"} = {}) {
  const year = month.slice(0, 4);
  const monthNumber = Number(month.slice(4));
  const item = code === "00" ? `<item><dealAmount>${page === 1 ? "10,000" : "11,000"}</dealAmount><dealYear>${year}</dealYear><dealMonth>${monthNumber}</dealMonth><dealDay>${page}</dealDay><umdNm>옥길동</umdNm><jibun>168-8</jibun><dealArea>100</dealArea></item>` : "";
  return `<?xml version="1.0"?><response><header><resultCode>${code}</resultCode><resultMsg>${message}</resultMsg></header><body><items>${item}</items><numOfRows>1000</numOfRows><pageNo>${page}</pageNo><totalCount>${totalCount}</totalCount></body></response>`;
}

function isCollectedRequest(url) {
  return new URL(url).hostname === "softm.github.io";
}

function unpublished() {
  return new Response("Collected data not published", {status: 404});
}

test("수집 JSON이 미게시이면 API를 최대 3개씩 호출하고 페이지네이션·부분 실패를 집계한다", async () => {
  globalThis.__TOJI_RUNTIME_CONFIG__ = {molitApiKey: "encoded-test-key"};
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const collectedUrls = [];
  const progress = [];
  const fetchImpl = async (url) => {
    const target = new URL(url);
    // A shard-index probe is not a MOLIT API request. Keep the original
    // API call/concurrency assertions, and verify the new source separately.
    if (isCollectedRequest(target)) {
      collectedUrls.push(target);
      return unpublished();
    }
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    assert.equal(target.hostname, "apis.data.go.kr");
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

  assert.equal(collectedUrls.length, 1);
  assert.match(collectedUrls[0].pathname, /\/published\/41194\/land-sale\/index\.json$/);
  assert.equal(maxActive, 3);
  assert.equal(calls, 25);
  assert.equal(result.collectedMonths, 0);
  assert.equal(result.requestedMonths, 24);
  assert.equal(result.failedMonths, 1);
  assert.equal(result.scope, "exact");
  assert.equal(result.totalCount, 24);
  assert.equal(progress.at(-1), 24);
});

test("수집 자료도 없고 키도 없으면 API 호출 없이 키 누락 오류를 안내한다", async () => {
  globalThis.__TOJI_RUNTIME_CONFIG__ = {molitApiKey: ""};
  const requested = [];
  await assert.rejects(
    requestTransactions({
      type: "apartment",
      pnu: "1111010100100010001",
      now: new Date(2026, 9, 12),
      fetchImpl: async (url) => {
        requested.push(new URL(url));
        return unpublished();
      }
    }),
    (error) => error.code === "MISSING_KEY"
  );
  assert.equal(requested.length, 1);
  assert.equal(requested[0].hostname, "softm.github.io");
});

test("인증 오류와 쿼터 초과를 구분한다", async () => {
  globalThis.__TOJI_RUNTIME_CONFIG__ = {molitApiKey: "test-key"};
  const base = {type: "factory", pnu: "1111010100100020001", now: new Date(2026, 8, 12)};
  const errorFetch = (code, message) => async (url) => isCollectedRequest(url)
    ? unpublished()
    : new Response(responseXml({code, message}), {status: 200});
  await assert.rejects(
    requestTransactions({...base, fetchImpl: errorFetch("30", "SERVICE KEY IS NOT REGISTERED")}),
    (error) => error.code === "AUTH"
  );
  await assert.rejects(
    requestTransactions({...base, pnu: "1111010100100030001", fetchImpl: errorFetch("22", "LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS")}),
    (error) => error.code === "QUOTA"
  );
});

test("수집된 24개월 JSON은 인증키 없이 조회하고 API를 중복 호출하지 않는다", async () => {
  globalThis.__TOJI_RUNTIME_CONFIG__ = {molitApiKey: ""};
  const now = new Date(2026, 9, 12);
  const months = recentMonths(24, now);
  const part = "11110/apartment-sale/202610/aaaaaaaaaaaaaaaa-0.json.gz";
  const row = {
    type: "apartment", deal: "sale", district: "11110", umdNm: "청운동",
    jibun: "2", lot: "2", exactLotPublic: true, buildingName: "테스트 아파트",
    date: "2026-10-02", month: "202610", amount: 70000, area: 84,
    floor: "3", cancelled: false
  };
  const requested = [];
  const progress = [];
  const result = await requestTransactions({
    type: "apartment",
    pnu: "1111010100100020000",
    parcelAddress: "서울특별시 종로구 청운동 2",
    now,
    onProgress: ({completed}) => progress.push(completed),
    fetchImpl: async (url) => {
      const target = new URL(url);
      requested.push(target);
      if (target.hostname !== "softm.github.io") throw new Error("MOLIT API must not be called for covered months");
      if (target.pathname.endsWith("/published/11110/apartment-sale/index.json")) {
        return Response.json({
          schemaVersion: 2, district: "11110", stream: "apartment-sale",
          coverage: months, updatedAt: "2026-10-12T00:00:00Z",
          groups: {"청운동": [{path: part, month: "202610", rows: 1, encoding: "gzip"}]}
        });
      }
      if (target.pathname.endsWith("/published/" + part)) {
        return new Response(gzipSync(JSON.stringify({
          schemaVersion: 2, district: "11110", stream: "apartment-sale",
          emd: "청운동", rows: [row]
        })), {headers: {"Content-Type": "application/gzip"}});
      }
      return unpublished();
    }
  });
  assert.equal(requested.length, 2);
  assert.ok(requested.every((url) => url.hostname === "softm.github.io"));
  assert.equal(result.collectedMonths, 24);
  assert.equal(result.failedMonths, 0);
  assert.equal(result.cachedMonths, 0);
  assert.equal(result.scope, "exact");
  assert.equal(result.totalCount, 1);
  assert.equal(result.items[0].amount, 70000);
  assert.equal(result.items[0].unitPrice, 70000 * 10000 / 84);
  assert.equal(result.collectedUpdatedAt, "2026-10-12T00:00:00Z");
  assert.equal(progress.at(-1), 24);
});
