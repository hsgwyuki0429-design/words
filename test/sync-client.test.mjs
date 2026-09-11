import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_DEVICE_SYNC,
  DEVICE_SYNC_META_KEY,
  TRANSFER_FORMAT,
  buildTransferFile,
  createJournalEntry,
  createSyncClient,
  guessDeviceName,
  highestSeq,
  isSyncConnected,
  mergeStudyProgress,
  normalizeDeviceSync,
  readTransferFile,
  relativeTimeLabel,
  syncStateLabel,
  transferFileName,
  unsentEntries,
} from "../src/sync.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const storageSource = readFileSync(new URL("../src/storage.js", import.meta.url), "utf8");
const serviceWorkerSource = readFileSync(new URL("../sw.js", import.meta.url), "utf8");

test("同期は既定で無効。設定が揃うまで接続されない", () => {
  assert.equal(DEFAULT_DEVICE_SYNC.deviceKey, "");
  assert.equal(isSyncConnected(normalizeDeviceSync({})), false);
  assert.equal(isSyncConnected(normalizeDeviceSync({ serverUrl: "https://a.test" })), false);
  assert.equal(isSyncConnected(normalizeDeviceSync({ serverUrl: "https://a.test", deviceKey: "k" })), true);
});

test("入力されたURLの末尾の / や /mcp を取り除く", () => {
  assert.equal(normalizeDeviceSync({ serverUrl: "https://a.test/mcp/" }).serverUrl, "https://a.test");
  assert.equal(normalizeDeviceSync({ serverUrl: " https://a.test/ " }).serverUrl, "https://a.test");
});

test("1問ごとの記録には、ほかと重ならない番号が付く", () => {
  let seq = 0;
  const entries = [];
  for (let index = 0; index < 3; index += 1) {
    const result = createJournalEntry(
      { itemId: `item-${index}`, mode: "m", correct: index % 2 === 0, durationMs: 1000 },
      { deviceId: "device-1", seq },
    );
    seq = result.seq;
    entries.push(result.entry);
  }
  assert.deepEqual(entries.map((entry) => entry.eventId), ["device-1-1", "device-1-2", "device-1-3"]);
  assert.equal(highestSeq(entries), 3);
  // 端末が違えば番号も重ならない。
  const other = createJournalEntry({ itemId: "x", correct: true }, { deviceId: "device-2", seq: 0 });
  assert.equal(other.entry.eventId, "device-2-1");
});

test("まだ送っていない記録だけを、古い順に取り出す", () => {
  const journal = [
    { seq: 5, itemId: "e" }, { seq: 3, itemId: "c" }, { seq: 4, itemId: "d" },
    { seq: 1, itemId: "a" }, { seq: 2, itemId: "b" },
  ];
  assert.deepEqual(unsentEntries(journal, 2).map((entry) => entry.itemId), ["c", "d", "e"]);
  assert.deepEqual(unsentEntries(journal, 5), []);
  assert.equal(unsentEntries(journal, 0, 2).length, 2, "一度に送る数には上限がある");
});

test("周回の進み具合は、新しいほうを採る", () => {
  const merged = mergeStudyProgress(
    { a: { lastUpdatedAt: 100, cycleNumber: 1 }, b: { lastUpdatedAt: 500, cycleNumber: 9 } },
    { a: { lastUpdatedAt: 200, cycleNumber: 2 }, b: { lastUpdatedAt: 100, cycleNumber: 1 }, c: { lastUpdatedAt: 1 } },
  );
  assert.equal(merged.a.cycleNumber, 2, "相手のほうが新しければ受け入れる");
  assert.equal(merged.b.cycleNumber, 9, "自分のほうが新しければ守る");
  assert.ok(merged.c, "相手にしか無いものは受け入れる");
});

test("学習データを書き出して、別の端末で読み込める", () => {
  const history = new Map([
    ["a", { itemId: "a", totalAttempts: 3, correctCount: 2 }],
    ["b", { itemId: "b", totalAttempts: 1, correctCount: 1 }],
  ]);
  const file = buildTransferFile({
    history,
    journal: [{ eventId: "d-1", itemId: "a", at: 1, correct: true }],
    studyProgress: { "key-1": { cycleNumber: 2 } },
    settings: { sound: true },
    bestCombo: 12,
    selectedPeriod: "2026.2",
  });
  assert.equal(file.format, TRANSFER_FORMAT);
  assert.deepEqual(file.counts, { questions: 2, attempts: 4, journal: 1 });

  const restored = readTransferFile(JSON.stringify(file));
  assert.equal(restored.ok, true);
  assert.deepEqual(Object.keys(restored.data.history).sort(), ["a", "b"]);
  assert.equal(restored.data.bestCombo, 12);
  assert.equal(restored.data.selectedPeriod, "2026.2");
  assert.equal(restored.data.studyProgress["key-1"].cycleNumber, 2);
});

test("wordsのファイルでないものや壊れたファイルは読み込まない", () => {
  assert.match(readTransferFile("これはJSONではない").message, /読み取れませんでした/);
  assert.match(readTransferFile('{"format":"別のアプリ"}').message, /wordsの学習データファイルではない/);
  assert.match(readTransferFile(JSON.stringify({ format: TRANSFER_FORMAT, version: 99 })).message, /新しい版/);
  assert.match(readTransferFile(JSON.stringify({ format: TRANSFER_FORMAT, version: 1 })).message, /壊れています/);
  assert.match(
    readTransferFile(JSON.stringify({ format: TRANSFER_FORMAT, version: 1, data: { history: "文字列" } })).message,
    /壊れています/,
  );
});

test("読み込んだファイルの中の、壊れた記録は取り除かれる", () => {
  const file = { format: TRANSFER_FORMAT, version: 1, data: { history: { a: { itemId: "a" }, b: null, "": {} } } };
  const restored = readTransferFile(JSON.stringify(file));
  assert.deepEqual(Object.keys(restored.data.history), ["a"]);
});

test("書き出すファイルの名前には日付が入り、英数字だけで作られる", () => {
  const name = transferFileName(new Date(2026, 8, 11));
  assert.equal(name, "words-study-data-20260911.json");
  // 端末をまたいで受け渡すため、文字化けや拡張子落ちが起きない名前にする。
  assert.match(name, /^[\w.-]+$/);
});

test("端末の名前は、入力させずに見当をつける", () => {
  assert.equal(guessDeviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "iPhone");
  assert.equal(guessDeviceName("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"), "iPad");
  assert.equal(guessDeviceName("Mozilla/5.0 (Linux; Android 15; Pixel) Mobile"), "Androidスマホ");
  assert.equal(guessDeviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)"), "Mac");
  assert.equal(guessDeviceName("なにか知らない端末"), "この端末");
});

test("同期の状態と経過時間は、そのまま画面に出せる形で返る", () => {
  assert.equal(syncStateLabel({ connected: false }).text, "未接続");
  assert.equal(syncStateLabel({ connected: true }).tone, "ok");
  assert.equal(syncStateLabel({ connected: true, syncing: true }).text, "同期中…");
  assert.equal(syncStateLabel({ connected: true, error: "だめ" }).tone, "error");
  assert.equal(relativeTimeLabel(null), "まだ同期していません");
  assert.equal(relativeTimeLabel(new Date(Date.now() - 30000).toISOString()), "たった今");
  assert.equal(relativeTimeLabel(new Date(Date.now() - 5 * 60000).toISOString()), "5分前");
  assert.equal(relativeTimeLabel(new Date(Date.now() - 3 * 3600000).toISOString()), "3時間前");
  assert.equal(relativeTimeLabel(new Date(Date.now() - 2 * 86400000).toISOString()), "2日前");
});

test("同期の通信では、端末キーだけを送る（管理キーは送らない）", async () => {
  const calls = [];
  const client = createSyncClient({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  await client.join("https://a.test", { code: "WORDS-AB12-CD34", deviceName: "iPhone" });
  assert.equal(calls[0].url, "https://a.test/api/sync/join");
  assert.equal(calls[0].init.headers.authorization, undefined, "登録のときは鍵をまだ持っていない");

  await client.push({ serverUrl: "https://a.test", deviceKey: "device-key" }, { journal: [] });
  assert.equal(calls[1].url, "https://a.test/api/sync/push");
  assert.equal(calls[1].init.headers.authorization, "Bearer device-key");
});

test("つながらないときは、原因が分かる日本語で返す", async () => {
  const offline = createSyncClient({ fetchImpl: async () => { throw new Error("失敗"); } });
  await assert.rejects(() => offline.pull({ serverUrl: "https://a.test", deviceKey: "k" }), /通信環境を確かめて/);

  const rejected = createSyncClient({
    fetchImpl: async () => new Response(JSON.stringify({ message: "解除されています" }), { status: 401 }),
  });
  await assert.rejects(() => rejected.pull({ serverUrl: "https://a.test", deviceKey: "k" }), /解除されています/);
});

test("設定画面に引き継ぎと同期のカードがあり、必要な操作がそろっている", () => {
  assert.ok(appSource.includes("function transferCard()"), "引き継ぎのカードがある");
  assert.ok(appSource.includes("function deviceSyncCard()"), "同期のカードがある");
  assert.ok(appSource.includes("function learnerSection()"), "学習者の一覧がある");
  assert.ok(appSource.includes("${transferCard()}") && appSource.includes("${deviceSyncCard()}"), "設定画面に出している");
  for (const marker of ["学習データの引き継ぎ", "端末間の同期", "同期コード", "学習者", "今すぐ同期", "接続を解除"]) {
    assert.ok(appSource.includes(marker), `設定画面に「${marker}」がある`);
  }
  for (const action of [
    "data-export-data", "data-import-data", "data-sync-connect", "data-sync-now",
    "data-sync-disconnect", "data-add-learner", "data-learner-code", "data-learner-remove",
  ]) {
    assert.ok(appSource.includes(action), `${action} の操作がある`);
  }
});

test("読み込みと学習者の削除は、必ず確認してから実行する", () => {
  assert.match(appSource, /async function importStudyData\([\s\S]*?if \(!confirm\(/, "読み込み前に確かめる");
  assert.match(appSource, /async function removeLearner\([\s\S]*?if \(!confirm\(/, "学習者を消す前に確かめる");
  assert.match(appSource, /data-sync-disconnect[\s\S]*?confirm\(/, "接続解除の前に確かめる");
});

test("同期を始めるとき、すでにある記録を二重に数えない", () => {
  // 接続より前の記録は「基準値」に含まれるので、出来事としては送らない。
  assert.match(
    appSource,
    /baselineSent: false,[\s\S]*?sentSeq: highestSeq\(state\.aiLinkJournal\)/,
    "接続時に、それまでの記録を送信済みとして印を付ける",
  );
  assert.match(
    appSource,
    /if \(!state\.deviceSync\.baselineSent\) payload\.baseline = Object\.fromEntries\(state\.history\);/,
    "基準値を預けるのは一度だけ",
  );
});

test("学習履歴の一括置き換えが用意され、途中で食い違わないようにしている", () => {
  assert.ok(storageSource.includes("export async function replaceHistory"), "まとめて入れ替える処理がある");
  assert.match(storageSource, /replaceHistory[\s\S]*?store\.clear\(\)/, "古い内容を消してから入れる");
  assert.match(storageSource, /replaceHistory[\s\S]*?if \(dataCleared\) return;/, "初期化のあとは書き込まない");
});

test("同期の設定は別の場所に保存され、オフライン用の一覧にも入っている", () => {
  assert.equal(DEVICE_SYNC_META_KEY, "deviceSync");
  assert.ok(appSource.includes("getMetaObject(DEVICE_SYNC_META_KEY, DEFAULT_DEVICE_SYNC)"));
  assert.ok(serviceWorkerSource.includes("./src/sync.js?v=${APP_VERSION}"));
  assert.ok(stylesSource.includes(".learner-list"), "学習者一覧のスタイルがある");
});

test("端末キーと同期コードは、リポジトリのファイルに書かれていない", () => {
  const syncSource = readFileSync(new URL("../src/sync.js", import.meta.url), "utf8");
  for (const source of [appSource, syncSource]) {
    assert.equal(/WORDS-[0-9A-Z]{4}-[0-9A-Z]{4}/.test(source.replace(/WORDS-XXXX-XXXX/g, "")), false);
    assert.equal(/deviceKey:\s*["'][0-9a-f]{16,}["']/.test(source), false);
  }
});

test("受け取った内容がこの端末の分より少なければ、履歴を置き換えない", () => {
  // 何かの手違いでこちらの分が届いていないとき、そのまま入れ替えると
  // 学習の記録が消えてしまう。消さずに預け直す側に倒している。
  assert.match(
    appSource,
    /async function adoptSyncSnapshot\([\s\S]*?if \(totalAttemptsOf\(snapshot\.records\) < localAttempts\) \{\s*\n\s*return \{ adopted: false, needsBaseline: true \};/,
    "少ない内容では置き換えない",
  );
  assert.match(
    appSource,
    /if \(!adopted\.adopted && adopted\.needsBaseline\) \{[\s\S]*?baseline: Object\.fromEntries\(state\.history\),/,
    "届いていない分は、その場で預け直す",
  );
  assert.match(
    appSource,
    /function totalAttemptsOf\(records\)[\s\S]*?totalAttempts \?\? 0/,
    "のべ回答数で多い少ないを見る",
  );
});

test("同期の記録は、この端末の番号で数える", () => {
  // 番号は端末ごとに増やす。ほかの端末から受け取った記録で番号が飛ばないようにする。
  assert.match(
    appSource,
    /createJournalEntry\(\s*\n?\s*\{ itemId, mode, correct, durationMs, at: Date\.now\(\) \},\s*\n?\s*\{ deviceId: state\.deviceSync\.deviceId, seq: state\.deviceSync\.seq \},/,
    "この端末の番号の続きから振る",
  );
  assert.match(appSource, /state\.deviceSync\.seq = seq;/, "振った番号を覚えておく");
});
