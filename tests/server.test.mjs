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

test("보고서 미리보기는 모바일 호환 HTML 컨테이너를 사용한다", async () => {
  await withServer(fetch, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /id="reportPreview"/);
    assert.doesNotMatch(html, /id="reportFrame"/);
  });
});

test("실거래·경매 UI와 브라우저 런타임 설정을 제공한다", async () => {
  await withServer(fetch, async (baseUrl) => {
    const html = await (await fetch(`${baseUrl}/`)).text();
    assert.match(html, /id="transactionCard"/);
    assert.match(html, /id="loadTransactions"/);
    assert.match(html, /id="copyAuctionAddress"/);
    assert.match(html, /https:\/\/www\.courtauction\.go\.kr\//);

    const response = await fetch(`${baseUrl}/runtime-config.js`);
    const script = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/javascript/);
    assert.match(script, /molitApiKey/);
    assert.doesNotMatch(script, /test-key/);
  });
});

test("건축물·토지대장 통합 뷰어와 건축물 공개정보 API를 제공한다", async () => {
  const fetchImpl = async (url) => {
    const target = new URL(url);
    assert.equal(target.pathname, "/ned/data/getBuildingUse");
    assert.equal(target.searchParams.get("pnu"), pnu);
    return mockResponse({buildingUses: {field: {
      buldIdntfcNo: "2714000012345",
      agbldgSeCode: "1",
      buldDongNm: "101동",
      mainPrposCodeNm: "공동주택",
      buldTotar: "4200.5",
      buldMainAtachSeCode: "0"
    }}});
  };
  await withServer(fetchImpl, async (baseUrl) => {
    const apiResponse = await fetch(`${baseUrl}/api/buildings?pnu=${pnu}`);
    const payload = await apiResponse.json();
    assert.equal(apiResponse.status, 200);
    assert.equal(payload.items[0].name, "101동");
    assert.equal(payload.items[0].isMain, true);

    const home = await (await fetch(`${baseUrl}/`)).text();
    const viewer = await (await fetch(`${baseUrl}/building-ledger.html`)).text();
    assert.match(home, /id="openPropertyDocuments"/);
    assert.match(viewer, /data-document-tab="building"/);
    assert.match(viewer, /data-document-tab="landRegister"/);
    assert.match(viewer, /data-document-tab="landUse"/);
    assert.match(viewer, /data-document-tab="eum"/);
    assert.match(viewer, /data-document-tab="districtPlan"/);
    assert.match(viewer, /data-document-tab="lifecycle"/);
  });
});

test("지도 화면은 현재 위치 기반 필지 조회 동작을 제공한다", async () => {
  await withServer(fetch, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();
    const script = await (await fetch(`${baseUrl}/app.js`)).text();
    assert.match(html, /id="currentLocation"/);
    assert.match(html, />현재 위치</);
    assert.match(script, /navigator\.geolocation\.getCurrentPosition/);
    assert.match(script, /await chooseMapPoint\(\[longitude, latitude\]\)/);
  });
});

test("주소 검색 API가 두 검색 범주를 합쳐 반환한다", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const target = new URL(url);
    if (target.searchParams.get("type") === "place") return mockResponse({response: {status: "NOT_FOUND"}});
    const category = target.searchParams.get("category");
    return mockResponse({response: {status: "OK", result: {items: [{id: pnu, address: {
      road: "대구광역시 동구 신암로16길 16",
      parcel: "대구광역시 동구 신천동 551-23",
      bldnm: category === "road" ? "가람타운" : ""
    }, point: {x: "128.609748", y: "35.876527"}}]}}});
  };
  await withServer(fetchImpl, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/address-search?q=${encodeURIComponent("신천동 551-23")}`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.items.length, 1);
    assert.deepEqual(payload.items[0].matchTypes, ["road", "parcel"]);
    assert.equal(payload.items[0].longitude, 128.609748);
  });
  assert.equal(calls, 3);
});

test("건물명 검색 결과를 지번주소로 재검색해 PNU 후보로 반환한다", async () => {
  const buildingPnu = "4119410600107420001";
  const fetchImpl = async (url) => {
    const target = new URL(url);
    const type = target.searchParams.get("type");
    const query = target.searchParams.get("query");
    if (type === "place") {
      return mockResponse({response: {status: "OK", result: {items: [{
        id: "POI-1",
        title: "옥길한신더휴",
        category: "시설구역경계 > 아파트단지",
        address: {parcel: "경기도 부천시 소사구 옥길동 742-1", road: "경기도 부천시 소사구 양지로 234-10"},
        point: {x: "126.825088", y: "37.466096"}
      }]}}});
    }
    if (query === "옥길한신더휴") return mockResponse({response: {status: "NOT_FOUND"}});
    return mockResponse({response: {status: "OK", result: {items: [{
      id: buildingPnu,
      address: {parcel: "경기도 부천시 소사구 옥길동 742-1", road: "경기도 부천시 소사구 양지로 234-10"},
      point: {x: "126.825088", y: "37.466096"}
    }]}}});
  };
  await withServer(fetchImpl, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/address-search?q=${encodeURIComponent("옥길한신더휴")}`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.items[0].pnu, buildingPnu);
    assert.equal(payload.items[0].buildingName, "옥길한신더휴");
    assert.deepEqual(payload.items[0].matchTypes, ["place"]);
  });
});

test("필지 부근 이미지 API가 VWorld 정적 지도를 PNG로 전달한다", async () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  let upstreamUrl = "";
  await withServer(async (url) => {
    upstreamUrl = String(url);
    return new Response(png, {status: 200, headers: {"Content-Type": "image/png"}});
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/vicinity-map?pnu=${pnu}&x=128.609748&y=35.876527`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
  });
  const target = new URL(upstreamUrl);
  assert.equal(target.pathname, "/req/image");
  assert.equal(target.searchParams.get("basemap"), "PHOTO_HYBRID");
  assert.match(target.searchParams.get("marker"), /선택 필지/);
});

test("필지 경계 API가 선택 PNU와 일치하는 GeoJSON 형상을 반환한다", async () => {
  const geometry = {type: "MultiPolygon", coordinates: [[[[128.6097, 35.8765], [128.6098, 35.8765], [128.6097, 35.8765]]]]};
  await withServer(async (url) => {
    const target = new URL(url);
    assert.equal(target.pathname, "/req/data");
    assert.equal(target.searchParams.get("geometry"), "true");
    return mockResponse({response: {status: "OK", result: {featureCollection: {features: [{
      type: "Feature",
      properties: {pnu},
      geometry
    }]}}}});
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/parcel-geometry?pnu=${pnu}&x=128.609748&y=35.876527`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.feature.properties.pnu, pnu);
    assert.deepEqual(payload.feature.geometry, geometry);
  });
});

test("지도 좌표에서 필지를 찾아 선택 가능한 주소 후보를 반환한다", async () => {
  const geometry = {type: "Polygon", coordinates: [[[126.825, 37.466], [126.826, 37.466], [126.825, 37.466]]]};
  await withServer(async () => mockResponse({response: {status: "OK", result: {featureCollection: {features: [{
    type: "Feature",
    properties: {pnu: "4119410600107420001", addr: "경기도 부천시 소사구 옥길동 742-1"},
    geometry
  }]}}}}), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/parcel-at-point?x=126.825088&y=37.466096`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.item.pnu, "4119410600107420001");
    assert.equal(payload.item.parcelAddress, "경기도 부천시 소사구 옥길동 742-1");
    assert.equal(payload.item.longitude, 126.825088);
    assert.deepEqual(payload.feature.geometry, geometry);
  });
});

test("잘못된 검색어와 PNU는 외부 요청 전에 거부한다", async () => {
  let calls = 0;
  await withServer(async () => { calls += 1; return mockResponse({}); }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/address-search?q=a`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/land-use?pnu=123`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/parcel-at-point?x=0&y=0`)).status, 400);
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
