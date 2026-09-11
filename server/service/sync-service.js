// 学習者（生徒・自分）と端末を管理し、端末をまたいで学習データを合わせる層。
//
//   学習者（learner） … データが分かれる単位。生徒1人、または自分自身。
//   端末（device）    … 1人の学習者が使う端末。スマホ2台でも同じ学習者に属する。
//
// 問題（教材と、AIが追加・編集したもの）は全員で共有する。
// 先生が1回足せば、生徒全員の words に同じ問題が入る。
// 学習履歴と周回の進み具合だけが、学習者ごとに分かれる。
//
// 鍵は3種類あり、できることが違う。
//
//   管理キー   … 先生／持ち主。学習者の追加・一覧・削除、同期コードの発行
//   同期コード … 学習者ごと。人が読み書きできる短い文字列。端末の登録に一度だけ使う
//   端末キー   … 登録のときに配る長い文字列。以後の同期はこれで行う
//
// 同期コードを短くしても安全なのは、それ自体では読み書きできず、
// 登録のときにしか使えないため。登録が済めば端末キーに置き換わる。

import { fail, readString, readStringArray } from "../core/validate.js";
import { generateToken, hashToken, timingSafeEqual } from "../auth/tokens.js";
import { updateDocument } from "../storage/driver.js";
import {
  compactDevice,
  dedupeJournal,
  mergeLearnerHistory,
  mergeProgressMaps,
  unwrapProgressMap,
  wrapProgressMap,
} from "./history-merge.js";

export const SYNC_KEYS = Object.freeze({
  learners: "words:learners",
  learner: (id) => `words:learner:${id}`,
  legacyHistory: "words:history",
});

export const SYNC_LIMITS = Object.freeze({
  learners: 60,
  devicesPerLearner: 10,
  journalPerPush: 500,
  journalKept: 1000,
  progressEntries: 200,
  sessions: 20,
  records: 20000,
});

// 見間違えやすい文字（0とO、1とIとl）を除いた並び。紙に書いて渡せるようにする。
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** WORDS-XXXX-XXXX の形の同期コードを作る。 */
export function generateSyncCode() {
  const pick = (length) => {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
  };
  return `WORDS-${pick(4)}-${pick(4)}`;
}

/** 入力された同期コードの揺れ（小文字・全角・空白・区切りの有無）を吸収する。 */
export function normalizeSyncCode(value) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
  const body = text.startsWith("WORDS") ? text.slice(5) : text;
  if (body.length !== 8) return null;
  return `WORDS-${body.slice(0, 4)}-${body.slice(4)}`;
}

const DEFAULT_LEARNERS = { learners: [], migratedLegacy: false };
const DEFAULT_LEARNER_DATA = { devices: {}, progress: {}, configs: {}, sessions: [], updatedAt: null };

function learnerId() {
  return `learner-${generateToken(6)}`;
}

export function createSyncService({ storage, now = () => Date.now() }) {
  async function readIndex() {
    const stored = await storage.get(SYNC_KEYS.learners);
    return { ...structuredClone(DEFAULT_LEARNERS), ...(stored ?? {}) };
  }

  async function readLearnerData(id) {
    const stored = await storage.get(SYNC_KEYS.learner(id));
    return { ...structuredClone(DEFAULT_LEARNER_DATA), ...(stored ?? {}) };
  }

  /**
   * 学習者を1人も作らずに使っていた頃のデータを、既定の学習者へ引き継ぐ。
   * 元の保存（words:history）はそのまま残すので、取り違えても元に戻せる。
   */
  async function migrateLegacy() {
    const index = await readIndex();
    if (index.migratedLegacy || index.learners.length) return index;
    const legacy = await storage.get(SYNC_KEYS.legacyHistory);
    const hasLegacy = legacy && Object.keys(legacy.records ?? {}).length > 0;
    if (!hasLegacy) {
      await updateDocument(storage, SYNC_KEYS.learners, (document) => {
        document.migratedLegacy = true;
      }, { defaults: structuredClone(DEFAULT_LEARNERS) });
      return readIndex();
    }
    const id = learnerId();
    const at = new Date(now()).toISOString();
    await storage.put(SYNC_KEYS.learner(id), {
      ...structuredClone(DEFAULT_LEARNER_DATA),
      devices: {
        "device-legacy": {
          name: "以前の端末",
          baseline: legacy.records ?? {},
          // 合計（records）にすでに入っている記録なので、積み上げずに表示用に残す。
          journal: [],
          log: dedupeJournal(legacy.journal ?? []),
          keyHash: null,
          joinedAt: at,
          lastSeenAt: legacy.updatedAt ?? at,
        },
      },
      sessions: legacy.sessions ?? [],
      updatedAt: at,
    });
    await updateDocument(storage, SYNC_KEYS.learners, (document) => {
      document.learners = [{ id, name: "本人", createdAt: at, codeHash: null, codePreview: null }];
      document.migratedLegacy = true;
    }, { defaults: structuredClone(DEFAULT_LEARNERS) });
    return readIndex();
  }

  async function findLearner(id) {
    const index = await migrateLegacy();
    return index.learners.find((learner) => learner.id === id) ?? null;
  }

  /** 名前でもIDでも学習者を探せるようにする。AIは名前で呼んでくるため。 */
  async function resolveLearner(reference) {
    const index = await migrateLegacy();
    if (!reference) return null;
    const text = String(reference).trim();
    const byId = index.learners.find((learner) => learner.id === text);
    if (byId) return byId;
    const lowered = text.toLocaleLowerCase("ja-JP");
    const matches = index.learners.filter(
      (learner) => learner.name.toLocaleLowerCase("ja-JP").includes(lowered),
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      fail(
        `「${text}」に当てはまる学習者が複数います: ${matches.map((learner) => learner.name).join(" / ")}。IDで指定してください。`,
        "learner",
      );
    }
    return null;
  }

  return {
    limits: SYNC_LIMITS,

    async listLearners() {
      const index = await migrateLegacy();
      const rows = await Promise.all(index.learners.map(async (learner) => {
        const data = await readLearnerData(learner.id);
        const devices = Object.entries(data.devices ?? {});
        return {
          id: learner.id,
          name: learner.name,
          createdAt: learner.createdAt,
          codeIssued: Boolean(learner.codeHash),
          devices: devices.map(([id, device]) => ({
            id,
            name: device.name,
            joinedAt: device.joinedAt ?? null,
            lastSeenAt: device.lastSeenAt ?? null,
          })),
          lastSyncedAt: data.updatedAt,
        };
      }));
      return { learners: rows, total: rows.length };
    },

    /** 学習者を1人ぶん作り、その場かぎりで同期コードを返す。 */
    async createLearner({ name }) {
      const label = readString(name, "name", { required: true, max: 40 });
      const index = await migrateLegacy();
      if (index.learners.length >= SYNC_LIMITS.learners) {
        fail(`学習者は${SYNC_LIMITS.learners}人までです。`, "name");
      }
      if (index.learners.some((learner) => learner.name === label)) {
        fail(`「${label}」という学習者はすでにいます。別の名前にしてください。`, "name");
      }
      const id = learnerId();
      const code = generateSyncCode();
      const at = new Date(now()).toISOString();
      await storage.put(SYNC_KEYS.learner(id), { ...structuredClone(DEFAULT_LEARNER_DATA), updatedAt: at });
      await updateDocument(storage, SYNC_KEYS.learners, (document) => {
        document.learners = [...document.learners, {
          id,
          name: label,
          createdAt: at,
          codeHash: null,
          codePreview: code.slice(0, 10),
        }];
        document.migratedLegacy = true;
      }, { defaults: structuredClone(DEFAULT_LEARNERS) });
      await this.setSyncCode(id, code);
      return { id, name: label, syncCode: code, createdAt: at };
    },

    /** 同期コードを保存する。控えるのはハッシュだけ。 */
    async setSyncCode(id, code) {
      const hash = await hashToken(code);
      await updateDocument(storage, SYNC_KEYS.learners, (document) => {
        const target = document.learners.find((learner) => learner.id === id);
        if (!target) fail(`学習者 ${id} は見つかりませんでした。`, "id");
        target.codeHash = hash;
        target.codePreview = code.slice(0, 10);
      }, { defaults: structuredClone(DEFAULT_LEARNERS) });
      return { id, syncCode: code };
    },

    /** 同期コードを出し直す。前のコードでは登録できなくなる（登録済みの端末は続けて使える）。 */
    async reissueSyncCode({ id }) {
      if (!(await findLearner(id))) fail(`学習者 ${id} は見つかりませんでした。`, "id");
      const code = generateSyncCode();
      await this.setSyncCode(id, code);
      return { id, syncCode: code };
    },

    async renameLearner({ id, name }) {
      const label = readString(name, "name", { required: true, max: 40 });
      await updateDocument(storage, SYNC_KEYS.learners, (document) => {
        const target = document.learners.find((learner) => learner.id === id);
        if (!target) fail(`学習者 ${id} は見つかりませんでした。`, "id");
        target.name = label;
      }, { defaults: structuredClone(DEFAULT_LEARNERS) });
      return { id, name: label };
    },

    /** 学習者を消す。学習履歴もまとめて消えるので、確認を必須にしている。 */
    async deleteLearner({ id, confirm = false }) {
      if (confirm !== true) {
        fail("学習者を消すと、その人の学習履歴も一緒に消えます。confirm を true にしてください。", "confirm");
      }
      const learner = await findLearner(id);
      if (!learner) fail(`学習者 ${id} は見つかりませんでした。`, "id");
      await updateDocument(storage, SYNC_KEYS.learners, (document) => {
        document.learners = document.learners.filter((entry) => entry.id !== id);
      }, { defaults: structuredClone(DEFAULT_LEARNERS) });
      await storage.delete(SYNC_KEYS.learner(id));
      return { id, name: learner.name, deleted: true };
    },

    // ----------------------------------------------------------------
    // 端末の登録と同期
    // ----------------------------------------------------------------

    /**
     * 同期コードを見せた端末を、その学習者の端末として登録する。
     * 以後の同期に使う端末キーは、このときだけ返す。
     */
    async joinDevice({ code, deviceName }) {
      const normalized = normalizeSyncCode(code);
      if (!normalized) {
        fail("同期コードの形が違います。WORDS-XXXX-XXXX の形で入力してください。", "code");
      }
      const index = await migrateLegacy();
      const hash = await hashToken(normalized);
      const learner = index.learners.find((entry) => entry.codeHash && timingSafeEqual(entry.codeHash, hash));
      if (!learner) fail("この同期コードは使えません。先生に確認してください。", "code");

      const data = await readLearnerData(learner.id);
      if (Object.keys(data.devices ?? {}).length >= SYNC_LIMITS.devicesPerLearner) {
        fail(`1人が登録できる端末は${SYNC_LIMITS.devicesPerLearner}台までです。使わない端末の接続を解除してください。`, "code");
      }

      const deviceId = `device-${generateToken(6)}`;
      const deviceKey = generateToken(32);
      const at = new Date(now()).toISOString();
      await updateDocument(storage, SYNC_KEYS.learner(learner.id), (document) => {
        document.devices[deviceId] = {
          name: readString(deviceName, "deviceName", { max: 40 }) || "端末",
          baseline: {},
          journal: [],
          keyHash: null,
          joinedAt: at,
          lastSeenAt: at,
          // この端末が同期を始める前から持っていた分は、まだ預かっていない。
          baselineReceived: false,
        };
        document.updatedAt = at;
      }, { defaults: structuredClone(DEFAULT_LEARNER_DATA) });

      const keyHash = await hashToken(deviceKey);
      await updateDocument(storage, SYNC_KEYS.learner(learner.id), (document) => {
        document.devices[deviceId].keyHash = keyHash;
      }, { defaults: structuredClone(DEFAULT_LEARNER_DATA) });

      return {
        learnerId: learner.id,
        learnerName: learner.name,
        deviceId,
        deviceKey,
        snapshot: await this.pull(learner.id),
      };
    },

    /** 端末キーから、どの学習者のどの端末かを割り出す。 */
    async resolveDeviceKey(deviceKey) {
      const key = readString(deviceKey, "deviceKey", { max: 200 });
      if (!key) return null;
      const hash = await hashToken(key);
      const index = await migrateLegacy();
      for (const learner of index.learners) {
        const data = await readLearnerData(learner.id);
        for (const [deviceId, device] of Object.entries(data.devices ?? {})) {
          if (device.keyHash && timingSafeEqual(device.keyHash, hash)) {
            return { learnerId: learner.id, learnerName: learner.name, deviceId, deviceName: device.name };
          }
        }
      }
      return null;
    },

    /** 端末から届いた分を預かる。同じ記録が二度届いても結果は変わらない。 */
    async push(learnerId, deviceId, payload = {}) {
      const journal = Array.isArray(payload.journal) ? payload.journal : [];
      if (journal.length > SYNC_LIMITS.journalPerPush) {
        fail(`1回に送れる学習記録は${SYNC_LIMITS.journalPerPush}件までです。`, "journal");
      }
      const baseline = payload.baseline && typeof payload.baseline === "object" ? payload.baseline : null;
      if (baseline && Object.keys(baseline).length > SYNC_LIMITS.records) {
        fail(`学習履歴は${SYNC_LIMITS.records}件までです。`, "baseline");
      }
      const at = new Date(now()).toISOString();

      await updateDocument(storage, SYNC_KEYS.learner(learnerId), (document) => {
        const device = document.devices?.[deviceId];
        if (!device) fail("この端末は登録されていません。接続しなおしてください。", "deviceId");

        // 同期を始める前から持っていた分は、最初の1回だけ預かる。
        // 2回目以降は無視する（同期で受け取った他の端末のぶんを送り返してくるため）。
        if (baseline && !device.baselineReceived) {
          device.baseline = baseline;
          device.baselineReceived = true;
        }
        if (journal.length) {
          device.journal = dedupeJournal([...(device.journal ?? []), ...journal]);
        }
        Object.assign(document.devices[deviceId], compactDevice(device, { keepEntries: SYNC_LIMITS.journalKept }));
        document.devices[deviceId].lastSeenAt = at;

        if (payload.progress && typeof payload.progress === "object") {
          const incoming = wrapProgressMap(payload.progress, { fallbackUpdatedAt: now() });
          const entries = Object.entries(mergeProgressMaps(document.progress ?? {}, incoming))
            .sort(([, left], [, right]) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
            .slice(0, SYNC_LIMITS.progressEntries);
          document.progress = Object.fromEntries(entries);
        }
        if (payload.configs && typeof payload.configs === "object") {
          document.configs = { ...(document.configs ?? {}), ...payload.configs };
        }
        if (Array.isArray(payload.sessions) && payload.sessions.length) {
          document.sessions = payload.sessions.slice(0, SYNC_LIMITS.sessions);
        }
        document.updatedAt = at;
      }, { defaults: structuredClone(DEFAULT_LEARNER_DATA) });

      return { savedAt: at, accepted: journal.length, baselineStored: Boolean(baseline) };
    },

    /** 全端末を合わせた、その学習者のいまの学習データ。 */
    async pull(id) {
      const data = await readLearnerData(id);
      const { records, journal } = mergeLearnerHistory(data.devices ?? {});
      return {
        learnerId: id,
        updatedAt: data.updatedAt,
        records,
        // 画面と統計では新しい順に使うので、ここで並べ替えて返す。
        journal: [...journal].reverse(),
        progress: unwrapProgressMap(data.progress ?? {}),
        configs: data.configs ?? {},
        sessions: data.sessions ?? [],
        devices: Object.entries(data.devices ?? {}).map(([deviceId, device]) => ({
          id: deviceId,
          name: device.name,
          lastSeenAt: device.lastSeenAt ?? null,
        })),
      };
    },

    /** その端末の登録を解く。預かっている学習の記録は残す（他の端末から見えるまま）。 */
    async leaveDevice(learnerId, deviceId) {
      await updateDocument(storage, SYNC_KEYS.learner(learnerId), (document) => {
        const device = document.devices?.[deviceId];
        if (!device) return;
        // 鍵だけ無効にして、積み上げた記録は残す。消すと合計が減ってしまう。
        device.keyHash = null;
        device.releasedAt = new Date(now()).toISOString();
      }, { defaults: structuredClone(DEFAULT_LEARNER_DATA) });
      return { learnerId, deviceId, released: true };
    },

    // ----------------------------------------------------------------
    // 読み取り（統計・MCP用）
    // ----------------------------------------------------------------

    /** 学習者を1人ぶん、または全員ぶんまとめた履歴を返す。 */
    async historyFor(reference = null) {
      const index = await migrateLegacy();
      if (!index.learners.length) return { records: {}, journal: [], sessions: [], updatedAt: null, learners: [] };

      if (reference) {
        const learner = await resolveLearner(reference);
        if (!learner) {
          fail(
            `学習者「${reference}」は見つかりませんでした。いるのは ${index.learners.map((entry) => entry.name).join(" / ")} です。`,
            "learner",
          );
        }
        const snapshot = await this.pull(learner.id);
        return {
          records: snapshot.records,
          journal: snapshot.journal.map((entry) => ({ ...entry, learner: learner.name })),
          sessions: snapshot.sessions,
          updatedAt: snapshot.updatedAt,
          learners: [{ id: learner.id, name: learner.name }],
        };
      }

      // 指定が無ければ全員ぶん。1人ならその人の履歴と同じになる。
      const snapshots = await Promise.all(index.learners.map(async (learner) => ({
        learner,
        snapshot: await this.pull(learner.id),
      })));
      let records = {};
      const journal = [];
      const sessions = [];
      let updatedAt = null;
      const { mergeRecordMaps } = await import("./history-merge.js");
      for (const { learner, snapshot } of snapshots) {
        records = mergeRecordMaps(records, snapshot.records);
        journal.push(...snapshot.journal.map((entry) => ({ ...entry, learner: learner.name })));
        sessions.push(...snapshot.sessions);
        if (!updatedAt || (snapshot.updatedAt && snapshot.updatedAt > updatedAt)) updatedAt = snapshot.updatedAt;
      }
      return {
        records,
        journal: journal.sort((left, right) => right.at - left.at),
        sessions,
        updatedAt,
        learners: index.learners.map((learner) => ({ id: learner.id, name: learner.name })),
      };
    },

    /** 学習者ごとの履歴を個別に返す。教科別・人別の成績を出すときに使う。 */
    async historyByLearner() {
      const index = await migrateLegacy();
      return Promise.all(index.learners.map(async (learner) => ({
        id: learner.id,
        name: learner.name,
        ...(await this.pull(learner.id)),
      })));
    },

    /**
     * 学習者を分ける前からある入口（管理キーでの履歴同期）の受け口。
     * 学習者がいなければ「本人」を作り、その端末ぶんとして預かる。
     * 端末ごとに分けて持つので、あとから2台目を足しても正しく合算される。
     */
    async saveOwnerSnapshot({ records = {}, journal = [], sessions = [], deviceId = null }) {
      const index = await migrateLegacy();
      let learner = index.learners[0] ?? null;
      if (!learner) {
        const created = await this.createLearner({ name: "本人" });
        learner = { id: created.id, name: created.name };
      }
      const key = deviceId ? `device-owner-${String(deviceId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}` : "device-owner";
      const at = new Date(now()).toISOString();
      await updateDocument(storage, SYNC_KEYS.learner(learner.id), (document) => {
        const existing = document.devices?.[key] ?? { name: "この端末", joinedAt: at, keyHash: null };
        // この入口は端末のいまの状態（合計）をそのまま預かる形なので、基準値を置き換える。
        // 1問ごとの記録は合計にすでに入っているため、積み上げずに表示用としてだけ持つ。
        document.devices[key] = {
          ...existing,
          baseline: records,
          baselineReceived: true,
          journal: [],
          log: dedupeJournal(journal).slice(-SYNC_LIMITS.journalKept),
          lastSeenAt: at,
        };
        if (sessions.length) document.sessions = sessions.slice(0, SYNC_LIMITS.sessions);
        document.updatedAt = at;
      }, { defaults: structuredClone(DEFAULT_LEARNER_DATA) });
      return { learnerId: learner.id, learnerName: learner.name, savedAt: at };
    },

    resolveLearner,
    findLearner,
    migrateLegacy,
  };
}
