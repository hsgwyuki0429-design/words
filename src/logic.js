export const IMPORTANCE_ORDER = ["SSS", "SS", "S", "A", "B", "C", "D"];
export const DIFFICULTY_ORDER = ["—", "A", "B", "C", "D", "E", "F"];
export const RANGE_ORDER = [
  "OriHime",
  "Mars",
  "Kakigori",
  "Plastic",
  "FOMO",
  "Snow",
  "Shinkansen",
  "Taste Buds",
];
export const PUBLIC_RANGE_ORDER = [
  "p.36–37",
  "p.40–47",
  "p.60–63",
  "p.68–69",
  "p.70–73",
  "p.76–77",
];
export const HEALTH_RANGE_ORDER = [
  "p.12–13",
  "p.14–15",
  "p.16–17",
  "p.20–21",
  "p.24–25",
  "p.26–27",
  "p.30–31",
  "p.34–35",
];

export const MODE_LABELS = {
  en_to_ja_choice: "英語 → 日本語 4択",
  ja_to_en_choice: "日本語 → 英語 4択",
  en_to_ja_flashcard: "英語 → 日本語 フラッシュカード",
  ja_to_en_flashcard: "日本語 → 英語 フラッシュカード",
  ja_to_en_input: "キーボード入力",
  spelling_input: "スペル完全入力",
  preposition_input: "前置詞穴埋め",
  phrase_blank_input: "熟語・語法穴埋め",
  public_recall: "公共 一問一答",
  health_recall: "保健 一問一答",
};

export const TYPE_LABELS = {
  word: "単語",
  phrase: "熟語",
  structure: "構文",
  expression: "表現",
  "public-term": "語句回答",
  "public-short": "短文回答",
  "health-term": "語句回答",
  "health-short": "短文回答",
};

export const ALL_MODES = Object.keys(MODE_LABELS);
export const UNKNOWN_CHOICE = "わからない";
export const WRONG_REVIEW_DELAY_MS = 3 * 60 * 1000;
export const ONE_HOUR_REVIEW_DELAY_MS = 60 * 60 * 1000;

export function reviewDelayForAnswer(mode, correct, requestedDelayMs = null) {
  const requested = Math.max(0, Number(requestedDelayMs) || 0);
  if (requested) return requested;
  return !correct && (String(mode).endsWith("choice") || mode === "ja_to_en_input")
    ? WRONG_REVIEW_DELAY_MS
    : null;
}

export function releaseDeferredReviews(reviews = [], now = Date.now(), forceNext = false) {
  const ordered = [...reviews].sort((left, right) => left.dueAt - right.dueAt);
  const ready = ordered.filter((review) => review.dueAt <= now);
  const pending = ordered.filter((review) => review.dueAt > now);
  if (forceNext && !ready.length && pending.length) ready.push(pending.shift());
  return { ready, pending };
}

export const STUDY_CONTENT_LABELS = {
  word: "単語",
  phrase: "熟語",
  structure: "構文",
  all: "単語＋熟語＋構文",
  term: "語句回答問題",
  short: "短文回答問題",
};

export const STUDY_METHOD_LABELS = {
  ja_to_en_choice: "日本語 → 英語 4択",
  ja_to_en_input: "キーボード入力",
  en_to_ja_choice: "英語 → 日本語 4択",
  ja_to_en_flashcard: "日本語 → 英語 フラッシュカード",
  en_to_ja_flashcard: "英語 → 日本語 フラッシュカード",
  recall: "タップで表裏・スワイプで自己採点",
};

export const ENGLISH_CONTENT_TYPES = ["word", "phrase", "structure"];

export function itemSupportsMode(item, mode) {
  if (item.questionModes.includes(mode)) return true;
  if (mode === "en_to_ja_flashcard") return item.questionModes.includes("en_to_ja_choice");
  if (mode === "ja_to_en_flashcard") return item.questionModes.includes("ja_to_en_choice");
  return false;
}

export function normalizeAnswer(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/(?:\.{3}|…+|～+)$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

export function isAnswerCorrect(input, acceptedAnswers) {
  const normalized = normalizeAnswer(input);
  return acceptedAnswers.some((answer) => normalizeAnswer(answer) === normalized)
    || acceptedInputAnswers(acceptedAnswers)
      .some((answer) => normalizeAnswer(answer) === normalized);
}

export function answersForMode(item, mode) {
  if (mode === "preposition_input") {
    return item.blanks?.preposition ? [item.blanks.preposition.answer] : [];
  }
  if (mode === "phrase_blank_input") {
    return item.blanks?.phrase ? [item.blanks.phrase.answer] : [];
  }
  return item.acceptedAnswers;
}

const INPUT_TOKEN_PATTERN = /[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g;
const JAPANESE_NOTATION_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WRAPPING_QUOTE_PATTERN = /^[“”"「」『』]+|[“”"「」『』]+$/gu;

function parseInputAnswer(answer) {
  const rawParts = String(answer ?? "")
    .replace(/(?:\.{3}|…+|～+)/g, " … ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const notationIndexes = new Set();
  rawParts.forEach((part, index) => {
    if (part !== "+") return;
    notationIndexes.add(index);
    if (JAPANESE_NOTATION_PATTERN.test(rawParts[index - 1] ?? "")) notationIndexes.add(index - 1);
    if (JAPANESE_NOTATION_PATTERN.test(rawParts[index + 1] ?? "")) notationIndexes.add(index + 1);
  });

  const slots = [];
  const segments = [];
  rawParts.forEach((rawPart, partIndex) => {
    if (notationIndexes.has(partIndex) || rawPart === "…") {
      segments.push({ kind: "fixed", text: rawPart });
      return;
    }

    const prefix = rawPart.match(/^[“”"「」『』]+/u)?.[0] ?? "";
    const suffix = rawPart.match(/[“”"「」『』]+$/u)?.[0] ?? "";
    let core = rawPart.replace(WRAPPING_QUOTE_PATTERN, "");
    const optional = /^\([^()\s]+\)$/u.test(core);
    if (optional) core = core.slice(1, -1);
    const alternatives = core
      .split("/")
      .flatMap((part) => part.match(INPUT_TOKEN_PATTERN) ?? [])
      .filter(Boolean);

    if (!alternatives.length) {
      segments.push({ kind: "fixed", text: rawPart });
      return;
    }
    if (prefix) segments.push({ kind: "fixed", text: prefix });
    const slotIndex = slots.length;
    slots.push({
      index: slotIndex,
      answer: alternatives[0],
      alternatives: [...new Set(alternatives)],
      optional,
    });
    segments.push({ kind: "slot", slotIndex });
    if (suffix) segments.push({ kind: "fixed", text: suffix });
  });

  let layouts = [{ tokens: [], slotIndexes: [] }];
  for (const slot of slots) {
    const choices = [
      ...(slot.optional ? [null] : []),
      ...slot.alternatives,
    ];
    layouts = layouts.flatMap((layout) => choices.map((choice) => choice === null
      ? layout
      : {
          tokens: [...layout.tokens, choice],
          slotIndexes: [...layout.slotIndexes, slot.index],
        }));
  }
  return { slots, segments, layouts };
}

export function inputPlanForAnswers(acceptedAnswers = []) {
  const parsedAnswers = (Array.isArray(acceptedAnswers) ? acceptedAnswers : [])
    .map(parseInputAnswer)
    .filter((parsed) => parsed.slots.length);
  const primary = parsedAnswers[0] ?? { slots: [], segments: [], layouts: [] };
  const slots = primary.slots.map((slot) => ({ ...slot, alternatives: [...slot.alternatives] }));
  const segments = primary.segments.map((segment) => ({ ...segment }));
  const maximumSlotCount = parsedAnswers.reduce(
    (maximum, parsed) => Math.max(maximum, parsed.slots.length),
    slots.length,
  );
  while (slots.length < maximumSlotCount) {
    const slotIndex = slots.length;
    slots.push({ index: slotIndex, answer: "", alternatives: [], optional: true });
    segments.push({ kind: "slot", slotIndex });
  }

  const layouts = parsedAnswers.flatMap((parsed, answerIndex) => parsed.layouts.map((layout) => ({
    tokens: [...layout.tokens],
    slotIndexes: answerIndex === 0
      ? [...layout.slotIndexes]
      : layout.tokens.map((_, index) => index),
  })));
  return { slots, segments, layouts };
}

export function acceptedInputAnswers(acceptedAnswers = []) {
  return [...new Set(
    inputPlanForAnswers(acceptedAnswers).layouts
      .map((layout) => layout.tokens.join(" ").trim())
      .filter(Boolean),
  )];
}

export function inputPlanForQuestion(item, mode) {
  return inputPlanForAnswers(answersForMode(item, mode));
}

export function tokenizeAnswer(answer) {
  return parseInputAnswer(answer).slots.map((slot) => slot.answer);
}

export function slotTokensForQuestion(item, mode) {
  return inputPlanForQuestion(item, mode).slots.map((slot) => slot.answer);
}

export function characterHintForToken(token) {
  return [...String(token ?? "").normalize("NFKC").replace(/[‘’]/g, "'")]
    .map((character) => /[A-Za-z0-9]/.test(character) ? "_" : /['-]/.test(character) ? character : "")
    .join("");
}

export function distributeInputText(plan, text, startIndex = 0) {
  const parts = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const values = Array.from({ length: plan?.slots?.length ?? 0 }, () => "");
  const start = Math.max(0, Number(startIndex) || 0);
  const matchingLayout = start === 0
    ? plan?.layouts?.find((layout) =>
        normalizeAnswer(layout.tokens.join(" ")) === normalizeAnswer(parts.join(" ")))
    : null;
  if (matchingLayout) {
    parts.forEach((part, index) => {
      const slotIndex = matchingLayout.slotIndexes[index];
      if (slotIndex !== undefined && values[slotIndex] !== undefined) values[slotIndex] = part;
    });
    return values;
  }
  parts.forEach((part, offset) => {
    if (values[start + offset] !== undefined) values[start + offset] = part;
  });
  return values;
}

/*
 * アプリ内小文字英字キーボードの配列とキー操作。
 * 採点は既存の normalizeAnswer() / isAnswerCorrect() だけを使い、ここでは
 * 「どの入力枠に何を書き込むか」という純粋な状態遷移のみを扱う。
 */
export const ALPHABET_KEYBOARD_ROWS = Object.freeze([
  Object.freeze(["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"]),
  Object.freeze(["a", "s", "d", "f", "g", "h", "j", "k", "l"]),
  Object.freeze(["'", "z", "x", "c", "v", "b", "n", "m", "-"]),
]);

const ALPHABET_KEY_SET = new Set(ALPHABET_KEYBOARD_ROWS.flat());

export function alphabetKeyboardKeys() {
  return ALPHABET_KEYBOARD_ROWS.flat();
}

export function isAlphabetKeyboardKey(key) {
  return ALPHABET_KEY_SET.has(String(key ?? ""));
}

function normalizeSlotValues(values) {
  return (Array.isArray(values) ? values : []).map((value) => String(value ?? ""));
}

export function clampSlotIndex(index, slotCount) {
  const count = Math.max(0, Math.trunc(Number(slotCount) || 0));
  if (!count) return 0;
  const requested = Math.trunc(Number(index) || 0);
  return Math.min(count - 1, Math.max(0, requested));
}

export function applyKeyboardKey(values, activeIndex, key) {
  const list = normalizeSlotValues(values);
  const index = clampSlotIndex(activeIndex, list.length);
  if (!list.length || !isAlphabetKeyboardKey(key)) return { values: list, activeIndex: index };
  list[index] = `${list[index]}${key}`;
  return { values: list, activeIndex: index };
}

export function deleteKeyboardCharacter(values, activeIndex) {
  const list = normalizeSlotValues(values);
  if (!list.length) return { values: list, activeIndex: 0 };
  let index = clampSlotIndex(activeIndex, list.length);
  // 空欄で削除したときは前の枠へ戻り、その枠の末尾1文字を消す。
  if (!list[index] && index > 0) index -= 1;
  list[index] = list[index].slice(0, -1);
  return { values: list, activeIndex: index };
}

export function moveKeyboardSlot(activeIndex, delta, slotCount) {
  const current = Math.trunc(Number(activeIndex) || 0);
  return clampSlotIndex(current + Math.trunc(Number(delta) || 0), slotCount);
}

export function emptyHistory(itemId) {
  return {
    itemId,
    totalAttempts: 0,
    correctCount: 0,
    wrongCount: 0,
    currentCorrectStreak: 0,
    bestCorrectStreak: 0,
    hasEverMissed: false,
    lastResult: null,
    lastAttemptAt: null,
    lastCorrectAt: null,
    lastWrongAt: null,
    totalAnswerTimeMs: 0,
    modeStats: {},
  };
}

export function mergeAttempt(
  current,
  { itemId, mode, correct, answeredAt = Date.now(), durationMs = 0 },
) {
  const base = current
    ? JSON.parse(JSON.stringify(current))
    : emptyHistory(itemId);
  const modeBase = base.modeStats?.[mode] ?? {
    attempts: 0,
    correct: 0,
    wrong: 0,
    totalAnswerTimeMs: 0,
    lastResult: null,
    lastAttemptAt: null,
    currentCorrectStreak: 0,
    bestCorrectStreak: 0,
  };

  base.totalAttempts += 1;
  base.correctCount += correct ? 1 : 0;
  base.wrongCount += correct ? 0 : 1;
  base.currentCorrectStreak = correct ? base.currentCorrectStreak + 1 : 0;
  base.bestCorrectStreak = Math.max(
    base.bestCorrectStreak,
    base.currentCorrectStreak,
  );
  base.hasEverMissed ||= !correct;
  base.lastResult = correct ? "correct" : "wrong";
  base.lastAttemptAt = answeredAt;
  base.totalAnswerTimeMs = (base.totalAnswerTimeMs ?? 0) + Math.max(0, durationMs);
  if (correct) base.lastCorrectAt = answeredAt;
  else base.lastWrongAt = answeredAt;

  modeBase.attempts += 1;
  modeBase.correct += correct ? 1 : 0;
  modeBase.wrong += correct ? 0 : 1;
  modeBase.totalAnswerTimeMs =
    (modeBase.totalAnswerTimeMs ?? 0) + Math.max(0, durationMs);
  modeBase.lastResult = base.lastResult;
  modeBase.lastAttemptAt = answeredAt;
  // 形式ごとの連続正解。全形式を跨ぐ base.currentCorrectStreak とは別に数える。
  modeBase.currentCorrectStreak = correct ? (modeBase.currentCorrectStreak ?? 0) + 1 : 0;
  modeBase.bestCorrectStreak = Math.max(modeBase.bestCorrectStreak ?? 0, modeBase.currentCorrectStreak);
  base.modeStats = { ...base.modeStats, [mode]: modeBase };
  return base;
}

export function getHistory(history, itemId) {
  if (history instanceof Map) return history.get(itemId) ?? emptyHistory(itemId);
  return history?.[itemId] ?? emptyHistory(itemId);
}

export function accuracyFor(record) {
  return record.totalAttempts > 0
    ? record.correctCount / record.totalAttempts
    : null;
}

export function historyForModes(record, modes = []) {
  const selectedModes = [...new Set(modes)].filter(Boolean);
  if (!selectedModes.length) return record;
  const stats = selectedModes
    .map((mode) => ({ mode, ...(record.modeStats?.[mode] ?? {}) }))
    .filter((stat) => (stat.attempts ?? 0) > 0);
  const latest = stats.reduce(
    (current, stat) => !current || (stat.lastAttemptAt ?? 0) > (current.lastAttemptAt ?? 0) ? stat : current,
    null,
  );
  const totalAttempts = stats.reduce((sum, stat) => sum + (stat.attempts ?? 0), 0);
  const correctCount = stats.reduce((sum, stat) => sum + (stat.correct ?? 0), 0);
  const wrongCount = stats.reduce((sum, stat) => sum + (stat.wrong ?? 0), 0);
  return {
    ...emptyHistory(record.itemId),
    totalAttempts,
    correctCount,
    wrongCount,
    hasEverMissed: wrongCount > 0,
    lastResult: latest?.lastResult ?? null,
    lastAttemptAt: latest?.lastAttemptAt ?? null,
    totalAnswerTimeMs: stats.reduce((sum, stat) => sum + (stat.totalAnswerTimeMs ?? 0), 0),
    modeStats: Object.fromEntries(stats.map((stat) => [stat.mode, record.modeStats[stat.mode]])),
  };
}

export function difficultyScore(record, importance = "B") {
  const importanceWeight = IMPORTANCE_ORDER.length - Math.max(0, IMPORTANCE_ORDER.indexOf(importance));
  const accuracy = accuracyFor(record) ?? 0.5;
  const unseenBoost = record.totalAttempts === 0 ? 2 : 0;
  return record.wrongCount * 5 + (1 - accuracy) * 20 + importanceWeight + unseenBoost;
}

function includesSearch(item, query) {
  const normalized = String(query ?? "").trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [
    item.english,
    item.lemma,
    (item.surfaceForms ?? []).join(" "),
    item.japanese,
    item.range,
    item.lesson,
    item.title,
    item.source,
  ].some((value) => String(value).toLocaleLowerCase().includes(normalized));
}

function matchesPerformance(record, performance) {
  const accuracy = accuracyFor(record);
  switch (performance) {
    case "unanswered":
      return record.totalAttempts === 0;
    case "answered":
      return record.totalAttempts > 0;
    case "everCorrect":
      return record.correctCount > 0;
    case "everMissed":
      return record.hasEverMissed;
    case "neverMissed":
      return !record.hasEverMissed;
    case "lastCorrect":
      return record.lastResult === "correct";
    case "lastWrong":
      return record.lastResult === "wrong";
    case "accuracyUnder50":
      return accuracy !== null && accuracy < 0.5;
    case "accuracyUnder70":
      return accuracy !== null && accuracy < 0.7;
    case "accuracyUnder80":
      return accuracy !== null && accuracy < 0.8;
    case "accuracyAtLeast90":
      return accuracy !== null && accuracy >= 0.9;
    default:
      return true;
  }
}

export function applyFilters(items, history, filters = {}) {
  const ranges = new Set(filters.ranges ?? []);
  const importance = new Set(filters.importance ?? []);
  const types = new Set(filters.types ?? []);
  const modes = new Set(filters.modes ?? []);
  const performanceModes = [...new Set(filters.performanceModes ?? [])];
  const tags = new Set(filters.tags ?? []);
  const minimumWrong = Number(filters.minimumWrong ?? 0);

  return items.filter((item) => {
    const record = historyForModes(getHistory(history, item.id), performanceModes);
    if (ranges.size && !ranges.has(item.range)) return false;
    if (importance.size && !importance.has(item.importance)) return false;
    if (types.size && !types.has(item.type)) return false;
    if (modes.size && ![...modes].some((mode) => itemSupportsMode(item, mode))) {
      return false;
    }
    if (tags.size && !item.tags.some((tag) => tags.has(tag))) return false;
    if (minimumWrong > 0 && record.wrongCount < minimumWrong) return false;
    if (!matchesPerformance(record, filters.performance ?? "all")) return false;
    return includesSearch(item, filters.search);
  });
}

export function shuffle(items, rng = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function compareNullableNumber(a, b, fallbackA = 0, fallbackB = 0) {
  return (a ?? fallbackA) - (b ?? fallbackB);
}

// 重要度順・難易度順では、同じレベル帯の中の並びをランダムにする。
// （S の中での順番は毎回変わる／レベルをまたぐ順番は変えない）
export const RANDOM_TIE_BREAK_SORT_KEYS = [
  "importance-desc",
  "importance-asc",
  "difficulty-level-desc",
];

export function sortItems(
  items,
  history,
  sortKey = "importance-desc",
  rng = Math.random,
  { randomizeTies = false } = {},
) {
  if (sortKey === "random") return shuffle(items, rng);
  // Array#sort は安定なので、先にシャッフルしてから同値を 0 で返すと
  // 同じレベル帯の中だけがランダムな並びになる。
  const randomTies = randomizeTies && RANDOM_TIE_BREAK_SORT_KEYS.includes(sortKey);
  const sorted = randomTies ? shuffle(items, rng) : [...items];
  const importanceIndex = (item) => IMPORTANCE_ORDER.indexOf(item.importance);
  const difficultyIndex = (item) => DIFFICULTY_ORDER.indexOf(item.difficulty);
  const rangeIndex = (item) => {
    const order = item.subject === "public"
      ? PUBLIC_RANGE_ORDER
      : item.subject === "health"
        ? HEALTH_RANGE_ORDER
        : RANGE_ORDER;
    const index = order.indexOf(item.range);
    return index < 0 ? order.length : index;
  };
  const registrationIndex = (item) => Number(item.order ?? item.number ?? 0);
  const record = (item) => getHistory(history, item.id);
  const accuracy = (item) => accuracyFor(record(item));

  sorted.sort((a, b) => {
    let result = 0;
    switch (sortKey) {
      case "importance-asc":
        result = importanceIndex(b) - importanceIndex(a);
        break;
      case "wrong-desc":
        result = record(b).wrongCount - record(a).wrongCount;
        break;
      case "wrong-asc":
        result = record(a).wrongCount - record(b).wrongCount;
        break;
      case "accuracy-asc":
        result = compareNullableNumber(accuracy(a), accuracy(b), 2, 2);
        break;
      case "accuracy-desc":
        result = compareNullableNumber(accuracy(b), accuracy(a), -1, -1);
        break;
      case "attempts-asc":
        result = record(a).totalAttempts - record(b).totalAttempts;
        break;
      case "attempts-desc":
        result = record(b).totalAttempts - record(a).totalAttempts;
        break;
      case "recent-wrong":
        result = (record(b).lastWrongAt ?? 0) - (record(a).lastWrongAt ?? 0);
        break;
      case "recent-attempted":
        result = (record(b).lastAttemptAt ?? 0) - (record(a).lastAttemptAt ?? 0);
        break;
      case "oldest-attempted":
        result =
          (record(a).lastAttemptAt ?? Number.MAX_SAFE_INTEGER) -
          (record(b).lastAttemptAt ?? Number.MAX_SAFE_INTEGER);
        break;
      case "range":
        result = rangeIndex(a) - rangeIndex(b);
        break;
      case "registration":
        result = registrationIndex(a) - registrationIndex(b);
        break;
      case "alpha-en":
        result = a.english.localeCompare(b.english, "en", { sensitivity: "base" });
        break;
      case "alpha-ja":
        result = a.japanese.localeCompare(b.japanese, "ja");
        break;
      case "difficulty":
        result =
          difficultyScore(record(b), b.importance) -
          difficultyScore(record(a), a.importance);
        break;
      case "difficulty-level-desc":
        result = difficultyIndex(b) - difficultyIndex(a);
        break;
      case "importance-desc":
      default:
        result = importanceIndex(a) - importanceIndex(b);
        break;
    }
    if (result) return result;
    return randomTies ? 0 : registrationIndex(a) - registrationIndex(b);
  });
  return sorted;
}

function choiceAnswer(candidate, mode) {
  if (mode === "ja_to_en_choice") return candidate.english;
  if (candidate.type === "structure") {
    return candidate.japanese.replace(/\s*（[^（）]*）\s*$/u, "").trim();
  }
  return candidate.japanese;
}

function placeholderSignature(value) {
  const text = String(value ?? "");
  const count = (placeholder) =>
    (text.match(new RegExp(`(?<![A-Za-z])${placeholder}(?![A-Za-z])`, "g")) ?? []).length;
  return `${count("A")}:${count("B")}`;
}

export function generateChoices(item, mode, pool, rng = Math.random, excludedItemIds = []) {
  const correct = choiceAnswer(item, mode);
  const excluded = new Set(excludedItemIds);
  const targetSignature = placeholderSignature(item.english);
  const matchPlaceholderShape = item.type !== "word" && targetSignature !== "0:0";
  // 日本語→英語では訳がそのまま問題文になるので、同じ訳の語句は誤答にできない。
  // garbage と trash のように、どちらを選んでも正解になってしまう。
  const promptGloss = mode === "ja_to_en_choice" ? normalizeAnswer(item.japanese) : "";
  const eligible = (candidate) =>
    candidate.id !== item.id &&
    (!promptGloss || normalizeAnswer(candidate.japanese) !== promptGloss) &&
    (!matchPlaceholderShape || (
      candidate.type !== "word" && placeholderSignature(candidate.english) === targetSignature
    ));

  const rankCandidates = (source) =>
    shuffle(source, rng).map((candidate) => {
      const wordDifference = Math.abs(
        tokenizeAnswer(candidate.english).length - tokenizeAnswer(item.english).length,
      );
      const score =
        (candidate.type === item.type ? 8 : 0) +
        (candidate.range !== item.range ? 3 : 0) +
        (candidate.importance === item.importance ? 1 : 0) +
        Math.max(0, 2 - wordDifference);
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score);
  const candidates = rankCandidates(
    pool.filter((candidate) => eligible(candidate) && !excluded.has(candidate.id)),
  );
  const fallbackCandidates = rankCandidates(
    pool.filter((candidate) => eligible(candidate) && excluded.has(candidate.id)),
  );

  const seen = new Set([normalizeAnswer(correct)]);
  const usedRanges = new Set([item.range]);
  const distractors = [];
  const addDistractors = (source) => {
    for (const requireNewRange of [true, false]) {
      for (const { candidate } of source) {
        if (requireNewRange && usedRanges.has(candidate.range)) continue;
        const value = choiceAnswer(candidate, mode);
        const key = normalizeAnswer(value);
        if (!seen.has(key)) {
          seen.add(key);
          usedRanges.add(candidate.range);
          distractors.push(value);
        }
        if (distractors.length === 3) return;
      }
    }
  };
  addDistractors(candidates);
  if (distractors.length < 3) addDistractors(fallbackCandidates);
  return shuffle([correct, ...distractors], rng);
}

export function buildQuestion(item, mode, pool, rng = Math.random, excludedChoiceItemIds = []) {
  const base = {
    item,
    mode,
    label: MODE_LABELS[mode],
    acceptedAnswers: answersForMode(item, mode),
  };
  switch (mode) {
    case "public_recall":
    case "health_recall":
      return {
        ...base,
        prompt: item[`${item.subject}Question`] ?? item.recallQuestion ?? item.publicQuestion ?? item.english,
        answer: item[`${item.subject}Answer`] ?? item.recallAnswer ?? item.publicAnswer ?? item.japanese,
        instruction: "tap",
      };
    case "en_to_ja_flashcard":
      return {
        ...base,
        prompt: item.english,
        answer: item.japanese,
        instruction: "tap",
      };
    case "ja_to_en_flashcard":
      return {
        ...base,
        prompt: item.japanese,
        answer: item.english,
        instruction: "tap",
      };
    case "en_to_ja_choice":
      return {
        ...base,
        prompt: item.english,
        instruction: "最も近い日本語を選んでください",
        choices: [...generateChoices(item, mode, pool, rng, excludedChoiceItemIds), UNKNOWN_CHOICE],
        correctChoice: choiceAnswer(item, mode),
      };
    case "ja_to_en_choice":
      return {
        ...base,
        prompt: item.japanese,
        instruction: "正しい英語を選んでください",
        choices: [...generateChoices(item, mode, pool, rng, excludedChoiceItemIds), UNKNOWN_CHOICE],
        correctChoice: item.english,
      };
    case "preposition_input":
      return {
        ...base,
        prompt: item.blanks.preposition.prompt,
        instruction: "空欄に入る前置詞を入力してください",
      };
    case "phrase_blank_input":
      return {
        ...base,
        prompt: item.blanks.phrase.prompt,
        instruction: "熟語・語法の空欄を完全入力してください",
      };
    case "spelling_input":
      return {
        ...base,
        prompt: item.japanese,
        instruction: "英単語のスペルを完全入力してください",
      };
    case "ja_to_en_input":
    default:
      return {
        ...base,
        prompt: item.japanese,
        inputPlan: inputPlanForQuestion(item, mode),
        instruction: "日本語に対応する英語を入力してください",
      };
  }
}

export function buildSession({
  items,
  history,
  filters = {},
  selectedModes = ALL_MODES,
  sortKey = "random",
  count = 15,
  rng = Math.random,
}) {
  const modes = selectedModes.length ? selectedModes : ALL_MODES;
  const candidates = sortItems(
    applyFilters(items, history, { ...filters, modes }),
    history,
    sortKey,
    rng,
  ).filter((item) => modes.some((mode) => itemSupportsMode(item, mode)));
  const limit = count === "all" ? candidates.length : Math.max(0, Number(count));
  const chosen = candidates.slice(0, limit);
  const usage = new Map(modes.map((mode) => [mode, 0]));

  return chosen.map((item) => {
    const supported = modes.filter((mode) => itemSupportsMode(item, mode));
    const leastUsed = Math.min(...supported.map((mode) => usage.get(mode) ?? 0));
    const balanced = supported.filter((mode) => (usage.get(mode) ?? 0) === leastUsed);
    const mode = balanced[Math.floor(rng() * balanced.length)];
    usage.set(mode, (usage.get(mode) ?? 0) + 1);
    return { item, mode };
  });
}

export function normalizeStudySelection(selection = {}) {
  const subject = ["public", "health"].includes(selection.subject) ? selection.subject : "english";
  const recallSubject = subject !== "english";
  const contentOptions = recallSubject
    ? ["term", "short", "all"]
    : ["word", "phrase", "structure", "all"];
  const requestedMethod = selection.method === "ja_to_en_spelling"
    ? "ja_to_en_input"
    : selection.method;
  const methodOptions = recallSubject
    ? ["recall"]
    : ["ja_to_en_choice", "ja_to_en_input", "en_to_ja_choice", "ja_to_en_flashcard", "en_to_ja_flashcard"];
  const selectedContents = recallSubject
    ? []
    : Array.isArray(selection.contents)
      ? ENGLISH_CONTENT_TYPES.filter((content) => new Set(selection.contents).has(content))
      : selection.content === "all"
        ? [...ENGLISH_CONTENT_TYPES]
        : ENGLISH_CONTENT_TYPES.includes(selection.content)
          ? [selection.content]
          : [];
  const content = recallSubject
    ? contentOptions.includes(selection.content) ? selection.content : null
    : selectedContents.length === ENGLISH_CONTENT_TYPES.length
      ? "all"
      : selectedContents.length === 1
        ? selectedContents[0]
        : null;
  const method = methodOptions.includes(requestedMethod) ? requestedMethod : null;
  const direction = ["en_to_ja", "ja_to_en"].includes(selection.direction)
    ? selection.direction
    : method?.startsWith("en_to_ja")
      ? "en_to_ja"
      : method?.startsWith("ja_to_en")
        ? "ja_to_en"
        : null;
  return { subject, content, contents: selectedContents, direction, method, scope: "full" };
}

// 5形式は周回・習得・進捗ゲージのすべてで完全に分離する。
// 出題方向をまたいでまとめない（英→日4択の履歴が日→英4択に混ざらない）。
export function exactStudyMode(selection = {}) {
  const normalized = normalizeStudySelection(selection);
  if (!normalized.method) return null;
  if (normalized.subject !== "english") return `${normalized.subject}_recall`;
  return normalized.method;
}

export function studyPerformanceModes(selection = {}) {
  const mode = exactStudyMode(selection);
  return mode ? [mode] : [];
}

export function normalizeRecentStudyConfig(config = {}) {
  const selection = normalizeStudySelection({
    ...(config.selection ?? {}),
    subject: config.selection?.subject ?? config.subject,
  });
  if (!selection.method || (selection.subject === "english" ? !selection.contents.length : !selection.content)) {
    return null;
  }
  const filters = config.filters ?? {};
  const stringList = (values) => [...new Set(Array.isArray(values) ? values.filter(Boolean).map(String) : [])];
  return {
    subject: selection.subject,
    selection,
    filters: {
      ranges: stringList(filters.ranges),
      importance: stringList(filters.importance),
      types: stringList(filters.types),
      tags: stringList(filters.tags),
      performance: typeof filters.performance === "string" ? filters.performance : "all",
      minimumWrong: Math.max(0, Number(filters.minimumWrong) || 0),
      search: "",
    },
    sortKey: typeof config.sortKey === "string" ? config.sortKey : "importance-desc",
    count: "all",
    itemIds: null,
  };
}

export function studyCombinationKey(selection) {
  const normalized = normalizeStudySelection(selection);
  const contentKey = normalized.subject === "english"
    ? normalized.contents.length === ENGLISH_CONTENT_TYPES.length
      ? "all"
      : normalized.contents.join("+")
    : normalized.content;
  if (!contentKey || !normalized.method) return null;
  const key = `${contentKey}:${normalized.method}:${normalized.scope}`;
  return normalized.subject === "english" ? key : `${normalized.subject}:${key}`;
}

export function studyCyclePolicy(cycleNumber, explicitPerformance = null) {
  const cycle = Math.max(1, Number(cycleNumber) || 1);
  if (cycle === 1) return { cycle, performance: "all", requiresChoice: false };
  if (cycle === 2) return { cycle, performance: "everMissed", requiresChoice: false };
  return {
    cycle,
    performance: explicitPerformance || null,
    requiresChoice: !explicitPerformance,
  };
}

export function studyModeForItem(item, selection) {
  const normalized = normalizeStudySelection(selection);
  if (!(normalized.content || normalized.contents.length) || !normalized.method) return null;
  if (normalized.subject !== "english") {
    if (item.subject !== normalized.subject) return null;
    const type = item.type === `${normalized.subject}-term` ? "term" : "short";
    if (normalized.content !== "all" && normalized.content !== type) return null;
    const mode = `${normalized.subject}_recall`;
    return item.questionModes.includes(mode) ? mode : null;
  }
  if (item.subject && item.subject !== "english") return null;
  if (!normalized.contents.includes(item.type)) return null;
  return itemSupportsMode(item, normalized.method) ? normalized.method : null;
}

export function buildStudySession({
  items,
  history,
  filters = {},
  selection,
  completedItemIds = [],
  sortKey = "importance-desc",
  count = 15,
  rng = Math.random,
}) {
  const completed = new Set(completedItemIds);
  const performanceModes = studyPerformanceModes(selection);
  const scopedHistory = new Map(
    items.map((item) => [item.id, historyForModes(getHistory(history, item.id), performanceModes)]),
  );
  const candidates = sortItems(
    applyFilters(items, history, { ...filters, modes: [], performanceModes }),
    scopedHistory,
    sortKey,
    rng,
    { randomizeTies: true },
  )
    .map((item) => ({ item, mode: studyModeForItem(item, selection) }))
    .filter((entry) => entry.mode && !completed.has(entry.item.id));
  const limit = count === "all" ? candidates.length : Math.max(0, Number(count));
  return candidates.slice(0, limit);
}

export function summarizeHistory(items, history) {
  const records = items.map((item) => getHistory(history, item.id));
  const attempts = records.reduce((sum, record) => sum + record.totalAttempts, 0);
  const correct = records.reduce((sum, record) => sum + record.correctCount, 0);
  const wrong = records.reduce((sum, record) => sum + record.wrongCount, 0);
  const answeredItems = records.filter((record) => record.totalAttempts > 0).length;
  const weakItems = records.filter((record) => record.hasEverMissed).length;
  const twoCorrectStreakItems = records.filter((record) => record.currentCorrectStreak >= 2).length;
  return {
    attempts,
    correct,
    wrong,
    answeredItems,
    weakItems,
    twoCorrectStreakItems,
    twoCorrectStreakRate: items.length ? twoCorrectStreakItems / items.length : 0,
    accuracy: attempts ? correct / attempts : null,
  };
}

export function summarizeSession(results = []) {
  const total = results.length;
  const correct = results.filter((result) => result.correct).length;
  let streak = 0;
  let bestStreak = 0;
  for (const result of results) {
    streak = result.correct ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
  }
  const durationMs = results.reduce(
    (sum, result) => sum + Math.max(0, Number(result.durationMs ?? 0)),
    0,
  );
  return {
    total,
    correct,
    wrong: total - correct,
    accuracy: total ? correct / total : null,
    uniqueItems: new Set(results.map((result) => result.itemId)).size,
    bestStreak,
    durationMs,
    averageDurationMs: total ? durationMs / total : 0,
  };
}

export function summarizeReviewItems(results = []) {
  const reviewItems = new Map();
  for (const result of results) {
    if (result.correct) continue;
    const current = reviewItems.get(result.itemId);
    reviewItems.set(result.itemId, {
      ...(current ?? result),
      ...result,
      wrongCount: (current?.wrongCount ?? 0) + 1,
    });
  }
  return [...reviewItems.values()];
}

export function visibleReviewItems(results = [], expanded = false, limit = 5) {
  const items = summarizeReviewItems(results);
  const safeLimit = Math.max(0, Number(limit) || 0);
  return {
    items: expanded ? items : items.slice(0, safeLimit),
    total: items.length,
    hasMore: !expanded && items.length > safeLimit,
  };
}

function masteryForRecord(record) {
  if (!record.totalAttempts) return 0;
  const accuracy = accuracyFor(record) ?? 0;
  const repetition = Math.min(record.totalAttempts, 3) / 3;
  const recentResult = record.lastResult === "correct" ? 1 : 0;
  return Math.min(1, accuracy * 0.7 + repetition * 0.2 + recentResult * 0.1);
}

export function summarizeByRange(items, history) {
  const subject = items.find((item) => item.subject)?.subject;
  const ranges = subject === "public"
    ? PUBLIC_RANGE_ORDER
    : subject === "health"
      ? HEALTH_RANGE_ORDER
      : RANGE_ORDER;
  return ranges.map((range) => {
    const rangeItems = items.filter((item) => item.range === range);
    const summary = summarizeHistory(rangeItems, history);
    const mastery = rangeItems.length
      ? rangeItems.reduce(
          (sum, item) => sum + masteryForRecord(getHistory(history, item.id)),
          0,
        ) / rangeItems.length
      : 0;
    return {
      range,
      itemCount: rangeItems.length,
      unansweredItems: rangeItems.length - summary.answeredItems,
      mastery,
      ...summary,
    };
  });
}

export function summarizeByMode(items, history) {
  return ALL_MODES.map((mode) => {
    const supported = items.filter((item) => itemSupportsMode(item, mode));
    const records = supported.map((item) => getHistory(history, item.id).modeStats?.[mode]);
    const attempts = records.reduce((sum, record) => sum + (record?.attempts ?? 0), 0);
    const correct = records.reduce((sum, record) => sum + (record?.correct ?? 0), 0);
    const wrong = records.reduce((sum, record) => sum + (record?.wrong ?? 0), 0);
    const durationMs = records.reduce(
      (sum, record) => sum + (record?.totalAnswerTimeMs ?? 0),
      0,
    );
    return {
      mode,
      label: MODE_LABELS[mode],
      supportedItems: supported.length,
      answeredItems: records.filter((record) => (record?.attempts ?? 0) > 0).length,
      weakItems: records.filter((record) => (record?.wrong ?? 0) > 0).length,
      attempts,
      correct,
      wrong,
      accuracy: attempts ? correct / attempts : null,
      averageDurationMs: attempts ? durationMs / attempts : 0,
    };
  }).filter((stat) => stat.supportedItems > 0);
}

// ---------------------------------------------------------------------------
// 学習ダッシュボード（範囲 → 形式別進捗 → そのまま学習）
// ---------------------------------------------------------------------------

// 新しいダッシュボードで扱う英語の学習形式。旧 spelling_input は含めない。
export const ENGLISH_STUDY_MODES = [
  "en_to_ja_choice",
  "en_to_ja_flashcard",
  "ja_to_en_choice",
  "ja_to_en_flashcard",
  "ja_to_en_input",
];

export const STUDY_DIRECTION_LABELS = {
  en_to_ja: "英語 → 日本語",
  ja_to_en: "日本語 → 英語",
};

export const DASHBOARD_MODE_META = {
  en_to_ja_choice: { title: "4択", detail: "英語を見て、意味を4つから選ぶ" },
  en_to_ja_flashcard: { title: "フラッシュカード", detail: "英語を見て、意味を思い出す" },
  ja_to_en_choice: { title: "4択", detail: "日本語を見て、英語を4つから選ぶ" },
  ja_to_en_flashcard: { title: "フラッシュカード", detail: "日本語を見て、英語を思い出す" },
  ja_to_en_input: { title: "キーボード入力", detail: "日本語を見て、英語を入力する" },
};

const ENGLISH_DASHBOARD_GROUPS = [
  ["en_to_ja", ["en_to_ja_choice", "en_to_ja_flashcard"]],
  ["ja_to_en", ["ja_to_en_choice", "ja_to_en_flashcard", "ja_to_en_input"]],
];

const RECALL_CONTENT_META = {
  term: { title: "語句回答", detail: "用語・人物・制度名などを答える" },
  short: { title: "短文回答", detail: "定義・理由・しくみなどを答える" },
  all: { title: "どっちとも", detail: "語句回答と短文回答をまとめて学習" },
};

// 習得判定は「習得ラウンド／周回」状態から求める（下の周回エンジンを参照）。
// 長期履歴（modeStats）は「一度でも解いたか」だけに使う。
export const MASTERY_CRITERIA = ["first_attempt_in_cycle", "two_consecutive_correct"];
export const DEFAULT_MASTERY_CRITERION = "first_attempt_in_cycle";
export const MASTERY_CRITERION_LABELS = {
  first_attempt_in_cycle: {
    title: "その周回の最初の回答で正解",
    detail: "その周回で最初から正解できた問題を習得とします",
  },
  two_consecutive_correct: {
    title: "2回連続で正解",
    detail: "同じ形式で2回連続正解した問題を習得とします",
  },
};

export function normalizeMasteryCriterion(value) {
  return MASTERY_CRITERIA.includes(value) ? value : DEFAULT_MASTERY_CRITERION;
}

export function evaluateMastery({
  criterion = DEFAULT_MASTERY_CRITERION,
  firstAttemptResult = null,
  consecutiveCorrect = 0,
} = {}) {
  if (normalizeMasteryCriterion(criterion) === "two_consecutive_correct") {
    return (Number(consecutiveCorrect) || 0) >= 2;
  }
  return firstAttemptResult === "correct";
}

export function hasAnsweredMode(record, mode) {
  return (record?.modeStats?.[mode]?.attempts ?? 0) > 0;
}

export function itemsForModeProgress(items = [], {
  ranges = [],
  types = [],
  importance = [],
  mode,
} = {}) {
  const rangeSet = new Set((ranges ?? []).filter(Boolean));
  const typeSet = new Set((types ?? []).filter(Boolean));
  const importanceSet = new Set((importance ?? []).filter(Boolean));
  return items.filter((item) =>
    (!rangeSet.size || rangeSet.has(item.range)) &&
    (!typeSet.size || typeSet.has(item.type)) &&
    (!importanceSet.size || importanceSet.has(item.importance)) &&
    itemSupportsMode(item, mode));
}

export function answeredCountForMode(items, history, mode, options = {}) {
  return itemsForModeProgress(items, { ...options, mode })
    .filter((item) => hasAnsweredMode(getHistory(history, item.id), mode)).length;
}

// 「解答済み」は長期履歴（modeStats）から、「習得」は現在の習得ラウンドの
// masteredIds から数える。前者は基本的に減らず、後者は新ラウンドで0へ戻る。
export function summarizeRangeModeProgress({
  items = [],
  history,
  ranges = [],
  types = [],
  importance = [],
  mode,
  masteredIds = [],
} = {}) {
  const scoped = itemsForModeProgress(items, { ranges, types, importance, mode });
  const rangeList = [...new Set((ranges ?? []).filter(Boolean))];
  const mastered = new Set(masteredIds ?? []);
  let answeredItems = 0;
  let masteredItems = 0;
  scoped.forEach((item) => {
    if (hasAnsweredMode(getHistory(history, item.id), mode)) answeredItems += 1;
    if (mastered.has(item.id)) masteredItems += 1;
  });
  const totalItems = scoped.length;
  return {
    range: rangeList.length === 1 ? rangeList[0] : null,
    ranges: rangeList,
    mode,
    label: MODE_LABELS[mode] ?? mode,
    totalItems,
    answeredItems,
    answeredRate: totalItems ? answeredItems / totalItems : 0,
    masteredItems,
    masteredRate: totalItems ? masteredItems / totalItems : 0,
  };
}

export function progressForRangeAndMode(items, history, range, mode, options = {}) {
  return summarizeRangeModeProgress({
    ...options,
    items,
    history,
    ranges: range ? [range] : [],
    mode,
  });
}

export function summarizeRangeModes({
  items = [],
  history,
  ranges = [],
  types = [],
  modes = ENGLISH_STUDY_MODES,
  masteredIdsByMode = {},
} = {}) {
  return modes.map((mode) => summarizeRangeModeProgress({
    items,
    history,
    ranges,
    types,
    mode,
    masteredIds: masteredIdsByMode[mode] ?? [],
  }));
}

export function studyTargetsForDashboard({ subject = "english", contents = [] } = {}) {
  if (subject === "public" || subject === "health") {
    const available = ["term", "short"].filter((content) => contents.includes(content));
    const list = available.length > 1 ? [...available, "all"] : available;
    return [{
      key: subject,
      direction: null,
      label: "一問一答",
      cards: list.map((content) => ({
        key: `${subject}:${content}`,
        mode: `${subject}_recall`,
        title: RECALL_CONTENT_META[content].title,
        detail: RECALL_CONTENT_META[content].detail,
        types: content === "all"
          ? [`${subject}-term`, `${subject}-short`]
          : [`${subject}-${content}`],
        selection: normalizeStudySelection({ subject, content, method: "recall" }),
      })),
    }];
  }
  return ENGLISH_DASHBOARD_GROUPS.map(([direction, modes]) => ({
    key: direction,
    direction,
    label: STUDY_DIRECTION_LABELS[direction],
    cards: modes.map((mode) => ({
      key: mode,
      mode,
      title: DASHBOARD_MODE_META[mode].title,
      detail: DASHBOARD_MODE_META[mode].detail,
      types: [...ENGLISH_CONTENT_TYPES],
      selection: normalizeStudySelection({
        subject: "english",
        contents: [...ENGLISH_CONTENT_TYPES],
        direction,
        method: mode,
      }),
    })),
  }));
}

export function dashboardStudyCards(options = {}) {
  return studyTargetsForDashboard(options).flatMap((group) => group.cards);
}

// 形式カードを押した時点で「範囲」と「形式」を確定させた学習設定を作る。
// この後のフローで範囲・出題方向・形式を再度たずねてはいけない。
export function studyConfigForTarget({
  target,
  ranges = [],
  filters = {},
  sortKey = "importance-desc",
} = {}) {
  const selection = normalizeStudySelection(target?.selection ?? {});
  const stringList = (values) => [...new Set(Array.isArray(values) ? values.filter(Boolean).map(String) : [])];
  return {
    subject: selection.subject,
    selection,
    filters: {
      ranges: stringList(ranges),
      importance: stringList(filters.importance),
      types: stringList(filters.types),
      tags: stringList(filters.tags),
      performance: typeof filters.performance === "string" ? filters.performance : "all",
      minimumWrong: Math.max(0, Number(filters.minimumWrong) || 0),
      search: "",
    },
    sortKey: typeof sortKey === "string" ? sortKey : "importance-desc",
    count: "all",
    itemIds: null,
  };
}

// ---------------------------------------------------------------------------
// 習得ラウンドと周回（回答状況の自動絞り込み）
//
//   A. cycleCorrectIds  … その周回で一度でも正解したか（周回の完了条件）
//   B. masteredIds      … 習得したか（次の周回の対象になるかどうか）
//   C. modeStats        … 過去に一度でも回答したことがあるか（長期履歴）
//
// この3つは別概念。1周目で「×→○」なら A は満たすが B は満たさない。
// ---------------------------------------------------------------------------

const STUDY_PROGRESS_VERSION = 1;

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(String))];
}

function sortedKeyList(values) {
  return uniqueIds(values).sort((left, right) => left.localeCompare(right, "ja"));
}

// 進捗キーに入る学習内容の並び。ボタン側と突き合わせるために使う。
export function studyContentsKey(contents = []) {
  return sortedKeyList(contents).join("+");
}

// 周回状態の単位：教科・範囲・学習内容・正確な形式・対象を変える絞り込み。
// 並び替えは対象集合を変えないのでキーに含めない。
export function studyProgressKey({ subject = null, selection = {}, filters = {} } = {}) {
  const normalized = normalizeStudySelection({
    ...selection,
    subject: selection?.subject ?? subject ?? "english",
  });
  const mode = exactStudyMode(normalized);
  if (!mode) return null;
  const contents = normalized.subject === "english"
    ? sortedKeyList(normalized.contents).join("+")
    : normalized.content ?? "";
  if (!contents) return null;
  return JSON.stringify({
    subject: normalized.subject,
    ranges: sortedKeyList(filters.ranges),
    contents,
    mode,
    importance: sortedKeyList(filters.importance),
    types: sortedKeyList(filters.types),
    tags: sortedKeyList(filters.tags),
    minimumWrong: Math.max(0, Number(filters.minimumWrong) || 0),
  });
}

export function createStudyProgress({
  key = null,
  itemIds = [],
  criterion = DEFAULT_MASTERY_CRITERION,
  masteryRound = 1,
  now = Date.now(),
} = {}) {
  const pool = uniqueIds(itemIds);
  return {
    version: STUDY_PROGRESS_VERSION,
    key,
    criterion: normalizeMasteryCriterion(criterion),
    masteryRound: Math.max(1, Number(masteryRound) || 1),
    cycleNumber: 1,
    roundItemIds: pool,
    cycleTargetIds: [...pool],
    cycleSeenIds: [],
    cycleCorrectIds: [],
    firstAttemptResults: {},
    masteredIds: [],
    consecutiveCorrect: {},
    pendingReviews: [],
    lastUpdatedAt: now,
  };
}

export function cloneStudyProgress(progress) {
  if (!progress) return null;
  return {
    ...progress,
    roundItemIds: [...progress.roundItemIds],
    cycleTargetIds: [...progress.cycleTargetIds],
    cycleSeenIds: [...progress.cycleSeenIds],
    cycleCorrectIds: [...progress.cycleCorrectIds],
    firstAttemptResults: { ...progress.firstAttemptResults },
    masteredIds: [...progress.masteredIds],
    consecutiveCorrect: { ...progress.consecutiveCorrect },
    pendingReviews: progress.pendingReviews.map((review) => ({ ...review })),
  };
}

// 保存済み状態を読み直す。教材更新で消えたIDは安全に除外し、
// 習得条件が変わっていた場合は null を返して新しいラウンドから始めさせる。
export function normalizeStudyProgress(raw, { itemIds = null, criterion = null } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const storedCriterion = normalizeMasteryCriterion(raw.criterion);
  if (criterion && normalizeMasteryCriterion(criterion) !== storedCriterion) return null;
  const pool = itemIds ? new Set(uniqueIds(itemIds)) : null;
  const keep = (values) => uniqueIds(values).filter((id) => !pool || pool.has(id));
  const roundItemIds = keep(raw.roundItemIds);
  const cycleTargetIds = keep(raw.cycleTargetIds);
  if (!cycleTargetIds.length) return null;
  const targetSet = new Set(cycleTargetIds);
  const roundSet = new Set(roundItemIds.length ? roundItemIds : cycleTargetIds);
  const firstAttemptResults = {};
  Object.entries(raw.firstAttemptResults ?? {}).forEach(([itemId, value]) => {
    if (targetSet.has(itemId) && (value === "correct" || value === "wrong")) {
      firstAttemptResults[itemId] = value;
    }
  });
  const consecutiveCorrect = {};
  Object.entries(raw.consecutiveCorrect ?? {}).forEach(([itemId, value]) => {
    const count = Math.max(0, Math.floor(Number(value) || 0));
    if (roundSet.has(itemId) && count > 0) consecutiveCorrect[itemId] = count;
  });
  const pendingReviews = (Array.isArray(raw.pendingReviews) ? raw.pendingReviews : [])
    .map((review) => ({ itemId: String(review?.itemId ?? ""), dueAt: Math.max(0, Number(review?.dueAt) || 0) }))
    .filter((review) => review.dueAt && targetSet.has(review.itemId))
    .sort((left, right) => left.dueAt - right.dueAt);
  return {
    version: STUDY_PROGRESS_VERSION,
    key: typeof raw.key === "string" ? raw.key : null,
    criterion: storedCriterion,
    masteryRound: Math.max(1, Number(raw.masteryRound) || 1),
    cycleNumber: Math.max(1, Number(raw.cycleNumber) || 1),
    roundItemIds: roundItemIds.length ? roundItemIds : [...cycleTargetIds],
    cycleTargetIds,
    cycleSeenIds: keep(raw.cycleSeenIds).filter((id) => targetSet.has(id)),
    cycleCorrectIds: keep(raw.cycleCorrectIds).filter((id) => targetSet.has(id)),
    firstAttemptResults,
    masteredIds: keep(raw.masteredIds).filter((id) => roundSet.has(id)),
    consecutiveCorrect,
    pendingReviews,
    lastUpdatedAt: Math.max(0, Number(raw.lastUpdatedAt) || 0),
  };
}

// 途中再開の対象：今回の周回の対象のうち、まだこの周回で正解していない問題。
// 3分後・1時間後の再出題待ちも「まだ正解していない」ので自然に含まれる。
export function pendingCycleItemIds(progress) {
  const done = new Set(progress?.cycleCorrectIds ?? []);
  return (progress?.cycleTargetIds ?? []).filter((itemId) => !done.has(itemId));
}

export function isCycleComplete(progress) {
  if (!progress) return false;
  return pendingCycleItemIds(progress).length === 0 && !(progress.pendingReviews ?? []).length;
}

export function isMasteredInRound(progress, itemId) {
  return Boolean(progress?.masteredIds?.includes(itemId));
}

export function applyStudyAnswer(progress, {
  itemId,
  correct,
  reviewDueAt = null,
  now = Date.now(),
} = {}) {
  const next = cloneStudyProgress(progress);
  if (!next || !next.cycleTargetIds.includes(itemId)) return next;
  if (!next.cycleSeenIds.includes(itemId)) next.cycleSeenIds.push(itemId);
  if (!(itemId in next.firstAttemptResults)) {
    next.firstAttemptResults[itemId] = correct ? "correct" : "wrong";
  }
  const streak = correct ? (next.consecutiveCorrect[itemId] ?? 0) + 1 : 0;
  if (streak) next.consecutiveCorrect[itemId] = streak;
  else delete next.consecutiveCorrect[itemId];
  if (correct && !next.cycleCorrectIds.includes(itemId)) next.cycleCorrectIds.push(itemId);
  next.pendingReviews = next.pendingReviews.filter((review) => review.itemId !== itemId);
  if (reviewDueAt) next.pendingReviews.push({ itemId, dueAt: reviewDueAt });
  next.pendingReviews.sort((left, right) => left.dueAt - right.dueAt);
  const mastered = evaluateMastery({
    criterion: next.criterion,
    firstAttemptResult: next.firstAttemptResults[itemId],
    consecutiveCorrect: streak,
  });
  if (mastered && !next.masteredIds.includes(itemId)) next.masteredIds.push(itemId);
  next.lastUpdatedAt = now;
  return next;
}

// 周回が完了したら次の周回へ。全部習得していたら新しい習得ラウンドを始める。
// 長期履歴には触れず、周回・習得状態だけを作り直す。
export function advanceStudyProgress(progress, { roundItemIds = null, now = Date.now() } = {}) {
  if (!progress) return null;
  if (!isCycleComplete(progress)) return cloneStudyProgress(progress);
  const mastered = new Set(progress.masteredIds);
  const remaining = progress.cycleTargetIds.filter((itemId) => !mastered.has(itemId));
  if (remaining.length) {
    const next = cloneStudyProgress(progress);
    next.cycleNumber += 1;
    next.cycleTargetIds = remaining;
    next.cycleSeenIds = [];
    next.cycleCorrectIds = [];
    next.firstAttemptResults = {};
    next.pendingReviews = [];
    next.lastUpdatedAt = now;
    return next;
  }
  return createStudyProgress({
    key: progress.key,
    itemIds: uniqueIds(roundItemIds ?? progress.roundItemIds),
    criterion: progress.criterion,
    masteryRound: progress.masteryRound + 1,
    now,
  });
}

export function studyProgressSummary(progress) {
  if (!progress) return null;
  const pending = pendingCycleItemIds(progress);
  return {
    masteryRound: progress.masteryRound,
    cycleNumber: progress.cycleNumber,
    criterion: progress.criterion,
    targetCount: progress.cycleTargetIds.length,
    seenCount: progress.cycleSeenIds.length,
    correctCount: progress.cycleCorrectIds.length,
    remainingCount: pending.length,
    masteredCount: progress.masteredIds.length,
    roundItemCount: progress.roundItemIds.length,
    complete: pending.length === 0 && !progress.pendingReviews.length,
  };
}


export function parseStudyProgressKey(key) {
  try {
    const meta = JSON.parse(key);
    return meta && typeof meta === "object" && meta.mode ? meta : null;
  } catch {
    return null;
  }
}

// 保存済みの周回状態から、形式（と必要なら範囲・絞り込み）が一致するものを新しい順に集める。
// contents（学習内容）だけは一致を求めない：カードを押した時点ではまだ選んでいないため。
export function studyProgressEntriesForMode(progressMap = {}, {
  mode,
  ranges = null,
  filters = null,
  criterion = null,
} = {}) {
  const wantedRanges = ranges ? sortedKeyList(ranges).join("|") : null;
  const wantedCriterion = criterion ? normalizeMasteryCriterion(criterion) : null;
  const conditionOf = (source) => JSON.stringify({
    importance: sortedKeyList(source?.importance),
    types: sortedKeyList(source?.types),
    tags: sortedKeyList(source?.tags),
    minimumWrong: Math.max(0, Number(source?.minimumWrong) || 0),
  });
  const wantedCondition = filters ? conditionOf(filters) : null;
  return Object.entries(progressMap ?? {})
    .map(([key, progress]) => ({ key, meta: parseStudyProgressKey(key), progress }))
    .filter(({ meta, progress }) => Boolean(meta) && Boolean(progress)
      && meta.mode === mode
      && (!wantedCriterion || normalizeMasteryCriterion(progress.criterion) === wantedCriterion)
      && (wantedRanges === null || sortedKeyList(meta.ranges).join("|") === wantedRanges)
      && (wantedCondition === null || conditionOf(meta) === wantedCondition))
    .sort((left, right) => (right.progress.lastUpdatedAt ?? 0) - (left.progress.lastUpdatedAt ?? 0));
}

// 学習途中の周回：この周回で1問以上進めていて、まだ残りがある状態。
// 始めただけ（1問も解いていない）や、周回を終えた状態は「途中」に含めない。
export function isStudyInProgress(progress) {
  if (!progress) return false;
  const started = (progress.cycleSeenIds ?? []).length > 0
    || (progress.pendingReviews ?? []).length > 0;
  if (!started) return false;
  return !isCycleComplete(progress);
}

// 学習途中の周回を、最後に学習した順で返す。キーは解析済みの meta として添える。
export function inProgressStudyEntries(progressMap = {}, {
  subject = null,
  criterion = null,
} = {}) {
  const wantedCriterion = criterion ? normalizeMasteryCriterion(criterion) : null;
  return Object.entries(progressMap ?? {})
    .map(([key, progress]) => ({ key, meta: parseStudyProgressKey(key), progress }))
    .filter(({ meta, progress }) => Boolean(meta) && isStudyInProgress(progress)
      && (!subject || meta.subject === subject)
      && (!wantedCriterion || normalizeMasteryCriterion(progress.criterion) === wantedCriterion))
    .sort((left, right) => (right.progress.lastUpdatedAt ?? 0) - (left.progress.lastUpdatedAt ?? 0));
}

// 進捗ゲージの「習得」は、その形式で現在の習得ラウンド中に習得した語句の合計。
// 学習内容の組み合わせが違っても同じ形式なら合算する（範囲は集計側で絞り込まれる）。
export function masteredIdsForMode(progressMap = {}, mode, { criterion = null } = {}) {
  const ids = new Set();
  studyProgressEntriesForMode(progressMap, { mode, criterion }).forEach(({ progress }) => {
    (progress.masteredIds ?? []).forEach((itemId) => ids.add(itemId));
  });
  return [...ids];
}
