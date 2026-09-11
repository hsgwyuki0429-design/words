import test from "node:test";
import assert from "node:assert/strict";

import {
  compactDevice,
  dedupeJournal,
  mergeHistoryRecords,
  mergeLearnerHistory,
  mergeProgressMaps,
  mergeRecordMaps,
  replayJournal,
  unwrapProgressMap,
  wrapProgressMap,
} from "../server/service/history-merge.js";
import { emptyHistory, mergeAttempt } from "../src/logic.js";

/** その端末で解いたぶんの記録を作る補助。 */
function answers(deviceId, list) {
  return list.map(([itemId, at, correct, mode = "health_recall"], index) => ({
    eventId: `${deviceId}-${index + 1}`,
    itemId,
    at,
    correct,
    mode,
  }));
}

test("2台の端末で解いた分は、取りこぼしなく足し合わされる", () => {
  const merged = mergeLearnerHistory({
    phone: { baseline: {}, journal: answers("phone", [["x", 100, true], ["x", 300, false]]) },
    tablet: { baseline: {}, journal: answers("tablet", [["x", 200, true]]) },
  });
  assert.equal(merged.records.x.totalAttempts, 3);
  assert.equal(merged.records.x.correctCount, 2);
  assert.equal(merged.records.x.wrongCount, 1);
  // 最後に解いたのは300の不正解なので、そこが最新として残る。
  assert.equal(merged.records.x.lastResult, "wrong");
  assert.equal(merged.records.x.lastAttemptAt, 300);
  assert.equal(merged.records.x.lastCorrectAt, 200);
});

test("同じ記録が何度届いても、回答数は増えない", () => {
  const phone = { baseline: {}, journal: answers("phone", [["x", 100, true], ["x", 200, false]]) };
  const once = mergeLearnerHistory({ phone });
  const twice = mergeLearnerHistory({
    phone,
    // 電波が悪くて二重に送られた場合や、別の端末が同じ記録を持ち帰った場合。
    phoneAgain: { baseline: {}, journal: [...phone.journal, ...phone.journal] },
  });
  assert.equal(once.records.x.totalAttempts, 2);
  assert.equal(twice.records.x.totalAttempts, 2, "二重に数えない");
});

test("同期を始める前からあった分（基準値）と、そのあとの記録が正しく重なる", () => {
  // スマホには以前から5回解いた記録があり、同期後にもう1回解いた。
  const before = mergeAttempt(
    mergeAttempt(emptyHistory("x"), { itemId: "x", mode: "m", correct: true, answeredAt: 10 }),
    { itemId: "x", mode: "m", correct: false, answeredAt: 20 },
  );
  const merged = mergeLearnerHistory({
    phone: { baseline: { x: before }, journal: answers("phone", [["x", 100, true]]) },
  });
  assert.equal(merged.records.x.totalAttempts, 3);
  assert.equal(merged.records.x.correctCount, 2);
});

test("オフラインで貯めた記録を、あとからまとめて送っても正しくなる", () => {
  const live = { baseline: {}, journal: answers("phone", [["x", 100, true]]) };
  const offline = { baseline: {}, journal: answers("tablet", [["x", 200, false], ["x", 300, false], ["x", 400, true]]) };
  const merged = mergeLearnerHistory({ live, offline });
  assert.equal(merged.records.x.totalAttempts, 4);
  assert.equal(merged.records.x.wrongCount, 2);
  // 時刻の順に積み上がるので、最後の1回（正解）が最新になる。
  assert.equal(merged.records.x.lastResult, "correct");
});

test("記録が増えすぎたら古い分を畳み込む。合計は変わらない", () => {
  const journal = answers("phone", Array.from({ length: 50 }, (_, index) => ["x", index + 1, index % 2 === 0]));
  const full = mergeLearnerHistory({ phone: { baseline: {}, journal } });
  const compacted = compactDevice({ baseline: {}, journal }, { keepEntries: 10 });
  const after = mergeLearnerHistory({ phone: compacted });
  assert.equal(compacted.journal.length, 10, "細かい記録は新しい分だけ残る");
  assert.equal(after.records.x.totalAttempts, full.records.x.totalAttempts);
  assert.equal(after.records.x.correctCount, full.records.x.correctCount);
});

test("1問ぶんの履歴を合わせると、形式ごとの成績もまとまる", () => {
  const left = mergeAttempt(emptyHistory("x"), { itemId: "x", mode: "a", correct: true, answeredAt: 10, durationMs: 100 });
  const right = mergeAttempt(emptyHistory("x"), { itemId: "x", mode: "b", correct: false, answeredAt: 20, durationMs: 200 });
  const merged = mergeHistoryRecords(left, right);
  assert.equal(merged.totalAttempts, 2);
  assert.equal(merged.totalAnswerTimeMs, 300);
  assert.equal(merged.modeStats.a.attempts, 1);
  assert.equal(merged.modeStats.b.attempts, 1);
  assert.equal(merged.hasEverMissed, true);
  assert.equal(merged.lastResult, "wrong", "新しいほうの結果が残る");
});

test("片方しか記録が無い場合も、そのまま扱える", () => {
  const record = emptyHistory("x");
  assert.deepEqual(mergeHistoryRecords(record, null), record);
  assert.deepEqual(mergeHistoryRecords(null, record), record);
  assert.equal(mergeHistoryRecords(null, null), null);
  assert.deepEqual(mergeRecordMaps({}, { x: record }), { x: record });
});

test("イベントIDが無い古い記録も、内容が同じなら1つにまとめる", () => {
  const entries = [
    { itemId: "x", at: 100, correct: true, mode: "m" },
    { itemId: "x", at: 100, correct: true, mode: "m" },
    { itemId: "x", at: 200, correct: false, mode: "m" },
  ];
  assert.equal(dedupeJournal(entries).length, 2);
});

test("壊れた記録は取り込まず、学習履歴を汚さない", () => {
  const entries = [
    { itemId: "x", at: 100, correct: true },
    null,
    { itemId: 123, at: 200 },
    { at: 300, correct: true },
    { itemId: "y", at: "時刻ではない" },
  ];
  const cleaned = dedupeJournal(entries);
  assert.equal(cleaned.length, 1);
  assert.equal(Object.keys(replayJournal({}, entries)).length, 1);
});

test("周回の進み具合は、最後に動かした端末のものを採る", () => {
  const merged = mergeProgressMaps(
    { "key-1": { value: { cycleNumber: 2 }, updatedAt: 100 } },
    { "key-1": { value: { cycleNumber: 5 }, updatedAt: 200 }, "key-2": { value: {}, updatedAt: 50 } },
  );
  assert.equal(merged["key-1"].value.cycleNumber, 5);
  assert.ok(merged["key-2"], "片方にしか無いものは残る");

  const older = mergeProgressMaps(
    { "key-1": { value: { cycleNumber: 9 }, updatedAt: 999 } },
    { "key-1": { value: { cycleNumber: 1 }, updatedAt: 1 } },
  );
  assert.equal(older["key-1"].value.cycleNumber, 9, "古い内容で上書きしない");
});

test("周回の進み具合は、保存用の形と画面の形を行き来できる", () => {
  const progress = { "key-1": { cycleNumber: 3, lastUpdatedAt: 500 } };
  const wrapped = wrapProgressMap(progress);
  assert.equal(wrapped["key-1"].updatedAt, 500);
  assert.deepEqual(unwrapProgressMap(wrapped), progress);
});

test("合計にすでに入っている記録は、表示に使うだけで二重に数えない", () => {
  // 「合計」と「1問ごとの記録」の両方を送ってくる入口がある。
  // 両方を積み上げると、同じ回答を二度数えてしまう。
  const merged = mergeLearnerHistory({
    old: {
      baseline: {
        x: {
          itemId: "x", totalAttempts: 4, correctCount: 3, wrongCount: 1,
          lastResult: "correct", lastAttemptAt: 500, modeStats: {},
        },
      },
      journal: [],
      log: answers("old", [["x", 500, true]]),
    },
  });
  assert.equal(merged.records.x.totalAttempts, 4, "合計はそのまま");
  assert.equal(merged.journal.length, 1, "1問ごとの記録は画面に出せる");
});

test("合計に入っている分と、そのあと解いた分は区別して積み上げる", () => {
  const merged = mergeLearnerHistory({
    phone: {
      baseline: { x: { itemId: "x", totalAttempts: 4, correctCount: 3, wrongCount: 1, lastAttemptAt: 500, modeStats: {} } },
      log: answers("phone", [["x", 500, true]]),
      journal: answers("phoneNew", [["x", 900, false]]),
    },
  });
  assert.equal(merged.records.x.totalAttempts, 5, "あとから解いた1回だけが足される");
  assert.equal(merged.journal.length, 2);
});
