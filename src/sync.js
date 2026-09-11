// 端末間の同期と、学習データの引き継ぎ（書き出し・読み込み）。
//
// できること
// ----------
//  1. 引き継ぎ … 学習データを1つのファイルに書き出し、別の端末で読み込む。
//                サーバーが無くても使える。機種変更のときなど、1回きりの移行向け。
//
//  2. 同期     … スマホとタブレットのように、同じ人が複数の端末で使う場合に、
//                どちらで解いても同じ学習データになるようにする。
//                words MCP Server に「同期コード」で接続すると使えるようになる。
//
// 同期のしくみ
// ------------
// 回答は1問ずつ「出来事」として記録し、それぞれに他と重ならない番号を付ける。
// 端末はその出来事を送るだけで、合計を送らない。サーバー側で番号の重複を除いて
// 積み上げるので、同じものを二度送っても回答数が増えず、電波が無いあいだに
// 貯めた分もあとからまとめて送れる。

export const DEVICE_SYNC_META_KEY = "deviceSync";

/** 引き継ぎファイルの目印。読み込むときに、wordsのファイルかどうかを確かめる。 */
export const TRANSFER_FORMAT = "words-study-data";
export const TRANSFER_VERSION = 1;

export const DEFAULT_DEVICE_SYNC = Object.freeze({
  serverUrl: "",
  deviceKey: "",
  deviceId: "",
  deviceName: "",
  learnerName: "",
  learnerId: "",
  lastSyncedAt: null,
  // 同期を始める前から端末にあった学習データを預けたかどうか。
  // 一度だけ預ける。二度送ると回答数が二重に数えられてしまう。
  baselineSent: false,
  // 送り終わった出来事の番号。ここから先だけを送ればよい。
  sentSeq: 0,
  seq: 0,
});

export function normalizeDeviceSync(raw = {}) {
  const stored = raw && typeof raw === "object" ? raw : {};
  const text = (value) => String(value ?? "").trim();
  return {
    serverUrl: text(stored.serverUrl).replace(/\/+$/, "").replace(/\/mcp$/, ""),
    deviceKey: text(stored.deviceKey),
    deviceId: text(stored.deviceId),
    deviceName: text(stored.deviceName),
    learnerName: text(stored.learnerName),
    learnerId: text(stored.learnerId),
    lastSyncedAt: stored.lastSyncedAt ?? null,
    baselineSent: stored.baselineSent === true,
    sentSeq: Number(stored.sentSeq) || 0,
    seq: Number(stored.seq) || 0,
  };
}

export function isSyncConnected(config) {
  return Boolean(config?.serverUrl && config?.deviceKey);
}

/** この端末が分かるような名前を、入力させずに決める。 */
export function guessDeviceName(userAgent = "") {
  const agent = String(userAgent);
  if (/iPad/i.test(agent)) return "iPad";
  if (/iPhone/i.test(agent)) return "iPhone";
  if (/Android/i.test(agent)) return /Mobile/i.test(agent) ? "Androidスマホ" : "Androidタブレット";
  if (/Macintosh/i.test(agent)) return "Mac";
  if (/Windows/i.test(agent)) return "Windows";
  return "この端末";
}

// ---------------------------------------------------------------------------
// 1問ごとの記録（出来事）
// ---------------------------------------------------------------------------

/**
 * 回答を1件記録する。番号は端末ごとに1つずつ増やすので、
 * ほかの端末の記録と混ざっても取り違えない。
 */
export function createJournalEntry({ itemId, mode, correct, durationMs, at = Date.now() }, { deviceId, seq }) {
  const next = (Number(seq) || 0) + 1;
  return {
    entry: {
      // 同期していない端末でも、あとから接続したときに使えるよう必ず付けておく。
      eventId: `${deviceId || "local"}-${next}`,
      seq: next,
      itemId,
      at,
      correct: Boolean(correct),
      mode: mode ?? null,
      durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
    },
    seq: next,
  };
}

/** まだ送っていない記録だけを、古い順に取り出す。 */
export function unsentEntries(journal = [], sentSeq = 0, limit = 500) {
  return [...journal]
    .filter((entry) => entry && Number(entry.seq ?? 0) > sentSeq)
    .sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0))
    .slice(0, limit);
}

export function highestSeq(entries = []) {
  return entries.reduce((highest, entry) => Math.max(highest, Number(entry.seq) || 0), 0);
}

/**
 * 周回の進み具合は端末をまたいで足せないので、学習条件ごとに
 * 最後に動かしたほうを採る。
 */
export function mergeStudyProgress(local = {}, remote = {}) {
  const merged = { ...local };
  for (const [key, value] of Object.entries(remote ?? {})) {
    const current = merged[key];
    if (!current || (value?.lastUpdatedAt ?? 0) > (current.lastUpdatedAt ?? 0)) merged[key] = value;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// 引き継ぎファイル
// ---------------------------------------------------------------------------

/** 学習データを1つのまとまりにする。別の端末で読み込めばそのまま続きから使える。 */
export function buildTransferFile({
  history,
  journal = [],
  studyProgress = {},
  studyConfigs = {},
  settings = {},
  bestCombo = 0,
  selectedPeriod = null,
  exportedAt = new Date().toISOString(),
}) {
  const records = history instanceof Map ? Object.fromEntries(history) : { ...(history ?? {}) };
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt,
    counts: {
      questions: Object.keys(records).length,
      attempts: Object.values(records).reduce((sum, record) => sum + (record?.totalAttempts ?? 0), 0),
      journal: journal.length,
    },
    data: { history: records, journal, studyProgress, studyConfigs, settings, bestCombo, selectedPeriod },
  };
}

/** 読み込んだファイルが本当にwordsの学習データかを確かめる。 */
export function readTransferFile(text) {
  let parsed;
  try {
    parsed = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    return { ok: false, message: "ファイルを読み取れませんでした。wordsで書き出したファイルか確かめてください。" };
  }
  if (!parsed || typeof parsed !== "object" || parsed.format !== TRANSFER_FORMAT) {
    return { ok: false, message: "wordsの学習データファイルではないようです。" };
  }
  if (Number(parsed.version) > TRANSFER_VERSION) {
    return { ok: false, message: "新しい版のwordsで書き出されたファイルです。wordsを更新してください。" };
  }
  const data = parsed.data;
  if (!data || typeof data !== "object" || typeof data.history !== "object" || data.history === null) {
    return { ok: false, message: "ファイルの中身が壊れています。" };
  }
  const history = Object.fromEntries(
    Object.entries(data.history).filter(([id, record]) => id && record && typeof record === "object"),
  );
  return {
    ok: true,
    exportedAt: parsed.exportedAt ?? null,
    counts: parsed.counts ?? null,
    data: {
      history,
      journal: Array.isArray(data.journal) ? data.journal : [],
      studyProgress: data.studyProgress && typeof data.studyProgress === "object" ? data.studyProgress : {},
      studyConfigs: data.studyConfigs && typeof data.studyConfigs === "object" ? data.studyConfigs : {},
      settings: data.settings && typeof data.settings === "object" ? data.settings : {},
      bestCombo: Number(data.bestCombo) || 0,
      selectedPeriod: data.selectedPeriod ?? null,
    },
  };
}

/**
 * 書き出したファイルの名前。日付を入れて、どの時点のものか分かるようにする。
 * 端末やパソコンをまたいで受け渡すので、名前は英数字だけにしておく
 * （機種によっては日本語のファイル名が文字化けしたり、拡張子が外れたりする）。
 */
export function transferFileName(date = new Date()) {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
  return `words-study-data-${stamp}.json`;
}

// ---------------------------------------------------------------------------
// サーバーとのやりとり
// ---------------------------------------------------------------------------

export class SyncError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "SyncError";
    this.status = status;
  }
}

async function request(serverUrl, path, { method = "GET", body = null, deviceKey = null, fetchImpl = fetch } = {}) {
  const base = String(serverUrl ?? "").replace(/\/+$/, "");
  if (!base) throw new SyncError("同期サーバーのURLが設定されていません。");
  let response;
  try {
    response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(deviceKey ? { authorization: `Bearer ${deviceKey}` } : {}),
      },
      body: body === null ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new SyncError(`同期サーバーへつながりませんでした（${error.message}）。URLと通信環境を確かめてください。`);
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new SyncError(`同期サーバーの応答を読み取れませんでした（${response.status}）。`, response.status);
  }
  if (!response.ok) {
    throw new SyncError(payload?.message ?? `同期サーバーが${response.status}を返しました。`, response.status);
  }
  return payload;
}

export function createSyncClient({ fetchImpl = fetch } = {}) {
  return {
    /** 同期コードを見せて、この端末を登録する。端末キーはここでだけ受け取る。 */
    join: (serverUrl, { code, deviceName }) =>
      request(serverUrl, "/api/sync/join", { method: "POST", body: { code, deviceName }, fetchImpl }),
    /** 未送信の記録を預け、合わせた結果を受け取る。 */
    push: (config, payload) =>
      request(config.serverUrl, "/api/sync/push", {
        method: "POST", body: payload, deviceKey: config.deviceKey, fetchImpl,
      }),
    pull: (config) =>
      request(config.serverUrl, "/api/sync/pull", { deviceKey: config.deviceKey, fetchImpl }),
    leave: (config) =>
      request(config.serverUrl, "/api/sync/leave", { method: "POST", deviceKey: config.deviceKey, fetchImpl }),
  };
}

/** 設定画面に出す同期の状態。 */
export function syncStateLabel({ connected, error, syncing }) {
  if (error) return { tone: "error", text: "同期できません" };
  if (syncing) return { tone: "idle", text: "同期中…" };
  if (!connected) return { tone: "idle", text: "未接続" };
  return { tone: "ok", text: "同期中" };
}

/** 「3分前」のような、読みやすい経過時間にする。 */
export function relativeTimeLabel(isoText, now = Date.now()) {
  if (!isoText) return "まだ同期していません";
  const at = Date.parse(isoText);
  if (Number.isNaN(at)) return "まだ同期していません";
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}
