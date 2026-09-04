import { emptyHistory, mergeAttempt } from "./logic.js";

const DB_NAME = "eicomi-words";
const DB_VERSION = 1;
const HISTORY_STORE = "history";
const META_STORE = "meta";
const FALLBACK_KEY = "eicomi-words:fallback";

let databasePromise;
let useFallback = false;

// 別タブでの削除・アップグレードなどで接続が閉じられた場合は、
// 次のアクセスで開き直せるように接続をリセットする。
function resetConnection() {
  databasePromise = undefined;
}

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
    request.onsuccess = () => {
      const database = request.result;
      database.onclose = resetConnection;
      database.onversionchange = () => {
        database.close();
        resetConnection();
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB open was blocked"));
  }).catch((error) => {
    console.warn("IndexedDB を開けなかったため localStorage を使います。", error);
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
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.warn("localStorage への保存に失敗しました。", error);
    return false;
  }
}

// IndexedDB への書き込みが失敗した場合は localStorage へ切り替えて保存し直す。
// 保存が一度でも失敗したまま黙って進むと、学習結果が消えてしまうため。
function switchToFallback(error) {
  console.warn("IndexedDB への保存に失敗したため localStorage へ切り替えます。", error);
  useFallback = true;
  resetConnection();
}

// 書き込みは request.onsuccess ではなく transaction の complete まで待つ。
// complete 前に画面を閉じるとコミットされず、保存されないことがあるため。
function runTransaction(database, storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = database.transaction(storeName, mode);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(box?.value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    let box;
    try {
      box = operation(tx.objectStore(storeName), tx);
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // 既に異常終了している場合は何もしない。
      }
      reject(error);
    }
  });
}

// 単一リクエストの結果を transaction 完了まで持ち越すための入れ物。
function requestBox(store, operation) {
  const box = { value: undefined };
  const request = operation(store);
  request.onsuccess = () => {
    box.value = request.result;
  };
  return box;
}

async function transaction(storeName, mode, operation) {
  const database = await openDatabase();
  if (!database || useFallback) return null;
  return runTransaction(database, storeName, mode, (store) => requestBox(store, operation));
}

export async function loadHistory() {
  await openDatabase();
  if (useFallback) {
    const data = fallbackData();
    return new Map(Object.entries(data.history ?? {}));
  }
  try {
    const records = await transaction(HISTORY_STORE, "readonly", (store) => store.getAll());
    return new Map((records ?? []).map((record) => [record.itemId, record]));
  } catch (error) {
    switchToFallback(error);
    const data = fallbackData();
    return new Map(Object.entries(data.history ?? {}));
  }
}

function recordAttemptToFallback(itemId, mode, correct, durationMs) {
  const data = fallbackData();
  const current = data.history?.[itemId] ?? emptyHistory(itemId);
  const next = mergeAttempt(current, { itemId, mode, correct, durationMs });
  data.history = { ...(data.history ?? {}), [itemId]: next };
  if (!writeFallback(data)) throw new Error("回答履歴を保存できませんでした");
  return next;
}

export async function recordAttempt(itemId, mode, correct, durationMs) {
  const database = await openDatabase();
  if (useFallback || !database) return recordAttemptToFallback(itemId, mode, correct, durationMs);

  try {
    return await runTransaction(database, HISTORY_STORE, "readwrite", (store) => {
      const box = { value: undefined };
      const getRequest = store.get(itemId);
      getRequest.onsuccess = () => {
        const next = mergeAttempt(getRequest.result, {
          itemId,
          mode,
          correct,
          durationMs,
        });
        box.value = next;
        store.put(next);
      };
      return box;
    });
  } catch (error) {
    switchToFallback(error);
    return recordAttemptToFallback(itemId, mode, correct, durationMs);
  }
}

// 直前の回答を取り消すため、回答前のレコードをそのまま書き戻す／削除する。
export async function putHistory(record) {
  if (!record?.itemId) return null;
  await openDatabase();
  const writeToFallback = () => {
    const data = fallbackData();
    data.history = { ...(data.history ?? {}), [record.itemId]: record };
    if (!writeFallback(data)) throw new Error("回答履歴を保存できませんでした");
    return record;
  };
  if (useFallback) return writeToFallback();
  try {
    await transaction(HISTORY_STORE, "readwrite", (store) => store.put(record));
    return record;
  } catch (error) {
    switchToFallback(error);
    return writeToFallback();
  }
}

export async function removeHistory(itemId) {
  await openDatabase();
  const removeFromFallback = () => {
    const data = fallbackData();
    if (data.history) delete data.history[itemId];
    if (!writeFallback(data)) throw new Error("回答履歴を保存できませんでした");
  };
  if (useFallback) {
    removeFromFallback();
    return;
  }
  try {
    await transaction(HISTORY_STORE, "readwrite", (store) => store.delete(itemId));
  } catch (error) {
    switchToFallback(error);
    removeFromFallback();
  }
}

export async function getMeta(key, fallback = null) {
  await openDatabase();
  if (useFallback) return fallbackData().meta?.[key] ?? fallback;
  try {
    const record = await transaction(META_STORE, "readonly", (store) => store.get(key));
    return record?.value ?? fallback;
  } catch (error) {
    switchToFallback(error);
    return fallbackData().meta?.[key] ?? fallback;
  }
}

export async function getMetaObject(key, defaults = {}) {
  const value = await getMeta(key, null);
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { ...defaults, ...stored };
}

export async function setMeta(key, value) {
  await openDatabase();
  const writeToFallback = () => {
    const data = fallbackData();
    data.meta = { ...(data.meta ?? {}), [key]: value };
    if (!writeFallback(data)) throw new Error(`${key} を保存できませんでした`);
  };
  if (useFallback) {
    writeToFallback();
    return;
  }
  try {
    await transaction(META_STORE, "readwrite", (store) => store.put({ key, value }));
  } catch (error) {
    switchToFallback(error);
    writeToFallback();
  }
}

export async function clearAllData() {
  await openDatabase();
  try {
    localStorage.removeItem(FALLBACK_KEY);
  } catch (error) {
    console.warn("localStorage を消去できませんでした。", error);
  }
  if (useFallback) return;
  try {
    await transaction(HISTORY_STORE, "readwrite", (store) => store.clear());
    await transaction(META_STORE, "readwrite", (store) => store.clear());
  } catch (error) {
    console.warn("IndexedDB を消去できませんでした。", error);
  }
}
