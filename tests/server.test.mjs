import test from "node:test";
import assert from "node:assert/strict";
import {once} from "node:events";
import {createAppServer} from "../server.mjs";

const pnu = "2714010200105510023";

function mockResponse(body, {status = 200, contentType = "application/json"} = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {status, headers: {"Content-Type": contentType}});
}

async function withServer(fetchImpl, callback) {
  const server = createAppServer({fetchImpl, getConfig: () => ({vworldApiKey: "test-key", vworldDomain: "localhost"})});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const {port} = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("주소 검색 API가 두 검색 범주를 합쳐 반환한다", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const category = new URL(url).searchParams.get("category");
    return mockResponse({response: {status: "OK", result: {items: [{id: pnu, address: {
      road: "대구광역시 동구 신암로16길 16",
      parcel: "대구광역시 동구 신천동 551-23",
      bldnm: category === "road" ? "가람타운" : ""
    }}]}}});
  };
  await withServer(fetchImpl, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/address-search?q=${encodeURIComponent("신천동 551-23")}`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.items.length, 1);
    assert.deepEqual(payload.items[0].matchTypes, ["road", "parcel"]);
  });
  assert.equal(calls, 2);
});

test("잘못된 검색어와 PNU는 외부 요청 전에 거부한다", async () => {
  let calls = 0;
  await withServer(async () => { calls += 1; return mockResponse({}); }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/address-search?q=a`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/land-use?pnu=123`)).status, 400);
  });
  assert.equal(calls, 0);
});

test("토지이용계획 API가 토지이음과 공시지가를 결합한다", async () => {
  const html = `<!doctype html><input id="pnu" value="${pnu}"><table><tr><td><div id="present_addr"></div>대구광역시 동구 신천동 551-23</td></tr></table><input id="present_class_val" value="대"><span id="present_area">17,997 ㎡</span><div id="present_mark1">도시지역</div>`;
  const fetchImpl = async (url) => String(url).includes("getIndvdLandPriceAttr")
    ? mockResponse({indvdLandPrices: {field: {stdrYear: "2025", pblntfPclnd: "1350000"}}})
    : mockResponse(html, {contentType: "text/html; charset=utf-8"});
  await withServer(fetchImpl, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/land-use?pnu=${pnu}`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.landCategory, "대");
    assert.equal(payload.data.price, 1350000);
    assert.equal(payload.data.officialUrl.includes(pnu), true);
  });
});

test("설정 파일과 서버 내부 모듈은 정적으로 제공하지 않는다", async () => {
  await withServer(fetch, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/config.example.js`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/lib/land-use.mjs`)).status, 404);
  });
});
