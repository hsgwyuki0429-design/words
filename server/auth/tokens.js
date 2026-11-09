// 接続トークンと権限。
//
// 考え方は2つだけ。
//
//  1. オーナーキー … wordsを使う本人だけが持つ鍵。環境変数に置く。
//                    設定画面からの管理（権限の切り替え・トークン発行・履歴同期）に使う。
//  2. 接続トークン … AIへ渡す鍵。オーナーキーで発行し、できることを絞ってある。
//
// 接続トークンはそのままの形では保存しない。ハッシュだけを保存し、
// 発行したその場でしか本体を見られないようにする（保存先が漏れても悪用されにくい）。

import { fail, readEnum, readString, readStringArray } from "../core/validate.js";
import { readDocument, updateDocument } from "../storage/driver.js";
import { STORAGE_KEYS } from "../service/words-service.js";

/** できることの単位。read → write → delete の順に強くなる。 */
export const SCOPES = Object.freeze(["read", "write", "delete"]);

/** 初期状態。書き込みも削除も、本人が設定画面で明示的に入れるまで使えない。 */
export const DEFAULT_PERMISSIONS = Object.freeze({ read: true, write: false, delete: false });
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  permissions: { ...DEFAULT_PERMISSIONS },
  updatedAt: null,
});

const DEFAULT_TOKENS = { tokens: [] };

/** バイト列を16進数の文字列にする。 */
function toHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** ランダムな文字列。Web Crypto はどのサーバーレス環境にもある。 */
export function generateToken(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return toHex(buffer);
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

/**
 * 接続トークンの登録内容と、本人が設定画面で入れた権限から、操作する人（actor）を作る。
 * トークンのスコープと設定の権限、その両方にある操作だけを scopes に入れる。
 * extra は tokenLabel の直後に差し込む項目（clientName など）。
 */
export function actorFromToken(entry, settings, extra = {}) {
  return {
    tokenId: entry.id,
    tokenLabel: entry.label,
    ...extra,
    scopes: entry.scopes.filter((scope) => settings.permissions[scope]),
    tokenScopes: entry.scopes,
    permissions: settings.permissions,
  };
}

/**
 * 文字列を1文字ずつではなく、長さに関わらず同じ手間で比べる。
 * 「どこまで合っていたか」が応答時間から漏れないようにするため。
 */
export function timingSafeEqual(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export function createAuth({ storage, ownerKey, now = () => Date.now() }) {
  async function readSettings() {
    const settings = await readDocument(storage, STORAGE_KEYS.settings, DEFAULT_SETTINGS);
    return {
      ...settings,
      permissions: { ...DEFAULT_PERMISSIONS, ...(settings.permissions ?? {}) },
    };
  }

  async function readTokens() {
    return readDocument(storage, STORAGE_KEYS.tokens, DEFAULT_TOKENS);
  }

  function updateTokens(mutate) {
    return updateDocument(storage, STORAGE_KEYS.tokens, mutate, { defaults: DEFAULT_TOKENS });
  }

  function nowIso() {
    return new Date(now()).toISOString();
  }

  return {
    readSettings,
    readTokens,

    /** オーナーキーが設定されているか。未設定なら管理APIは一切使えない。 */
    hasOwnerKey() {
      return Boolean(ownerKey && ownerKey.length >= 16);
    },

    isOwner(presented) {
      return this.hasOwnerKey() && timingSafeEqual(presented, ownerKey);
    },

    async updateSettings(changes) {
      const { document } = await updateDocument(storage, STORAGE_KEYS.settings, (draft) => {
        if (changes.enabled !== undefined) {
          if (typeof changes.enabled !== "boolean") fail("enabled は true か false で渡してください。", "enabled");
          draft.enabled = changes.enabled;
        }
        if (changes.permissions !== undefined) {
          const permissions = { ...DEFAULT_PERMISSIONS, ...(draft.permissions ?? {}) };
          for (const scope of SCOPES) {
            const value = changes.permissions[scope];
            if (value === undefined) continue;
            if (typeof value !== "boolean") fail(`permissions.${scope} は true か false で渡してください。`, scope);
            permissions[scope] = value;
          }
          // 読み取りを切ると何もできなくなるので、連携を使うなら read は常に必要。
          draft.permissions = { ...permissions, read: permissions.read };
        }
        draft.updatedAt = nowIso();
      }, { defaults: DEFAULT_SETTINGS });
      return {
        enabled: document.enabled,
        permissions: document.permissions,
        updatedAt: document.updatedAt,
      };
    },

    /** 新しい接続トークンを発行する。本体を返すのはこのときだけ。 */
    async issueToken({ label = "AI連携", scopes = ["read"] } = {}) {
      const name = readString(label, "label", { max: 40 }) || "AI連携";
      const requested = readStringArray(scopes, "scopes", { max: SCOPES.length, allowed: SCOPES }) ?? ["read"];
      if (!requested.includes("read")) requested.unshift("read");
      const token = generateToken();
      const hash = await hashToken(token);
      const entry = {
        id: generateToken(8),
        label: name,
        hash,
        scopes: requested,
        createdAt: nowIso(),
        lastUsedAt: null,
        // 見分けるための先頭だけ。これだけでは接続できない。
        preview: `${token.slice(0, 6)}…`,
      };
      await updateTokens((document) => {
        // 発行しなおしたら前のトークンは使えなくする（AIに配った鍵は1つだけに保つ）。
        document.tokens = [entry];
      });
      return { token, entry: { ...entry, hash: undefined } };
    },

    async revokeTokens() {
      await updateTokens((document) => {
        document.tokens = [];
      });
      return { revoked: true };
    },

    /**
     * 提示されたトークンから、いま何ができるかを決める。
     * トークンのスコープと、本人が設定画面で入れた権限、その両方にある操作だけ通す。
     */
    async authenticate(presented, { clientName = null } = {}) {
      const [settings, stored] = await Promise.all([readSettings(), readTokens()]);
      if (!settings.enabled) {
        return { ok: false, reason: "disabled", message: "wordsの設定画面でAI連携が有効になっていません。" };
      }
      const token = readString(presented, "token", { max: 200 });
      if (!token) return { ok: false, reason: "missing", message: "接続トークンがありません。" };
      const hash = await hashToken(token);
      const entry = (stored.tokens ?? []).find((candidate) => timingSafeEqual(candidate.hash, hash));
      if (!entry) return { ok: false, reason: "invalid", message: "接続トークンが正しくありません。" };

      // 最後に使われた時刻の記録は、失敗しても本来の処理を止めない。
      updateTokens((document) => {
        const target = (document.tokens ?? []).find((candidate) => candidate.id === entry.id);
        if (target) target.lastUsedAt = nowIso();
      }).catch(() => {});

      return { ok: true, actor: actorFromToken(entry, settings, { clientName }) };
    },
  };
}

/** 権限が足りないことを表す誤り。ツール側でそのまま結果に載せる。 */
export class PermissionError extends Error {
  constructor(scope, actor) {
    const labels = { read: "問題・学習履歴を見る", write: "問題を追加・編集する", delete: "問題を削除する" };
    const allowedByUser = actor?.permissions?.[scope];
    super(
      allowedByUser === false
        ? `この操作には「${labels[scope]}」の権限が必要です。wordsの設定画面 → AI連携 で許可してください。`
        : `この接続トークンには「${labels[scope]}」の権限がありません。設定画面でトークンを再発行してください。`,
    );
    this.name = "PermissionError";
    this.scope = scope;
  }
}

export function requireScope(actor, scope) {
  if (!actor?.scopes?.includes(scope)) throw new PermissionError(scope, actor);
  return actor;
}

export { readEnum };
