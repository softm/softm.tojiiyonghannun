import test from "node:test";
import assert from "node:assert/strict";
import {
  PROPERTY_DOCUMENT_URLS,
  buildBuildingLifecycleUrl,
  buildDistrictPlanUrl,
  buildEumLandUseUrl,
  buildingPostFields,
  hasDistrictPlan,
  landRegisterPostFields,
  landUsePostFields,
  normalizeBuildingRecords,
  parcelDocumentIdentity
} from "../property-documents.js";

const ordinaryPnu = "4119410400101680008";
const mountainPnu = "4119410400201680008";

test("VWorld 건축물 응답을 전체·개별 선택 모델로 정규화한다", () => {
  const records = normalizeBuildingRecords({buildingUses: {field: [
    {buldIdntfcNo: "41194000990002", agbldgSeCode: "3", buldNm: "부속동", mainPrposCodeNm: "창고시설", buldTotar: "20", buldMainAtachSeCode: "1"},
    {buldIdntfcNo: "41194000990001", agbldgSeCode: "1", buldDongNm: "101동", detailPrposCodeNm: "공동주택", groundFloorCo: "18", buldTotar: "8100.5", useConfmDe: "20200131", buldMainAtachSeCode: "0"}
  ]}});
  assert.equal(records.length, 2);
  assert.equal(records[0].id, "41194000990001");
  assert.equal(records[0].isMain, true);
  assert.equal(records[0].name, "101동");
  assert.equal(records[0].totalArea, 8100.5);
});

test("일반·산 PNU를 국토부 대장용 코드와 본번·부번으로 변환한다", () => {
  assert.deepEqual(parcelDocumentIdentity(ordinaryPnu), {
    pnu: ordinaryPnu,
    registryPnu: "4119410400001680008",
    mainNumber: "0168",
    subNumber: "0008",
    displayJibun: "168-8"
  });
  assert.equal(parcelDocumentIdentity(mountainPnu).registryPnu, "4119410400101680008");
  assert.equal(parcelDocumentIdentity(mountainPnu).displayJibun, "산 168-8");
});

test("건축물·토지대장·토지이용계획 POST 필드를 구분한다", () => {
  const building = buildingPostFields(ordinaryPnu, {id: "109717552", ledgerKind: "3"});
  assert.deepEqual(building, {mgmBldrgstPk: "109717552", regstrKindCd: "3", pnuCode: "4119410400001680008"});
  assert.deepEqual(landRegisterPostFields(ordinaryPnu), {pnuCode: "4119410400001680008", jibunBonbun: "0168", jibunBubun: "0008"});
  assert.deepEqual(landUsePostFields(ordinaryPnu), {pnuCode: ordinaryPnu, jibunBonbun: "0168", jibunBubun: "0008"});
  assert.match(PROPERTY_DOCUMENT_URLS.building, /RtecsBildRegstrInfoPreview\.do$/);
});

test("건축물 생애이력 URL은 대장용 PNU와 건물 식별자를 사용한다", () => {
  const target = new URL(buildBuildingLifecycleUrl("4119210200101000001", "109717552"));
  assert.equal(target.searchParams.get("bldrgstPk"), "41192-7552");
  assert.equal(target.searchParams.get("searchPnu"), "4119210200001000001");
  assert.equal(target.searchParams.get("searchType"), "B");
});

test("토지이음 URL은 PNU의 행정구역·필지 번호를 공식 조회 파라미터로 분해한다", () => {
  const target = new URL(buildEumLandUseUrl("4119210200101000001"));
  assert.equal(target.origin, "https://www.eum.go.kr");
  assert.equal(target.searchParams.get("selSido"), "41");
  assert.equal(target.searchParams.get("selSgg"), "192");
  assert.equal(target.searchParams.get("selUmd"), "0102");
  assert.equal(target.searchParams.get("selRi"), "00");
  assert.equal(target.searchParams.get("landGbn"), "1");
  assert.equal(target.searchParams.get("bobn"), "0100");
  assert.equal(target.searchParams.get("bubn"), "0001");
  assert.equal(target.searchParams.get("pnu"), "4119210200101000001");
});

test("서울 필지에 지구단위계획 지정이 있을 때만 서울 계획 URL을 제공한다", () => {
  const seoulPnu = "1153010700103350012";
  assert.equal(hasDistrictPlan({nationalPlan: [{name: "지구단위계획구역"}]}, seoulPnu), true);
  assert.equal(hasDistrictPlan({nationalPlan: [{name: "도시지역"}]}, seoulPnu), false);
  assert.equal(hasDistrictPlan({nationalPlan: [{name: "지구단위계획구역"}]}, ordinaryPnu), false);
  assert.equal(new URL(buildDistrictPlanUrl(seoulPnu)).searchParams.get("pnu"), seoulPnu);
  assert.equal(buildDistrictPlanUrl(ordinaryPnu), "");
});
