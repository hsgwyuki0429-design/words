// AI連携（MCP）のクライアント側。
//
// words 本体は今までどおり静的サイトのまま動く。この連携を有効にしたときだけ、
// 別に立てた words MCP Server と、次のやりとりをする。
//
//   ・学習履歴を預ける      … AIが「今日間違えた問題」を答えられるようにする
//   ・AIが追加・変更した問題を取り込む
//   ・接続の設定（有効・無効、権限、接続トークン）を読み書きする
//
// 無効のあいだは、この画面からネットワークへ出ることは一切ない。
//
// 管理キー（ownerKey）は利用者本人がこの端末へ入れる鍵で、端末の中だけに保存する。
// リポジトリやHTMLには決して書き込まない。

export const AI_LINK_META_KEY = "aiLink";
export const AI_LINK_JOURNAL_KEY = "aiLinkJournal";

/** 1問ごとの学習記録として残す上限。古いものから捨てる。 */
export const JOURNAL_LIMIT = 2000;

export const DEFAULT_AI_LINK = Object.freeze({
  // この端末で連携を使うかどうか。サーバー側の有効・無効とは別に持ち、
  // 両方が有効のときだけ同期する。
  enabled: false,
  serverUrl: "",
  ownerKey: "",
  deviceId: null,
  lastSyncedAt: null,
});

export function normalizeAiLinkConfig(raw = {}) {
  const stored = raw && typeof raw === "object" ? raw : {};
  const serverUrl = String(stored.serverUrl ?? "").trim().replace(/\/+$/, "");
  return {
    enabled: stored.enabled === true,
    // 末尾の / と、貼り間違えやすい /mcp を取り除いて、サーバーの入口だけを残す。
    serverUrl: serverUrl.replace(/\/mcp$/, ""),
    ownerKey: String(stored.ownerKey ?? "").trim(),
    deviceId: typeof stored.deviceId === "string" && stored.deviceId ? stored.deviceId : null,
    lastSyncedAt: stored.lastSyncedAt ?? null,
  };
}

export function isAiLinkConfigured(config) {
  return Boolean(config?.serverUrl && config?.ownerKey);
}

export function isAiLinkActive(config) {
  return Boolean(config?.enabled && isAiLinkConfigured(config));
}

export function mcpUrlFor(config) {
  return config?.serverUrl ? `${config.serverUrl}/mcp` : "";
}

/** 端末を見分けるための名前。個人を特定する情報は入れない。 */
export function createDeviceId() {
  return `device-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// サーバーとのやりとり
// ---------------------------------------------------------------------------

class AiLinkError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "AiLinkError";
    this.status = status;
  }
}

export { AiLinkError };

async function request(config, path, { method = "GET", body = null, fetchImpl = fetch, signal } = {}) {
  if (!isAiLinkConfigured(config)) throw new AiLinkError("MCP Server URL と管理キーを入力してください。");
  let response;
  try {
    response = await fetchImpl(`${config.serverUrl}${path}`, {
      method,
      signal,
      headers: {
        "content-type": "application/json",
        // 管理キーはこの端末からサーバーへ送るだけで、AIへは渡らない。
        authorization: `Bearer ${config.ownerKey}`,
      },
      body: body === null ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new AiLinkError(`サーバーへつながりませんでした（${error.message}）。URLを確認してください。`);
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new AiLinkError(`サーバーの応答を読み取れませんでした（${response.status}）。`, response.status);
  }
  if (!response.ok) {
    const message = response.status === 401
      ? "管理キーが正しくありません。"
      : payload?.message ?? `サーバーが${response.status}を返しました。`;
    throw new AiLinkError(message, response.status);
  }
  return payload;
}

export function createAiLinkClient({ fetchImpl = fetch } = {}) {
  return {
    status: (config, signal) => request(config, "/api/admin/status", { fetchImpl, signal }),
    updateSettings: (config, changes) =>
      request(config, "/api/admin/settings", { method: "POST", body: changes, fetchImpl }),
    issueToken: (config, scopes) =>
      request(config, "/api/admin/token", { method: "POST", body: { scopes }, fetchImpl }),
    revokeToken: (config) => request(config, "/api/admin/token", { method: "DELETE", fetchImpl }),
    syncHistory: (config, payload) =>
      request(config, "/api/sync/history", { method: "POST", body: payload, fetchImpl }),
    overlay: (config, signal) => request(config, "/api/sync/overlay", { fetchImpl, signal }),
    restore: (config, id) =>
      request(config, "/api/admin/restore", { method: "POST", body: { id }, fetchImpl }),
    // 学習者（生徒・自分）の管理。管理キーを持っている人だけが使える。
    listLearners: (config) => request(config, "/api/admin/learners", { fetchImpl }),
    createLearner: (config, name) =>
      request(config, "/api/admin/learners", { method: "POST", body: { name }, fetchImpl }),
    deleteLearner: (config, id) =>
      request(config, "/api/admin/learners", { method: "DELETE", body: { id, confirm: true }, fetchImpl }),
    reissueLearnerCode: (config, id) =>
      request(config, "/api/admin/learners/code", { method: "POST", body: { id }, fetchImpl }),
  };
}

// ---------------------------------------------------------------------------
// データの組み立て（画面にもネットワークにも依存しない部分）
// ---------------------------------------------------------------------------

/**
 * 1問ごとの学習記録を1件足す。新しい順に並べ、上限を超えた分は捨てる。
 *
 * eventId と seq は端末間の同期に要る。eventId は同じ記録を二度数えないための
 * 目印で、seq は「どこまで送ったか」を表す番号。どちらも落とさずに残す。
 */
export function appendJournalEntry(journal, entry, limit = JOURNAL_LIMIT) {
  const list = Array.isArray(journal) ? journal : [];
  const next = [
    {
      ...(entry.eventId ? { eventId: entry.eventId } : {}),
      ...(Number.isFinite(entry.seq) ? { seq: entry.seq } : {}),
      itemId: entry.itemId,
      at: entry.at ?? Date.now(),
      correct: Boolean(entry.correct),
      mode: entry.mode ?? null,
      durationMs: Number.isFinite(entry.durationMs) ? Math.max(0, Math.round(entry.durationMs)) : null,
    },
    ...list,
  ];
  return next.slice(0, Math.max(1, limit));
}

/** サーバーへ預ける学習履歴。端末にある内容をそのまま送る（形は変えない）。 */
export function buildHistoryPayload({ history, journal, deviceId, sessions = [] }) {
  const records = history instanceof Map
    ? Object.fromEntries(history)
    : { ...(history ?? {}) };
  return {
    deviceId: deviceId ?? null,
    records,
    journal: Array.isArray(journal) ? journal.slice(0, JOURNAL_LIMIT) : [],
    sessions: Array.isArray(sessions) ? sessions.slice(0, 20) : [],
  };
}

/**
 * AIによる追加・変更・削除を、画面が使う問題一覧へ重ねる。
 * 元の配列は変えず、新しい配列を返す。差分が無ければ元の配列をそのまま返す。
 */
export function applyOverlayToItems(items, overlay) {
  if (!overlay) return items;
  const added = Array.isArray(overlay.added) ? overlay.added : [];
  const patched = overlay.patched && typeof overlay.patched === "object" ? overlay.patched : {};
  const deleted = new Set(Array.isArray(overlay.deletedIds) ? overlay.deletedIds : []);
  if (!added.length && !Object.keys(patched).length && !deleted.size) return items;

  const merged = items
    .filter((item) => !deleted.has(item.id))
    .map((item) => (patched[item.id] ? { ...item, ...patched[item.id] } : item));
  const existing = new Set(merged.map((item) => item.id));
  added.forEach((item) => {
    if (deleted.has(item.id) || existing.has(item.id)) return;
    merged.push(patched[item.id] ? { ...item, ...patched[item.id] } : item);
  });
  return merged;
}

/** 教科ごとに分けて重ね合わせる。画面は教科別の配列を持っているため。 */
export function applyOverlayBySubject(lists, overlay) {
  const subjectOf = (item) => item.subject ?? "english";
  const result = {};
  for (const [subject, items] of Object.entries(lists)) {
    result[subject] = applyOverlayToItems(items, overlay && {
      ...overlay,
      added: (overlay.added ?? []).filter((item) => subjectOf(item) === subject),
    });
  }
  return result;
}

/** 接続状態の見出し文。設定画面にそのまま出す。 */
export function connectionStateLabel({ configured, enabled, serverEnabled, error }) {
  if (error) return { tone: "error", text: "接続できません" };
  if (!configured) return { tone: "idle", text: "未設定" };
  if (!serverEnabled) return { tone: "idle", text: "サーバー側が無効" };
  if (!enabled) return { tone: "idle", text: "この端末で無効" };
  return { tone: "ok", text: "接続可能" };
}

/** Claudeなどへ登録するときの手順書。トークンそのものは含めない。 */
export function connectionInstructions(mcpUrl) {
  const url = mcpUrl || "https://<あなたのMCP Server>/mcp";
  return [
    {
      title: "Claude Code（パソコンのターミナル）",
      body: `claude mcp add --transport http words ${url} \\\n  --header "Authorization: Bearer <接続トークン>"`,
    },
    {
      title: "Claude デスクトップ／claude.ai のコネクタ",
      body: `「カスタムコネクタを追加」で次のURLを入力します。\n${url}\n`
        + "接続の確認画面が出たら、この設定画面で発行した接続トークンを貼り付けてください。",
    },
    {
      title: "そのほかのMCP対応クライアント",
      body: `種別: Streamable HTTP\nURL: ${url}\n認証: Authorization ヘッダーに Bearer <接続トークン>`,
    },
  ];
}
