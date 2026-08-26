export const IMPORTANCE_ORDER = ["SSS", "SS", "S", "A", "B", "C", "D"];
export const DIFFICULTY_ORDER = ["4級", "3級", "準2級", "2級", "準1級", "1級", "専門"];
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
  "p.66–67",
  "p.70–73",
  "p.76–77",
];

export const MODE_LABELS = {
  en_to_ja_choice: "英語 → 日本語 4択",
  ja_to_en_choice: "日本語 → 英語 4択",
  ja_to_en_input: "日本語 → 英語 入力",
  spelling_input: "スペル完全入力",
  preposition_input: "前置詞穴埋め",
  phrase_blank_input: "熟語・構文穴埋め",
  public_recall: "公共 一問一答",
};

export const TYPE_LABELS = {
  word: "単語",
  phrase: "熟語",
  structure: "構文",
  expression: "表現",
  "public-term": "語句回答",
  "public-short": "短文回答",
};

export const ALL_MODES = Object.keys(MODE_LABELS);
export const UNKNOWN_CHOICE = "わからない";
export const WRONG_REVIEW_DELAY_MS = 3 * 60 * 1000;

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
  en_to_ja_choice: "英語 → 日本語 4択",
  write: "日本語 → 英語 記述",
  recall: "答えを表示して自己採点",
};

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
  const difficultyIndex = (item) => DIFFICULTY_ORDER.indexOf(item.difficulty);
  const rangeIndex = (item) => {
    const order = item.subject === "public" ? PUBLIC_RANGE_ORDER : RANGE_ORDER;
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
    return result || registrationIndex(a) - registrationIndex(b);
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
  const eligible = (candidate) =>
    candidate.id !== item.id &&
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
      return {
        ...base,
        prompt: item.publicQuestion ?? item.english,
        answer: item.publicAnswer ?? item.japanese,
        instruction: "問題を確認し、画面をタップして答えを表示してください",
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

export function normalizeStudySelection(selection = {}) {
  const subject = selection.subject === "public" ? "public" : "english";
  const contentOptions = subject === "public"
    ? ["term", "short", "all"]
    : ["word", "phrase", "structure", "all"];
  const methodOptions = subject === "public"
    ? ["recall"]
    : ["ja_to_en_choice", "en_to_ja_choice", "write"];
  const content = contentOptions.includes(selection.content) ? selection.content : null;
  const method = methodOptions.includes(selection.method) ? selection.method : null;
  const scope = method === "write" && content !== "word"
    ? selection.scope === "partial" ? "partial" : "full"
    : "full";
  return { subject, content, method, scope };
}

export function studyCombinationKey(selection) {
  const normalized = normalizeStudySelection(selection);
  if (!normalized.content || !normalized.method) return null;
  const key = `${normalized.content}:${normalized.method}:${normalized.scope}`;
  return normalized.subject === "public" ? `public:${key}` : key;
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
  if (!normalized.content || !normalized.method) return null;
  if (normalized.subject === "public") {
    if (item.subject !== "public") return null;
    const type = item.type === "public-term" ? "term" : "short";
    if (normalized.content !== "all" && normalized.content !== type) return null;
    return item.questionModes.includes("public_recall") ? "public_recall" : null;
  }
  if (item.subject === "public") return null;
  const isWord = item.type === "word";
  if (normalized.content !== "all" && item.type !== normalized.content) return null;
  if (normalized.method === "ja_to_en_choice") {
    return item.questionModes.includes("ja_to_en_choice") ? "ja_to_en_choice" : null;
  }
  if (normalized.method === "en_to_ja_choice") {
    return item.questionModes.includes("en_to_ja_choice") ? "en_to_ja_choice" : null;
  }
  if (isWord) {
    return item.questionModes.includes("spelling_input") ? "spelling_input" : null;
  }
  const mode = normalized.scope === "partial" ? "phrase_blank_input" : "ja_to_en_input";
  return item.questionModes.includes(mode) ? mode : null;
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
  const candidates = sortItems(
    applyFilters(items, history, { ...filters, modes: [] }),
    history,
    sortKey,
    rng,
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

function masteryForRecord(record) {
  if (!record.totalAttempts) return 0;
  const accuracy = accuracyFor(record) ?? 0;
  const repetition = Math.min(record.totalAttempts, 3) / 3;
  const recentResult = record.lastResult === "correct" ? 1 : 0;
  return Math.min(1, accuracy * 0.7 + repetition * 0.2 + recentResult * 0.1);
}

export function summarizeByRange(items, history) {
  const ranges = items.some((item) => item.subject === "public")
    ? PUBLIC_RANGE_ORDER
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
    const supported = items.filter((item) => item.questionModes.includes(mode));
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
