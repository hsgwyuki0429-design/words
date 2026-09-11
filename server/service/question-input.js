// AIが渡してきた問題を、wordsの教材データと同じ形へ組み立て直す場所。
//
// AIには教科ごとの内部の項目名（publicQuestion / recallAnswer / exampleLines …）
// を知らせず、question・answer・choices といった共通の名前で受け取る。
// ここで教科ごとの正式な形へ広げ、最後に words 本体のロジックで
// 「この問題は本当に出題できるか」を確かめる。

import {
  DIFFICULTY_ORDER,
  IMPORTANCE_ORDER,
  acceptedInputAnswers,
  recallChoicesFor,
  recallCorrectChoiceFor,
  slotTokensForQuestion,
} from "../../src/logic.js";
import {
  fail,
  isPlainObject,
  readEnum,
  readId,
  readString,
  readStringArray,
  rejectUnknownKeys,
  requireObject,
} from "../core/validate.js";
import { SUBJECTS, SUBJECT_IDS, subjectOf } from "./subjects.js";

/** 入力の上限。長すぎる本文や大量の別解で保存が膨らむのを防ぐ。 */
export const QUESTION_LIMITS = Object.freeze({
  question: 800,
  answer: 200,
  explanation: 1200,
  choice: 200,
  shortText: 200,
  tags: 12,
  acceptedAnswers: 8,
  examples: 5,
});

/** AIから受け取ってよい項目。ここに無い名前は誤字として突き返す。 */
export const QUESTION_INPUT_FIELDS = Object.freeze([
  "subject",
  "id",
  "question",
  "answer",
  "explanation",
  "choices",
  "correctChoice",
  "importance",
  "difficulty",
  "range",
  "lesson",
  "title",
  "source",
  "tags",
  "type",
  "acceptedAnswers",
  "note",
  "examples",
  "reading",
  "point",
]);

const CHOICE_KEYS = ["A", "B", "C", "D"];
const ENGLISH_SOURCE_TYPES = { word: "単語", phrase: "熟語", structure: "語法" };

function readChoices(value, field = "choices") {
  if (value === undefined || value === null) return null;
  requireObject(value, field);
  rejectUnknownKeys(value, CHOICE_KEYS, field);
  const entries = CHOICE_KEYS
    .filter((key) => value[key] !== undefined && value[key] !== null)
    .map((key) => [key, readString(value[key], `${field}.${key}`, { required: true, max: QUESTION_LIMITS.choice })]);
  if (entries.length !== CHOICE_KEYS.length) {
    fail(`${field} は A・B・C・D の4つすべてを指定してください。`, field);
  }
  const texts = entries.map(([, text]) => text);
  if (new Set(texts).size !== texts.length) fail(`${field} に同じ選択肢が重複しています。`, field);
  return Object.fromEntries(entries);
}

/** 共通の入力を読み取る。add と update で同じ規則を使う。 */
function readCommonInput(raw, field) {
  requireObject(raw, field);
  rejectUnknownKeys(raw, QUESTION_INPUT_FIELDS, field);
  return {
    question: readString(raw.question, `${field}.question`, { max: QUESTION_LIMITS.question }),
    answer: readString(raw.answer, `${field}.answer`, { max: QUESTION_LIMITS.answer }),
    explanation: readString(raw.explanation, `${field}.explanation`, { max: QUESTION_LIMITS.explanation }),
    choices: readChoices(raw.choices, `${field}.choices`),
    correctChoice: readEnum(raw.correctChoice, `${field}.correctChoice`, CHOICE_KEYS),
    importance: readEnum(raw.importance, `${field}.importance`, IMPORTANCE_ORDER),
    difficulty: readEnum(raw.difficulty, `${field}.difficulty`, DIFFICULTY_ORDER),
    range: readString(raw.range, `${field}.range`, { max: QUESTION_LIMITS.shortText }),
    lesson: readString(raw.lesson, `${field}.lesson`, { max: QUESTION_LIMITS.shortText }),
    title: readString(raw.title, `${field}.title`, { max: QUESTION_LIMITS.shortText }),
    source: readString(raw.source, `${field}.source`, { max: QUESTION_LIMITS.explanation }),
    tags: readStringArray(raw.tags, `${field}.tags`, { max: QUESTION_LIMITS.tags, maxLength: 40 }),
    type: readString(raw.type, `${field}.type`, { max: 40 }),
    acceptedAnswers: readStringArray(raw.acceptedAnswers, `${field}.acceptedAnswers`, {
      max: QUESTION_LIMITS.acceptedAnswers,
      maxLength: QUESTION_LIMITS.answer,
    }),
    note: readString(raw.note, `${field}.note`, { max: QUESTION_LIMITS.explanation }),
    examples: readStringArray(raw.examples, `${field}.examples`, {
      max: QUESTION_LIMITS.examples,
      maxLength: QUESTION_LIMITS.question,
    }),
    reading: readString(raw.reading, `${field}.reading`, { max: QUESTION_LIMITS.question }),
    point: readString(raw.point, `${field}.point`, { max: QUESTION_LIMITS.explanation }),
  };
}

export function readSubject(value, field = "subject", { required = true } = {}) {
  return readEnum(value, field, SUBJECT_IDS, { required });
}

/** 教科ごとに決まっている範囲（range）以外は受け付けない。範囲外だとwordsの画面に出ない。 */
function requireKnownRange(subject, range, field) {
  const config = SUBJECTS[subject];
  if (!range) fail(`${field}.range は必須です。${config.label}で使える範囲: ${config.ranges.join(" / ")}`, `${field}.range`);
  if (!config.ranges.includes(range)) {
    fail(
      `${field}.range「${range}」は${config.label}に無い範囲です。使えるのは ${config.ranges.join(" / ")} です。`,
      `${field}.range`,
    );
  }
  return range;
}

function mirrorSources(item, { lesson, title, detail, range = null }) {
  item.lesson = lesson;
  item.title = title;
  item.source = detail;
  item.sourceDetail = detail;
  item.sources = [range === null ? { lesson, title, detail } : { range, lesson, title, detail }];
  return item;
}

/** 用例（／区切り）から、古文単語カードの下線表示用データを組み立てる。 */
export function buildExampleLines(example, term) {
  const lines = String(example)
    .split(/[／/]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const needle = String(term ?? "").trim();
  return lines.map((line) => {
    const index = needle ? line.indexOf(needle) : -1;
    if (index < 0) return { parts: [{ text: line, mark: false }] };
    const parts = [];
    if (index > 0) parts.push({ text: line.slice(0, index), mark: false });
    parts.push({ text: needle, mark: true });
    const rest = line.slice(index + needle.length);
    if (rest) parts.push({ text: rest, mark: false });
    return { parts };
  });
}

function buildEnglishItem(id, input) {
  const type = readEnum(input.type ?? "word", "question.type", SUBJECTS.english.types);
  const english = input.question;
  const japanese = input.answer;
  const modes = ["en_to_ja_choice", "ja_to_en_choice", "ja_to_en_input"];
  if (type === "word") modes.push("spelling_input");
  const item = {
    id,
    english,
    japanese,
    type,
    sourceType: ENGLISH_SOURCE_TYPES[type],
    importance: input.importance ?? "B",
    difficulty: input.difficulty ?? "—",
    range: input.range,
    tags: input.tags ?? [type],
    acceptedAnswers: input.acceptedAnswers?.length ? input.acceptedAnswers : [english],
    questionModes: modes,
  };
  mirrorSources(item, {
    range: input.range,
    lesson: input.lesson ?? input.range,
    title: input.title ?? input.range,
    detail: input.source ?? input.range,
  });
  if (type === "word") {
    item.lemma = english;
    item.surfaceForms = [english];
  }
  if (input.examples?.length) item.examples = input.examples;
  if (input.note) item.note = input.note;
  return item;
}

function buildRecallItem(id, input, { subject, questionField, answerField, kindLabel, type }) {
  const item = {
    id,
    subject,
    importance: input.importance ?? "A",
    [questionField]: input.question,
    [answerField]: input.answer,
    english: input.question,
    japanese: input.answer,
    type,
    answerFormat: "term",
    kind: kindLabel,
    range: input.range,
    tags: input.tags ?? [kindLabel],
    acceptedAnswers: input.acceptedAnswers?.length
      ? [input.answer, ...input.acceptedAnswers.filter((value) => value !== input.answer)]
      : [input.answer],
    questionModes: [`${subject}_recall`],
  };
  mirrorSources(item, {
    lesson: input.lesson ?? input.range,
    title: input.title ?? input.range,
    detail: input.source ?? input.range,
  });
  return item;
}

function buildPublicItem(id, input) {
  const item = buildRecallItem(id, input, {
    subject: "public",
    questionField: "publicQuestion",
    answerField: "publicAnswer",
    kindLabel: "用語",
    type: readEnum(input.type ?? "public-term", "question.type", SUBJECTS.public.types),
  });
  if (input.choices) {
    const correctChoice = input.correctChoice ?? CHOICE_KEYS.find((key) => input.choices[key] === input.answer);
    if (!correctChoice) {
      fail(
        "choices を渡すときは correctChoice（A〜D）も指定するか、答えと同じ文字列の選択肢を入れてください。",
        "question.correctChoice",
      );
    }
    item.editorial = { choices: input.choices, correctChoice };
    // 4択として出せる問題だけ、4択モードを付ける。選択肢が無い問題は一問一答だけになる。
    item.questionModes = ["public_recall", "public_choice"];
  }
  return item;
}

function buildHealthItem(id, input) {
  return buildRecallItem(id, input, {
    subject: "health",
    questionField: "healthQuestion",
    answerField: "healthAnswer",
    kindLabel: "用語",
    type: readEnum(input.type ?? "health-term", "question.type", SUBJECTS.health.types),
  });
}

function buildKobunVocabItem(id, input) {
  const example = input.question;
  const meaning = input.answer;
  // 教材の古文単語カードは「用例そのもの」が語句を兼ねている。下線もこの語句で引く。
  const term = example;
  const item = {
    id,
    subject: "kobun-vocab",
    category: "vocabulary",
    importance: input.importance ?? "A",
    // 教材に難易度の指定が無いため、古文単語は常に「—」で揃える。
    difficulty: "—",
    headword: example,
    meanings: [meaning],
    english: example,
    japanese: meaning,
    recallQuestion: example,
    recallAnswer: meaning,
    term,
    example,
    exampleLines: buildExampleLines(example, term),
    point: input.point ?? input.explanation ?? "",
    formats: ["現代語訳"],
    work: input.title ?? input.range,
    type: "kobun-vocab-term",
    answerFormat: "term",
    kind: "重要語句",
    range: input.range,
    tags: input.tags ?? ["重要語句", "現代語訳"],
    acceptedAnswers: input.acceptedAnswers?.length
      ? [meaning, ...input.acceptedAnswers.filter((value) => value !== meaning)]
      : [meaning],
    questionModes: ["kobun-vocab_recall"],
  };
  item.termMarked = item.exampleLines.some((line) => line.parts.some((part) => part.mark));
  if (input.reading) item.reading = input.reading;
  mirrorSources(item, {
    lesson: input.range,
    title: input.title ?? input.range,
    detail: input.source ?? input.range,
  });
  return item;
}

const BUILDERS = {
  english: buildEnglishItem,
  public: buildPublicItem,
  health: buildHealthItem,
  "kobun-vocab": buildKobunVocabItem,
};

/**
 * words本体のロジックで、その問題が実際に出題できるかを確かめる。
 * 画面の描画に必要な項目が欠けたまま保存されると、学習中にエラーになるため。
 */
export function assertPlayable(item) {
  const subject = subjectOf(item);
  if (subject === "english") {
    if (!slotTokensForQuestion(item, "ja_to_en_input").length) {
      fail(`「${item.english}」はキーボード入力の解答欄を作れません。英語の綴りを確かめてください。`, "question");
    }
    if (!acceptedInputAnswers(item.acceptedAnswers).length) {
      fail(`「${item.english}」は入力で受け付けられる答えがありません。`, "answer");
    }
  }
  if (item.questionModes?.includes("public_choice")) {
    const choices = recallChoicesFor(item);
    if (choices.length !== 4 || !choices.includes(recallCorrectChoiceFor(item))) {
      fail("4択にするには、重複しない4つの選択肢と、正解の記号（correctChoice）が必要です。", "choices");
    }
  }
  return item;
}

/** 新しい問題を1件組み立てる。id は呼び出し側が決める。 */
export function buildQuestion({ subject, input, id, field = "question" }) {
  const common = readCommonInput(input, field);
  if (!common.question) fail(`${field}.question は必須です。`, `${field}.question`);
  if (!common.answer) fail(`${field}.answer は必須です。`, `${field}.answer`);
  requireKnownRange(subject, common.range, field);
  const item = BUILDERS[subject](readId(id, `${field}.id`), common);
  if (common.explanation) {
    item.editorial = { ...(item.editorial ?? {}), explanation: common.explanation };
  }
  // AI経由で追加された問題だと画面と記録から分かるようにしておく。
  item.aiAdded = true;
  return assertPlayable(item);
}

/**
 * 既存の問題を部分的に書き換える。渡された項目だけを変え、他はそのまま残す。
 * 教科ごとに対になっている項目（publicQuestion と english など）も一緒に揃える。
 */
export function patchQuestion(item, input, { field = "patch" } = {}) {
  const common = readCommonInput(input, field);
  if (input.subject !== undefined) fail(`${field}.subject は変更できません。`, `${field}.subject`);
  if (input.id !== undefined) fail(`${field}.id は変更できません。`, `${field}.id`);
  const subject = subjectOf(item);
  const config = SUBJECTS[subject];
  const next = structuredClone(item);
  const changed = [];

  const setQuestion = (text) => {
    next[config.questionField] = text;
    next.english = text;
    if (subject === "kobun-vocab") {
      next.headword = text;
      next.example = text;
      next.recallQuestion = text;
      next.term = text;
      next.exampleLines = buildExampleLines(text, text);
      next.termMarked = next.exampleLines.some((line) => line.parts.some((part) => part.mark));
    }
  };
  const setAnswer = (text) => {
    next[config.answerField] = text;
    next.japanese = text;
    if (subject === "kobun-vocab") {
      next.meanings = [text];
      next.recallAnswer = text;
    }
    // 別解が指定されていなければ、受け付ける答えも新しい答えに合わせる。
    const extras = (next.acceptedAnswers ?? []).slice(1);
    next.acceptedAnswers = subject === "english" ? [text] : [text, ...extras];
  };

  if (common.question !== null) {
    if (!common.question) fail(`${field}.question は空にできません。`, `${field}.question`);
    setQuestion(common.question);
    changed.push("question");
  }
  if (common.answer !== null) {
    if (!common.answer) fail(`${field}.answer は空にできません。`, `${field}.answer`);
    setAnswer(common.answer);
    changed.push("answer");
  }
  if (common.explanation !== null) {
    next.editorial = { ...(next.editorial ?? {}), explanation: common.explanation };
    changed.push("explanation");
  }
  if (common.choices) {
    const correctChoice = common.correctChoice
      ?? next.editorial?.correctChoice
      ?? CHOICE_KEYS.find((key) => common.choices[key] === next[config.answerField]);
    if (!correctChoice) fail(`${field}.correctChoice（A〜D）も指定してください。`, `${field}.correctChoice`);
    next.editorial = { ...(next.editorial ?? {}), choices: common.choices, correctChoice };
    if (subject === "public" && !next.questionModes.includes("public_choice")) {
      next.questionModes = ["public_recall", "public_choice"];
    }
    changed.push("choices");
  } else if (common.correctChoice) {
    if (!next.editorial?.choices) fail(`${field}.correctChoice は選択肢のある問題にだけ指定できます。`, `${field}.correctChoice`);
    next.editorial = { ...next.editorial, correctChoice: common.correctChoice };
    changed.push("correctChoice");
  }
  if (common.importance) {
    next.importance = common.importance;
    changed.push("importance");
  }
  if (common.difficulty && subject !== "kobun-vocab") {
    next.difficulty = common.difficulty;
    changed.push("difficulty");
  }
  if (common.range) {
    requireKnownRange(subject, common.range, field);
    next.range = common.range;
    changed.push("range");
  }
  if (common.tags) {
    next.tags = common.tags;
    changed.push("tags");
  }
  if (common.type) {
    next.type = readEnum(common.type, `${field}.type`, config.types);
    if (subject === "english") next.sourceType = ENGLISH_SOURCE_TYPES[next.type];
    changed.push("type");
  }
  if (common.acceptedAnswers) {
    const answer = next[config.answerField];
    next.acceptedAnswers = subject === "english"
      ? [...new Set([answer, ...common.acceptedAnswers])]
      : [...new Set([answer, ...common.acceptedAnswers])];
    changed.push("acceptedAnswers");
  }
  if (common.note !== null) {
    next.note = common.note;
    changed.push("note");
  }
  if (common.examples) {
    next.examples = common.examples;
    changed.push("examples");
  }
  if (common.point !== null) {
    next.point = common.point;
    changed.push("point");
  }
  if (common.lesson || common.title || common.source) {
    mirrorSources(next, {
      range: subject === "english" ? next.range : null,
      lesson: common.lesson ?? next.lesson,
      title: common.title ?? next.title,
      detail: common.source ?? next.sourceDetail,
    });
    changed.push("source");
  }
  if (!changed.length) fail("変更する項目が1つも指定されていません。", field);
  return { item: assertPlayable(next), changed };
}

export function hasChoices(item) {
  return isPlainObject(item?.editorial?.choices);
}
