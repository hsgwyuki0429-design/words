import test from "node:test";
import assert from "node:assert/strict";

import {
  ERROR,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  createMcpServer,
  toolResult,
} from "../server/core/mcp.js";

const serverInfo = { name: "words", version: "1.0.0" };

function server(tools = []) {
  return createMcpServer({ serverInfo, instructions: "説明", tools });
}

const echoTool = {
  name: "echo",
  description: "そのまま返す",
  inputSchema: { type: "object" },
  handler: async (args) => toolResult({ args }),
};

const META = {
  "io.modelcontextprotocol/protocolVersion": LATEST_PROTOCOL_VERSION,
  "io.modelcontextprotocol/clientInfo": { name: "claude", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

function request(method, params = {}, id = 1) {
  return { jsonrpc: "2.0", id, method, params: { ...params, _meta: META } };
}

test("最新の仕様（2026-07-28）を既定にしつつ、古い版にも応える", () => {
  assert.equal(LATEST_PROTOCOL_VERSION, "2026-07-28");
  assert.equal(SUPPORTED_PROTOCOL_VERSIONS[0], "2026-07-28");
  assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes("2025-06-18"), "旧版のクライアントも受け付ける");
});

test("server/discover が対応版と機能を返す", async () => {
  const { status, body } = await server([echoTool]).handle(
    request("server/discover"),
    { "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION },
  );
  assert.equal(status, 200);
  assert.deepEqual(body.result.supportedVersions, [...SUPPORTED_PROTOCOL_VERSIONS]);
  assert.equal(body.result.resultType, "complete", "2026-07-28 は resultType が必須");
  assert.equal(body.result.capabilities.tools.listChanged, false);
  assert.equal(body.result._meta["io.modelcontextprotocol/serverInfo"].name, "words");
  assert.equal(typeof body.result.ttlMs, "number");
  assert.ok(["public", "private"].includes(body.result.cacheScope));
});

test("tools/list はキャッシュの目安を添えて一覧を返す", async () => {
  const { body } = await server([echoTool]).handle(request("tools/list"));
  assert.deepEqual(body.result.tools.map((tool) => tool.name), ["echo"]);
  assert.equal(typeof body.result.ttlMs, "number");
});

test("tools/call はツールを実行し、結果に文章と構造の両方を載せる", async () => {
  const { body } = await server([echoTool]).handle(
    request("tools/call", { name: "echo", arguments: { x: 1 } }),
    { "Mcp-Method": "tools/call", "Mcp-Name": "echo" },
  );
  assert.deepEqual(body.result.structuredContent, { args: { x: 1 } });
  assert.equal(body.result.content[0].type, "text");
});

test("ヘッダーと本文が食い違うときは推測せずに拒む", async () => {
  const mismatchedMethod = await server([echoTool]).handle(
    request("tools/call", { name: "echo" }),
    { "Mcp-Method": "tools/list" },
  );
  assert.equal(mismatchedMethod.status, 400);
  assert.equal(mismatchedMethod.body.error.code, ERROR.HEADER_MISMATCH);

  const mismatchedName = await server([echoTool]).handle(
    request("tools/call", { name: "echo" }),
    { "Mcp-Method": "tools/call", "Mcp-Name": "other" },
  );
  assert.equal(mismatchedName.body.error.code, ERROR.HEADER_MISMATCH);

  const mismatchedVersion = await server([echoTool]).handle(
    request("tools/list"),
    { "MCP-Protocol-Version": "2025-06-18" },
  );
  assert.equal(mismatchedVersion.status, 400);
  assert.equal(mismatchedVersion.body.error.code, ERROR.HEADER_MISMATCH);
});

test("知らないプロトコル版には、対応している版を添えて断る", async () => {
  const { status, body } = await server().handle(
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    { "MCP-Protocol-Version": "1999-01-01" },
  );
  assert.equal(status, 400);
  assert.equal(body.error.code, ERROR.UNSUPPORTED_PROTOCOL_VERSION);
  assert.deepEqual(body.error.data.supported, [...SUPPORTED_PROTOCOL_VERSIONS]);
});

test("initialize を使う古いクライアントも同じ入口で使える", async () => {
  const { status, body } = await server([echoTool]).handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "old", version: "1" } },
  });
  assert.equal(status, 200);
  assert.equal(body.result.protocolVersion, "2025-06-18");
  assert.equal(body.result.serverInfo.name, "words");

  const notified = await server().handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(notified.status, 202, "通知には本文を返さない");
  assert.equal(notified.body, null);
});

test("壊れた入力や知らないメソッドは、JSON-RPCの決まりどおりに返す", async () => {
  const parse = await server().handle("{壊れている");
  assert.equal(parse.body.error.code, ERROR.PARSE);

  const batch = await server().handle([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
  assert.equal(batch.body.error.code, ERROR.INVALID_REQUEST, "まとめ送りは仕様から外れている");

  const unknown = await server().handle(request("does/notExist"));
  assert.equal(unknown.body.error.code, ERROR.METHOD_NOT_FOUND);

  const missingTool = await server().handle(request("tools/call", { name: "missing" }));
  assert.equal(missingTool.body.error.code, ERROR.INVALID_PARAMS);
});

test("ツールの中で起きた失敗は、結果として返してAIが読めるようにする", async () => {
  const broken = {
    name: "broken",
    description: "必ず失敗する",
    inputSchema: { type: "object" },
    handler: async () => { throw new Error("壊れました"); },
  };
  const { status, body } = await server([broken]).handle(request("tools/call", { name: "broken" }));
  // プロトコルの誤りではないので 200 で返り、id も保たれる。
  assert.equal(status, 200);
  assert.equal(body.error.code, ERROR.INTERNAL);
});
