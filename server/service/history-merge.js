// 複数の端末の学習履歴を、取りこぼしも二重計上もなく1つに合わせる処理。
//
// なぜ単純な「上書き」や「合算」では駄目なのか
// ------------------------------------------------
// wordsの学習履歴は「のべ回答数」「正解数」のような積み上げた数で持っている。
//
//   ・上書き … あとから同期した端末の内容で、もう片方の学習が消える
//   ・合算   … 同期のたびに同じ回答を足してしまい、回数が増え続ける
//
// そこで、端末ごとに次の2つを分けて預かる。
//
//   baseline … その端末が同期を始める前から持っていた分（1回だけ預ける）
//   journal  … 同期を始めたあとの1問ごとの記録（イベントIDつき）
//
// 合わせた履歴は「全端末の baseline を足したもの」に「全端末の journal を
// イベントIDで重複を除いて時刻順に再生したもの」を重ねて作る。
// 同じイベントを何度送っても結果が変わらないので、電波の悪いところで
// 二重に送られても、しばらくオフラインで貯めてからまとめて送っても正しくなる。

import { emptyHistory, mergeAttempt } from "../../src/logic.js";

/** 2つの数を足す。片方が無い場合も0として扱う。 */
function add(left, right) {
  return (Number(left) || 0) + (Number(right) || 0);
}

/** 新しいほうの時刻を採る。どちらも無ければ null。 */
function later(left, right) {
  if (!left) return right ?? null;
  if (!right) return left ?? null;
  return Math.max(left, right);
}

function mergeModeStat(left, right) {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  const leftIsNewer = (left.lastAttemptAt ?? 0) >= (right.lastAttemptAt ?? 0);
  const newer = leftIsNewer ? left : right;
  return {
    attempts: add(left.attempts, right.attempts),
    correct: add(left.correct, right.correct),
    wrong: add(left.wrong, right.wrong),
    totalAnswerTimeMs: add(left.totalAnswerTimeMs, right.totalAnswerTimeMs),
    lastResult: newer.lastResult ?? null,
    lastAttemptAt: later(left.lastAttemptAt, right.lastAttemptAt),
    // 連続正解は端末をまたいで数えられないので、最後に解いた端末の値を引き継ぐ。
    currentCorrectStreak: newer.currentCorrectStreak ?? 0,
    bestCorrectStreak: Math.max(left.bestCorrectStreak ?? 0, right.bestCorrectStreak ?? 0),
  };
}

/**
 * 1問ぶんの履歴レコードを2つ合わせる。
 * 回数は足し、時刻は新しいほうを採り、連続正解は最後に解いた端末のものを引き継ぐ。
 */
export function mergeHistoryRecords(left, right) {
  if (!left) return right ? structuredClone(right) : null;
  if (!right) return structuredClone(left);

  const leftIsNewer = (left.lastAttemptAt ?? 0) >= (right.lastAttemptAt ?? 0);
  const newer = leftIsNewer ? left : right;
  const modes = new Set([
    ...Object.keys(left.modeStats ?? {}),
    ...Object.keys(right.modeStats ?? {}),
  ]);

  return {
    itemId: left.itemId ?? right.itemId,
    totalAttempts: add(left.totalAttempts, right.totalAttempts),
    correctCount: add(left.correctCount, right.correctCount),
    wrongCount: add(left.wrongCount, right.wrongCount),
    currentCorrectStreak: newer.currentCorrectStreak ?? 0,
    bestCorrectStreak: Math.max(left.bestCorrectStreak ?? 0, right.bestCorrectStreak ?? 0),
    hasEverMissed: Boolean(left.hasEverMissed || right.hasEverMissed),
    lastResult: newer.lastResult ?? null,
    lastAttemptAt: later(left.lastAttemptAt, right.lastAttemptAt),
    lastCorrectAt: later(left.lastCorrectAt, right.lastCorrectAt),
    lastWrongAt: later(left.lastWrongAt, right.lastWrongAt),
    totalAnswerTimeMs: add(left.totalAnswerTimeMs, right.totalAnswerTimeMs),
    modeStats: Object.fromEntries(
      [...modes].map((mode) => [mode, mergeModeStat(left.modeStats?.[mode], right.modeStats?.[mode])]),
    ),
  };
}

/** 問題IDごとの履歴のかたまりを2つ合わせる。 */
export function mergeRecordMaps(left = {}, right = {}) {
  const merged = { ...structuredClone(left) };
  for (const [itemId, record] of Object.entries(right)) {
    merged[itemId] = mergeHistoryRecords(merged[itemId], record);
  }
  return merged;
}

/**
 * 1問ごとの記録を、イベントIDで重複を除いて時刻の古い順に並べる。
 * 同じイベントを何度受け取っても、並べた結果は同じになる。
 */
export function dedupeJournal(entries = []) {
  const seen = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.itemId !== "string" || !Number.isFinite(entry.at)) continue;
    // イベントIDが無い古い記録は、内容から同じものを1つにまとめる。
    const key = entry.eventId ?? `${entry.itemId}|${entry.at}|${entry.mode ?? ""}`;
    if (!seen.has(key)) seen.set(key, entry);
  }
  return [...seen.values()].sort((left, right) => left.at - right.at);
}

/** 1問ごとの記録を積み上げて、問題IDごとの履歴に直す。 */
export function replayJournal(records = {}, entries = []) {
  const result = structuredClone(records);
  for (const entry of dedupeJournal(entries)) {
    result[entry.itemId] = mergeAttempt(result[entry.itemId] ?? emptyHistory(entry.itemId), {
      itemId: entry.itemId,
      mode: entry.mode ?? "unknown",
      correct: Boolean(entry.correct),
      answeredAt: entry.at,
      durationMs: Number(entry.durationMs) || 0,
    });
  }
  return result;
}

/**
 * 1人ぶんの端末をすべて合わせて、その人の学習履歴を作る。
 * devices は { 端末ID: { baseline, journal, log } } の形。
 *
 *   baseline … その端末の積み上がった合計
 *   journal  … baseline にまだ入っていない1問ごとの記録。合計へ積み上げる
 *   log      … すでに baseline に入っている1問ごとの記録。表示にだけ使う
 *
 * log を分けているのは、端末が「合計」と「1問ごとの記録」を両方送ってくる
 * 入口があるため。両方を積み上げると同じ回答を二度数えてしまう。
 */
export function mergeLearnerHistory(devices = {}) {
  let records = {};
  const counted = [];
  const shown = [];
  for (const device of Object.values(devices)) {
    records = mergeRecordMaps(records, device?.baseline ?? {});
    counted.push(...(device?.journal ?? []));
    shown.push(...(device?.log ?? []));
  }
  const ordered = dedupeJournal(counted);
  return {
    records: replayJournal(records, ordered),
    // 画面と統計で見せるのは、積み上げた分と、すでに合計に入っている分の両方。
    journal: dedupeJournal([...ordered, ...shown]),
  };
}

/**
 * 周回の進み具合は、端末をまたいで足し合わせられない（同じ問題を別々に進めている）。
 * 同じ学習条件（キー）については、最後に動かした端末のものを採る。
 */
export function mergeProgressMaps(left = {}, right = {}) {
  const merged = { ...left };
  for (const [key, entry] of Object.entries(right)) {
    const current = merged[key];
    if (!current || (entry?.updatedAt ?? 0) >= (current.updatedAt ?? 0)) merged[key] = entry;
  }
  return merged;
}

/** 保存したままの形（updatedAt付き）から、wordsの画面が使う形へ戻す。 */
export function unwrapProgressMap(wrapped = {}) {
  return Object.fromEntries(
    Object.entries(wrapped)
      .filter(([, entry]) => entry?.value)
      .map(([key, entry]) => [key, entry.value]),
  );
}

/** wordsの画面が持っている形を、更新時刻を添えた保存用の形にする。 */
export function wrapProgressMap(map = {}, { fallbackUpdatedAt = 0 } = {}) {
  return Object.fromEntries(
    Object.entries(map ?? {})
      .filter(([, value]) => value && typeof value === "object")
      .map(([key, value]) => [key, {
        value,
        updatedAt: Number(value.lastUpdatedAt) || Number(value.updatedAt) || fallbackUpdatedAt,
      }]),
  );
}

/**
 * 記録が増えすぎないよう、古い1問ごとの記録を基準値へ畳み込む。
 * 畳み込んでも合計は変わらない（1問ごとの細かい記録だけが消える）。
 */
export function compactDevice(device, { keepEntries = 1000 } = {}) {
  const journal = dedupeJournal(device?.journal ?? []);
  if (journal.length <= keepEntries) return { ...device, journal };
  const foldCount = journal.length - keepEntries;
  return {
    ...device,
    baseline: replayJournal(device?.baseline ?? {}, journal.slice(0, foldCount)),
    journal: journal.slice(foldCount),
  };
}
