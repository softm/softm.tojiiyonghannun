const MAX_HISTORY_ITEMS = 6;

function text(value, maxLength = 160) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeHistoryItem(item) {
  const pnu = text(item?.pnu, 19);
  if (!/^\d{19}$/.test(pnu)) return null;
  const longitude = Number(item?.longitude);
  const latitude = Number(item?.latitude);
  return {
    pnu,
    primaryAddress: text(item?.primaryAddress),
    parcelAddress: text(item?.parcelAddress),
    roadAddress: text(item?.roadAddress),
    buildingName: text(item?.buildingName, 100),
    matchTypes: Array.isArray(item?.matchTypes) ? item.matchTypes.filter((type) => type === "road" || type === "parcel") : [],
    longitude: Number.isFinite(longitude) ? longitude : null,
    latitude: Number.isFinite(latitude) ? latitude : null,
    viewedAt: Number.isFinite(Number(item?.viewedAt)) ? Number(item.viewedAt) : Date.now()
  };
}

export function parseHistory(raw) {
  try {
    const items = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(items)) return [];
    return items.map(normalizeHistoryItem).filter(Boolean).slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

export function addHistoryItem(history, item, viewedAt = Date.now()) {
  const normalized = normalizeHistoryItem({...item, viewedAt});
  if (!normalized) return [...history].slice(0, MAX_HISTORY_ITEMS);
  return [normalized, ...history.filter((entry) => entry.pnu !== normalized.pnu)].slice(0, MAX_HISTORY_ITEMS);
}

function searchText(value) {
  return text(value).toLocaleLowerCase("ko-KR");
}

export function filterHistoryItems(history, query, limit = MAX_HISTORY_ITEMS) {
  const tokens = searchText(query).split(/\s+/).filter(Boolean);
  return history.filter((item) => {
    if (!tokens.length) return true;
    const fields = [item?.parcelAddress, item?.primaryAddress, item?.roadAddress, item?.buildingName, item?.pnu]
      .map(searchText)
      .filter(Boolean);
    return tokens.every((token) => fields.some((field) => field.includes(token)));
  }).slice(0, Math.max(0, Number(limit) || 0));
}

export {MAX_HISTORY_ITEMS};
