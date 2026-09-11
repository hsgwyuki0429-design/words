// words のデータに触れる唯一の場所（サービス層）。
//
// MCP のことは何も知らない。MCP Tool も、設定画面からの管理APIも、
// 将来ほかの入口を足すときも、必ずここを通してデータを読み書きする。
//
//   MCP Tool / 管理API
//        ↓
//   words サービス層（このファイル）
//        ↓
//   教材データ（data/*.json・読むだけ） ＋ ストレージ（追加・変更・削除の重ね合わせ）
//
// 教材データそのものは決して書き換えない。AIによる追加・変更・削除は
// 「重ね合わせ（overlay）」として別に保存し、読むときに合成する。
// こうしておけば、既存データはいつでもそのままの形で残る。

import { getHistory, historyForModes } from "../../src/logic.js";
import { ValidationError, fail, readEnum, readId, readInteger, readString, readStringArray } from "../core/validate.js";
import { pushCapped, updateDocument } from "../storage/driver.js";
import { buildQuestion, patchQuestion } from "./question-input.js";
import { mergeRecordMaps } from "./history-merge.js";
import { SUBJECTS, SUBJECT_IDS, answerText, explanationText, questionText, subjectOf } from "./subjects.js";

export const DATA_SCHEMA_VERSION = 1;
export const SERVICE_VERSION = "1.0.0";

export const STORAGE_KEYS = Object.freeze({
  overlay: "words:overlay",
  history: "words:history",
  settings: "words:settings",
  tokens: "words:tokens",
  log: "words:oplog",
});

/** 一度の呼び出しで扱える上限。事故で大量に足したり消したりできないようにする。 */
export const SERVICE_LIMITS = Object.freeze({
  addPerCall: 20,
  totalAdded: 2000,
  searchLimitMax: 50,
  searchLimitDefault: 20,
  logEntries: 200,
  journalEntries: 2000,
  historyRecords: 20000,
});

const DEFAULT_OVERLAY = { schemaVersion: DATA_SCHEMA_VERSION, added: {}, patched: {}, trash: {} };
const DEFAULT_HISTORY = { updatedAt: null, deviceId: null, records: {}, journal: [], sessions: [] };
const DEFAULT_LOG = { entries: [] };

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("ja-JP");
}

function startOfDay(timestamp, offsetMinutes) {
  // 端末の時間帯（例：日本なら +540 分）で「その日」を切り出す。
  const shifted = timestamp + offsetMinutes * 60 * 1000;
  return Math.floor(shifted / 86400000) * 86400000 - offsetMinutes * 60 * 1000;
}

function dayKey(timestamp, offsetMinutes) {
  return new Date(timestamp + offsetMinutes * 60 * 1000).toISOString().slice(0, 10);
}

/** 一覧やAIへ返すときの、問題の短い形。全項目を返すと量が多すぎるため。 */
export function summarizeQuestion(item, record = null) {
  const summary = {
    id: item.id,
    subject: subjectOf(item),
    question: questionText(item),
    answer: answerText(item),
    importance: item.importance ?? null,
    range: item.range ?? null,
    type: item.type ?? null,
    tags: item.tags ?? [],
    aiAdded: Boolean(item.aiAdded),
  };
  if (record) {
    summary.study = {
      attempts: record.totalAttempts,
      correct: record.correctCount,
      wrong: record.wrongCount,
      accuracy: record.totalAttempts ? Number((record.correctCount / record.totalAttempts).toFixed(3)) : null,
      lastResult: record.lastResult,
      lastAttemptAt: record.lastAttemptAt ? new Date(record.lastAttemptAt).toISOString() : null,
    };
  }
  return summary;
}

/** 1問の詳細。解説や選択肢まで含めて返す。 */
export function detailQuestion(item, record = null) {
  const detail = {
    ...summarizeQuestion(item, record),
    difficulty: item.difficulty ?? null,
    lesson: item.lesson ?? null,
    title: item.title ?? null,
    source: item.sourceDetail ?? item.source ?? null,
    explanation: explanationText(item) || null,
    acceptedAnswers: item.acceptedAnswers ?? [],
    questionModes: item.questionModes ?? [],
  };
  if (item.editorial?.choices) {
    detail.choices = item.editorial.choices;
    detail.correctChoice = item.editorial.correctChoice ?? null;
  }
  if (item.note) detail.note = item.note;
  if (item.examples?.length) detail.examples = item.examples;
  if (item.point) detail.point = item.point;
  return detail;
}

export function createWordsService({
  catalog,
  storage,
  // 学習者と端末をまとめる層。学習履歴はすべてここ越しに読む。
  sync,
  now = () => Date.now(),
  idSuffix = () => Math.random().toString(36).slice(2, 8),
}) {
  async function readDocument(key, defaults) {
    const stored = await storage.get(key);
    return { ...structuredClone(defaults), ...(stored ?? {}) };
  }

  async function readOverlay() {
    return readDocument(STORAGE_KEYS.overlay, DEFAULT_OVERLAY);
  }

  /**
   * 学習履歴を読む。learner を渡すとその人ぶん、省略すると全員ぶんを合わせて返す。
   * 端末をまたいだ合算は同期層が受け持つので、ここでは結果を受け取るだけでよい。
   */
  async function readHistory(learner = null) {
    if (!sync) return readDocument(STORAGE_KEYS.history, DEFAULT_HISTORY);
    return sync.historyFor(learner);
  }

  /** 教材データに重ね合わせを適用して、いまの問題一覧を作る。 */
  async function resolveItems({ includeDeleted = false } = {}) {
    const [base, overlay] = await Promise.all([catalog.allBaseItems(), readOverlay()]);
    const items = [];
    for (const item of base) {
      if (!includeDeleted && overlay.trash[item.id]) continue;
      const patch = overlay.patched[item.id];
      items.push(patch ? { ...item, ...patch.item } : item);
    }
    for (const entry of Object.values(overlay.added)) {
      if (!includeDeleted && overlay.trash[entry.item.id]) continue;
      const patch = overlay.patched[entry.item.id];
      items.push(patch ? { ...entry.item, ...patch.item } : entry.item);
    }
    return { items, overlay };
  }

  async function findItem(id, { includeDeleted = true } = {}) {
    const { items, overlay } = await resolveItems({ includeDeleted });
    const item = items.find((candidate) => candidate.id === id) ?? null;
    return { item, overlay };
  }

  /** AI経由の操作を記録する。wordsの設定画面から見返せるようにするため。 */
  async function appendLog(entry) {
    await updateDocument(storage, STORAGE_KEYS.log, (document) => {
      document.entries = pushCapped(document.entries ?? [], entry, SERVICE_LIMITS.logEntries);
    }, { defaults: DEFAULT_LOG });
    return entry;
  }

  function logEntry(actor, tool, summary, extra = {}) {
    return {
      at: new Date(now()).toISOString(),
      client: actor?.clientName ?? "unknown",
      token: actor?.tokenLabel ?? null,
      tool,
      summary,
      ...extra,
    };
  }

  function nextId(subject, taken) {
    const date = new Date(now()).toISOString().slice(0, 10).replace(/-/g, "");
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = `ai-${subject}-${date}-${idSuffix()}`;
      if (!taken.has(candidate)) return candidate;
    }
    throw new Error("新しい問題IDを作れませんでした");
  }

  // ------------------------------------------------------------------
  // 読み取り
  // ------------------------------------------------------------------

  function matchesFilters(item, record, filters) {
    if (filters.subjects?.length && !filters.subjects.includes(subjectOf(item))) return false;
    if (filters.ranges?.length && !filters.ranges.includes(item.range)) return false;
    if (filters.importance?.length && !filters.importance.includes(item.importance)) return false;
    if (filters.types?.length && !filters.types.includes(item.type)) return false;
    if (filters.tags?.length && !filters.tags.some((tag) => (item.tags ?? []).includes(tag))) return false;
    if (filters.questionModes?.length
      && !filters.questionModes.some((mode) => (item.questionModes ?? []).includes(mode))) return false;
    if (filters.aiAddedOnly && !item.aiAdded) return false;
    if (filters.minimumWrong && record.wrongCount < filters.minimumWrong) return false;
    const performance = filters.performance ?? "all";
    if (performance === "unanswered" && record.totalAttempts > 0) return false;
    if (performance === "answered" && record.totalAttempts === 0) return false;
    if (performance === "wrong" && !(record.wrongCount > 0)) return false;
    if (performance === "correct" && !(record.totalAttempts > 0 && record.wrongCount === 0)) return false;
    if (performance === "last-wrong" && record.lastResult !== "wrong") return false;
    if (filters.answeredSince && !(record.lastAttemptAt >= filters.answeredSince)) return false;
    if (filters.wrongSince && !(record.lastWrongAt >= filters.wrongSince)) return false;
    if (filters.keywords?.length) {
      const haystack = normalizeText([
        item.id,
        questionText(item),
        answerText(item),
        explanationText(item),
        (item.tags ?? []).join(" "),
        item.title ?? "",
        item.range ?? "",
        (item.acceptedAnswers ?? []).join(" "),
      ].join("\n"));
      if (!filters.keywords.every((keyword) => haystack.includes(keyword))) return false;
    }
    return true;
  }

  const SORTERS = {
    relevance: null,
    id: (a, b) => a.item.id.localeCompare(b.item.id),
    importance: (a, b) => {
      const order = ["SSS", "SS", "S", "A", "B", "C", "D"];
      return order.indexOf(a.item.importance) - order.indexOf(b.item.importance);
    },
    "most-wrong": (a, b) => b.record.wrongCount - a.record.wrongCount,
    "recently-studied": (a, b) => (b.record.lastAttemptAt ?? 0) - (a.record.lastAttemptAt ?? 0),
    "recently-wrong": (a, b) => (b.record.lastWrongAt ?? 0) - (a.record.lastWrongAt ?? 0),
  };

  /** 検索と一覧の共通処理。件数は必ず上限で区切り、続きは offset で取る。 */
  async function queryQuestions(filters = {}, { limit, offset = 0, sort = "id", includeDeleted = false, learner = null } = {}) {
    const [{ items }, history] = await Promise.all([resolveItems({ includeDeleted }), readHistory(learner)]);
    const records = history.records ?? {};
    const rows = items
      .map((item) => ({ item, record: getHistory(records, item.id) }))
      .filter(({ item, record }) => matchesFilters(item, record, filters));
    const sorter = SORTERS[sort] ?? SORTERS.id;
    if (sorter) rows.sort(sorter);
    const size = Math.min(Math.max(1, limit ?? SERVICE_LIMITS.searchLimitDefault), SERVICE_LIMITS.searchLimitMax);
    const page = rows.slice(offset, offset + size);
    return {
      total: rows.length,
      offset,
      limit: size,
      returned: page.length,
      hasMore: offset + page.length < rows.length,
      nextOffset: offset + page.length < rows.length ? offset + page.length : null,
      questions: page.map(({ item, record }) => summarizeQuestion(item, record)),
    };
  }

  return {
    limits: SERVICE_LIMITS,

    async getAppInfo() {
      const [{ items, overlay }, history, settings] = await Promise.all([
        resolveItems(),
        readHistory(),
        readDocument(STORAGE_KEYS.settings, {}),
      ]);
      const bySubject = Object.fromEntries(SUBJECT_IDS.map((subject) => [
        subject,
        {
          label: SUBJECTS[subject].label,
          questions: items.filter((item) => subjectOf(item) === subject).length,
          ranges: SUBJECTS[subject].ranges,
        },
      ]));
      return {
        app: "words",
        description: "英語・古文・公共・保健の定期テスト対策アプリ",
        serviceVersion: SERVICE_VERSION,
        dataSchemaVersion: DATA_SCHEMA_VERSION,
        dataSource: catalog.source,
        totalQuestions: items.length,
        aiAddedQuestions: Object.keys(overlay.added).length,
        editedQuestions: Object.keys(overlay.patched).length,
        trashedQuestions: Object.keys(overlay.trash).length,
        subjects: bySubject,
        studyHistory: {
          synced: Boolean(history.updatedAt),
          syncedAt: history.updatedAt,
          questionsWithHistory: Object.keys(history.records ?? {}).length,
          journalEntries: (history.journal ?? []).length,
        },
        // 問題は全員で共有し、学習履歴だけが学習者ごとに分かれる。
        learners: (history.learners ?? []).map((learner) => learner.name),
        permissions: settings.permissions ?? null,
        limits: SERVICE_LIMITS,
      };
    },

    async searchQuestions(params = {}) {
      const keywords = readString(params.query, "query", { max: 200 })
        ?.split(/\s+/)
        .filter(Boolean)
        .map(normalizeText) ?? [];
      return queryQuestions(
        { ...readFilters(params), keywords },
        {
          limit: readInteger(params.limit, "limit", { min: 1, max: SERVICE_LIMITS.searchLimitMax }),
          offset: readInteger(params.offset, "offset", { min: 0, fallback: 0 }),
          sort: readEnum(params.sort, "sort", Object.keys(SORTERS), { fallback: "id" }),
          includeDeleted: params.includeDeleted === true,
          learner: readString(params.learner, "learner", { max: 60 }),
        },
      );
    },

    async listQuestions(params = {}) {
      return queryQuestions(readFilters(params), {
        limit: readInteger(params.limit, "limit", { min: 1, max: SERVICE_LIMITS.searchLimitMax }),
        offset: readInteger(params.offset, "offset", { min: 0, fallback: 0 }),
        sort: readEnum(params.sort, "sort", Object.keys(SORTERS), { fallback: "id" }),
        includeDeleted: params.includeDeleted === true,
        learner: readString(params.learner, "learner", { max: 60 }),
      });
    },

    async getQuestion(params = {}) {
      const id = readId(params.id, "id");
      const learner = readString(params.learner, "learner", { max: 60 });
      const [{ item, overlay }, history] = await Promise.all([findItem(id), readHistory(learner)]);
      if (!item) fail(`問題 ${id} は見つかりませんでした。`, "id");
      const detail = detailQuestion(item, getHistory(history.records ?? {}, id));
      detail.edited = Boolean(overlay.patched[id]);
      detail.deleted = Boolean(overlay.trash[id]);
      if (overlay.trash[id]) detail.deletedAt = overlay.trash[id].at;
      const modeStats = getHistory(history.records ?? {}, id).modeStats ?? {};
      detail.study = { ...(detail.study ?? {}), byMode: modeStats };
      return detail;
    },

    // ------------------------------------------------------------------
    // 書き込み
    // ------------------------------------------------------------------

    async addQuestions({ subject, questions }, actor = {}) {
      const targetSubject = readEnum(subject, "subject", SUBJECT_IDS, { required: true });
      if (!Array.isArray(questions)) fail("questions は配列で渡してください。", "questions");
      if (!questions.length) fail("questions が空です。", "questions");
      if (questions.length > SERVICE_LIMITS.addPerCall) {
        fail(
          `一度に追加できるのは${SERVICE_LIMITS.addPerCall}件までです（受け取った件数: ${questions.length}）。分けて実行してください。`,
          "questions",
        );
      }
      const { items } = await resolveItems({ includeDeleted: true });
      const taken = new Set(items.map((item) => item.id));
      const existingQuestions = new Set(
        items.filter((item) => subjectOf(item) === targetSubject).map((item) => normalizeText(questionText(item))),
      );

      // 先に全件を組み立てて検証する。1件でも駄目なら何も保存しない。
      const built = questions.map((input, index) => {
        const field = `questions[${index}]`;
        const id = nextId(targetSubject, taken);
        taken.add(id);
        const item = buildQuestion({ subject: targetSubject, input, id, field });
        const key = normalizeText(questionText(item));
        if (existingQuestions.has(key)) {
          fail(`${field}: 同じ問題文がすでに登録されています（${questionText(item)}）。`, field);
        }
        existingQuestions.add(key);
        return item;
      });

      const at = new Date(now()).toISOString();
      const { result } = await updateDocument(storage, STORAGE_KEYS.overlay, (document) => {
        const total = Object.keys(document.added).length + built.length;
        if (total > SERVICE_LIMITS.totalAdded) {
          fail(`AI経由で追加できる問題は合計${SERVICE_LIMITS.totalAdded}件までです。`, "questions");
        }
        built.forEach((item) => {
          document.added[item.id] = { item, at, client: actor.clientName ?? null, token: actor.tokenLabel ?? null };
        });
        return built.map((item) => item.id);
      }, { defaults: DEFAULT_OVERLAY });

      await appendLog(logEntry(actor, "addQuestions", `${SUBJECTS[targetSubject].label}に${built.length}件追加`, {
        subject: targetSubject,
        questionIds: result,
      }));
      return {
        added: built.length,
        subject: targetSubject,
        questions: built.map((item) => summarizeQuestion(item)),
      };
    },

    async updateQuestion({ id, patch }, actor = {}) {
      const questionId = readId(id, "id");
      const { item } = await findItem(questionId, { includeDeleted: true });
      if (!item) fail(`問題 ${questionId} は見つかりませんでした。`, "id");
      const { item: updated, changed } = patchQuestion(item, patch ?? {}, { field: "patch" });
      const at = new Date(now()).toISOString();
      await updateDocument(storage, STORAGE_KEYS.overlay, (document) => {
        if (document.added[questionId]) {
          // AIが追加した問題は、重ね合わせを重ねずに元の登録内容を書き換える。
          document.added[questionId] = { ...document.added[questionId], item: updated, updatedAt: at };
          return;
        }
        document.patched[questionId] = { item: updated, at, client: actor.clientName ?? null, changed };
      }, { defaults: DEFAULT_OVERLAY });

      await appendLog(logEntry(actor, "updateQuestion", `${questionId} の ${changed.join("・")} を変更`, {
        questionId,
        changed,
      }));
      return { id: questionId, changed, question: detailQuestion(updated) };
    },

    /**
     * 削除は完全削除ではなく「ゴミ箱へ移す」。元のデータは残るので、いつでも戻せる。
     * 一度に消せるのは1問だけにして、AIの一回の操作で大量に消えないようにしている。
     */
    async deleteQuestion({ id, reason = null, confirm = false }, actor = {}) {
      const questionId = readId(id, "id");
      if (confirm !== true) {
        fail(
          "削除するには confirm を true にしてください。削除は1問ずつ、ゴミ箱へ移す形で行われます。",
          "confirm",
        );
      }
      const note = readString(reason, "reason", { max: 200 });
      const { item, overlay } = await findItem(questionId, { includeDeleted: true });
      if (!item) fail(`問題 ${questionId} は見つかりませんでした。`, "id");
      if (overlay.trash[questionId]) {
        return { id: questionId, alreadyDeleted: true, deletedAt: overlay.trash[questionId].at };
      }
      const at = new Date(now()).toISOString();
      await updateDocument(storage, STORAGE_KEYS.overlay, (document) => {
        document.trash[questionId] = {
          at,
          reason: note,
          client: actor.clientName ?? null,
          token: actor.tokenLabel ?? null,
          question: questionText(item),
        };
      }, { defaults: DEFAULT_OVERLAY });
      await appendLog(logEntry(actor, "deleteQuestion", `${questionId} をゴミ箱へ移動`, { questionId, reason: note }));
      return {
        id: questionId,
        deleted: true,
        deletedAt: at,
        restorable: true,
        note: "完全には消していません。restoreQuestion、またはwordsの設定画面から元に戻せます。",
      };
    },

    async restoreQuestion({ id }, actor = {}) {
      const questionId = readId(id, "id");
      const { overlay } = await findItem(questionId, { includeDeleted: true });
      if (!overlay.trash[questionId]) fail(`問題 ${questionId} はゴミ箱にありません。`, "id");
      await updateDocument(storage, STORAGE_KEYS.overlay, (document) => {
        delete document.trash[questionId];
      }, { defaults: DEFAULT_OVERLAY });
      await appendLog(logEntry(actor, "restoreQuestion", `${questionId} をゴミ箱から復元`, { questionId }));
      return { id: questionId, restored: true };
    },

    // ------------------------------------------------------------------
    // 学習の記録
    // ------------------------------------------------------------------

    async getStudyStats(params = {}) {
      const learner = readString(params.learner, "learner", { max: 60 });
      const [{ items }, history] = await Promise.all([resolveItems(), readHistory(learner)]);
      const records = history.records ?? {};
      const modes = readStringArray(params.modes, "modes", { max: 12 }) ?? [];
      const subjects = readStringArray(params.subjects, "subjects", { max: 4, allowed: SUBJECT_IDS }) ?? SUBJECT_IDS;
      const offsetMinutes = readInteger(params.timezoneOffsetMinutes, "timezoneOffsetMinutes", {
        min: -840, max: 840, fallback: 540,
      });

      const scoped = items.filter((item) => subjects.includes(subjectOf(item)));
      const rows = scoped.map((item) => ({
        item,
        record: modes.length
          ? historyForModes(getHistory(records, item.id), modes)
          : getHistory(records, item.id),
      }));

      const tally = (list) => {
        const attempts = list.reduce((sum, row) => sum + row.record.totalAttempts, 0);
        const correct = list.reduce((sum, row) => sum + row.record.correctCount, 0);
        const studied = list.filter((row) => row.record.totalAttempts > 0).length;
        return {
          questions: list.length,
          studiedQuestions: studied,
          unstudiedQuestions: list.length - studied,
          attempts,
          correct,
          wrong: attempts - correct,
          accuracy: attempts ? Number((correct / attempts).toFixed(3)) : null,
        };
      };

      const groupBy = (getKey) => {
        const groups = new Map();
        rows.forEach((row) => {
          const key = getKey(row.item);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(row);
        });
        return [...groups.entries()].map(([key, list]) => ({ key, ...tally(list) }));
      };

      const today = startOfDay(now(), offsetMinutes);
      const recentDays = readInteger(params.recentDays, "recentDays", { min: 1, max: 90, fallback: 7 });
      const since = today - (recentDays - 1) * 86400000;
      const journal = (history.journal ?? []).filter((entry) => entry.at >= since);
      const dailyMap = new Map();
      journal.forEach((entry) => {
        const key = dayKey(entry.at, offsetMinutes);
        const day = dailyMap.get(key) ?? { date: key, attempts: 0, correct: 0 };
        day.attempts += 1;
        day.correct += entry.correct ? 1 : 0;
        dailyMap.set(key, day);
      });

      // 学習者が複数いて、誰とも指定が無いときは、人ごとの成績も添える。
      const perLearner = !learner && (history.learners ?? []).length > 1 && sync
        ? await Promise.all((await sync.historyByLearner()).map(async (entry) => {
          const learnerRows = scoped.map((item) => ({
            item,
            record: modes.length
              ? historyForModes(getHistory(entry.records, item.id), modes)
              : getHistory(entry.records, item.id),
          }));
          return { learner: entry.name, learnerId: entry.id, ...tally(learnerRows) };
        }))
        : null;

      return {
        syncedAt: history.updatedAt,
        learner: learner ?? null,
        learners: history.learners ?? [],
        byLearner: perLearner,
        modes: modes.length ? modes : null,
        overall: tally(rows),
        bySubject: groupBy((item) => subjectOf(item)).map((group) => ({
          subject: group.key,
          label: SUBJECTS[group.key]?.label ?? group.key,
          ...group,
        })),
        byRange: groupBy((item) => `${subjectOf(item)} / ${item.range}`),
        byImportance: groupBy((item) => item.importance ?? "—"),
        recent: {
          days: recentDays,
          // 学習履歴の細かい記録（journal）はAI連携を有効にしてから貯まる。
          available: (history.journal ?? []).length > 0,
          daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
          attempts: journal.length,
          correct: journal.filter((entry) => entry.correct).length,
        },
      };
    },

    async getRecentMistakes(params = {}) {
      const offsetMinutes = readInteger(params.timezoneOffsetMinutes, "timezoneOffsetMinutes", {
        min: -840, max: 840, fallback: 540,
      });
      const days = readInteger(params.days, "days", { min: 1, max: 365, fallback: 1 });
      const limit = readInteger(params.limit, "limit", { min: 1, max: SERVICE_LIMITS.searchLimitMax, fallback: 20 });
      const since = params.since !== undefined && params.since !== null
        ? readInteger(params.since, "since", { min: 0 })
        : startOfDay(now(), offsetMinutes) - (days - 1) * 86400000;

      const learner = readString(params.learner, "learner", { max: 60 });
      const [{ items }, history] = await Promise.all([resolveItems(), readHistory(learner)]);
      const records = history.records ?? {};
      const subjects = readStringArray(params.subjects, "subjects", { max: 4, allowed: SUBJECT_IDS });
      const byId = new Map(items.map((item) => [item.id, item]));

      // 細かい記録があればそちらを使い、無ければ「最後に間違えた日時」で拾う。
      const journal = (history.journal ?? []).filter((entry) => !entry.correct && entry.at >= since);
      const fromJournal = new Map();
      journal.forEach((entry) => {
        const item = byId.get(entry.itemId);
        if (!item) return;
        if (subjects?.length && !subjects.includes(subjectOf(item))) return;
        const key = entry.learner ? `${entry.learner}|${entry.itemId}` : entry.itemId;
        const current = fromJournal.get(key)
          ?? { item, times: 0, lastAt: 0, modes: new Set(), learner: entry.learner ?? null };
        current.times += 1;
        current.lastAt = Math.max(current.lastAt, entry.at);
        if (entry.mode) current.modes.add(entry.mode);
        fromJournal.set(key, current);
      });

      let rows;
      let source;
      if (fromJournal.size) {
        source = "journal";
        rows = [...fromJournal.values()]
          .sort((a, b) => b.lastAt - a.lastAt)
          .map((entry) => ({
            ...summarizeQuestion(entry.item, getHistory(records, entry.item.id)),
            missedTimes: entry.times,
            missedAt: new Date(entry.lastAt).toISOString(),
            modes: [...entry.modes],
            ...(entry.learner ? { learner: entry.learner } : {}),
          }));
      } else {
        source = "history";
        rows = items
          .filter((item) => (!subjects?.length || subjects.includes(subjectOf(item))))
          .map((item) => ({ item, record: getHistory(records, item.id) }))
          .filter(({ record }) => (record.lastWrongAt ?? 0) >= since)
          .sort((a, b) => (b.record.lastWrongAt ?? 0) - (a.record.lastWrongAt ?? 0))
          .map(({ item, record }) => ({
            ...summarizeQuestion(item, record),
            missedTimes: record.wrongCount,
            missedAt: new Date(record.lastWrongAt).toISOString(),
          }));
      }

      return {
        since: new Date(since).toISOString(),
        days,
        source,
        learner: learner ?? null,
        learners: history.learners ?? [],
        syncedAt: history.updatedAt,
        total: rows.length,
        returned: Math.min(rows.length, limit),
        questions: rows.slice(0, limit),
      };
    },

    async getStudyHistory(params = {}) {
      const offsetMinutes = readInteger(params.timezoneOffsetMinutes, "timezoneOffsetMinutes", {
        min: -840, max: 840, fallback: 540,
      });
      const days = readInteger(params.days, "days", { min: 1, max: 365, fallback: 7 });
      const limit = readInteger(params.limit, "limit", { min: 1, max: 200, fallback: 50 });
      const since = startOfDay(now(), offsetMinutes) - (days - 1) * 86400000;
      const learner = readString(params.learner, "learner", { max: 60 });
      const [{ items }, history] = await Promise.all([resolveItems({ includeDeleted: true }), readHistory(learner)]);
      const byId = new Map(items.map((item) => [item.id, item]));
      const onlyWrong = params.onlyWrong === true;

      const entries = (history.journal ?? [])
        .filter((entry) => entry.at >= since && (!onlyWrong || !entry.correct))
        .sort((a, b) => b.at - a.at)
        .slice(0, limit)
        .map((entry) => {
          const item = byId.get(entry.itemId);
          return {
            at: new Date(entry.at).toISOString(),
            date: dayKey(entry.at, offsetMinutes),
            questionId: entry.itemId,
            subject: item ? subjectOf(item) : null,
            question: item ? questionText(item) : null,
            answer: item ? answerText(item) : null,
            correct: Boolean(entry.correct),
            mode: entry.mode ?? null,
            durationMs: entry.durationMs ?? null,
            ...(entry.learner ? { learner: entry.learner } : {}),
          };
        });

      return {
        since: new Date(since).toISOString(),
        days,
        learner: learner ?? null,
        learners: history.learners ?? [],
        syncedAt: history.updatedAt,
        available: (history.journal ?? []).length > 0,
        note: (history.journal ?? []).length
          ? null
          : "1問ごとの学習記録はまだありません。wordsの設定画面でAI連携を有効にすると記録が貯まります。",
        total: entries.length,
        entries,
        sessions: (history.sessions ?? []).slice(0, 20),
      };
    },

    // ------------------------------------------------------------------
    // words 本体（ブラウザ）との受け渡し
    // ------------------------------------------------------------------

    /** 学習履歴のスナップショットを受け取る。端末が唯一の持ち主なので、上書き保存でよい。 */
    async saveHistorySnapshot(payload = {}) {
      const records = payload.records;
      if (records !== undefined && records !== null && typeof records !== "object") {
        fail("records はオブジェクトで渡してください。", "records");
      }
      const entries = Object.entries(records ?? {});
      if (entries.length > SERVICE_LIMITS.historyRecords) {
        fail(`学習履歴は${SERVICE_LIMITS.historyRecords}件までです。`, "records");
      }
      const journal = Array.isArray(payload.journal)
        ? payload.journal
          .filter((entry) => entry && typeof entry.itemId === "string" && Number.isFinite(entry.at))
          .slice(0, SERVICE_LIMITS.journalEntries)
          .map((entry) => ({
            itemId: entry.itemId,
            at: entry.at,
            correct: Boolean(entry.correct),
            mode: typeof entry.mode === "string" ? entry.mode.slice(0, 60) : null,
            durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : null,
          }))
        : [];
      const savedAt = new Date(now()).toISOString();
      const sessions = Array.isArray(payload.sessions) ? payload.sessions.slice(0, 20) : [];
      if (!sync) {
        await storage.put(STORAGE_KEYS.history, {
          updatedAt: savedAt,
          deviceId: readString(payload.deviceId, "deviceId", { max: 80 }),
          records: Object.fromEntries(entries),
          journal,
          sessions,
        });
        return { savedAt, records: entries.length, journal: journal.length };
      }
      // 学習者を分ける前からある入口。学習者を作っていなければ「本人」を用意し、
      // この端末ぶんとして預かる。ほかの端末の記録とは正しく合算される。
      const result = await sync.saveOwnerSnapshot({
        records: Object.fromEntries(entries),
        journal,
        sessions,
        deviceId: readString(payload.deviceId, "deviceId", { max: 80 }),
      });
      return { savedAt, records: entries.length, journal: journal.length, learner: result.learnerName };
    },

    /** wordsの画面が、AIによる追加・変更・削除を取り込むための差分。 */
    async getOverlay() {
      const overlay = await readOverlay();
      return {
        schemaVersion: overlay.schemaVersion ?? DATA_SCHEMA_VERSION,
        revision: overlay.revision ?? 0,
        added: Object.values(overlay.added).map((entry) => entry.item),
        patched: Object.fromEntries(Object.entries(overlay.patched).map(([id, entry]) => [id, entry.item])),
        deletedIds: Object.keys(overlay.trash),
        trash: Object.entries(overlay.trash).map(([id, entry]) => ({ id, ...entry })),
      };
    },

    async getOperationLog({ limit = 20 } = {}) {
      const document = await readDocument(STORAGE_KEYS.log, DEFAULT_LOG);
      const size = Math.min(Math.max(1, Number(limit) || 20), SERVICE_LIMITS.logEntries);
      return { total: (document.entries ?? []).length, entries: (document.entries ?? []).slice(0, size) };
    },

    appendLog,
    resolveItems,
    readOverlay,
    readHistory,
  };
}

/** 検索・一覧に共通する絞り込み条件の読み取り。 */
function readFilters(params) {
  return {
    subjects: readStringArray(params.subjects ?? (params.subject ? [params.subject] : null), "subjects", {
      max: 4,
      allowed: SUBJECT_IDS,
    }),
    ranges: readStringArray(params.ranges ?? (params.range ? [params.range] : null), "ranges", { max: 16 }),
    importance: readStringArray(params.importance, "importance", {
      max: 7,
      allowed: ["SSS", "SS", "S", "A", "B", "C", "D"],
    }),
    types: readStringArray(params.types, "types", { max: 8 }),
    tags: readStringArray(params.tags, "tags", { max: 12 }),
    questionModes: readStringArray(params.questionModes, "questionModes", { max: 12 }),
    performance: readEnum(params.performance, "performance", [
      "all", "answered", "unanswered", "wrong", "correct", "last-wrong",
    ], { fallback: "all" }),
    minimumWrong: readInteger(params.minimumWrong, "minimumWrong", { min: 0, max: 999, fallback: 0 }),
    aiAddedOnly: params.aiAddedOnly === true,
  };
}

export { ValidationError };
