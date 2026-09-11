// 教科ごとの「問題データの形」をまとめた表。
//
// wordsの教材データは data/*.json に入っていて、教科ごとに項目名が違う。
// MCPから読み書きするときも、この形をそのまま使う（既存データは変換しない）。

import {
  HEALTH_RANGE_ORDER,
  KOBUN_VOCAB_RANGE_ORDER,
  PUBLIC_RANGE_ORDER,
  RANGE_ORDER,
} from "../../src/logic.js";

/** 教材データの読み方。file は data/ からの相対パス、pick は配列の取り出し方。 */
export const SUBJECTS = Object.freeze({
  english: {
    id: "english",
    label: "英語",
    file: "items.json",
    pick: (json) => json,
    ranges: RANGE_ORDER,
    types: ["word", "phrase", "structure"],
    // 追加・編集で必ず埋まっている必要がある項目。
    required: ["english", "japanese", "type", "importance", "range"],
    // 問題文と答えに当たる項目（検索と表示に使う）。
    questionField: "english",
    answerField: "japanese",
    modes: ["en_to_ja_choice", "ja_to_en_choice", "ja_to_en_input"],
  },
  public: {
    id: "public",
    label: "公共",
    file: "public-items.json",
    pick: (json) => json,
    ranges: PUBLIC_RANGE_ORDER,
    types: ["public-term", "public-short"],
    required: ["publicQuestion", "publicAnswer", "importance", "range"],
    questionField: "publicQuestion",
    answerField: "publicAnswer",
    modes: ["public_recall", "public_choice"],
  },
  health: {
    id: "health",
    label: "保健",
    file: "health-items.json",
    pick: (json) => json,
    ranges: HEALTH_RANGE_ORDER,
    types: ["health-term", "health-short"],
    required: ["healthQuestion", "healthAnswer", "importance", "range"],
    questionField: "healthQuestion",
    answerField: "healthAnswer",
    modes: ["health_recall"],
  },
  "kobun-vocab": {
    id: "kobun-vocab",
    label: "古文単語",
    file: "kobun-vocabulary.json",
    pick: (json) => json.items,
    ranges: KOBUN_VOCAB_RANGE_ORDER,
    types: ["kobun-vocab-term"],
    required: ["term", "japanese", "example", "importance", "range"],
    questionField: "example",
    answerField: "japanese",
    modes: ["kobun-vocab_recall"],
  },
});

export const SUBJECT_IDS = Object.freeze(Object.keys(SUBJECTS));

export function subjectConfig(subject) {
  return SUBJECTS[subject] ?? null;
}

/** 教材データの項目から教科を判定する。英語だけ subject を持たないので形で見分ける。 */
export function subjectOf(item) {
  if (typeof item?.subject === "string" && SUBJECTS[item.subject]) return item.subject;
  return "english";
}

/** 検索・表示のために、教科ごとの項目名の違いを吸収した共通の見え方を作る。 */
export function questionText(item) {
  const config = SUBJECTS[subjectOf(item)];
  return String(item?.[config.questionField] ?? "");
}

export function answerText(item) {
  const config = SUBJECTS[subjectOf(item)];
  return String(item?.[config.answerField] ?? "");
}

/** 解説は教科によって置き場所が違う（公共・保健は editorial の下）。 */
export function explanationText(item) {
  return String(item?.explanation ?? item?.editorial?.explanation ?? item?.point ?? "").trim();
}
