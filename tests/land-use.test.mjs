import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficialUrl,
  isValidPnu,
  mergeSearchItems,
  normalizePricePayload,
  normalizePlaceCandidates,
  normalizeSearchItems,
  parseEumLandUseHtml
} from "../lib/land-use.mjs";

const pnu = "2714010200105510023";

test("PNU 검증과 공식 토지이음 URL 생성", () => {
  assert.equal(isValidPnu(pnu), true);
  assert.equal(isValidPnu("123"), false);
  const url = new URL(buildOfficialUrl(pnu));
  assert.equal(url.hostname, "www.eum.go.kr");
  assert.equal(url.searchParams.get("pnu"), pnu);
  assert.equal(url.searchParams.get("bobn"), "551");
  assert.equal(url.searchParams.get("bubn"), "23");
});

test("장소 검색 결과에서 필지 확인용 주소와 명칭을 추출한다", () => {
  const candidates = normalizePlaceCandidates({response: {status: "OK", result: {items: [{
    id: "POI-1",
    title: "옥길한신더휴",
    category: "시설구역경계 > 아파트단지",
    address: {parcel: "경기도 부천시 소사구 옥길동 742-1", road: "경기도 부천시 소사구 양지로 234-10"},
    point: {x: "126.825088", y: "37.466096"}
  }]}}});
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, "옥길한신더휴");
  assert.equal(candidates[0].parcelAddress, "경기도 부천시 소사구 옥길동 742-1");
  assert.equal(candidates[0].longitude, 126.825088);
});

test("도로명과 지번 검색 결과를 PNU 기준으로 합친다", () => {
  const roadPayload = {response: {status: "OK", result: {items: [{
    id: pnu,
    address: {road: "대구광역시 동구 신암로16길 16", parcel: "대구광역시 동구 신천동 551-23", bldnm: "가람타운"},
    point: {x: "128.609748", y: "35.876527"}
  }]}}};
  const parcelPayload = {response: {status: "OK", result: {items: [{
    id: pnu,
    address: {road: "신암로16길 16", parcel: "대구광역시 동구 신천동 551-23"}
  }, {id: "invalid", address: {parcel: "제외"}}]}}};
  const items = mergeSearchItems([
    normalizeSearchItems(roadPayload, "road"),
    normalizeSearchItems(parcelPayload, "parcel")
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].matchTypes, ["road", "parcel"]);
  assert.equal(items[0].pnu, pnu);
  assert.equal(items[0].buildingName, "가람타운");
  assert.equal(items[0].longitude, 128.609748);
  assert.equal(items[0].latitude, 35.876527);
});

test("토지이음 HTML에서 핵심 내용과 행위제한을 추출한다", () => {
  const html = `<!doctype html><html><body>
    <input id="pnu" value="${pnu}">
    <table><tr><td><div id="present_addr"></div>대구광역시 동구 신천동 551-23</td></tr></table>
    <input id="present_class_val" value="대">
    <span id="present_area">17,997 ㎡</span>
    <div id="present_mark1"><a class="link" onclick="live_layer_UQA123()">제3종일반주거지역</a><div class="layer_pop"><div class="layer_body"><strong>중고층 주택 중심 지역</strong></div></div>, 대로2류</div>
    <div id="present_mark2">가축사육제한구역</div>
    <div id="present_mark3">수질보전특별대책지역</div>
    <div id="act_content"><section class="act_contxt"><div class="title">제3종일반주거지역</div><p><strong>국토계획법</strong><a class="link">시행령 제71조</a><span class="mblock">(건축물 용도)</span></p></section></div>
  </body></html>`;
  const result = parseEumLandUseHtml(html, pnu);
  assert.equal(result.address, "대구광역시 동구 신천동 551-23");
  assert.equal(result.landCategory, "대");
  assert.equal(result.area, "17,997 ㎡");
  assert.equal(result.nationalPlan[0].name, "제3종일반주거지역");
  assert.equal(result.otherLaws[0].name, "가축사육제한구역");
  assert.equal(result.restrictions[0].rules[0].subject, "건축물 용도");
});

test("토지이음 응답의 PNU가 다르면 거부한다", () => {
  assert.throws(() => parseEumLandUseHtml('<input id="pnu" value="1111111111111111111">', pnu), /PNU가 일치하지 않습니다/);
});

test("가장 최근 개별공시지가를 선택한다", () => {
  const result = normalizePricePayload({indvdLandPrices: {field: [
    {stdrYear: "2024", pblntfPclnd: "1200000"},
    {stdrYear: "2025", pblntfPclnd: "1350000"}
  ]}});
  assert.deepEqual(result, {price: 1350000, priceYear: "2025"});
});
