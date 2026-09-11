// wordsがAIへ公開するMCP Tools。
//
// ここはプロトコルとサービス層をつなぐ薄い層に留める。
// 実際のデータ処理は words サービス層（server/service/words-service.js）にあり、
// MCP以外の入口（設定画面の管理API、将来の別クライアント）からも同じ処理を使える。

import { toolResult } from "./core/mcp.js";
import { PermissionError, requireScope } from "./auth/tokens.js";
import { ValidationError } from "./core/validate.js";
import { QUESTION_INPUT_FIELDS, QUESTION_LIMITS } from "./service/question-input.js";
import { SERVICE_LIMITS } from "./service/words-service.js";
import { SUBJECTS, SUBJECT_IDS } from "./service/subjects.js";

const IMPORTANCE_VALUES = ["SSS", "SS", "S", "A", "B", "C", "D"];
const RANGE_HINT = SUBJECT_IDS
  .map((subject) => `${SUBJECTS[subject].label}(${subject}): ${SUBJECTS[subject].ranges.join(" / ")}`)
  .join("\n");

/** 一覧・検索で共通して使える絞り込み条件。 */
const FILTER_PROPERTIES = {
  subjects: {
    type: "array",
    items: { type: "string", enum: [...SUBJECT_IDS] },
    description: "教科で絞る。省略すると全教科。",
  },
  ranges: {
    type: "array",
    items: { type: "string" },
    description: `単元・範囲で絞る。教科ごとに使える値は決まっている。\n${RANGE_HINT}`,
  },
  importance: {
    type: "array",
    items: { type: "string", enum: IMPORTANCE_VALUES },
    description: "重要度で絞る。SSSが最重要、Dが最低。",
  },
  types: { type: "array", items: { type: "string" }, description: "問題形式で絞る（word / phrase / structure / public-term など）。" },
  tags: { type: "array", items: { type: "string" }, description: "タグで絞る。" },
  questionModes: { type: "array", items: { type: "string" }, description: "出題形式で絞る（en_to_ja_choice / public_recall など）。" },
  performance: {
    type: "string",
    enum: ["all", "answered", "unanswered", "wrong", "correct", "last-wrong"],
    description: "正誤の履歴で絞る。wrong=一度でも間違えた / last-wrong=直近が不正解 / correct=間違えたことがない。",
  },
  minimumWrong: { type: "integer", minimum: 0, description: "この回数以上間違えた問題だけに絞る。" },
  aiAddedOnly: { type: "boolean", description: "AI経由で追加された問題だけに絞る。" },
  limit: {
    type: "integer",
    minimum: 1,
    maximum: SERVICE_LIMITS.searchLimitMax,
    description: `一度に返す件数（既定 ${SERVICE_LIMITS.searchLimitDefault}、最大 ${SERVICE_LIMITS.searchLimitMax}）。`,
  },
  offset: { type: "integer", minimum: 0, description: "続きを読むときの開始位置。前回の nextOffset を渡す。" },
  sort: {
    type: "string",
    enum: ["id", "importance", "most-wrong", "recently-studied", "recently-wrong"],
    description: "並び順。",
  },
};

/** 問題1件の入力。追加でも編集でも同じ名前を使う。 */
const QUESTION_PROPERTIES = {
  question: { type: "string", maxLength: QUESTION_LIMITS.question, description: "問題文。英語なら英単語・熟語そのもの、公共や保健なら一問一答の問い、古文単語なら用例。" },
  answer: { type: "string", maxLength: QUESTION_LIMITS.answer, description: "答え。英語なら日本語訳、公共・保健なら用語、古文単語なら現代語訳。" },
  explanation: { type: "string", maxLength: QUESTION_LIMITS.explanation, description: "解説。" },
  choices: {
    type: "object",
    description: "4択の選択肢。公共の問題だけで使える。A〜Dの4つすべてが必要。",
    properties: {
      A: { type: "string" }, B: { type: "string" }, C: { type: "string" }, D: { type: "string" },
    },
    required: ["A", "B", "C", "D"],
  },
  correctChoice: { type: "string", enum: ["A", "B", "C", "D"], description: "choices のうち、どれが正解かの記号。" },
  importance: { type: "string", enum: IMPORTANCE_VALUES, description: "重要度。省略時は英語がB、それ以外がA。" },
  difficulty: { type: "string", enum: ["—", "A", "B", "C", "D", "E", "F"], description: "難易度。" },
  range: { type: "string", description: `単元・範囲。教科ごとに決まった値のみ。\n${RANGE_HINT}` },
  lesson: { type: "string", description: "レッスン名。省略すると range と同じになる。" },
  title: { type: "string", description: "題材名。" },
  source: { type: "string", description: "出典（教科書のページなど）。" },
  tags: { type: "array", items: { type: "string" }, maxItems: QUESTION_LIMITS.tags, description: "タグ。" },
  type: { type: "string", description: "問題の種類（英語: word / phrase / structure）。" },
  acceptedAnswers: {
    type: "array",
    items: { type: "string" },
    maxItems: QUESTION_LIMITS.acceptedAnswers,
    description: "答えとして認める別の書き方。",
  },
  note: { type: "string", description: "補足メモ。" },
  examples: { type: "array", items: { type: "string" }, description: "用例。" },
  reading: { type: "string", description: "読み（古文単語）。" },
  point: { type: "string", description: "ポイント解説（古文単語）。" },
};

const TIMEZONE_PROPERTY = {
  type: "integer",
  minimum: -840,
  maximum: 840,
  description: "「今日」を判定する時間帯のずれ（分）。日本標準時は540。既定は540。",
};

/**
 * ツールを定義する。権限の確認と、失敗したときの伝え方をここで揃える。
 * 入力の誤りや権限不足は、プロトコルの誤りではなく「結果」として返す。
 * そうしないとAIが理由を読めず、同じ失敗を繰り返してしまう。
 */
function defineTool({ name, title, description, inputSchema, scope, annotations, run }) {
  return {
    name,
    title,
    description,
    scope,
    annotations,
    inputSchema: { type: "object", additionalProperties: false, ...inputSchema },
    async handler(args, context) {
      // どのAIから来た操作かを記録に残せるよう、クライアント名を actor に移しておく。
      const actor = { ...context.actor, clientName: context.clientInfo?.name ?? context.actor?.clientName ?? null };
      try {
        if (scope) requireScope(actor, scope);
        return toolResult(await run(args, { ...context, actor }));
      } catch (error) {
        if (error instanceof ValidationError) {
          return toolResult(
            { ok: false, error: "invalid_input", field: error.field, message: error.message },
            { isError: true, text: `入力を確認してください: ${error.message}` },
          );
        }
        if (error instanceof PermissionError) {
          return toolResult(
            { ok: false, error: "permission_denied", requiredScope: error.scope, message: error.message },
            { isError: true, text: error.message },
          );
        }
        return toolResult(
          { ok: false, error: "server_error", message: error?.message ?? "不明な問題が起きました。" },
          { isError: true, text: `処理できませんでした: ${error?.message ?? "不明な問題"}` },
        );
      }
    },
  };
}

export function createTools() {
  return [
    defineTool({
      name: "getAppInfo",
      title: "wordsの基本情報",
      description: "wordsの構成・問題数・教科と範囲の一覧・データ形式の版・学習履歴の同期状況・許可されている権限を返す。最初にこれを呼ぶと、他のツールへ渡せる値（教科名や範囲名）が分かる。",
      scope: "read",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { properties: {} },
      run: (_args, { service }) => service.getAppInfo(),
    }),

    defineTool({
      name: "searchQuestions",
      title: "問題を検索",
      description: "キーワードと条件でwordsの問題を探す。問題文・答え・解説・タグ・出典が検索対象。一度に返る件数には上限があるので、続きは nextOffset を offset に渡して読む。",
      scope: "read",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        properties: {
          query: { type: "string", maxLength: 200, description: "検索語。空白で区切るとすべてを含む問題だけに絞られる。" },
          ...FILTER_PROPERTIES,
          includeDeleted: { type: "boolean", description: "ゴミ箱に入っている問題も含める。" },
        },
      },
      run: (args, { service }) => service.searchQuestions(args),
    }),

    defineTool({
      name: "getQuestion",
      title: "問題の詳細",
      description: "問題IDを指定して1問の詳細（問題文・答え・解説・選択肢・タグ・出典・その問題の学習成績）を取得する。",
      scope: "read",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { properties: { id: { type: "string", description: "問題ID。" } }, required: ["id"] },
      run: (args, { service }) => service.getQuestion(args),
    }),

    defineTool({
      name: "listQuestions",
      title: "条件で問題を一覧",
      description: "キーワードを使わず、教科・範囲・重要度・正誤履歴などの条件だけで問題を一覧する。件数の把握や、範囲ごとの問題の並びを見るときに使う。",
      scope: "read",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { properties: { ...FILTER_PROPERTIES, includeDeleted: { type: "boolean" } } },
      run: (args, { service }) => service.listQuestions(args),
    }),

    defineTool({
      name: "addQuestions",
      title: "問題を追加",
      description: `wordsへ問題を追加する。一度に追加できるのは${SERVICE_LIMITS.addPerCall}件まで。range は教科ごとに決まった値しか使えないので、分からなければ先に getAppInfo を呼ぶこと。同じ問題文がすでにある場合は追加されない。1件でも内容に問題があれば、その呼び出しでは1件も追加されない。`,
      scope: "write",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        properties: {
          subject: { type: "string", enum: [...SUBJECT_IDS], description: "追加先の教科。" },
          questions: {
            type: "array",
            minItems: 1,
            maxItems: SERVICE_LIMITS.addPerCall,
            description: "追加する問題。",
            items: {
              type: "object",
              additionalProperties: false,
              properties: QUESTION_PROPERTIES,
              required: ["question", "answer", "range"],
            },
          },
        },
        required: ["subject", "questions"],
      },
      run: (args, { service, actor }) => service.addQuestions(args, actor),
    }),

    defineTool({
      name: "updateQuestion",
      title: "問題を編集",
      description: "既存の問題を書き換える。変更したい項目だけを patch に入れれば、他の項目はそのまま残る。教科と問題IDは変更できない。",
      scope: "write",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        properties: {
          id: { type: "string", description: "編集する問題のID。" },
          patch: {
            type: "object",
            additionalProperties: false,
            minProperties: 1,
            description: `変更する項目だけを入れる。使える項目: ${QUESTION_INPUT_FIELDS.filter((field) => !["subject", "id"].includes(field)).join(" / ")}`,
            properties: QUESTION_PROPERTIES,
          },
        },
        required: ["id", "patch"],
      },
      run: (args, { service, actor }) => service.updateQuestion(args, actor),
    }),

    defineTool({
      name: "deleteQuestion",
      title: "問題を削除（ゴミ箱へ）",
      description: "問題をゴミ箱へ移す。完全には消さないので restoreQuestion で元に戻せる。安全のため一度に1問だけ、かつ confirm を true にしたときだけ実行される。まとめて消したい場合でも、1問ずつ確認しながら実行すること。",
      scope: "delete",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        properties: {
          id: { type: "string", description: "削除する問題のID。" },
          reason: { type: "string", maxLength: 200, description: "削除する理由。記録に残る。" },
          confirm: { type: "boolean", description: "true のときだけ削除する。ユーザーに確認してから true にすること。" },
        },
        required: ["id", "confirm"],
      },
      run: (args, { service, actor }) => service.deleteQuestion(args, actor),
    }),

    defineTool({
      name: "restoreQuestion",
      title: "ゴミ箱から戻す",
      description: "ゴミ箱に入っている問題を元に戻す。",
      scope: "write",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: { properties: { id: { type: "string", description: "戻す問題のID。" } }, required: ["id"] },
      run: (args, { service, actor }) => service.restoreQuestion(args, actor),
    }),

    defineTool({
      name: "getStudyStats",
      title: "学習統計",
      description: "回答数・正解数・正答率を、全体／教科別／範囲別／重要度別に返す。直近の学習状況（日ごとの回答数と正解数）も含む。学習履歴はwordsの設定画面でAI連携を有効にしたときだけ同期される。",
      scope: "read",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        properties: {
          subjects: { type: "array", items: { type: "string", enum: [...SUBJECT_IDS] }, description: "教科で絞る。" },
          modes: { type: "array", items: { type: "string" }, description: "出題形式で絞る（例: ja_to_en_input）。" },
          recentDays: { type: "integer", minimum: 1, maximum: 90, description: "直近何日ぶんの学習状況を返すか。既定は7。" },
          timezoneOffsetMinutes: TIMEZONE_PROPERTY,
        },
      },
      run: (args, { service }) => service.getStudyStats(args),
    }),

    defineTool({
      name: "getRecentMistakes",
      title: "最近間違えた問題",
      description: "最近間違えた問題を新しい順に返す。days=1 なら今日、7 なら今週ぶん。1問ごとの学習記録が無い場合は「最後に間違えた日時」から拾う。",
      scope: "read",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        properties: {
          days: { type: "integer", minimum: 1, maximum: 365, description: "今日から何日ぶんさかのぼるか。既定は1（今日）。" },
          limit: { type: "integer", minimum: 1, maximum: SERVICE_LIMITS.searchLimitMax, description: "返す件数。既定は20。" },
          subjects: { type: "array", items: { type: "string", enum: [...SUBJECT_IDS] }, description: "教科で絞る。" },
          timezoneOffsetMinutes: TIMEZONE_PROPERTY,
        },
      },
      run: (args, { service }) => service.getRecentMistakes(args),
    }),

    defineTool({
      name: "getStudyHistory",
      title: "学習履歴",
      description: "1問ごとの学習記録（日時・問題・答え・正誤・出題形式・かかった時間）を新しい順に返す。AI連携を有効にしてから記録が貯まる。",
      scope: "read",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        properties: {
          days: { type: "integer", minimum: 1, maximum: 365, description: "今日から何日ぶんさかのぼるか。既定は7。" },
          limit: { type: "integer", minimum: 1, maximum: 200, description: "返す件数。既定は50。" },
          onlyWrong: { type: "boolean", description: "間違えた記録だけに絞る。" },
          timezoneOffsetMinutes: TIMEZONE_PROPERTY,
        },
      },
      run: (args, { service }) => service.getStudyHistory(args),
    }),
  ];
}

/** AIへ渡す、このサーバーの使い方の説明。 */
export const SERVER_INSTRUCTIONS = `words は、英語・古文単語・公共・保健の定期テスト対策アプリです。
このサーバーからは、wordsに入っている問題と、その人の学習履歴を読み書きできます。

使うときの目安:
- まず getAppInfo を呼ぶと、教科（english / public / health / kobun-vocab）と、
  それぞれで使える範囲（range）の一覧が分かります。range は決まった値しか使えません。
- 問題を探すときは searchQuestions、条件だけで絞るときは listQuestions を使います。
  返る件数には上限があるので、続きは nextOffset を offset に渡してください。
- 「今日間違えた問題」は getRecentMistakes（days=1）、「最近の成績」は getStudyStats です。
- 問題の追加・編集・削除は、利用者が words の設定画面で許可したときだけ行えます。
  権限が無い場合はその旨が返るので、利用者に設定を促してください。
- 削除は必ず1問ずつ、利用者に確認してから confirm: true で実行してください。
  削除してもゴミ箱に入るだけで、restoreQuestion で戻せます。`;
