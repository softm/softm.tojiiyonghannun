const PNU_PATTERN = /^\d{19}$/;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validCoordinate(value, min, max) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

export function buildParcelShareUrl(baseUrl, item) {
  const pnu = String(item?.pnu || "");
  if (!PNU_PATTERN.test(pnu)) throw new Error("공유할 필지의 19자리 PNU가 필요합니다.");
  const url = new URL("./", baseUrl);
  const address = cleanText(item.parcelAddress || item.primaryAddress);
  const roadAddress = cleanText(item.roadAddress);
  const buildingName = cleanText(item.buildingName);
  const longitude = validCoordinate(item.longitude, -180, 180);
  const latitude = validCoordinate(item.latitude, -90, 90);
  url.searchParams.set("pnu", pnu);
  if (address) url.searchParams.set("address", address);
  if (roadAddress) url.searchParams.set("road", roadAddress);
  if (buildingName) url.searchParams.set("building", buildingName);
  if (longitude !== undefined) url.searchParams.set("lng", String(longitude));
  if (latitude !== undefined) url.searchParams.set("lat", String(latitude));
  return url.toString();
}

export function parseParcelShareUrl(value) {
  const url = new URL(value, "https://tojiiyonghannun.invalid/");
  const pnu = String(url.searchParams.get("pnu") || "");
  if (!PNU_PATTERN.test(pnu)) return null;
  const parcelAddress = cleanText(url.searchParams.get("address"));
  const roadAddress = cleanText(url.searchParams.get("road"));
  const buildingName = cleanText(url.searchParams.get("building"));
  const longitude = validCoordinate(url.searchParams.get("lng"), -180, 180);
  const latitude = validCoordinate(url.searchParams.get("lat"), -90, 90);
  return {
    pnu,
    primaryAddress: parcelAddress || `PNU ${pnu}`,
    parcelAddress,
    roadAddress,
    buildingName,
    matchTypes: ["shared"],
    ...(longitude !== undefined && latitude !== undefined ? {longitude, latitude} : {})
  };
}
