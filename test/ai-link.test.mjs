import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AI_LINK_JOURNAL_KEY,
  AI_LINK_META_KEY,
  DEFAULT_AI_LINK,
  JOURNAL_LIMIT,
  appendJournalEntry,
  applyOverlayBySubject,
  applyOverlayToItems,
  buildHistoryPayload,
  connectionInstructions,
  connectionStateLabel,
  createAiLinkClient,
  isAiLinkActive,
  isAiLinkConfigured,
  mcpUrlFor,
  normalizeAiLinkConfig,
} from "../src/ai-link.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const serviceWorkerSource = readFileSync(new URL("../sw.js", import.meta.url), "utf8");

test("AI連携は既定で無効。設定が揃うまで接続できない", () => {
  assert.equal(DEFAULT_AI_LINK.enabled, false);
  assert.equal(isAiLinkConfigured(normalizeAiLinkConfig({})), false);
  assert.equal(isAiLinkActive(normalizeAiLinkConfig({ enabled: true })), false);
  assert.equal(
    isAiLinkActive(normalizeAiLinkConfig({ enabled: true, serverUrl: "https://a.test", ownerKey: "k" })),
    true,
  );
});

test("入力されたURLの末尾の / や /mcp を取り除く", () => {
  assert.equal(normalizeAiLinkConfig({ serverUrl: "https://a.test/mcp" }).serverUrl, "https://a.test");
  assert.equal(normalizeAiLinkConfig({ serverUrl: "https://a.test/mcp/" }).serverUrl, "https://a.test");
  assert.equal(normalizeAiLinkConfig({ serverUrl: " https://a.test/ " }).serverUrl, "https://a.test");
  assert.equal(mcpUrlFor({ serverUrl: "https://a.test" }), "https://a.test/mcp");
});

test("AIの追加・変更・削除を、画面の問題一覧へ重ねられる", () => {
  const items = [{ id: "a", importance: "B" }, { id: "b" }, { id: "c" }];
  const merged = applyOverlayToItems(items, {
    added: [{ id: "new" }],
    patched: { a: { importance: "SSS" } },
    deletedIds: ["b"],
  });
  assert.deepEqual(merged.map((item) => item.id), ["a", "c", "new"]);
  assert.equal(merged[0].importance, "SSS");
  assert.equal(items[0].importance, "B", "元の配列は変えない");
});

test("差分が無ければ、問題一覧はそのまま使う", () => {
  const items = [{ id: "a" }];
  assert.equal(applyOverlayToItems(items, null), items);
  assert.equal(applyOverlayToItems(items, { added: [], patched: {}, deletedIds: [] }), items);
});

test("追加された問題は、その教科の一覧にだけ入る", () => {
  const merged = applyOverlayBySubject({
    english: [{ id: "e1" }],
    public: [{ id: "p1", subject: "public" }],
  }, {
    added: [{ id: "new-public", subject: "public" }, { id: "new-english" }],
    patched: {},
    deletedIds: [],
  });
  assert.deepEqual(merged.english.map((item) => item.id), ["e1", "new-english"]);
  assert.deepEqual(merged.public.map((item) => item.id), ["p1", "new-public"]);
});

test("1問ごとの記録は、同期に要る目印（eventId・seq）を落とさない", () => {
  // ここを落とすと「どこまで送ったか」が分からなくなり、
  // 送ったはずの記録が届かないまま端末の履歴が消えてしまう。
  const journal = appendJournalEntry([], {
    eventId: "device-1-7",
    seq: 7,
    itemId: "health-0001",
    at: 1000,
    correct: false,
    mode: "health_recall",
    durationMs: 2500,
  });
  assert.equal(journal[0].eventId, "device-1-7");
  assert.equal(journal[0].seq, 7);
  assert.equal(journal[0].itemId, "health-0001");
  assert.equal(journal[0].durationMs, 2500);

  // 目印が無い記録も、そのまま受け取れる。
  const plain = appendJournalEntry([], { itemId: "x", correct: true, at: 1 });
  assert.equal("eventId" in plain[0], false);
  assert.equal("seq" in plain[0], false);
});

test("1問ごとの学習記録は新しい順に積まれ、上限を超えない", () => {
  let journal = [];
  for (let index = 0; index < JOURNAL_LIMIT + 10; index += 1) {
    journal = appendJournalEntry(journal, { itemId: `item-${index}`, correct: index % 2 === 0, at: index });
  }
  assert.equal(journal.length, JOURNAL_LIMIT);
  assert.equal(journal[0].itemId, `item-${JOURNAL_LIMIT + 9}`, "新しいものが先頭");
});

test("学習履歴は、端末に入っている形のまま送る", () => {
  const history = new Map([["a", { itemId: "a", totalAttempts: 3 }]]);
  const payload = buildHistoryPayload({
    history,
    journal: [{ itemId: "a", at: 1, correct: true }],
    deviceId: "device-1",
  });
  assert.deepEqual(payload.records, { a: { itemId: "a", totalAttempts: 3 } });
  assert.equal(payload.deviceId, "device-1");
  assert.equal(payload.journal.length, 1);
});

test("接続状態の見出しは、設定と結果を素直に表す", () => {
  assert.equal(connectionStateLabel({ configured: false }).text, "未設定");
  assert.equal(connectionStateLabel({ configured: true, serverEnabled: false }).text, "サーバー側が無効");
  assert.equal(connectionStateLabel({ configured: true, serverEnabled: true, enabled: false }).text, "この端末で無効");
  assert.equal(connectionStateLabel({ configured: true, serverEnabled: true, enabled: true }).tone, "ok");
  assert.equal(connectionStateLabel({ configured: true, error: "つながらない" }).tone, "error");
});

test("接続方法の案内にはURLだけが載り、鍵は載らない", () => {
  const steps = connectionInstructions("https://a.test/mcp");
  assert.ok(steps.length >= 3);
  const text = JSON.stringify(steps);
  assert.ok(text.includes("https://a.test/mcp"));
  assert.ok(text.includes("Bearer"));
  assert.ok(text.includes("claude mcp add"));
});

test("管理キーはサーバーへ送るだけで、AIへ渡すトークンとは別に扱う", async () => {
  const calls = [];
  const client = createAiLinkClient({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    },
  });
  await client.status({ serverUrl: "https://a.test", ownerKey: "secret-key" });
  assert.equal(calls[0].url, "https://a.test/api/admin/status");
  assert.equal(calls[0].init.headers.authorization, "Bearer secret-key");
});

test("つながらないときは、原因が分かる日本語で返す", async () => {
  const client = createAiLinkClient({ fetchImpl: async () => { throw new Error("失敗"); } });
  await assert.rejects(
    () => client.status({ serverUrl: "https://a.test", ownerKey: "k" }),
    /URLを確認/,
  );

  const unauthorized = createAiLinkClient({
    fetchImpl: async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
  });
  await assert.rejects(
    () => unauthorized.status({ serverUrl: "https://a.test", ownerKey: "k" }),
    /管理キーが正しくありません/,
  );
});

test("設定画面にAI連携のカードがあり、必要な操作がそろっている", () => {
  assert.ok(appSource.includes("function aiLinkCard()"), "AI連携のカードを描く処理がある");
  assert.ok(appSource.includes("${aiLinkCard()}"), "設定画面に差し込まれている");
  for (const marker of [
    "AI連携（MCP）",
    "MCP Connector",
    "接続状態",
    "アクセス権限",
    "接続用トークン",
    "接続方法を見る",
    "最近のAI操作",
  ]) {
    assert.ok(appSource.includes(marker), `設定画面に「${marker}」がある`);
  }
  for (const action of [
    "data-ai-connect",
    "data-ai-enabled",
    "data-ai-permission",
    "data-ai-issue-token",
    "data-ai-copy-url",
    "data-ai-toggle-guide",
  ]) {
    assert.ok(appSource.includes(action), `${action} の操作がある`);
  }
});

test("権限は read / write / delete に分かれ、初期状態では読み取りだけ", () => {
  assert.ok(appSource.includes('scope: "read"'));
  assert.ok(appSource.includes('scope: "write"'));
  assert.ok(appSource.includes('scope: "delete"'));
  assert.ok(appSource.includes("既定でオフ"), "既定でオフである旨を画面に書いている");
});

test("AI連携も同期も使っていないあいだは、学習の記録も通信も行わない", () => {
  assert.match(
    appSource,
    /function recordAiLinkAttempt\(\{[\s\S]*?if \(!isAiLinkActive\(state\.aiLink\) && !isSyncConnected\(state\.deviceSync\)\) return;/,
    "どちらも使っていなければ1問ごとの記録を残さない",
  );
  assert.match(
    appSource,
    /function scheduleAiLinkSync\([\s\S]*?if \(!isSyncConnected\(state\.deviceSync\) && !isAiLinkActive\(state\.aiLink\)\) return;/,
    "どちらも使っていなければ送信の予約もしない",
  );
  assert.match(
    appSource,
    /async function syncDeviceNow\([\s\S]*?if \(!isSyncConnected\(state\.deviceSync\) \|\| aiLinkSyncing\) return null;/,
    "接続していなければ同期しない",
  );
  assert.match(
    appSource,
    /if \(isSyncConnected\(state\.deviceSync\)\) \{[\s\S]*?\} else if \(isAiLinkActive\(state\.aiLink\)\) \{/,
    "起動時の通信も、接続しているときだけ",
  );
});

test("保存する場所は既存の設定と分けてあり、初期化で一緒に消える", () => {
  assert.equal(AI_LINK_META_KEY, "aiLink");
  assert.equal(AI_LINK_JOURNAL_KEY, "aiLinkJournal");
  assert.ok(appSource.includes("getMetaObject(AI_LINK_META_KEY, DEFAULT_AI_LINK)"));
  assert.ok(appSource.includes("getMeta(AI_LINK_JOURNAL_KEY, [])"));
});

test("接続トークンは画面を離れると消え、保存もされない", () => {
  assert.ok(
    appSource.includes('if (view !== "settings") state.aiLinkIssuedToken = null;'),
    "設定画面を離れたら表示を消す",
  );
  assert.equal(
    appSource.includes("setMeta(\"aiLinkIssuedToken\""),
    false,
    "発行したトークンは端末にも保存しない",
  );
});

test("AI連携のカードには専用の見た目があり、Service Workerにも登録されている", () => {
  for (const className of [".ai-link-card", ".ai-link-state", ".ai-link-token", ".ai-link-log", ".settings-input"]) {
    assert.ok(stylesSource.includes(className), `${className} のスタイルがある`);
  }
  // 既存のデザイン変数だけを使い、明暗どちらでも読める色にしている。
  assert.ok(stylesSource.includes(".ai-link-state-ok { color: var(--green); }"));
  assert.ok(serviceWorkerSource.includes("./src/ai-link.js?v=${APP_VERSION}"), "オフライン用の一覧に入っている");
});

test("秘密の値がリポジトリのファイルに書かれていない", () => {
  const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const source of [appSource, indexSource, readFileSync(new URL("../src/ai-link.js", import.meta.url), "utf8")]) {
    assert.equal(/WORDS_OWNER_KEY\s*=\s*["'][^"']+["']/.test(source), false, "管理キーが直接書かれていない");
    assert.equal(/Bearer\s+[A-Za-z0-9]{24,}/.test(source), false, "トークンが直接書かれていない");
  }
});
