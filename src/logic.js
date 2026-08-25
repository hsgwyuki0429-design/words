export const IMPORTANCE_ORDER = ["SSS", "SS", "S", "A", "B"];
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

export const MODE_LABELS = {
  en_to_ja_choice: "英語 → 日本語 4択",
  ja_to_en_choice: "日本語 → 英語 4択",
  ja_to_en_input: "日本語 → 英語 入力",
  spelling_input: "スペル完全入力",
  preposition_input: "前置詞穴埋め",
  phrase_blank_input: "熟語・構文穴埋め",
};

export const TYPE_LABELS = {
  word: "単語",
  phrase: "熟語",
  structure: "構文",
  expression: "表現",
};

export const ALL_MODES = Object.keys(MODE_LABELS);

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
  return acceptedAnswers.some((answer) => normalizeAnswer(answer) === normalized);
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

export function tokenizeAnswer(answer) {
  return (
    String(answer ?? "")
      .replace(/(?:\.{3}|…+|～+)/g, " ")
      .match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g) ?? []
  );
}

export function slotTokensForQuestion(item, mode) {
  return tokenizeAnswer(answersForMode(item, mode)[0] ?? "");
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

export function difficultyScore(record, importance = "B") {
  const importanceWeight = 5 - Math.max(0, IMPORTANCE_ORDER.indexOf(importance));
  const accuracy = accuracyFor(record) ?? 0.5;
  const unseenBoost = record.totalAttempts === 0 ? 2 : 0;
  return record.wrongCount * 5 + (1 - accuracy) * 20 + importanceWeight + unseenBoost;
}

function includesSearch(item, query) {
  const normalized = String(query ?? "").trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [
    item.english,
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
  const tags = new Set(filters.tags ?? []);
  const minimumWrong = Number(filters.minimumWrong ?? 0);

  return items.filter((item) => {
    const record = getHistory(history, item.id);
    if (ranges.size && !ranges.has(item.range)) return false;
    if (importance.size && !importance.has(item.importance)) return false;
    if (types.size && !types.has(item.type)) return false;
    if (modes.size && !item.questionModes.some((mode) => modes.has(mode))) {
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

export function sortItems(items, history, sortKey = "importance-desc", rng = Math.random) {
  if (sortKey === "random") return shuffle(items, rng);
  const sorted = [...items];
  const importanceIndex = (item) => IMPORTANCE_ORDER.indexOf(item.importance);
  const rangeIndex = (item) => RANGE_ORDER.indexOf(item.range);
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
        result = a.order - b.order;
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
      case "importance-desc":
      default:
        result = importanceIndex(a) - importanceIndex(b);
        break;
    }
    return result || a.order - b.order;
  });
  return sorted;
}

export function generateChoices(item, mode, pool, rng = Math.random) {
  const englishMode = mode === "ja_to_en_choice";
  const displayAnswer = (candidate) =>
    englishMode ? candidate.english : candidate.japanese;
  const correct = displayAnswer(item);

  const candidates = shuffle(
    pool.filter((candidate) => candidate.id !== item.id),
    rng,
  )
    .map((candidate) => {
      const wordDifference = Math.abs(
        tokenizeAnswer(candidate.english).length - tokenizeAnswer(item.english).length,
      );
      const score =
        (candidate.type === item.type ? 5 : 0) +
        (candidate.range === item.range ? 3 : 0) +
        (candidate.importance === item.importance ? 2 : 0) +
        Math.max(0, 2 - wordDifference);
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score);

  const seen = new Set([normalizeAnswer(correct)]);
  const distractors = [];
  for (const { candidate } of candidates) {
    const value = displayAnswer(candidate);
    const key = normalizeAnswer(value);
    if (!seen.has(key)) {
      seen.add(key);
      distractors.push(value);
    }
    if (distractors.length === 3) break;
  }
  return shuffle([correct, ...distractors], rng);
}

export function buildQuestion(item, mode, pool, rng = Math.random) {
  const base = {
    item,
    mode,
    label: MODE_LABELS[mode],
    acceptedAnswers: answersForMode(item, mode),
  };
  switch (mode) {
    case "en_to_ja_choice":
      return {
        ...base,
        prompt: item.english,
        instruction: "最も近い日本語を選んでください",
        choices: generateChoices(item, mode, pool, rng),
        correctChoice: item.japanese,
      };
    case "ja_to_en_choice":
      return {
        ...base,
        prompt: item.japanese,
        instruction: "正しい英語を選んでください",
        choices: generateChoices(item, mode, pool, rng),
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
        instruction: "熟語・構文の空欄を完全入力してください",
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
        instruction: "英語を語順どおり完全入力してください",
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
  ).filter((item) => item.questionModes.some((mode) => modes.includes(mode)));
  const limit = count === "all" ? candidates.length : Math.max(0, Number(count));
  const chosen = candidates.slice(0, limit);
  const usage = new Map(modes.map((mode) => [mode, 0]));

  return chosen.map((item) => {
    const supported = item.questionModes.filter((mode) => modes.includes(mode));
    const leastUsed = Math.min(...supported.map((mode) => usage.get(mode) ?? 0));
    const balanced = supported.filter((mode) => (usage.get(mode) ?? 0) === leastUsed);
    const mode = balanced[Math.floor(rng() * balanced.length)];
    usage.set(mode, (usage.get(mode) ?? 0) + 1);
    return { item, mode };
  });
}

export function summarizeHistory(items, history) {
  const records = items.map((item) => getHistory(history, item.id));
  const attempts = records.reduce((sum, record) => sum + record.totalAttempts, 0);
  const correct = records.reduce((sum, record) => sum + record.correctCount, 0);
  const wrong = records.reduce((sum, record) => sum + record.wrongCount, 0);
  const answeredItems = records.filter((record) => record.totalAttempts > 0).length;
  const weakItems = records.filter((record) => record.hasEverMissed).length;
  return {
    attempts,
    correct,
    wrong,
    answeredItems,
    weakItems,
    accuracy: attempts ? correct / attempts : null,
  };
}
