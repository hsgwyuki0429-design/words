import test from "node:test";
import assert from "node:assert/strict";

import { createWordsMcpApp } from "../server/app.js";
import { createMemoryDriver } from "../server/storage/memory-driver.js";
import { createFileDataSource, createQuestionCatalog } from "../server/service/data-source.js";
import { LATEST_PROTOCOL_VERSION } from "../server/core/mcp.js";
import { pkceChallengeOf } from "../server/oauth.js";

const OWNER_KEY = "owner-key-for-tests-0123456789abcdef";
const dataDirectory = new URL("../data/", import.meta.url).pathname;

function newApp(env = {}) {
  const app = createWordsMcpApp({
    storage: createMemoryDriver(),
    env: { WORDS_OWNER_KEY: OWNER_KEY, WORDS_SITE_ORIGIN: "https://words.example", ...env },
    catalog: createQuestionCatalog(createFileDataSource(dataDirectory)),
  });
  const call = (path, init = {}) => app.fetch(new Request(`https://mcp.example${path}`, init));
  const ownerHeaders = { authorization: `Bearer ${OWNER_KEY}`, "content-type": "application/json" };
  return {
    app,
    call,
    ownerHeaders,
    admin: (path, method = "GET", body = null) => call(path, {
      method,
      headers: ownerHeaders,
      body: body === null ? undefined : JSON.stringify(body),
    }),
  };
}

/** 接続できる状態（連携が有効・トークン発行済み）にして、その接続トークンを返す。 */
async function connect(harness, { permissions = { write: true }, scopes = ["read", "write", "delete"] } = {}) {
  await harness.admin("/api/admin/settings", "POST", { enabled: true, permissions });
  const issued = await (await harness.admin("/api/admin/token", "POST", { scopes })).json();
  return issued.token;
}

function mcpCall(harness, token, method, params = {}) {
  return harness.call("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION,
      "Mcp-Method": method,
      ...(params.name ? { "Mcp-Name": params.name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": LATEST_PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientInfo": { name: "claude", version: "1.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

async function tool(harness, token, name, args = {}) {
  const response = await mcpCall(harness, token, "tools/call", { name, arguments: args });
  const body = await response.json();
  return body.result?.structuredContent ?? body;
}

test("認証なしではMCPに一切アクセスできない", async () => {
  const harness = newApp();
  const response = await harness.call("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /^Bearer realm="words"/);
  assert.match(response.headers.get("www-authenticate") ?? "", /resource_metadata=/);
});

test("間違ったトークンでもアクセスできない", async () => {
  const harness = newApp();
  await connect(harness);
  const response = await mcpCall(harness, "wrong-token-value", "tools/list");
  assert.equal(response.status, 401);
});

test("連携が無効なあいだは、正しいトークンでも使えない", async () => {
  const harness = newApp();
  const token = await connect(harness);
  await harness.admin("/api/admin/settings", "POST", { enabled: false });
  const response = await mcpCall(harness, token, "tools/list");
  assert.equal(response.status, 401);
});

test("管理APIは管理キーがなければ使えない", async () => {
  const harness = newApp();
  assert.equal((await harness.call("/api/admin/status")).status, 401);
  assert.equal((await harness.call("/api/admin/status", { headers: { authorization: "Bearer wrong-owner-key" } })).status, 401);
  assert.equal((await harness.admin("/api/admin/status")).status, 200);
});

test("管理キーが未設定のサーバーでは、管理APIが動かない", async () => {
  const app = createWordsMcpApp({
    storage: createMemoryDriver(),
    env: {},
    catalog: createQuestionCatalog(createFileDataSource(dataDirectory)),
  });
  const response = await app.fetch(new Request("https://mcp.example/api/admin/status"));
  assert.equal(response.status, 503);
});

test("接続トークンでは管理APIを操作できない（権限の格上げができない）", async () => {
  const harness = newApp();
  const token = await connect(harness);
  const response = await harness.call("/api/admin/settings", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ permissions: { delete: true } }),
  });
  assert.equal(response.status, 401);
});

test("Tools一覧を取得でき、必要な12個がそろっている", async () => {
  const harness = newApp();
  const token = await connect(harness);
  const body = await (await mcpCall(harness, token, "tools/list")).json();
  const names = body.result.tools.map((entry) => entry.name);
  assert.deepEqual(names.sort(), [
    "addQuestions", "deleteQuestion", "getAppInfo", "getQuestion", "getRecentMistakes",
    "getStudyHistory", "getStudyStats", "listLearners", "listQuestions", "restoreQuestion",
    "searchQuestions", "updateQuestion",
  ]);
  body.result.tools.forEach((entry) => {
    assert.equal(entry.inputSchema.type, "object", `${entry.name} の入力形式が要る`);
    assert.ok(entry.description.length > 10, `${entry.name} に説明が要る`);
  });
});

test("問題を読み取り、検索し、追加し、編集できる", async () => {
  const harness = newApp();
  const token = await connect(harness);

  const info = await tool(harness, token, "getAppInfo");
  assert.equal(info.totalQuestions, 2163);

  const found = await tool(harness, token, "searchQuestions", { query: "社会的ジレンマ", limit: 5 });
  assert.ok(found.total >= 1);

  const detail = await tool(harness, token, "getQuestion", { id: found.questions[0].id });
  assert.ok(detail.explanation);

  const added = await tool(harness, token, "addQuestions", {
    subject: "english",
    questions: [{ question: "resilient", answer: "回復力のある", range: "Mars", type: "word", importance: "A" }],
  });
  assert.equal(added.added, 1);

  const updated = await tool(harness, token, "updateQuestion", {
    id: added.questions[0].id,
    patch: { importance: "SSS" },
  });
  assert.deepEqual(updated.changed, ["importance"]);
  assert.equal((await tool(harness, token, "getQuestion", { id: added.questions[0].id })).importance, "SSS");
});

test("権限がオフのあいだは、書き込みも削除も断られる", async () => {
  const harness = newApp();
  // 既定の権限（read だけ）で接続する。
  const token = await connect(harness, { permissions: {} });

  const added = await tool(harness, token, "addQuestions", {
    subject: "english",
    questions: [{ question: "denied", answer: "拒否される", range: "Mars" }],
  });
  assert.equal(added.error, "permission_denied");
  assert.equal(added.requiredScope, "write");
  assert.match(added.message, /設定画面/);

  const deleted = await tool(harness, token, "deleteQuestion", { id: "health-0001", confirm: true });
  assert.equal(deleted.error, "permission_denied");

  // 読み取りはできる。
  assert.equal((await tool(harness, token, "getAppInfo")).totalQuestions, 2163);
  // 追加は本当に起きていない。
  assert.equal((await tool(harness, token, "getAppInfo")).aiAddedQuestions, 0);
});

test("削除の権限を入れると、ゴミ箱へ移せる", async () => {
  const harness = newApp();
  const token = await connect(harness, { permissions: { write: true, delete: true } });
  const deleted = await tool(harness, token, "deleteQuestion", { id: "health-0001", confirm: true, reason: "重複" });
  assert.equal(deleted.deleted, true);

  const trash = await (await harness.admin("/api/admin/trash")).json();
  assert.equal(trash.trash[0].id, "health-0001");
  assert.equal(trash.trash[0].reason, "重複");

  await harness.admin("/api/admin/restore", "POST", { id: "health-0001" });
  assert.equal((await (await harness.admin("/api/admin/trash")).json()).trash.length, 0);
});

test("不正な入力はAIが読める形で返り、データは壊れない", async () => {
  const harness = newApp();
  const token = await connect(harness);
  const result = await tool(harness, token, "addQuestions", {
    subject: "public",
    questions: [{ question: "問い", answer: "答え", range: "存在しない範囲" }],
  });
  assert.equal(result.error, "invalid_input");
  assert.match(result.message, /使えるのは/);
  assert.equal((await tool(harness, token, "getAppInfo")).aiAddedQuestions, 0);
});

test("トークンを再発行すると、前のトークンは使えなくなる", async () => {
  const harness = newApp();
  const first = await connect(harness);
  assert.equal((await mcpCall(harness, first, "tools/list")).status, 200);

  const second = (await (await harness.admin("/api/admin/token", "POST", { scopes: ["read"] })).json()).token;
  assert.notEqual(first, second);
  assert.equal((await mcpCall(harness, first, "tools/list")).status, 401);
  assert.equal((await mcpCall(harness, second, "tools/list")).status, 200);

  await harness.admin("/api/admin/token", "DELETE");
  assert.equal((await mcpCall(harness, second, "tools/list")).status, 401);
});

test("管理画面用の状態には、トークンそのものが含まれない", async () => {
  const harness = newApp();
  const token = await connect(harness);
  const status = await (await harness.admin("/api/admin/status")).json();
  assert.equal(JSON.stringify(status).includes(token), false, "トークン本体は二度と返さない");
  assert.match(status.token.preview, /…$/);
  assert.equal(status.mcpUrl, "https://mcp.example/mcp");
  assert.deepEqual(status.permissions, { read: true, write: true, delete: false });
});

test("学習履歴の同期と、AIの変更の取り込みができる", async () => {
  const harness = newApp();
  const token = await connect(harness);
  await harness.admin("/api/sync/history", "POST", {
    deviceId: "device-1",
    records: { "health-0001": { itemId: "health-0001", totalAttempts: 1, correctCount: 0, wrongCount: 1, lastResult: "wrong", lastWrongAt: Date.now(), lastAttemptAt: Date.now(), modeStats: {} } },
    journal: [{ itemId: "health-0001", at: Date.now(), correct: false, mode: "health_recall" }],
  });
  const mistakes = await tool(harness, token, "getRecentMistakes", { days: 1 });
  assert.equal(mistakes.questions[0].id, "health-0001");

  await tool(harness, token, "addQuestions", {
    subject: "health",
    questions: [{ question: "取り込みのテストは何というか。", answer: "取り込み", range: "p.12–13" }],
  });
  const overlay = await (await harness.admin("/api/sync/overlay")).json();
  assert.equal(overlay.added.length, 1);
  assert.equal(overlay.added[0].subject, "health");
  assert.equal(overlay.added[0].healthQuestion, "取り込みのテストは何というか。");
});

test("OAuthの案内が仕様どおりに公開されている", async () => {
  const harness = newApp();
  const resource = await (await harness.call("/.well-known/oauth-protected-resource")).json();
  assert.equal(resource.resource, "https://mcp.example/mcp");
  assert.deepEqual(resource.authorization_servers, ["https://mcp.example"]);

  const server = await (await harness.call("/.well-known/oauth-authorization-server")).json();
  assert.equal(server.issuer, "https://mcp.example");
  assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);
  assert.equal(server.authorization_response_iss_parameter_supported, true);
});

test("OAuthでは、接続トークンを示した人だけがアクセストークンを受け取れる", async () => {
  const harness = newApp();
  const token = await connect(harness);
  const redirectUri = "https://client.example/callback";

  const registered = await (await harness.call("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "テストクライアント" }),
  })).json();
  assert.ok(registered.client_id);

  const verifier = "verifier-0123456789-abcdefghijklmnop";
  const challenge = await pkceChallengeOf(verifier);

  // 接続トークンが違えば、認可コードは出ない。
  const refused = await harness.call("/oauth/authorize", {
    method: "POST",
    body: new URLSearchParams({
      client_id: registered.client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      state: "xyz",
      connection_token: "でたらめ",
    }),
  });
  assert.equal(refused.status, 401);

  const approved = await harness.call("/oauth/authorize", {
    method: "POST",
    body: new URLSearchParams({
      client_id: registered.client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      state: "xyz",
      connection_token: token,
    }),
  });
  assert.equal(approved.status, 302);
  const location = new URL(approved.headers.get("location"));
  assert.equal(location.searchParams.get("state"), "xyz");
  assert.equal(location.searchParams.get("iss"), "https://mcp.example");
  const code = location.searchParams.get("code");

  // code_verifier が違えば引き換えられない。
  const wrongVerifier = await harness.call("/oauth/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: registered.client_id,
      redirect_uri: redirectUri,
      code_verifier: "ちがう値",
    }),
  });
  assert.equal(wrongVerifier.status, 400);

  const issued = await (await harness.call("/oauth/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: registered.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  })).json();
  assert.equal(issued.token_type, "Bearer");

  // 発行されたアクセストークンで、ちゃんとMCPが使える。
  assert.equal((await mcpCall(harness, issued.access_token, "tools/list")).status, 200);

  // 認可コードは一度きり。
  const reused = await harness.call("/oauth/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: registered.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  assert.equal(reused.status, 400);
});

test("MCPの入口はPOSTだけで、GETには405を返す", async () => {
  const harness = newApp();
  const response = await harness.call("/mcp");
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST, OPTIONS");
});

test("CORSは許可した場所にだけ返る", async () => {
  const harness = newApp({ WORDS_ALLOWED_ORIGINS: "http://localhost:4173" });
  const allowed = await harness.call("/health", { headers: { origin: "https://words.example" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://words.example");

  const local = await harness.call("/health", { headers: { origin: "http://localhost:4173" } });
  assert.equal(local.headers.get("access-control-allow-origin"), "http://localhost:4173");

  const other = await harness.call("/health", { headers: { origin: "https://attacker.example" } });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
});
