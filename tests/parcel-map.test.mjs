import test from "node:test";
import assert from "node:assert/strict";
import {geometryPolygons, lonLatToMapPixel, lonLatToWorldPixel} from "../parcel-map.js";

test("지도 중심 좌표를 이미지 중앙 픽셀로 변환한다", () => {
  const center = [126.825088, 37.466096];
  assert.deepEqual(lonLatToMapPixel(center, center, 1024, 620, 18), [512, 310]);
});

test("경도 증가 방향은 오른쪽이고 위도 증가 방향은 위쪽이다", () => {
  const center = [126.825088, 37.466096];
  const centerPixel = lonLatToWorldPixel(...center, 18);
  const east = lonLatToWorldPixel(center[0] + 0.001, center[1], 18);
  const north = lonLatToWorldPixel(center[0], center[1] + 0.001, 18);
  assert.ok(east.x > centerPixel.x);
  assert.ok(north.y < centerPixel.y);
});

test("Polygon과 MultiPolygon을 동일한 폴리곤 목록으로 정규화한다", () => {
  const polygon = [[[126, 37], [127, 37], [126, 37]]];
  assert.deepEqual(geometryPolygons({type: "Polygon", coordinates: polygon}), [polygon]);
  assert.deepEqual(geometryPolygons({type: "MultiPolygon", coordinates: [polygon]}), [polygon]);
  assert.deepEqual(geometryPolygons({type: "Point", coordinates: [126, 37]}), []);
});
