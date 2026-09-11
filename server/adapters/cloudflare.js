// Cloudflare Workers 用の入口。
//
//   wrangler.toml で KV を "WORDS_KV" という名前で結び付け、
//   秘密（WORDS_OWNER_KEY）は `wrangler secret put` で入れる。
//   デプロイ: npx wrangler deploy

import { createWordsMcpApp } from "../app.js";
import { createKvDriver } from "../storage/kv-driver.js";

let app;

export default {
  async fetch(request, env) {
    // Worker は呼び出しをまたいで生き続けることがあるので、組み立ては一度だけ。
    if (!app) app = createWordsMcpApp({ storage: createKvDriver(env.WORDS_KV), env });
    return app.fetch(request);
  },
};
