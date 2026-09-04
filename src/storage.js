import { emptyHistory, mergeAttempt } from "./logic.js";

const DB_NAME = "eicomi-words";
const DB_VERSION = 1;
const HISTORY_STORE = "history";
const META_STORE = "meta";
const FALLBACK_KEY = "eicomi-words:fallback";
// IndexedDB へ書き込み中のデータの控え。コミット前に画面を閉じても失われないよう、
// 書き込みを始める前に localStorage へ同期で置き、コミットできたら取り除く。
const PENDING_KEY = "eicomi-words:pending";

let databasePromise;
let useFallback = false;
let pendingRestored = false;

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

function pendingData() {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}") || {};
    return { history: raw.history ?? {}, meta: raw.meta ?? {} };
  } catch {
    return { history: {}, meta: {} };
  }
}

function writePending(data) {
  try {
    if (!Object.keys(data.history).length && !Object.keys(data.meta).length) {
      localStorage.removeItem(PENDING_KEY);
      return;
    }
    localStorage.setItem(PENDING_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn("保存中データの控えを書けませんでした。", error);
  }
}

// 書き込みの前後で控えを足し引きする。localStorage は同期なので、
// この間に画面を閉じられても控えは必ず残る。
function addPending(kind, key, value) {
  const data = pendingData();
  data[kind][key] = value;
  writePending(data);
}

function removePending(kind, key) {
  const data = pendingData();
  if (!(key in data[kind])) return;
  delete data[kind][key];
  writePending(data);
}

// 前回コミットできなかった書き込みを IndexedDB へ入れ直す。
async function restorePending(database) {
  if (pendingRestored) return;
  pendingRestored = true;
  const data = pendingData();
  const historyEntries = Object.values(data.history);
  const metaEntries = Object.entries(data.meta);
  if (!historyEntries.length && !metaEntries.length) return;
  try {
    if (historyEntries.length) {
      await runTransaction(database, HISTORY_STORE, "readwrite", (store) => {
        historyEntries.forEach((record) => store.put(record));
        return { value: null };
      });
    }
    if (metaEntries.length) {
      await runTransaction(database, META_STORE, "readwrite", (store) => {
        metaEntries.forEach(([key, value]) => store.put({ key, value }));
        return { value: null };
      });
    }
    writePending({ history: {}, meta: {} });
  } catch (error) {
    console.warn("保存中データを書き戻せませんでした。", error);
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
  const database = await openDatabase();
  if (useFallback || !database) {
    const data = fallbackData();
    return new Map(Object.entries(data.history ?? {}));
  }
  try {
    await restorePending(database);
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
    await restorePending(database);
    const current = await runTransaction(database, HISTORY_STORE, "readonly", (store) =>
      requestBox(store, (target) => target.get(itemId)));
    const next = mergeAttempt(current, { itemId, mode, correct, durationMs });
    // 書き込む値が決まった時点で控えを置く。ここから先で画面を閉じられても、
    // 次回の起動時に控えから IndexedDB へ書き戻せる。
    addPending("history", itemId, next);
    await runTransaction(database, HISTORY_STORE, "readwrite", (store) => {
      store.put(next);
      return { value: next };
    });
    removePending("history", itemId);
    return next;
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
    addPending("history", record.itemId, record);
    await transaction(HISTORY_STORE, "readwrite", (store) => store.put(record));
    removePending("history", record.itemId);
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
    removePending("history", itemId);
    await transaction(HISTORY_STORE, "readwrite", (store) => store.delete(itemId));
  } catch (error) {
    switchToFallback(error);
    removeFromFallback();
  }
}

export async function getMeta(key, fallback = null) {
  const database = await openDatabase();
  if (useFallback || !database) return fallbackData().meta?.[key] ?? fallback;
  try {
    await restorePending(database);
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
    addPending("meta", key, value);
    await transaction(META_STORE, "readwrite", (store) => store.put({ key, value }));
    removePending("meta", key);
  } catch (error) {
    switchToFallback(error);
    writeToFallback();
  }
}

// 画面を閉じる直前など、非同期の保存が間に合わない場面で使う同期の退避。
// 控えに置いておけば、次回の起動時に IndexedDB へ書き戻される。
export function stashMeta(key, value) {
  if (useFallback) {
    const data = fallbackData();
    data.meta = { ...(data.meta ?? {}), [key]: value };
    writeFallback(data);
    return;
  }
  addPending("meta", key, value);
}

export async function clearAllData() {
  await openDatabase();
  try {
    localStorage.removeItem(FALLBACK_KEY);
    localStorage.removeItem(PENDING_KEY);
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
