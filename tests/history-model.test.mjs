import test from "node:test";
import assert from "node:assert/strict";
import {addHistoryItem, filterHistoryItems, parseHistory, shouldShowRecentHistory} from "../history-model.js";

const parcel = (pnu, address) => ({
  pnu,
  parcelAddress: address,
  primaryAddress: address,
  roadAddress: "테스트로 1",
  matchTypes: ["parcel"],
  longitude: 127.1,
  latitude: 37.5
});

test("최근 조회 필지는 같은 PNU를 중복 없이 최신순으로 보관한다", () => {
  let history = addHistoryItem([], parcel("1111010100100010001", "첫 번째"), 100);
  history = addHistoryItem(history, parcel("1111010100100020002", "두 번째"), 200);
  history = addHistoryItem(history, parcel("1111010100100010001", "첫 번째 갱신"), 300);
  assert.deepEqual(history.map((item) => item.pnu), ["1111010100100010001", "1111010100100020002"]);
  assert.equal(history[0].parcelAddress, "첫 번째 갱신");
  assert.equal(history[0].viewedAt, 300);
});

test("저장 기록은 유효한 PNU만 최대 6개까지 복원한다", () => {
  const raw = JSON.stringify([
    parcel("1111010100100010001", "1"),
    parcel("1111010100100020002", "2"),
    parcel("1111010100100030003", "3"),
    parcel("1111010100100040004", "4"),
    parcel("1111010100100050005", "5"),
    parcel("1111010100100060006", "6"),
    parcel("1111010100100070007", "7"),
    {pnu: "invalid"}
  ]);
  const history = parseHistory(raw);
  assert.equal(history.length, 6);
  assert.equal(history[0].parcelAddress, "1");
});

test("최근 조회 자동완성은 주소, 도로명, 건물명과 PNU를 검색한다", () => {
  const history = [
    {...parcel("4119410600107420001", "경기도 부천시 소사구 옥길동 742-1"), roadAddress: "양지로 234-10", buildingName: "옥길한신더휴"},
    {...parcel("2714010200105510023", "대구광역시 동구 신천동 551-23"), roadAddress: "신암로16길 16"}
  ];
  assert.equal(filterHistoryItems(history, "옥길 742")[0].buildingName, "옥길한신더휴");
  assert.equal(filterHistoryItems(history, "양지로")[0].pnu, "4119410600107420001");
  assert.equal(filterHistoryItems(history, "한신더휴")[0].parcelAddress.includes("옥길동"), true);
  assert.equal(filterHistoryItems(history, "2714010200105510023")[0].parcelAddress.includes("신천동"), true);
  assert.equal(filterHistoryItems(history, "없는 주소").length, 0);
});

test("최근 조회 목록은 검색 전 기본 화면에서만 표시한다", () => {
  const history = [parcel("4119410600107420001", "경기도 부천시 소사구 옥길동 742-1")];
  assert.equal(shouldShowRecentHistory(history, "idle"), true);
  assert.equal(shouldShowRecentHistory(history, "active"), false);
  assert.equal(shouldShowRecentHistory([], "idle"), false);
});
