# AI / MCP連携（words MCP Server）

ClaudeなどのMCP対応AIから、wordsの問題と学習履歴を会話のなかで扱えるようにする仕組みです。

```
Claude / ChatGPT / その他MCP対応AI
        ↓  MCP（Streamable HTTP）
   words MCP Server
        ↓
   wordsのデータ（教材データ ＋ 追加・変更・削除の重ね合わせ ＋ 学習履歴）
```

有効にすると、次のような会話ができます。

- 「wordsで今日間違えた問題を見せて」
- 「公共の問題だけ検索して」
- 「この10問をwordsに追加して」
- 「この問題の解説を変更して」
- 「最近間違えている分野を分析して」

## 目次

1. [MCPとは](#mcpとは)
2. [全体の構成](#全体の構成)
3. [セットアップ](#セットアップ)
4. [環境変数](#環境変数)
5. [デプロイ方法](#デプロイ方法)
6. [wordsの設定画面での操作](#wordsの設定画面での操作)
7. [Claudeへの接続方法](#claudeへの接続方法)
8. [MCP Server URLの確認方法](#mcp-server-urlの確認方法)
9. [認証と権限](#認証と権限)
10. [利用できるTools](#利用できるtools)
11. [データの守り方](#データの守り方)
12. [トラブルシューティング](#トラブルシューティング)

---

## MCPとは

MCP（Model Context Protocol）は、AIが外部のデータや機能を使うための共通の決まりごとです。
USBの規格のようなもので、決まりに従ってサーバーを用意しておけば、
Claude・ChatGPT・そのほかのMCP対応クライアントのどれからでも同じように使えます。

このサーバーは **MCP 2026-07-28**（最新仕様）に沿って作られています。
この版のMCPは「状態を持たない（stateless）」形に変わり、以前の `initialize` の握手と
`Mcp-Session-Id` ヘッダーが無くなりました。代わりに、1回ごとのリクエストが
`MCP-Protocol-Version` ヘッダーと `_meta` で自分の情報を運びます。

古いクライアントもまだ多いため、`initialize` を使う 2025-03-26 〜 2025-11-25 の
クライアントにも同じ入口で応えます。特定のAIに合わせた分岐は入れていません。

## 全体の構成

words本体は今までどおりGitHub Pagesの静的サイトのままです。
MCPサーバーだけを、別のサーバーレス環境に置きます。

```
ブラウザ（words本体・GitHub Pages）
  └─ 設定画面 → AI連携   ── 管理キー ──▶  words MCP Server
                                              │
AI（Claude など）── 接続トークン ──▶  /mcp   │
                                              ▼
                            教材データ（読むだけ）  https://…/data/*.json
                            重ね合わせ・学習履歴・トークン・操作ログ（KVなど）
```

コードは層に分かれていて、MCPの処理とデータの処理は密結合していません。

| 場所 | 役割 |
| --- | --- |
| `server/core/mcp.js` | MCPプロトコル（JSON-RPC・版の取り決め・ヘッダー検証） |
| `server/tools.js` | AIへ公開するTools定義（薄いつなぎ） |
| `server/service/words-service.js` | wordsサービス層。データの読み書きはすべてここを通る |
| `server/service/question-input.js` | AIの入力を教材データと同じ形へ組み立て直す |
| `server/storage/*.js` | 保存先のドライバ（メモリ／ファイル／KV） |
| `server/app.js` | HTTPの入口（標準の Request / Response のみ） |
| `server/adapters/*.js` | Cloudflare Workers / Vercel / Node への橋渡し |
| `src/ai-link.js` | words本体（ブラウザ）側の連携処理 |

サービス層はMCPのことを何も知らないので、MCP以外の入口（設定画面の管理API、
将来の別クライアント）からも同じ処理を再利用できます。

### 既存データはそのまま

**教材データ（`data/*.json`）は一切書き換えません。** AIによる追加・変更・削除は
「重ね合わせ（overlay）」として別に保存し、読むときに合成します。

- 追加 … 重ね合わせに新しい問題として持つ
- 変更 … 元の問題に、変わった項目だけを重ねる
- 削除 … ゴミ箱に入れるだけ（元のデータは残り、いつでも戻せる）

そのため、連携をやめても既存データは元のまま残り、マイグレーションも要りません。

## セットアップ

### 1. 必要なもの

- サーバーレス環境のアカウント（Cloudflare Workers・Vercel など）、またはNodeが動くサーバー
- Node.js 22以降（ローカルで試す場合）

### 2. まずローカルで動かす

```sh
# 管理キーを作る（32バイトのランダムな文字列）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# .env を用意する（.env はGitに入りません）
cp .env.example .env
# WORDS_OWNER_KEY= に、上で作った文字列を書く

# サーバーを起動する
WORDS_OWNER_KEY=<作った文字列> node server/adapters/node.js
# → words MCP Server: http://localhost:8787/mcp
```

`http://localhost:8787/health` が `{"ok":true,...}` を返せば動いています。

### 3. wordsの設定画面からつなぐ

words を開き、**設定 → AI連携（MCP）** で、
MCP Server URL（`http://localhost:8787`）と管理キーを入れて「保存して接続を確認」を押します。

## 環境変数

秘密と公開可能な設定を分けてあります。**秘密は必ずホスティングの「秘密（Secret）」機能へ入れ、
リポジトリには絶対に置かないでください。**

| 変数 | 種別 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `WORDS_OWNER_KEY` | **秘密** | なし | 管理キー。設定画面からサーバーを操作するときに使う。32文字以上のランダムな文字列。未設定だと管理APIは動かず、連携も使えません |
| `WORDS_SITE_ORIGIN` | 公開可 | `https://hsgwyuki0429-design.github.io/words` | words本体の場所。教材データの読み込み元とCORSの許可先になります |
| `WORDS_DATA_BASE_URL` | 公開可・任意 | `WORDS_SITE_ORIGIN` と同じ | 教材データだけ別の場所から読むとき |
| `WORDS_PUBLIC_URL` | 公開可・任意 | リクエストから判定 | 前段にプロキシがあり、外から見えるURLが違うとき |
| `WORDS_ALLOWED_ORIGINS` | 公開可・任意 | なし | CORSを許可する追加の場所（カンマ区切り） |
| `WORDS_DATA_DIR` | 公開可・任意 | `.words-data` | Nodeで動かすときの保存先 |

`.env.example` に同じ内容のひな形があります。`.env`・`.words-data/` は `.gitignore` 済みです。

## デプロイ方法

保存先とHTTPの入口だけを差し替える作りなので、どの環境でも同じコードが動きます。

### Cloudflare Workers（おすすめ）

無料枠で足り、KVがそのまま使えます。

```sh
# 1. 保存先（KV）を作る
npx wrangler kv namespace create WORDS_KV
#    表示された id を wrangler.toml の kv_namespaces に貼る

# 2. 管理キーを秘密として入れる（リポジトリには残りません）
npx wrangler secret put WORDS_OWNER_KEY

# 3. 公開する
npx wrangler deploy
```

`wrangler.toml` は用意済みです。デプロイ後に表示される
`https://words-mcp.<あなた>.workers.dev` が MCP Server の場所になります。

### Vercel Functions

`api/[[...path]].js` を作り、次のように書きます（保存先は Vercel KV など）。

```js
import { kv } from "@vercel/kv";
import { createVercelHandler } from "../server/adapters/vercel.js";

const storage = {
  get: (key) => kv.get(key),
  put: (key, value) => kv.set(key, value),
  delete: (key) => kv.del(key),
  list: async (prefix) => (await kv.keys(`${prefix}*`)).sort(),
};

export default createVercelHandler({ storage });
export const config = { runtime: "edge" };
```

管理キーは Vercel の Environment Variables に `WORDS_OWNER_KEY` として入れます。

### そのほか（Deno Deploy・Supabase Edge Functions・自前のNode）

`server/app.js` の `createWordsMcpApp({ storage, env })` は標準の `Request` を受けて
`Response` を返すだけなので、その環境の流儀で `app.fetch(request)` を呼べば動きます。
保存先は `get / put / delete / list` の4つを持つオブジェクトを渡すだけです。

Nodeでそのまま動かす場合:

```sh
WORDS_OWNER_KEY=<管理キー> PORT=8787 node server/adapters/node.js
```

## wordsの設定画面での操作

**設定 → AI連携（MCP）** で、次のことができます。

| 項目 | 内容 |
| --- | --- |
| MCP Server URL | 用意したサーバーの場所。末尾の `/mcp` は付けても付けなくても構いません |
| 管理キー | サーバーに設定した `WORDS_OWNER_KEY`。**この端末の中だけに保存され、AIへは渡りません** |
| MCP Connector | 連携そのものの有効・無効 |
| 接続状態 | ● 接続可能／サーバー側が無効／この端末で無効／接続できません |
| アクセス権限 | 見る（read）・追加編集（write）・削除（delete）の3つ |
| 接続用トークン | AIへ渡す鍵。発行と再発行ができます |
| 接続方法を見る | Claudeなどへの登録手順 |
| 最近のAI操作 | AI経由で行われた変更の記録 |

連携が無効なあいだ、words本体はこのサーバーへ一切通信しません。動きは今までと同じです。

## Claudeへの接続方法

### Claude Code（ターミナル）

```sh
claude mcp add --transport http words https://<あなたのサーバー>/mcp \
  --header "Authorization: Bearer <接続トークン>"
```

### Claudeデスクトップ／claude.ai のコネクタ

「カスタムコネクタを追加」で MCP Server URL を入力します。
接続の確認画面が出たら、設定画面で発行した接続トークンを貼り付けてください
（OAuth 2.1 + PKCE で、接続トークンをアクセストークンに引き換えます）。

### そのほかのMCP対応クライアント

| 項目 | 値 |
| --- | --- |
| 種別 | Streamable HTTP |
| URL | `https://<あなたのサーバー>/mcp` |
| 認証 | `Authorization: Bearer <接続トークン>` |
| プロトコル | 2026-07-28（2025-03-26以降の旧版も可） |

## MCP Server URLの確認方法

1. wordsの **設定 → AI連携（MCP）** を開く
2. 「接続先のURL」の欄に表示されます（サーバー自身が答えた値です）
3. 右の「コピー」を押すとコピーできます

サーバーのトップページ（`https://<あなたのサーバー>/`）を開いても確認できます。
このページからデータを見ることはできません。

## 認証と権限

### 2種類の鍵

| 鍵 | 誰が持つ | できること |
| --- | --- | --- |
| 管理キー（`WORDS_OWNER_KEY`） | 本人だけ。環境変数と端末の中 | 連携の有効・無効、権限の変更、トークンの発行、学習履歴の同期 |
| 接続トークン | AIへ渡す | 許可された範囲でのTool実行だけ |

接続トークンで管理APIを操作することはできません（権限の格上げができない作り）。
接続トークンはハッシュ（SHA-256）だけを保存するので、保存先が漏れても元の値は分かりません。
発行したその場でしか本体は表示されず、設定画面を離れると消えます。

### 3つの権限

| 権限 | 内容 | 初期値 |
| --- | --- | --- |
| `read` | 問題・成績・履歴を見る | **オン**（連携に必ず必要） |
| `write` | 問題を追加・編集する | **オフ** |
| `delete` | 問題を削除する | **オフ** |

実際にできることは「接続トークンのスコープ」と「設定画面で入れた権限」の**両方にあるものだけ**です。
片方でも外れていれば、AIには理由付きで断りが返ります。

### 認証なしではアクセスできない

`/mcp` は、正しい接続トークンが無いと必ず `401 Unauthorized` を返します。
応答には RFC 9728 の `WWW-Authenticate` ヘッダーが付き、OAuthの案内先を示します。

CORSは許可した場所（既定では words 本体）にだけ返します。`*` は使いません。

## 利用できるTools

| Tool | 権限 | 内容 |
| --- | --- | --- |
| `getAppInfo` | read | 問題数・教科と範囲の一覧・データ形式の版・履歴の同期状況・権限 |
| `searchQuestions` | read | キーワードと条件で検索（問題文・答え・解説・タグ・出典） |
| `getQuestion` | read | IDを指定して1問の詳細と、その問題の成績 |
| `listQuestions` | read | 条件だけで一覧（キーワードなし） |
| `addQuestions` | write | 問題を追加（1回20件まで） |
| `updateQuestion` | write | 変更したい項目だけを送って編集 |
| `deleteQuestion` | delete | ゴミ箱へ移す（1回1問・`confirm: true` が必要） |
| `restoreQuestion` | write | ゴミ箱から元に戻す |
| `getStudyStats` | read | 全体／教科別／範囲別／重要度別の成績と直近の学習状況 |
| `getRecentMistakes` | read | 最近間違えた問題（期間と件数を指定） |
| `getStudyHistory` | read | 1問ごとの記録（日時・問題・答え・正誤・出題形式・所要時間） |

### 教科と範囲

`range` は教科ごとに決まった値しか使えません（wordsの画面に出なくなるため）。
分からないときは `getAppInfo` を呼ぶと一覧が返ります。

| 教科 | id | 範囲 |
| --- | --- | --- |
| 英語 | `english` | OriHime / Mars / Kakigori / Plastic / FOMO / Snow / Shinkansen / Taste Buds |
| 公共 | `public` | p.36–37 / p.40–47 / p.60–63 / p.68–69 / p.70–73 / p.76–77 |
| 保健 | `health` | p.12–13 / p.14–15 / p.16–17 / p.20–21 / p.24–25 / p.26–27 / p.30–31 / p.34–35 |
| 古文単語 | `kobun-vocab` | 伊勢物語 芥川／東下り／筒井筒、徒然草 丹波に出雲／花は盛りに、羅生門、今昔物語集 羅城門 |

### 学習履歴について

学習履歴はブラウザの中（IndexedDB）にあります。AI連携を有効にすると、
wordsが履歴をサーバーへ預け、`getStudyStats` などから読めるようになります。

1問ごとの細かい記録（`getStudyHistory`）は、**連携を有効にしてから**貯まります。
それ以前の分については、「最後に間違えた日時」から `getRecentMistakes` が拾います。

## データの守り方

AIから送られた入力は信用せず、サーバー側で必ず確かめます。

- **型チェック** … 文字列・数値・真偽値・配列を取り違えていれば断る
- **必須項目** … 問題文・答え・範囲が無ければ追加しない
- **知らない項目** … 誤字はそのまま無視せず、使える項目名を添えて返す
- **最大文字数** … 問題文800字・答え200字・解説1200字など
- **範囲の確認** … 教科に無い範囲は受け付けない
- **重複の確認** … 同じ問題文はすでにあれば追加しない
- **最大追加件数** … 1回20件、AI経由の合計2000件まで
- **削除の抑制** … 1回1問だけ、`confirm: true` が必要、しかもゴミ箱行き
- **権限確認** … read / write / delete を分離し、両側で許可されたものだけ
- **出題できるかの確認** … 保存の前に、words本体のロジックで実際に問題を組み立てられるか試す
- **全件まとめて検証** … 追加は1件でも不正なら、その呼び出しでは1件も保存しない

AI経由の変更はすべて記録に残り、設定画面の「最近のAI操作」で確認できます。

```
2026-09-11 18:30  Claude  addQuestions   公共に10件追加
2026-09-11 18:35  Claude  updateQuestion public-20260908-0042 の explanation を変更
```

## トラブルシューティング

### 「サーバーへつながりませんでした」と出る

- URLが合っているか確認してください（`https://` から始まり、末尾に余分な文字が無いか）
- サーバーが動いているか、`https://<サーバー>/health` をブラウザで開いて確かめてください
- ブラウザの開発者ツールにCORSの誤りが出ていれば、`WORDS_SITE_ORIGIN` が
  words本体の場所と一致しているか確認してください

### 「管理キーが正しくありません」と出る

環境変数 `WORDS_OWNER_KEY` と、設定画面に入れた値が同じか確認してください。
Cloudflare Workers では `npx wrangler secret put WORDS_OWNER_KEY` で入れ直せます。
前後の空白や改行が入っていないかも確認してください。

### サーバーが `503 not_configured` を返す

`WORDS_OWNER_KEY` が設定されていないか、16文字未満です。長いランダムな文字列を設定してください。

### AIが「権限がありません」と言う

設定画面 → AI連携 → アクセス権限 で、必要な権限を入れてください。
追加・編集（write）と削除（delete）は、初期状態ではオフです。
権限を変えたあと、AI側で接続し直す必要はありません（次の呼び出しから反映されます）。

### AIが「接続トークンが正しくありません」と言う

トークンを再発行すると、前のトークンは使えなくなります。
新しいトークンでAI側の登録をやり直してください。

### AIがwordsを見つけられない／Toolsが出てこない

- MCP Connector が「有効」になっているか確認してください
- `https://<サーバー>/mcp` へ `POST` できているか（`GET` は405を返します）
- Claude Code なら `claude mcp list` で登録内容を確認できます

### AIが追加した問題がwordsに出てこない

wordsを開き直してください。起動時に取り込みます。
それでも出ない場合は、範囲（range）が教科の一覧にあるか確認してください。

### 「今日間違えた問題」が空になる

- 連携を有効にしてから学習した分だけが1問ごとの記録に残ります
- 学習後、サーバーへ送られるまで少し時間がかかります（設定画面を開き直すと送られます）
- 時間帯がずれている場合は `timezoneOffsetMinutes`（日本は540）を指定してもらってください

### 誤って問題を消してしまった

完全には消えていません。AIに `restoreQuestion` を頼むか、
サーバーの `/api/admin/trash` と `/api/admin/restore` から戻せます。

### プロトコル版で断られる

`対応していません` と返る場合、クライアントが 2025-03-26 より古い版を使っています。
クライアント側を更新してください。対応している版は `server/discover` で確認できます。
