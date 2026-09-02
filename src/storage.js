import { emptyHistory, mergeAttempt } from "./logic.js";

const DB_NAME = "eicomi-words";
const DB_VERSION = 1;
const HISTORY_STORE = "history";
const META_STORE = "meta";
const FALLBACK_KEY = "eicomi-words:fallback";

let databasePromise;
let useFallback = false;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HISTORY_STORE)) {
        database.createObjectStore(HISTORY_STORE, { keyPath: "itemId" });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    console.warn("IndexedDB could not be opened; using localStorage.", error);
    useFallback = true;
    return null;
  });
  return databasePromise;
}

function fallbackData() {
  try {
    return JSON.parse(localStorage.getItem(FALLBACK_KEY) ?? "{}") || {};
  } catch {
    return {};
  }
}

function writeFallback(data) {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(data));
}

async function transaction(storeName, mode, operation) {
  const database = await openDatabase();
  if (!database || useFallback) return null;
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = operation(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadHistory() {
  await openDatabase();
  if (useFallback) {
    const data = fallbackData();
    return new Map(Object.entries(data.history ?? {}));
  }
  const records = await transaction(HISTORY_STORE, "readonly", (store) =>
    store.getAll(),
  );
  return new Map((records ?? []).map((record) => [record.itemId, record]));
}

export async function recordAttempt(itemId, mode, correct, durationMs) {
  await openDatabase();
  if (useFallback) {
    const data = fallbackData();
    const current = data.history?.[itemId] ?? emptyHistory(itemId);
    const next = mergeAttempt(current, { itemId, mode, correct, durationMs });
    data.history = { ...(data.history ?? {}), [itemId]: next };
    writeFallback(data);
    return next;
  }

  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(HISTORY_STORE, "readwrite");
    const store = tx.objectStore(HISTORY_STORE);
    const getRequest = store.get(itemId);
    getRequest.onsuccess = () => {
      const next = mergeAttempt(getRequest.result, {
        itemId,
        mode,
        correct,
        durationMs,
      });
      const putRequest = store.put(next);
      putRequest.onsuccess = () => resolve(next);
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

export async function getMeta(key, fallback = null) {
  await openDatabase();
  if (useFallback) return fallbackData().meta?.[key] ?? fallback;
  const record = await transaction(META_STORE, "readonly", (store) => store.get(key));
  return record?.value ?? fallback;
}

export async function getMetaObject(key, defaults = {}) {
  const value = await getMeta(key, null);
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { ...defaults, ...stored };
}

export async function setMeta(key, value) {
  await openDatabase();
  if (useFallback) {
    const data = fallbackData();
    data.meta = { ...(data.meta ?? {}), [key]: value };
    writeFallback(data);
    return;
  }
  await transaction(META_STORE, "readwrite", (store) => store.put({ key, value }));
}

export async function clearAllData() {
  await openDatabase();
  if (useFallback) {
    localStorage.removeItem(FALLBACK_KEY);
    return;
  }
  await Promise.all([
    transaction(HISTORY_STORE, "readwrite", (store) => store.clear()),
    transaction(META_STORE, "readwrite", (store) => store.clear()),
  ]);
}
