import test from "node:test";
import assert from "node:assert/strict";

import { createWordsMcpApp } from "../server/app.js";
import { createMemoryDriver } from "../server/storage/memory-driver.js";
import { createFileDataSource, createQuestionCatalog } from "../server/service/data-source.js";
import { createSyncService, normalizeSyncCode } from "../server/service/sync-service.js";
import { LATEST_PROTOCOL_VERSION } from "../server/core/mcp.js";
import { ValidationError } from "../server/core/validate.js";

const OWNER_KEY = "owner-key-for-tests-0123456789abcdef";
const dataDirectory = new URL("../data/", import.meta.url).pathname;

function newApp() {
  const storage = createMemoryDriver();
  const app = createWordsMcpApp({
    storage,
    env: { WORDS_OWNER_KEY: OWNER_KEY, WORDS_SITE_ORIGIN: "https://words.example" },
    catalog: createQuestionCatalog(createFileDataSource(dataDirectory)),
  });
  const call = (path, init = {}) => app.fetch(new Request(`https://mcp.example${path}`, init));
  const owner = { authorization: `Bearer ${OWNER_KEY}`, "content-type": "application/json" };
  const body = (value) => (value === null ? undefined : JSON.stringify(value));
  return {
    app,
    storage,
    call,
    admin: (path, method = "GET", value = null) => call(path, { method, headers: owner, body: body(value) }),
    join: (code, deviceName) => call("/api/sync/join", {
      method: "POST", headers: { "content-type": "application/json" }, body: body({ code, deviceName }),
    }),
    push: (deviceKey, value) => call("/api/sync/push", {
      method: "POST",
      headers: { authorization: `Bearer ${deviceKey}`, "content-type": "application/json" },
      body: body(value),
    }),
    pull: (deviceKey) => call("/api/sync/pull", { headers: { authorization: `Bearer ${deviceKey}` } }),
    leave: (deviceKey) => call("/api/sync/leave", {
      method: "POST", headers: { authorization: `Bearer ${deviceKey}` },
    }),
  };
}

const json = async (response) => (await response).json();
const answer = (eventId, itemId, at, correct) => ({ eventId, itemId, at, correct, mode: "health_recall" });

test("同期コードは、書き写しの揺れを吸収して読み取れる", () => {
  assert.equal(normalizeSyncCode("WORDS-AB12-CD34"), "WORDS-AB12-CD34");
  assert.equal(normalizeSyncCode("words-ab12-cd34"), "WORDS-AB12-CD34");
  assert.equal(normalizeSyncCode(" ab12 cd34 "), "WORDS-AB12-CD34");
  assert.equal(normalizeSyncCode("ＷＯＲＤＳ－ＡＢ１２－ＣＤ３４"), "WORDS-AB12-CD34");
  assert.equal(normalizeSyncCode("みじかすぎ"), null);
  assert.equal(normalizeSyncCode(""), null);
});

test("先生は学習者を登録でき、同期コードはその場かぎりで渡される", async () => {
  const harness = newApp();
  const created = await json(harness.admin("/api/admin/learners", "POST", { name: "田中" }));
  assert.equal(created.name, "田中");
  assert.match(created.syncCode, /^WORDS-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  const listed = await json(harness.admin("/api/admin/learners"));
  assert.equal(listed.learners[0].name, "田中");
  // 一覧に同期コードそのものは出てこない。
  assert.equal(JSON.stringify(listed).includes(created.syncCode), false);
});

test("同じ名前の学習者は二重に作れない", async () => {
  const harness = newApp();
  await harness.admin("/api/admin/learners", "POST", { name: "田中" });
  const again = await harness.admin("/api/admin/learners", "POST", { name: "田中" });
  assert.equal(again.status, 400);
  assert.match((await again.json()).message, /すでにいます/);
});

test("学習者の管理は、管理キーがなければできない", async () => {
  const harness = newApp();
  const created = await json(harness.admin("/api/admin/learners", "POST", { name: "田中" }));
  for (const [method, value] of [["GET", null], ["POST", { name: "勝手に追加" }], ["DELETE", { id: created.id, confirm: true }]]) {
    const response = await harness.call("/api/admin/learners", {
      method,
      headers: { "content-type": "application/json" },
      body: value === null ? undefined : JSON.stringify(value),
    });
    assert.equal(response.status, 401, `${method} は管理キーが要る`);
  }
});

test("同じ人の2台の端末は、どちらで解いても同じ学習データになる", async () => {
  const harness = newApp();
  const tanaka = await json(harness.admin("/api/admin/learners", "POST", { name: "田中" }));
  const phone = await json(harness.join(tanaka.syncCode, "スマホ"));
  const tablet = await json(harness.join(tanaka.syncCode, "タブレット"));
  assert.notEqual(phone.deviceId, tablet.deviceId);
  assert.notEqual(phone.deviceKey, tablet.deviceKey);
  assert.equal(phone.learnerName, "田中");

  // スマホで2問、タブレットで1問解く。
  await harness.push(phone.deviceKey, {
    baseline: {},
    journal: [answer("p-1", "health-0001", 1000, false), answer("p-2", "health-0002", 1100, true)],
  });
  const afterTablet = await json(harness.push(tablet.deviceKey, {
    baseline: {},
    journal: [answer("t-1", "health-0001", 2000, true)],
  }));

  // タブレットから見ても、スマホで解いた分が入っている。
  assert.equal(afterTablet.snapshot.records["health-0001"].totalAttempts, 2);
  assert.equal(afterTablet.snapshot.records["health-0002"].totalAttempts, 1);

  // スマホから見ても同じになる。
  const fromPhone = await json(harness.pull(phone.deviceKey));
  assert.equal(fromPhone.records["health-0001"].totalAttempts, 2);
  assert.equal(fromPhone.records["health-0001"].correctCount, 1);
  assert.equal(fromPhone.learner, "田中");
  assert.equal(fromPhone.devices.length, 2);
});

test("同じ記録を二度送っても、回答数は増えない", async () => {
  const harness = newApp();
  const tanaka = await json(harness.admin("/api/admin/learners", "POST", { name: "田中" }));
  const phone = await json(harness.join(tanaka.syncCode, "スマホ"));
  const entries = [answer("p-1", "health-0001", 1000, true)];
  await harness.push(phone.deviceKey, { baseline: {}, journal: entries });
  const again = await json(harness.push(phone.deviceKey, { journal: entries }));
  assert.equal(again.snapshot.records["health-0001"].totalAttempts, 1);
});

test("同期を始める前からあった学習データは、一度だけ預かる", async () => {
  const harness = newApp();
  const tanaka = await json(harness.admin("/api/admin/learners", "POST", { name: "田中" }));
  const phone = await json(harness.join(tanaka.syncCode, "スマホ"));
  const baseline = {
    "health-0001": {
      itemId: "health-0001", totalAttempts: 7, correctCount: 5, wrongCount: 2,
      lastResult: "correct", lastAttemptAt: 500, modeStats: {},
    },
  };
  const first = await json(harness.push(phone.deviceKey, { baseline, journal: [] }));
  assert.equal(first.baselineStored, true);
  assert.equal(first.snapshot.records["health-0001"].totalAttempts, 7);

  // 2回目に同じものを送っても、二重に数えない（合算結果を送り返してくるため）。
  const second = await json(harness.push(phone.deviceKey, { baseline, journal: [] }));
  assert.equal(second.snapshot.records["health-0001"].totalAttempts, 7);
});

test("別の学習者のデータは見えない", async () => {
  const harness = newApp();
  const tanaka = await json(harness.admin("/api/admin/learners", "POST", { name: "田中" }));
  const sato = await json(harness.admin("/api/admin/learners", "POST", { name: "佐藤" }));
  const tanakaPhone = await json(harness.join(tanaka.syncCode, "スマホ"));
  const satoPhone = await json(harness.join(sato.syncCode, "スマホ"));

  await harness.push(tanakaPhone.deviceKey, { baseline: {}, journal: [answer("t-1", "health-0001", 1000, false)] });
  const satoView = await json(harness.pull(satoPhone.deviceKey));
  assert.deepEqual(satoView.records, {});
  assert.equal(satoView.learner, "佐藤");
});

test("正しくない同期コードでは端末を登録できない", async () => {
  const harness = newApp();
  await harness.admin("/api/admin/learners", "POST", { name: "田中" });
  const wrong = await harness.join("WORDS-ZZZZ-ZZZZ", "怪しい端末");
  assert.equal(wrong.status, 400);
  assert.match((await wrong.json()).message, /使えません/);

  const malformed = await harness.join("みじかい", "端末");
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).message, /形が違います/);
});

test("端末キーがなければ同期できない", async () => {
  const harness = newApp();
  assert.equal((await harness.pull("")).status, 401);
  assert.equal((await harness.pull("wrong-device-key")).status, 401);
  assert.equal((await harness.push("wrong-device-key", { journal: [] })).status, 401);
});

test("同期コードを作り直すと、古いコードでは登録できなくなる", async () => {
  const harness = newApp();
  const tanaka = await json(harness.admin("/api/admin/learners", "POST", { name: "田中" }));
  const phone = await json(harness.join(tanaka.syncCode, "スマホ"));
  const reissued = await json(harness.admin("/api/admin/learners/code", "POST", { id: tanaka.id }));
  assert.notEqual(reissued.syncCode, tanaka.syncCode);

  assert.equal((await harness.join(tanaka.syncCode, "別端末")).status, 400, "古いコードは使えない");
  assert.equal((await harness.join(reissued.syncCode, "別端末")).status, 200, "新しいコードは使える");
  // すでに接続している端末は、そのまま使い続けられる。
  assert.equal((await harness.pull(phone.deviceKey)).status, 200);
});

test("端末の接続を解くと、その端末からは同期できなくなる。学習の記録は残る", async () => {
  const harness = newApp();
  const tanaka = await json(harness.admin("/api/admin/learners", "POST", { name: "田中" }));
  const phone = await json(harness.join(tanaka.syncCode, "スマホ"));
  const tablet = await json(harness.join(tanaka.syncCode, "タブレット"));
  await harness.push(phone.deviceKey, { baseline: {}, journal: [answer("p-1", "health-0001", 1000, true)] });

  await harness.leave(phone.deviceKey);
  assert.equal((await harness.pull(phone.deviceKey)).status, 401, "解除した端末は使えない");
  // 解除しても、その端末で解いた記録は残る。
  const remaining = await json(harness.pull(tablet.deviceKey));
  assert.equal(remaining.records["health-0001"].totalAttempts, 1);
});

test("学習者を消すと、その人の学習履歴も消える。確認なしには消せない", async () => {
  const harness = newApp();
  const tanaka = await json(harness.admin("/api/admin/learners", "POST", { name: "田中" }));
  const phone = await json(harness.join(tanaka.syncCode, "スマホ"));
  await harness.push(phone.deviceKey, { baseline: {}, journal: [answer("p-1", "health-0001", 1000, true)] });

  const sync = createSyncService({ storage: harness.storage });
  await assert.rejects(() => sync.deleteLearner({ id: tanaka.id }), ValidationError, "確認が要る");

  await harness.admin("/api/admin/learners", "DELETE", { id: tanaka.id, confirm: true });
  assert.equal((await json(harness.admin("/api/admin/learners"))).total, 0);
  assert.equal((await harness.pull(phone.deviceKey)).status, 401);
});

test("1人が登録できる端末の数には上限がある", async () => {
  const harness = newApp();
  const tanaka = await json(harness.admin("/api/admin/learners", "POST", { name: "田中" }));
  for (let index = 0; index < 10; index += 1) {
    assert.equal((await harness.join(tanaka.syncCode, `端末${index}`)).status, 200);
  }
  const over = await harness.join(tanaka.syncCode, "11台目");
  assert.equal(over.status, 400);
  assert.match((await over.json()).message, /10台までです/);
});

test("問題は全員で共有される。生徒の端末にも先生が足した問題が届く", async () => {
  const harness = newApp();
  await harness.admin("/api/admin/settings", "POST", { enabled: true, permissions: { write: true } });
  const { token } = await json(harness.admin("/api/admin/token", "POST", { scopes: ["read", "write"] }));
  const tanaka = await json(harness.admin("/api/admin/learners", "POST", { name: "田中" }));
  const phone = await json(harness.join(tanaka.syncCode, "スマホ"));

  await harness.call("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: {
        name: "addQuestions",
        arguments: {
          subject: "health",
          questions: [{ question: "共有される問題を何というか。", answer: "共有問題", range: "p.12–13" }],
        },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": LATEST_PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });

  // 生徒は管理キーを持たないが、同期で問題の差分を受け取れる。
  const pulled = await json(harness.pull(phone.deviceKey));
  assert.equal(pulled.overlay.added.length, 1);
  assert.equal(pulled.overlay.added[0].healthQuestion, "共有される問題を何というか。");
});

test("MCPからは学習者ごとの成績が読め、名前で指定できる", async () => {
  const harness = newApp();
  await harness.admin("/api/admin/settings", "POST", { enabled: true });
  const { token } = await json(harness.admin("/api/admin/token", "POST", { scopes: ["read"] }));
  const tanaka = await json(harness.admin("/api/admin/learners", "POST", { name: "田中" }));
  const sato = await json(harness.admin("/api/admin/learners", "POST", { name: "佐藤" }));
  const tanakaPhone = await json(harness.join(tanaka.syncCode, "スマホ"));
  const satoPhone = await json(harness.join(sato.syncCode, "スマホ"));
  const today = Date.parse("2026-09-11T10:00:00+09:00");
  await harness.push(tanakaPhone.deviceKey, {
    baseline: {},
    journal: [answer("t-1", "health-0001", today, false), answer("t-2", "health-0002", today, true)],
  });
  await harness.push(satoPhone.deviceKey, { baseline: {}, journal: [answer("s-1", "health-0005", today, false)] });

  const tool = async (name, args = {}) => {
    const response = await harness.call("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: {
          name, arguments: args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": LATEST_PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    return (await response.json()).result.structuredContent;
  };

  const learners = await tool("listLearners");
  assert.deepEqual(learners.learners.map((entry) => entry.name).sort(), ["佐藤", "田中"]);
  assert.equal(learners.learners[0].devices.length, 1);

  // 名前を指定すれば、その人の分だけ返る。
  const tanakaOnly = await tool("getRecentMistakes", { days: 1, learner: "田中" });
  assert.equal(tanakaOnly.total, 1);
  assert.equal(tanakaOnly.questions[0].id, "health-0001");
  assert.equal(tanakaOnly.learner, "田中");

  // 指定しなければ全員ぶんが返り、誰の記録かが分かる。
  const everyone = await tool("getRecentMistakes", { days: 1 });
  assert.equal(everyone.total, 2);
  assert.deepEqual(everyone.questions.map((entry) => entry.learner).sort(), ["佐藤", "田中"]);

  // 成績は人ごとの内訳も付く。
  const stats = await tool("getStudyStats", { subjects: ["health"] });
  assert.equal(stats.overall.attempts, 3);
  const byLearner = Object.fromEntries(stats.byLearner.map((entry) => [entry.learner, entry.attempts]));
  assert.deepEqual(byLearner, { "田中": 2, "佐藤": 1 });

  // 学習履歴にも、誰の記録かが入る。
  const history = await tool("getStudyHistory", { days: 7, learner: "佐藤" });
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].questionId, "health-0005");

  // 居ない人を指定したら、居る人の名前を添えて教える。
  const missing = await tool("getStudyStats", { learner: "鈴木" });
  assert.equal(missing.error, "invalid_input");
  assert.match(missing.message, /田中|佐藤/);
});

test("学習者を分ける前に預けた履歴は、「本人」へ引き継がれる", async () => {
  const harness = newApp();
  // 学習者がいない状態で、以前の入口から履歴を預ける。
  await harness.admin("/api/sync/history", "POST", {
    records: {
      "health-0001": {
        itemId: "health-0001", totalAttempts: 4, correctCount: 3, wrongCount: 1,
        lastResult: "correct", lastAttemptAt: 500, modeStats: {},
      },
    },
    journal: [answer("legacy-1", "health-0001", 500, true)],
  });
  const listed = await json(harness.admin("/api/admin/learners"));
  assert.equal(listed.learners[0].name, "本人");

  // 引き継いだあと、2台目を足しても正しく合算される。
  const code = await json(harness.admin("/api/admin/learners/code", "POST", { id: listed.learners[0].id }));
  const second = await json(harness.join(code.syncCode, "2台目"));
  const merged = await json(harness.push(second.deviceKey, {
    baseline: {},
    journal: [answer("second-1", "health-0001", 900, false)],
  }));
  assert.equal(merged.snapshot.records["health-0001"].totalAttempts, 5);
});
