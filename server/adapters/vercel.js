// Vercel Functions（Edge Runtime）用の入口。
//
//   api/[[...path]].js から、この handler をそのまま再輸出して使う。
//   保存先は Vercel KV（@vercel/kv）などを createWordsMcpApp へ渡す。

import { createWordsMcpApp } from "../app.js";

export function createVercelHandler({ storage, env = process.env }) {
  const app = createWordsMcpApp({ storage, env });
  return (request) => app.fetch(request);
}

export const config = { runtime: "edge" };
