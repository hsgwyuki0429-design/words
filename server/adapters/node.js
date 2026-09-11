// Node で動かすための入口。自分のパソコンや、好きなサーバーで動かすときに使う。
//
//   WORDS_OWNER_KEY=... node server/adapters/node.js
//
// 保存先はファイル（既定は .words-data/）。教材データはリポジトリの data/ を直接読む。

import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createWordsMcpApp } from "../app.js";
import { createFileDriver } from "../storage/file-driver.js";
import { createFileDataSource, createQuestionCatalog } from "../service/data-source.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../..");

export function createNodeApp(env = process.env) {
  const storage = createFileDriver(env.WORDS_DATA_DIR ?? path.join(repositoryRoot, ".words-data"));
  const catalog = env.WORDS_DATA_BASE_URL
    ? null
    : createQuestionCatalog(createFileDataSource(path.join(repositoryRoot, "data")));
  return createWordsMcpApp({ storage, env, catalog });
}

/** Node の要求・応答を、標準の Request / Response に橋渡しする。 */
export function createNodeServer(app) {
  return createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const host = incoming.headers.host ?? "localhost";
    const url = `http://${host}${incoming.url}`;
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      body: ["GET", "HEAD"].includes(incoming.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await app.fetch(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
  });
}

// 直接実行されたときだけ待ち受ける（読み込まれただけなら何もしない）。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 8787);
  const app = createNodeApp();
  if (!app.auth.hasOwnerKey()) {
    console.warn("WORDS_OWNER_KEY が未設定です。管理APIは使えません（MCPの読み書きもできません）。");
  }
  createNodeServer(app).listen(port, () => {
    console.log(`words MCP Server: http://localhost:${port}/mcp`);
  });
}
