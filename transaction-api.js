import {
  TRANSACTION_TYPES,
  analyzeTransactions,
  cacheTtlForMonth,
  parcelIdentity,
  parseTransactionXml,
  pruneCacheRecords,
  recommendTransactionType,
  recentMonths,
  runWithConcurrency
} from "./transaction-model.js?v=20261013-11";

const DATABASE_NAME = "tojiiyonghannun-rtms-v1";
const STORE_NAME = "monthly-transactions";
const memoryCache = new Map();
let databasePromise;

export class TransactionApiError extends Error {
  constructor(message, code = "TRANSACTION_ERROR") {
    super(message);
    this.name = "TransactionApiError";
    this.code = code;
  }
}

export function getMolitApiKey() {
  return String(globalThis.__TOJI_RUNTIME_CONFIG__?.molitApiKey || "").trim();
}

export function hasMolitApiKey() {
  return Boolean(getMolitApiKey());
}

function normalizedServiceKey(value) {
  const key = String(value || "").trim();
  if (!key.includes("%")) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, {keyPath: "key"});
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

function databaseRequest(database, mode, callback) {
  return new Promise((resolve) => {
    if (!database) {
      resolve(null);
      return;
    }
    try {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = callback(store);
      request.onsuccess = () => resolve(request.result ?? true);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function getCachedMonth(key, month) {
  const database = await openDatabase();
  const record = database
    ? await databaseRequest(database, "readonly", (store) => store.get(key))
    : memoryCache.get(key);
  if (!record) return null;
  if (Date.now() - Number(record.storedAt || 0) > cacheTtlForMonth(month)) return null;
  return record;
}

async function pruneDatabase(database) {
  if (!database) {
    const retained = pruneCacheRecords(memoryCache.values());
    memoryCache.clear();
    retained.forEach((record) => memoryCache.set(record.key, record));
    return;
  }
  const records = await databaseRequest(database, "readonly", (store) => store.getAll());
  if (!Array.isArray(records) || records.length <= 200) return;
  const retainedKeys = new Set(pruneCacheRecords(records).map((record) => record.key));
  await Promise.all(records.filter((record) => !retainedKeys.has(record.key))
    .map((record) => databaseRequest(database, "readwrite", (store) => store.delete(record.key))));
}

async function putCachedMonth(record) {
  const database = await openDatabase();
  if (database) await databaseRequest(database, "readwrite", (store) => store.put(record));
  else memoryCache.set(record.key, record);
  await pruneDatabase(database);
}

function responseError(code, message, status = 0) {
  const normalized = String(code || "").trim();
  const copy = String(message || "").trim();
  if (status === 401 || ["20", "30", "31"].includes(normalized)) {
    return new TransactionApiError("공공데이터 인증키가 없거나 해당 거래 API 활용승인이 필요합니다.", "AUTH");
  }
  if (["22", "23"].includes(normalized)) {
    return new TransactionApiError("공공데이터 API 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.", "QUOTA");
  }
  if (status >= 500) return new TransactionApiError("국토교통부 실거래가 서비스가 일시적으로 응답하지 않습니다.", "UPSTREAM");
  return new TransactionApiError(copy || "실거래가 정보를 불러오지 못했습니다.", "UPSTREAM");
}

async function fetchPage({type, lawdCd, month, pageNo, signal, fetchImpl}) {
  const definition = TRANSACTION_TYPES[type];
  if (!definition) throw new TransactionApiError("지원하지 않는 거래 유형입니다.", "INVALID_TYPE");
  const serviceKey = normalizedServiceKey(getMolitApiKey());
  if (!serviceKey) throw new TransactionApiError("실거래 조회용 공공데이터 인증키가 설정되지 않았습니다.", "MISSING_KEY");
  const target = new URL(definition.endpoint);
  target.searchParams.set("serviceKey", serviceKey);
  target.searchParams.set("LAWD_CD", lawdCd);
  target.searchParams.set("DEAL_YMD", month);
  target.searchParams.set("pageNo", String(pageNo));
  target.searchParams.set("numOfRows", "1000");
  let response;
  try {
    response = await fetchImpl(target, {headers: {Accept: "application/xml,text/xml"}, signal});
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new TransactionApiError("국토교통부 실거래가 서비스에 연결하지 못했습니다.", "NETWORK");
  }
  const xml = await response.text();
  const parsed = parseTransactionXml(xml, type);
  if (!response.ok || (parsed.resultCode && !["00", "000"].includes(parsed.resultCode))) {
    throw responseError(parsed.resultCode, parsed.resultMessage, response.status);
  }
  return parsed;
}

async function fetchMonth({type, lawdCd, month, signal, fetchImpl = fetch}) {
  const key = `${type}:${lawdCd}:${month}`;
  const cached = await getCachedMonth(key, month);
  if (cached) return {...cached, cached: true};
  const first = await fetchPage({type, lawdCd, month, pageNo: 1, signal, fetchImpl});
  const pages = Math.max(1, Math.ceil(first.totalCount / 1000));
  const cappedPages = Math.min(pages, 5);
  const remaining = [];
  for (let pageNo = 2; pageNo <= cappedPages; pageNo += 1) {
    remaining.push(fetchPage({type, lawdCd, month, pageNo, signal, fetchImpl}));
  }
  const rest = remaining.length ? await Promise.all(remaining) : [];
  const record = {
    key,
    type,
    lawdCd,
    month,
    storedAt: Date.now(),
    totalCount: first.totalCount,
    truncated: pages > 5,
    items: [first, ...rest].flatMap((page) => page.items)
  };
  await putCachedMonth(record);
  return {...record, cached: false};
}

export async function requestTransactions({
  type,
  pnu,
  parcelAddress = "",
  selectedArea = 0,
  signal,
  onProgress = () => {},
  now = new Date(),
  fetchImpl = fetch
}) {
  const definition = TRANSACTION_TYPES[type];
  if (!definition) throw new TransactionApiError("지원하지 않는 거래 유형입니다.", "INVALID_TYPE");
  const {lawdCd} = parcelIdentity(pnu);
  const months = recentMonths(24, now);
  let completed = 0;
  const tasks = months.map((month) => async () => fetchMonth({type, lawdCd, month, signal, fetchImpl}));
  const settled = await runWithConcurrency(tasks, 3, () => {
    completed += 1;
    onProgress({completed, total: months.length, percent: Math.round(completed / months.length * 100)});
  });
  if (signal?.aborted) throw new DOMException("요청이 취소되었습니다.", "AbortError");
  const fulfilled = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const failures = settled.filter((result) => result.status === "rejected");
  if (!fulfilled.length) throw failures[0]?.reason || new TransactionApiError("실거래가 정보를 불러오지 못했습니다.");
  const analysis = analyzeTransactions(fulfilled.flatMap((record) => record.items), {
    type,
    pnu,
    parcelAddress,
    selectedArea
  });
  return {
    ...analysis,
    definition,
    requestedMonths: months.length,
    failedMonths: failures.length,
    truncated: fulfilled.some((record) => record.truncated),
    cachedMonths: fulfilled.filter((record) => record.cached).length
  };
}

export {TRANSACTION_TYPES, recommendTransactionType};
