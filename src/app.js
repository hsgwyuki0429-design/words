import {
  ALL_MODES,
  ENGLISH_CONTENT_TYPES,
  HEALTH_RANGE_ORDER,
  IMPORTANCE_ORDER,
  MODE_LABELS,
  PUBLIC_RANGE_ORDER,
  RANGE_ORDER,
  TYPE_LABELS,
  UNKNOWN_CHOICE,
  WRONG_REVIEW_DELAY_MS,
  ONE_HOUR_REVIEW_DELAY_MS,
  STUDY_CONTENT_LABELS,
  STUDY_METHOD_LABELS,
  addRecentStudy,
  accuracyFor,
  answersForMode,
  applyFilters,
  buildQuestion,
  buildSession,
  buildStudySession,
  getHistory,
  generateLetterChoices,
  historyForModes,
  isAnswerCorrect,
  normalizeAnswer,
  reviewDelayForAnswer,
  slotTokensForQuestion,
  sortItems,
  normalizeStudySelection,
  normalizeRecentStudies,
  recentStudyConfigKey,
  releaseDeferredReviews,
  studyCombinationKey,
  studyModeForItem,
  studyPerformanceModes,
  spellingLetters,
  summarizeByMode,
  summarizeByRange,
  summarizeHistory,
  summarizeSession,
} from "./logic.js?v=2026.2.16";
import { clearAllData, getMeta, loadHistory, recordAttempt, setMeta } from "./storage.js";

const DEFAULT_SETTINGS = {
  effectsMode: null,
  sound: false,
  vibration: true,
  particles: true,
  shake: true,
  showSources: true,
};

const state = {
  items: [],
  englishItems: [],
  publicItems: [],
  healthItems: [],
  subject: null,
  selectedPeriod: null,
  history: new Map(),
  view: "period",
  selectedMode: null,
  studySelection: { subject: "english", content: null, contents: [], direction: null, method: null, scope: "full" },
  progress: new Map(),
  filters: {
    ranges: [],
    importance: [],
    types: [],
    tags: [],
    performance: "all",
    minimumWrong: 0,
    search: "",
  },
  sortKey: "importance-desc",
  listSortKey: "importance-desc",
  listLimit: 60,
  session: null,
  settings: { ...DEFAULT_SETTINGS },
  combo: 0,
  bestCombo: 0,
  activeStudy: null,
  recentStudies: [],
  importanceFilterMode: null,
  rangeSelectionMode: null,
  contentSelectionMode: null,
};

const elements = Object.fromEntries(
  [
    "app-shell",
    "app-header",
    "header-status",
    "greeting",
    "home-title",
    "home-copy",
    "resume-study-card",
    "recent-study-section",
    "recent-study-list",
    "study-content-heading",
    "study-content-copy",
    "study-content-options",
    "confirm-study-content",
    "study-content-action-copy",
    "study-method-heading",
    "study-method-copy",
    "study-method-options",
    "study-scope-options",
    "study-range-options",
    "confirm-study-ranges",
    "study-range-action-copy",
    "study-importance-kind-options",
    "study-importance-options",
    "confirm-study-importance",
    "study-performance-options",
    "study-performance-copy",
    "study-sort-kind-options",
    "study-sort-other-options",
    "list-search",
    "list-sort",
    "list-count",
    "list-eyebrow",
    "list-title",
    "nav-list-button",
    "nav-list-label",
    "word-list",
    "load-more",
    "quiz-content",
    "analysis-content",
    "settings-content",
    "bottom-nav",
    "effects-canvas",
    "fx-backdrop",
    "fx-vignette",
    "fx-invert",
    "fx-flash",
    "max-callout",
    "onboarding",
    "filter-backdrop",
    "filter-sheet",
    "filter-form",
    "filter-ranges",
    "filter-importance",
    "filter-types",
    "filter-performance",
    "filter-performance-fieldset",
    "filter-minimum-wrong",
    "filter-tags",
    "filter-preview-count",
    "toast",
  ].map((id) => [
    id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
    document.getElementById(id),
  ]),
);

const PERFORMANCE_LABELS = {
  all: "全部",
  unanswered: "未回答",
  answered: "回答済み",
  everCorrect: "正解したことがある",
  everMissed: "間違えたことのある",
  neverMissed: "間違えたことがない",
  lastCorrect: "最後に正解",
  lastWrong: "最後に不正解",
  accuracyUnder50: "正答率50%未満",
  accuracyUnder70: "正答率70%未満",
  accuracyUnder80: "正答率80%未満",
  accuracyAtLeast90: "正答率90%以上",
};

const OTHER_SORT_OPTIONS = [
  ["random", "ランダム"],
  ["importance-asc", "重要度が低い順"],
  ["wrong-desc", "間違い回数が多い順"],
  ["wrong-asc", "間違い回数が少ない順"],
  ["accuracy-asc", "正答率が低い順"],
  ["accuracy-desc", "正答率が高い順"],
  ["attempts-asc", "回答回数が少ない順"],
  ["attempts-desc", "回答回数が多い順"],
  ["recent-wrong", "最近間違えた順"],
  ["recent-attempted", "最近回答した順"],
  ["oldest-attempted", "古く回答した順"],
  ["range", "範囲順"],
  ["registration", "登録順"],
  ["alpha-en", "A–Z"],
  ["alpha-ja", "あいうえお順"],
];

const STUDY_SORT_LABELS = {
  "importance-desc": "重要度順",
  difficulty: "苦手順",
  ...Object.fromEntries(OTHER_SORT_OPTIONS),
};

const SUBJECT_LABELS = {
  english: "英語",
  public: "公共",
  health: "保健",
};

const MODE_META = {
  en_to_ja_choice: { icon: "英→日", tags: ["4択", "意味"] },
  ja_to_en_choice: { icon: "日→英", tags: ["4択", "英語"] },
  ja_to_en_spelling: { icon: "Aa", tags: ["1文字ずつ4択", "スペル"] },
  en_to_ja_flashcard: { icon: "英→日", tags: ["自己採点", "フラッシュカード"] },
  ja_to_en_flashcard: { icon: "日→英", tags: ["自己採点", "フラッシュカード"] },
  ja_to_en_input: { icon: "日→英", tags: ["完全入力", "語句"] },
  spelling_input: { icon: "Aa", tags: ["完全入力", "スペル"] },
  preposition_input: { icon: "_", tags: ["穴埋め", "前置詞"] },
  phrase_blank_input: { icon: "…", tags: ["穴埋め", "熟語・構文"] },
  public_recall: { icon: "公", tags: ["自己採点", "一問一答"] },
  health_recall: { icon: "保", tags: ["自己採点", "一問一答"] },
};

const ACTIVE_ENGLISH_STUDY_MODES = [
  "en_to_ja_choice",
  "ja_to_en_choice",
  "ja_to_en_spelling",
  "en_to_ja_flashcard",
  "ja_to_en_flashcard",
];

const STUDY_CONTENT_META = {
  word: { icon: "Aa", title: "単語", detail: "英単語を中心に学習", tags: ["単語"] },
  phrase: { icon: "…", title: "熟語", detail: "熟語だけを学習", tags: ["熟語"] },
  structure: { icon: "S V", title: "構文", detail: "構文だけを学習", tags: ["構文"] },
  all: { icon: "＋", title: "すべて", detail: "単語・熟語・構文を続けて学習", tags: ["単語", "熟語", "構文"] },
};

const STUDY_DIRECTION_META = {
  en_to_ja: { icon: "英→日", title: "英語 → 日本語", detail: "英語を見て日本語の意味を答える", tags: ["英語から"] },
  ja_to_en: { icon: "日→英", title: "日本語 → 英語", detail: "日本語を見て対応する英語を答える", tags: ["日本語から"] },
};

const STUDY_FORMAT_META = {
  choice: { icon: "4", title: "4択問題", detail: "4つの候補から正しい答えを選ぶ", tags: ["選択式"] },
  flashcard: { icon: "▣", title: "フラッシュカード", detail: "画面を押して答えを表示し、自分で採点する", tags: ["自己採点"] },
  spelling: { icon: "Aa", title: "スペル1文字ずつ4択", detail: "アルファベットを1文字ずつ選んで単語を完成させる", tags: ["スペル", "選択式"] },
};

const ENGLISH_CONTENT_COMBINATIONS = [
  ["word"],
  ["phrase"],
  ["structure"],
  ["word", "phrase"],
  ["word", "structure"],
  ["phrase", "structure"],
  [...ENGLISH_CONTENT_TYPES],
];

const KNOWN_STUDY_SELECTIONS = [
  ...ENGLISH_CONTENT_COMBINATIONS.flatMap((contents) => [
    { contents, method: "ja_to_en_choice", scope: "full" },
    { contents, method: "en_to_ja_choice", scope: "full" },
    { contents, method: "ja_to_en_flashcard", scope: "full" },
    { contents, method: "en_to_ja_flashcard", scope: "full" },
    ...(contents.includes("word") ? [{ contents, method: "ja_to_en_spelling", scope: "full" }] : []),
  ]),
  { subject: "public", content: "term", method: "recall", scope: "full" },
  { subject: "public", content: "short", method: "recall", scope: "full" },
  { subject: "public", content: "all", method: "recall", scope: "full" },
  { subject: "health", content: "term", method: "recall", scope: "full" },
  { subject: "health", content: "short", method: "recall", scope: "full" },
  { subject: "health", content: "all", method: "recall", scope: "full" },
];

const TAG_LABELS = {
  word: "単語",
  phrase: "熟語",
  structure: "構文",
  expression: "表現",
  preposition: "前置詞",
  spelling: "スペル",
  blank: "穴埋め",
  語句: "語句回答",
  短文: "短文回答",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPercent(value) {
  return value === null || Number.isNaN(value) ? "—" : `${Math.round(value * 100)}%`;
}

function formatSeconds(milliseconds) {
  const seconds = Math.max(0, Math.round(Number(milliseconds ?? 0) / 1000));
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒`;
}

function renderTags(tags = [], limit = 4) {
  return [...new Set(tags)]
    .slice(0, limit)
    .map((tag) => `<span class="item-tag">${escapeHtml(TAG_LABELS[tag] ?? tag)}</span>`)
    .join("");
}

function isPublicSubject() {
  return state.subject === "public";
}

function isHealthSubject() {
  return state.subject === "health";
}

function isRecallSubject() {
  return isPublicSubject() || isHealthSubject();
}

function recallQuestion(item) {
  return item[`${item.subject}Question`] ?? item.recallQuestion ?? item.publicQuestion ?? item.english;
}

function recallAnswer(item) {
  return item[`${item.subject}Answer`] ?? item.recallAnswer ?? item.publicAnswer ?? item.japanese;
}

function currentRangeOrder() {
  if (isPublicSubject()) return PUBLIC_RANGE_ORDER;
  if (isHealthSubject()) return HEALTH_RANGE_ORDER;
  return RANGE_ORDER;
}

function currentImportanceOrder() {
  const available = new Set(state.items.map((item) => item.importance));
  return IMPORTANCE_ORDER.filter((importance) => available.has(importance));
}

function emptyFilters() {
  return {
    ranges: [],
    importance: [],
    types: [],
    tags: [],
    performance: "all",
    minimumWrong: 0,
    search: "",
  };
}

function resetStudyFlow() {
  state.studySelection = {
    subject: isRecallSubject() ? state.subject : "english",
    content: null,
    contents: [],
    direction: null,
    method: null,
    scope: "full",
  };
  state.sortKey = "importance-desc";
  state.filters = emptyFilters();
  state.filters.ranges = [];
  state.importanceFilterMode = null;
  state.rangeSelectionMode = null;
  state.contentSelectionMode = null;
}

function selectSubject(subject) {
  state.subject = ["public", "health"].includes(subject) ? subject : "english";
  state.items = isPublicSubject()
    ? state.publicItems
    : isHealthSubject()
      ? state.healthItems
      : state.englishItems;
  resetStudyFlow();
  elements.listSearch.value = "";
  elements.listSearch.placeholder = isRecallSubject() ? "問題・答えで検索" : "英語・日本語で検索";
  elements.listEyebrow.textContent = isRecallSubject() ? "QUESTION & ANSWER" : "WORD BOOK";
  elements.listTitle.textContent = isRecallSubject() ? "一問一答" : "単語帳";
  elements.navListButton.dataset.viewTarget = isHealthSubject() ? "health-notes" : "list";
  elements.navListLabel.textContent = isHealthSubject()
    ? "まとめノート"
    : isPublicSubject()
      ? "一問一答"
      : "単語帳";
  const levelOption = elements.listSort.querySelector('option[value="difficulty-level-desc"]');
  const englishOption = elements.listSort.querySelector('option[value="alpha-en"]');
  const japaneseOption = elements.listSort.querySelector('option[value="alpha-ja"]');
  levelOption.hidden = isRecallSubject();
  englishOption.textContent = isRecallSubject() ? "問題順" : "A–Z";
  japaneseOption.textContent = isRecallSubject() ? "答え順" : "あいうえお順";
  if (isRecallSubject() && state.listSortKey === "difficulty-level-desc") state.listSortKey = "importance-desc";
  setView("home");
  if (!state.settings.effectsMode) elements.onboarding.hidden = false;
}

function selectionIsComplete(selection = state.studySelection) {
  const normalized = normalizeStudySelection(selection);
  return Boolean(
    normalized.method && (normalized.subject === "english" ? normalized.contents.length : normalized.content),
  );
}

function studyContentLabel(selection = state.studySelection) {
  const normalized = normalizeStudySelection(selection);
  if (normalized.subject !== "english") {
    return normalized.content === "all"
      ? "語句回答＋短文回答"
      : STUDY_CONTENT_LABELS[normalized.content] ?? "教材";
  }
  if (normalized.contents.length === ENGLISH_CONTENT_TYPES.length) return STUDY_CONTENT_LABELS.all;
  return normalized.contents.map((content) => STUDY_CONTENT_LABELS[content]).join("＋") || "教材";
}

function studySelectionLabel(selection = state.studySelection) {
  const normalized = normalizeStudySelection(selection);
  if (!selectionIsComplete(normalized)) return "—";
  if (normalized.subject !== "english") {
    return `${studyContentLabel(normalized)} / 答えを表示して自己採点`;
  }
  const parts = [
    studyContentLabel(normalized),
    STUDY_METHOD_LABELS[normalized.method],
  ];
  return parts.join(" / ");
}

function recentStudyRangeLabel(config) {
  const ranges = config.filters?.ranges ?? [];
  const allRanges = config.subject === "public"
    ? PUBLIC_RANGE_ORDER
    : config.subject === "health"
      ? HEALTH_RANGE_ORDER
      : RANGE_ORDER;
  if (!ranges.length || allRanges.every((range) => ranges.includes(range))) return "全範囲";
  if (ranges.length <= 2) return ranges.join("・");
  return `${ranges.slice(0, 2).join("・")}＋ほか${ranges.length - 2}`;
}

function recentStudyTimeLabel(lastUsedAt) {
  if (!lastUsedAt) return "前回";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(lastUsedAt));
}

function renderRecentStudies() {
  const entries = state.recentStudies.slice(0, 4);
  elements.recentStudySection.hidden = entries.length === 0;
  if (!entries.length) {
    elements.recentStudyList.innerHTML = "";
    return;
  }
  elements.recentStudyList.innerHTML = entries.map((entry, index) => {
    const config = entry.config;
    const resumesActiveStudy = Boolean(
      state.activeStudy
      && recentStudyConfigKey(state.activeStudy.config) === recentStudyConfigKey(config),
    );
    const importance = config.filters.importance.length
      ? `重要度：${config.filters.importance.join("・")}`
      : "重要度：全部";
    const performance = `回答：${PERFORMANCE_LABELS[config.filters.performance] ?? "全部"}`;
    const sort = STUDY_SORT_LABELS[config.sortKey] ?? "選択した順番";
    return `
      <button class="recent-study-button subject-${escapeHtml(config.subject)}" type="button" data-recent-study-index="${index}">
        <span class="recent-study-meta">
          <span class="recent-subject">${escapeHtml(SUBJECT_LABELS[config.subject] ?? "英語")}</span>
          <time>${escapeHtml(recentStudyTimeLabel(entry.lastUsedAt))}</time>
        </span>
        <strong>${escapeHtml(studyContentLabel(config.selection))}</strong>
        <span class="recent-study-method">${escapeHtml(STUDY_METHOD_LABELS[config.selection.method])}</span>
        <small>${escapeHtml([recentStudyRangeLabel(config), importance, performance, sort].join(" · "))}</small>
        <span class="recent-study-action">${resumesActiveStudy
          ? `途中から再開（${Number(state.activeStudy.answeredCount) || 0} / ${Number(state.activeStudy.totalCount) || 0}問）`
          : "この条件で始める"} <span aria-hidden="true">→</span></span>
      </button>`;
  }).join("");
}

function progressForSelection(selection = state.studySelection) {
  const key = studyCombinationKey(selection);
  return key ? state.progress.get(key) ?? { completedItemIds: [] } : { completedItemIds: [] };
}

function selectionCard({ icon, title, detail, tags, dataAttribute }) {
  return `
    <button class="selection-card" type="button" ${dataAttribute}>
      <span class="selection-card-icon" aria-hidden="true">${escapeHtml(icon)}</span>
      <span class="selection-card-copy">
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(detail)}</small>
        <span class="item-tags">${renderTags(tags)}</span>
      </span>
      <span class="card-arrow" aria-hidden="true">›</span>
    </button>`;
}

function recallContentMeta() {
  const termCount = state.items.filter((item) => item.answerFormat === "term").length;
  const shortCount = state.items.filter((item) => item.answerFormat === "short").length;
  return {
    term: { icon: "語", title: "語句回答問題", detail: "用語・人物・制度名・年号など", tags: [`${termCount}問`] },
    short: { icon: "文", title: "短文回答問題", detail: "定義・理由・特徴・しくみなど", tags: [`${shortCount}問`] },
    all: { icon: "＋", title: "どっちとも", detail: "語句回答と短文回答をまとめて学習", tags: [`${termCount + shortCount}問`] },
  };
}

function renderStudyContent() {
  elements.studyContentHeading.textContent = isRecallSubject()
    ? "どの問題を学習しますか？"
    : "何を学習しますか？";
  elements.studyContentCopy.textContent = isRecallSubject()
    ? "語句回答、短文回答、または両方から選んでください。"
    : "複数選択できます。すべて学ぶ場合は「全選択」を選んでください。";
  const action = elements.confirmStudyContent.closest(".sticky-action");
  if (isRecallSubject()) {
    action.hidden = true;
    elements.studyContentOptions.className = "selection-grid content-selection-grid";
    elements.studyContentOptions.innerHTML = Object.entries(recallContentMeta())
      .map(([content, meta]) => selectionCard({
        ...meta,
        dataAttribute: `data-study-content="${content}"`,
      }))
      .join("");
    return;
  }

  action.hidden = false;
  elements.studyContentOptions.className = "multi-select-grid content-select-grid";
  const selectedContents = state.studySelection.contents ?? [];
  const allSelected = state.contentSelectionMode === "all";
  const baseItems = applyFilters(state.items, state.history, {
    ...state.filters,
    performance: "all",
    minimumWrong: 0,
    modes: [],
  });
  const allCard = `<button class="multi-select-card select-all-card${allSelected ? " selected" : ""}" type="button" data-study-content-all aria-pressed="${allSelected}">
    <span class="multi-check" aria-hidden="true">${allSelected ? "✓" : ""}</span>
    <span><strong>全選択</strong><small>単語・熟語・構文のすべて（${baseItems.length}語句）</small></span>
  </button>`;
  const contentCards = ENGLISH_CONTENT_TYPES.map((content) => {
    const selected = !allSelected && selectedContents.includes(content);
    const meta = STUDY_CONTENT_META[content];
    const count = baseItems.filter((item) => item.type === content).length;
    return `<button class="multi-select-card${selected ? " selected" : ""}${allSelected ? " disabled-by-all" : ""}" type="button" data-study-content="${content}" aria-pressed="${selected}" ${allSelected ? "disabled aria-disabled=\"true\"" : ""}>
      <span class="multi-check" aria-hidden="true">${selected ? "✓" : ""}</span>
      <span><strong>${escapeHtml(meta.title)}</strong><small>${count}語句</small></span>
    </button>`;
  }).join("");
  elements.studyContentOptions.innerHTML = allCard + contentCards;
  const ready = selectedContents.length > 0;
  elements.confirmStudyContent.disabled = !ready;
  elements.confirmStudyContent.classList.toggle("ready-to-continue", ready);
  elements.confirmStudyContent.innerHTML = `${allSelected ? "すべてを学習して次へ" : "選択した教材で次へ"} <span aria-hidden="true">→</span>`;
  elements.studyContentActionCopy.hidden = !ready;
  elements.studyContentActionCopy.textContent = allSelected
    ? "すべて選択しました。次へ進めます"
    : `${selectedContents.length}種類を選択中。次へ進めます`;
}

function renderStudyMethod() {
  const contentLabel = studyContentLabel();
  elements.studyMethodHeading.textContent = `${contentLabel}の出題方向`;
  elements.studyMethodCopy.textContent = "問題と答えの向きを選んでください。";
  elements.studyMethodOptions.innerHTML = Object.entries(STUDY_DIRECTION_META)
    .map(([direction, meta]) => selectionCard({
      ...meta,
      dataAttribute: `data-study-direction="${direction}"`,
    }))
    .join("");
}

function renderStudyScope() {
  const formats = Object.entries(STUDY_FORMAT_META).filter(([format]) => {
    if (format !== "spelling") return true;
    return state.studySelection.direction === "ja_to_en"
      && state.studySelection.contents?.includes("word");
  });
  elements.studyScopeOptions.innerHTML = formats
    .map(([format, meta]) => selectionCard({
      ...meta,
      dataAttribute: `data-study-format="${format}"`,
    }))
    .join("");
}

function renderStudyRangeSelect() {
  const ranges = currentRangeOrder();
  const allSelected = state.rangeSelectionMode === "all";
  const allCard = `<button class="multi-select-card select-all-card${allSelected ? " selected" : ""}" type="button" data-study-range-all aria-pressed="${allSelected}">
    <span class="multi-check" aria-hidden="true">${allSelected ? "✓" : ""}</span>
    <span><strong>全選択</strong><small>すべての範囲（${state.items.length}${isRecallSubject() ? "問" : "語句"}）</small></span>
  </button>`;
  const rangeCards = ranges.map((range) => {
    const selected = !allSelected && state.filters.ranges.includes(range);
    const count = state.items.filter((item) => item.range === range).length;
    return `<button class="multi-select-card${selected ? " selected" : ""}${allSelected ? " disabled-by-all" : ""}" type="button" data-study-range="${escapeHtml(range)}" aria-pressed="${selected}" ${allSelected ? "disabled aria-disabled=\"true\"" : ""}>
      <span class="multi-check" aria-hidden="true">${selected ? "✓" : ""}</span>
      <span><strong>${escapeHtml(range)}</strong><small>${count}${isRecallSubject() ? "問" : "語句"}</small></span>
    </button>`;
  }).join("");
  elements.studyRangeOptions.innerHTML = allCard + rangeCards;
  const ready = state.filters.ranges.length > 0;
  elements.confirmStudyRanges.disabled = !ready;
  elements.confirmStudyRanges.classList.toggle("ready-to-continue", ready);
  elements.confirmStudyRanges.innerHTML = `${allSelected ? "全範囲で次へ" : "選択した範囲で次へ"} <span aria-hidden="true">→</span>`;
  elements.studyRangeActionCopy.hidden = !ready;
  elements.studyRangeActionCopy.textContent = allSelected
    ? "全範囲を選択しました。次へ進めます"
    : `${state.filters.ranges.length}範囲を選択中。次へ進めます`;
}

function renderStudyImportanceKind() {
  const available = currentImportanceOrder();
  elements.studyImportanceKindOptions.innerHTML = [
    { mode: "all", icon: "∞", title: "重要度全部", detail: `${available[0]}から${available.at(-1)}まですべて学習`, tags: ["すべて"] },
    { mode: "custom", icon: "✓", title: "その他の重要度", detail: "重要度を複数選択", tags: ["複数選択可"] },
  ].map((meta) => selectionCard({
    ...meta,
    dataAttribute: `data-importance-filter-mode="${meta.mode}"`,
  })).join("");
}

function renderStudyImportanceSelect() {
  elements.studyImportanceOptions.innerHTML = currentImportanceOrder().map((importance) => {
    const selected = state.filters.importance.includes(importance);
    const count = learningItems({ ...state.filters, importance: [importance] }).length;
    return `<button class="multi-select-card importance-option${selected ? " selected" : ""}" type="button" data-study-importance="${importance}" aria-pressed="${selected}">
      <span class="multi-check" aria-hidden="true">${selected ? "✓" : ""}</span>
      <span><strong>${importance}</strong><small>${count}${isRecallSubject() ? "問" : "語句"}</small></span>
    </button>`;
  }).join("");
  elements.confirmStudyImportance.disabled = state.filters.importance.length === 0;
}

function performanceBaseItems() {
  return learningItems({ ...state.filters, performance: "all", minimumWrong: 0 });
}

function renderStudyPerformance() {
  const base = performanceBaseItems();
  const performanceModes = studyPerformanceModes(state.studySelection);
  const scopedHistory = (item) => historyForModes(getHistory(state.history, item.id), performanceModes);
  const unanswered = base.filter((item) => scopedHistory(item).totalAttempts === 0).length;
  const missed = base.filter((item) => scopedHistory(item).hasEverMissed).length;
  const answered = base.length - unanswered;
  const formatLabel = isRecallSubject()
    ? "一問一答"
    : state.studySelection.method?.endsWith("_flashcard")
      ? "フラッシュカード"
      : "4択";
  const options = [];
  if (unanswered === 0) {
    options.push(["everMissed", "↺", `${formatLabel}で間違えたことのある`, `${missed}問を復習`]);
    options.push(["all", "∞", "全部", `${base.length}問すべて`]);
  } else if (answered > 0) {
    options.push(["unanswered", "○", `${formatLabel}で未回答`, `${unanswered}問が未回答`]);
    options.push(["all", "∞", "全部", `${base.length}問すべて`]);
    options.push(["everMissed", "↺", `${formatLabel}で間違えたことのある`, `${missed}問を復習`]);
  } else {
    options.push(["all", "∞", "全部", `${base.length}問すべて`]);
    options.push(["unanswered", "○", `${formatLabel}で未回答`, `${unanswered}問が未回答`]);
    options.push(["everMissed", "↺", `${formatLabel}で間違えたことのある`, "学習後に表示されます"]);
  }
  const statusCopy = unanswered === 0
    ? "未回答の問題がないため、復習を先頭にしました。"
    : answered > 0
      ? "続きから始めやすいよう、未回答を先頭にしました。"
      : "今の条件に合う回答状況から選んでください。";
  elements.studyPerformanceCopy.textContent = `${formatLabel}の履歴だけで集計します。${statusCopy}`;
  elements.studyPerformanceOptions.innerHTML = options
    .map(([key, icon, title, detail], index) => selectionCard({
      icon,
      title,
      detail,
      tags: index === 0 ? ["おすすめ"] : [],
      dataAttribute: `data-study-performance="${key}"${key === "everMissed" && missed === 0 ? " disabled aria-disabled=\"true\"" : ""}`,
    }))
    .join("");
}

function renderStudySortKind() {
  elements.studySortKindOptions.innerHTML = [
    { key: "importance-desc", icon: "S", title: "重要度順", detail: "重要度が高い問題から出題", tags: ["おすすめ"] },
    { key: "difficulty", icon: "↘", title: "苦手順", detail: "間違いが多い問題から出題", tags: ["復習"] },
    { key: "random", icon: "⇄", title: "ランダム", detail: "問題を毎回シャッフルして出題", tags: ["シャッフル"] },
    { key: "other", icon: "…", title: "その他", detail: "正答率や範囲順などから選択", tags: ["詳細"] },
  ].map((meta) => selectionCard({
    ...meta,
    dataAttribute: `data-study-sort-kind="${meta.key}"`,
  })).join("");
}

function renderStudySortOther() {
  elements.studySortOtherOptions.innerHTML = OTHER_SORT_OPTIONS.map(([key, label]) => `
    <button class="multi-select-card sort-option" type="button" data-study-sort="${key}">
      <span class="multi-check sort-icon" aria-hidden="true">↕</span>
      <span><strong>${label}</strong><small>この順番で出題</small></span>
    </button>`).join("");
}

function viewBeforeImportanceSelection() {
  if (isRecallSubject()) return "study-content";
  return "study-scope";
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 2400);
}

function isMaxMode() {
  return state.settings.effectsMode === "max";
}

function applySettings() {
  document.body.classList.toggle("max-mode", isMaxMode());
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    isMaxMode() && state.view === "quiz" ? "#090a12" : "#f5f5f7",
  );
  syncMaxAmbience();
}

function saveSettings() {
  applySettings();
  setMeta("settings", state.settings).catch(console.warn);
}

function renderSettings() {
  const toggle = (key, title, detail) => `
    <label class="settings-row">
      <span><strong>${title}</strong><small>${detail}</small></span>
      <span class="switch"><input type="checkbox" data-setting="${key}" ${state.settings[key] ? "checked" : ""}><span aria-hidden="true"></span></span>
    </label>`;
  elements.settingsContent.innerHTML = `
    <section class="settings-card">
      <h2>演出モード</h2><p>問題と正答判定はどちらのモードでも同じです。</p>
      <div class="segmented-options" role="radiogroup" aria-label="演出モード">
        <button type="button" data-effects-mode="simple" class="${isMaxMode() ? "" : "selected"}">SIMPLE</button>
        <button type="button" data-effects-mode="max" class="${isMaxMode() ? "selected" : ""}">MAX</button>
      </div>
    </section>
    <section class="settings-card">
      <h2>MAX MODE</h2><p>端末の負荷と好みに合わせて個別に切り替えられます。</p>
      ${toggle("particles", "パーティクル", "正解時にCanvasの光を表示")}
      ${toggle("shake", "画面シェイク", "コンボ時に画面を短く揺らす")}
      ${toggle("sound", "効果音", "初期設定はオフ")}
      ${toggle("vibration", "振動", "対応端末のみ短く振動")}
    </section>
    <section class="settings-card">
      <h2>学習画面</h2>
      ${toggle("showSources", "出典を表示", "回答後に教材と範囲を表示")}
    </section>
    <section class="settings-card">
      <h2>学習データ</h2><p>正誤履歴、途中位置、設定をこの端末から削除します。</p>
      <button class="secondary-button danger-button" type="button" data-reset-data>学習データを初期化</button>
    </section>`;
}

/* ---------------------------------------------------------------------------
   MAX演出レイヤー
   background : #fx-backdrop（MAX中の背景エネルギー）
   world      : zoom punch / screen shake / invert / flash / vignette
   particles  : #effects-canvas（粒子・衝撃波・スピードライン／単一のrAF）
   ui         : #max-callout / .combo-pill
   --------------------------------------------------------------------------- */

const REDUCED_MOTION_QUERY = matchMedia("(prefers-reduced-motion: reduce)");
const COMBO_INTENSITY_CAP = 12;
const PARTICLE_COLORS = ["#70d7ff", "#ffffff", "#9b7cff", "#ffd86b", "#ff5db1"];

const fx = {
  context: null,
  frame: 0,
  running: false,
  frozen: false,
  previous: 0,
  width: 0,
  height: 0,
  scale: 1,
  needsResize: true,
  particles: [],
  rings: [],
  rays: [],
  timers: [],
  animations: new Set(),
  ambient: false,
};

let audioContext = null;
let calloutTimer = 0;

function prefersReducedMotion() {
  return REDUCED_MOTION_QUERY.matches;
}

function isLowPowerDevice() {
  return (navigator.hardwareConcurrency ?? 8) <= 4;
}

/** "off" = MAX以外, "reduced" = 動きを減らす設定, "full" = 全部入り。 */
function effectsLevel() {
  if (!isMaxMode()) return "off";
  return prefersReducedMotion() ? "reduced" : "full";
}

function canvasEffectsEnabled() {
  return state.settings.particles && effectsLevel() === "full";
}

function shakeEnabled() {
  return state.settings.shake && effectsLevel() === "full";
}

function fxTimeout(callback, delay) {
  const id = setTimeout(() => {
    fx.timers = fx.timers.filter((timer) => timer !== id);
    callback();
  }, delay);
  fx.timers.push(id);
  return id;
}

function clearFxTimers() {
  fx.timers.forEach(clearTimeout);
  fx.timers = [];
}

function fxAnimate(element, keyframes, options) {
  if (!element?.animate) return null;
  let animation = null;
  try {
    animation = element.animate(keyframes, { fill: "none", easing: "ease-out", ...options });
  } catch {
    return null;
  }
  fx.animations.add(animation);
  const forget = () => fx.animations.delete(animation);
  animation.addEventListener("finish", forget, { once: true });
  animation.addEventListener("cancel", forget, { once: true });
  return animation;
}

function cancelFxAnimations() {
  fx.animations.forEach((animation) => animation.cancel());
  fx.animations.clear();
}

function markFxResize() {
  fx.needsResize = true;
}

function ensureFxCanvas() {
  const canvas = elements.effectsCanvas;
  if (!canvas) return null;
  if (!fx.context) fx.context = canvas.getContext("2d", { alpha: true });
  if (!fx.context) return null;
  if (fx.needsResize) {
    fx.scale = Math.min(devicePixelRatio || 1, 2);
    fx.width = innerWidth;
    fx.height = innerHeight;
    canvas.width = Math.round(fx.width * fx.scale);
    canvas.height = Math.round(fx.height * fx.scale);
    fx.context.setTransform(fx.scale, 0, 0, fx.scale, 0, 0);
    fx.needsResize = false;
  }
  return fx.context;
}

function fxOrigin() {
  return { x: fx.width / 2, y: fx.height * 0.42 };
}

function startFxLoop() {
  if (fx.running) return;
  fx.running = true;
  fx.previous = performance.now();
  fx.frame = requestAnimationFrame(stepFx);
}

function stopFxLoop() {
  if (fx.frame) cancelAnimationFrame(fx.frame);
  fx.frame = 0;
  fx.running = false;
}

function stepFx(now) {
  const context = ensureFxCanvas();
  if (!context) {
    stopFxLoop();
    return;
  }
  const elapsed = now - fx.previous;
  fx.previous = now;
  const step = fx.frozen ? 0 : Math.max(0, Math.min(2.2, elapsed / 16.67));
  if (elapsed > 34 && fx.particles.length > 90) {
    fx.particles.length = Math.max(90, Math.ceil(fx.particles.length * 0.7));
  }
  context.clearRect(0, 0, fx.width, fx.height);
  drawRays(context, step);
  drawRings(context, step);
  drawParticles(context, step);
  context.globalAlpha = 1;
  if (fx.particles.length || fx.rings.length || fx.rays.length) {
    fx.frame = requestAnimationFrame(stepFx);
    return;
  }
  context.clearRect(0, 0, fx.width, fx.height);
  fx.frame = 0;
  fx.running = false;
}

function drawParticles(context, step) {
  if (!fx.particles.length) return;
  const alive = [];
  for (const particle of fx.particles) {
    particle.life -= particle.decay * step;
    if (particle.life <= 0) continue;
    particle.x += particle.vx * step;
    particle.y += particle.vy * step;
    particle.vy += particle.gravity * step;
    particle.vx *= 1 - 0.008 * step;
    particle.rotation += particle.spin * step;
    context.globalAlpha = Math.min(1, particle.life * 1.7);
    context.fillStyle = particle.color;
    if (particle.shard) {
      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.fillRect(-particle.size, -particle.size * 0.3, particle.size * 2, particle.size * 0.6);
      context.restore();
    } else {
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      context.fill();
    }
    alive.push(particle);
  }
  fx.particles = alive;
}

function drawRings(context, step) {
  if (!fx.rings.length) return;
  const alive = [];
  for (const ring of fx.rings) {
    ring.life -= ring.decay * step;
    if (ring.life <= 0) continue;
    ring.radius = Math.max(0, ring.radius + ring.speed * step);
    ring.speed *= 1 - 0.055 * step;
    context.globalAlpha = Math.max(0, ring.life) * ring.alpha;
    context.lineWidth = Math.max(0.6, ring.width * ring.life);
    context.strokeStyle = ring.color;
    context.beginPath();
    context.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    context.stroke();
    alive.push(ring);
  }
  fx.rings = alive;
}

function drawRays(context, step) {
  if (!fx.rays.length) return;
  const alive = [];
  for (const ray of fx.rays) {
    ray.life -= ray.decay * step;
    if (ray.life <= 0) continue;
    ray.distance = Math.max(0, ray.distance + ray.speed * step);
    ray.speed *= 1 - 0.03 * step;
    const cos = Math.cos(ray.angle);
    const sin = Math.sin(ray.angle);
    context.globalAlpha = Math.max(0, ray.life) * 0.5;
    context.strokeStyle = ray.color;
    context.lineWidth = ray.width;
    context.beginPath();
    context.moveTo(ray.x + cos * ray.distance, ray.y + sin * ray.distance);
    context.lineTo(ray.x + cos * (ray.distance + ray.length), ray.y + sin * (ray.distance + ray.length));
    context.stroke();
    alive.push(ray);
  }
  fx.rays = alive;
}

function particleBudget() {
  return isLowPowerDevice() ? 130 : 340;
}

function spawnParticleBurst({ count = 90, power = 1, origin = null, speed = 1, shards = false } = {}) {
  if (!canvasEffectsEnabled()) return;
  const context = ensureFxCanvas();
  if (!context) return;
  const center = origin ?? fxOrigin();
  const total = Math.min(Math.round(count), particleBudget() - fx.particles.length);
  if (total <= 0) return;
  for (let index = 0; index < total; index += 1) {
    const angle = (Math.PI * 2 * index) / total + Math.random() * 0.4;
    const velocity = (1.8 + Math.random() * (4.4 + power)) * speed;
    fx.particles.push({
      x: center.x,
      y: center.y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity - 1.4,
      size: 1.1 + Math.random() * (2.2 + power * 0.7),
      gravity: 0.045 + Math.random() * 0.06,
      decay: 0.015 + Math.random() * 0.018,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.26,
      shard: shards && index % 3 === 0,
      color: PARTICLE_COLORS[index % PARTICLE_COLORS.length],
      life: 1,
    });
  }
  startFxLoop();
}

function triggerShockwave({
  origin = null,
  radius = 8,
  speed = 18,
  width = 9,
  color = "rgba(255,255,255,.92)",
  decay = 0.03,
  alpha = 1,
} = {}) {
  if (!canvasEffectsEnabled()) return;
  const context = ensureFxCanvas();
  if (!context) return;
  if (fx.rings.length > 6) return;
  const center = origin ?? fxOrigin();
  fx.rings.push({ x: center.x, y: center.y, radius, speed, width, color, decay, alpha, life: 1 });
  startFxLoop();
}

function spawnSpeedLines({ origin = null, count = 24, power = 1 } = {}) {
  if (!canvasEffectsEnabled()) return;
  const context = ensureFxCanvas();
  if (!context) return;
  if (fx.rays.length > 60) return;
  const center = origin ?? fxOrigin();
  const total = isLowPowerDevice() ? Math.ceil(count / 2) : count;
  for (let index = 0; index < total; index += 1) {
    const angle = (Math.PI * 2 * index) / total + Math.random() * 0.25;
    fx.rays.push({
      x: center.x,
      y: center.y,
      angle,
      distance: 40 + Math.random() * 90,
      length: 90 + Math.random() * (140 + power * 40),
      speed: 16 + Math.random() * (12 + power * 6),
      width: 1 + Math.random() * 2.2,
      decay: 0.035 + Math.random() * 0.02,
      color: index % 4 === 0 ? "#9b7cff" : "#c9f1ff",
      life: 1,
    });
  }
  startFxLoop();
}

/* --- world layer ---------------------------------------------------------- */

/**
 * transformを載せてよい要素だけを返す。
 * position:fixed の子（.next-button / .public-grade-guide / .bottom-nav）を
 * 内包する要素は含めない（含めると固定配置の基準がずれて回答UIが飛ぶ）。
 */
function worldStageElements() {
  const nodes = [];
  if (state.view === "quiz") {
    const shell = elements.quizContent?.querySelector(".quiz-shell, .result-shell");
    if (shell) nodes.push(shell);
    return nodes;
  }
  const view = document.querySelector(`.view[data-view="${state.view}"]`);
  if (view && !view.hidden) nodes.push(view);
  if (elements.appHeader && !elements.appHeader.hidden) nodes.push(elements.appHeader);
  if (elements.bottomNav && !elements.bottomNav.hidden) nodes.push(elements.bottomNav);
  return nodes;
}

function triggerWorldImpact({ zoom = 0.04, shake = 0, duration = 360 } = {}) {
  if (effectsLevel() !== "full") return;
  const amplitude = shakeEnabled() ? shake : 0;
  if (!zoom && !amplitude) return;
  const jitter = (weight = 1) => (amplitude ? ((Math.random() * 2 - 1) * amplitude * weight).toFixed(1) : "0");
  const frame = (scale, weight) => `translate3d(${jitter(weight)}px, ${jitter(weight)}px, 0) scale(${scale.toFixed(4)})`;
  const keyframes = [
    { transform: "translate3d(0,0,0) scale(1)" },
    { offset: 0.12, transform: frame(1 + zoom, 1) },
    { offset: 0.28, transform: frame(1 - zoom * 0.45, 0.85) },
    { offset: 0.44, transform: frame(1 + zoom * 0.3, 0.55) },
    { offset: 0.62, transform: frame(1 - zoom * 0.12, 0.28) },
    { offset: 0.8, transform: frame(1 + zoom * 0.05, 0.12) },
    { transform: "translate3d(0,0,0) scale(1)" },
  ];
  for (const node of worldStageElements()) {
    fxAnimate(node, keyframes, { duration, easing: "cubic-bezier(.22,.9,.26,1)" });
  }
}

function triggerScreenFlash(strength = 0.9, duration = 300) {
  const level = effectsLevel();
  if (level === "off" || !elements.fxFlash) return;
  const peak = level === "reduced" ? Math.min(0.3, strength * 0.4) : strength;
  fxAnimate(elements.fxFlash, [
    { opacity: 0 },
    { opacity: peak, offset: 0.14 },
    { opacity: 0 },
  ], { duration, easing: "cubic-bezier(.12,.7,.3,1)" });
}

function triggerScreenInvert(duration = 60) {
  if (effectsLevel() !== "full" || !elements.fxInvert) return;
  fxAnimate(elements.fxInvert, [
    { opacity: 0 },
    { opacity: 1, offset: 0.2 },
    { opacity: 1, offset: 0.8 },
    { opacity: 0 },
  ], { duration, easing: "linear" });
}

function triggerScreenPulse(strength = 0.45, duration = 420) {
  if (effectsLevel() !== "full" || !elements.fxVignette) return;
  fxAnimate(elements.fxVignette, [
    { opacity: 0 },
    { opacity: strength, offset: 0.22 },
    { opacity: 0 },
  ], { duration, easing: "ease-out" });
}

/** 一瞬だけ時間が止まったように見せる「溜め」。JSの処理自体は止めない。 */
function triggerImpactFreeze(duration = 80) {
  if (effectsLevel() !== "full") return;
  document.body.classList.add("fx-freeze");
  fx.frozen = true;
  fxTimeout(() => {
    document.body.classList.remove("fx-freeze");
    fx.frozen = false;
    fx.previous = performance.now();
  }, duration);
}

function triggerRgbSplit(duration = 160) {
  if (effectsLevel() !== "full") return;
  document.body.classList.add("fx-rgb");
  fxTimeout(() => document.body.classList.remove("fx-rgb"), duration);
}

function pulseVibration(power = 1) {
  if (!state.settings.vibration || !navigator.vibrate) return;
  navigator.vibrate(power >= 4 ? [35, 30, 55] : power >= 2 ? 35 : 15);
}

function effectAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  return audioContext;
}

function playEffectSound(power = 1) {
  if (!state.settings.sound) return;
  try {
    const context = effectAudioContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(520 + power * 70, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880 + power * 90, context.currentTime + 0.1);
    gain.gain.setValueAtTime(0.045, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.14);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.15);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  } catch { /* Audio is an optional enhancement. */ }
}

/* --- UI layer ------------------------------------------------------------- */

function renderMaxCallout(label, detail = "", variant = "pop") {
  const callout = elements.maxCallout;
  if (!callout) return 0;
  clearTimeout(calloutTimer);
  const calm = prefersReducedMotion();
  const duration = calm ? 700 : variant === "slam" ? 1000 : 680;
  callout.className = `max-callout max-callout--${calm ? "calm" : variant}`;
  callout.innerHTML = `
    <div class="max-callout-inner" data-label="${escapeHtml(label)}">
      <span class="max-callout-label">${escapeHtml(label)}</span>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
    </div>`;
  callout.hidden = false;
  if (calm) {
    // reduce設定ではCSS animationが実質無効化されるため、WAAPIで最小限の表示を行う。
    fxAnimate(callout.firstElementChild, [
      { opacity: 0 },
      { opacity: 1, offset: 0.16 },
      { opacity: 1, offset: 0.72 },
      { opacity: 0 },
    ], { duration, easing: "ease-out", fill: "forwards" });
  }
  calloutTimer = setTimeout(() => {
    callout.hidden = true;
    callout.innerHTML = "";
  }, duration);
  return duration;
}

/** 既存呼び出し（PERFECT / SSS MASTER など）と同じ強度の複合演出。 */
function triggerMaxImpact(power = 1) {
  const level = effectsLevel();
  if (level === "off") return;
  playEffectSound(power);
  pulseVibration(power);
  if (level === "reduced") {
    triggerScreenFlash(0.5, 280);
    return;
  }
  triggerScreenFlash(power >= 4 ? 0.85 : 0.42, power >= 4 ? 340 : 240);
  triggerWorldImpact({ zoom: 0.016 + power * 0.008, shake: power >= 2 ? 2 + power : 0, duration: 300 + power * 20 });
  spawnParticleBurst({ count: power >= 4 ? 190 : power >= 2 ? 120 : 70, power, shards: power >= 3 });
  triggerShockwave({ speed: 14 + power * 3, width: 5 + power * 1.6 });
  if (power >= 3) {
    triggerShockwave({ speed: 9 + power * 2, width: 2.4, color: "rgba(130,220,255,.72)", decay: 0.022, alpha: 0.8 });
  }
  if (power >= 4) {
    spawnSpeedLines({ count: 24, power });
    triggerRgbSplit(150);
    triggerScreenPulse(0.45, 460);
  }
}

function showMaxCallout(label, detail = "", power = 1) {
  if (!isMaxMode()) return;
  renderMaxCallout(label, detail, power >= 4 ? "slam" : "pop");
  triggerMaxImpact(power);
}

/* --- sequences ------------------------------------------------------------ */

/** MAX突入：静止 → 反転 → 閃光 → MAX文字の着弾（衝撃を全部同期） → 余韻。 */
function triggerMaxEntrance(detail = "READY") {
  if (!isMaxMode()) return;
  resetMaxEffects({ keepAmbience: true });
  syncMaxAmbience();
  if (effectsLevel() === "reduced") {
    renderMaxCallout("MAX MODE", detail);
    triggerScreenFlash(0.4, 320);
    playEffectSound(4);
    pulseVibration(4);
    return;
  }
  document.body.classList.add("fx-max-entrance");
  // Phase A — IMPACT FREEZE（溜め）
  triggerImpactFreeze(80);
  pulseVibration(2);
  // Phase B — ネガポジ反転
  fxTimeout(() => triggerScreenInvert(60), 72);
  // Phase C — WHITE FLASH ＋ MAX文字の射出
  fxTimeout(() => {
    triggerScreenFlash(0.95, 300);
    renderMaxCallout("MAX MODE", detail, "slam");
  }, 132);
  // Phase D — TEXT IMPACT（文字が最大になる瞬間に全レイヤーを同期）
  fxTimeout(() => {
    triggerWorldImpact({ zoom: 0.055, shake: 7, duration: 420 });
    triggerRgbSplit(170);
    triggerScreenPulse(0.55, 480);
    triggerShockwave({ speed: 30, width: 12 });
    spawnParticleBurst({ count: 200, power: 4, shards: true });
    spawnSpeedLines({ count: 30, power: 4 });
    playEffectSound(4);
    pulseVibration(4);
  }, 300);
  // Phase E — 第2波（少し遅れて薄いリング）
  fxTimeout(() => {
    triggerShockwave({ speed: 20, width: 3.4, color: "rgba(140,205,255,.7)", decay: 0.02, alpha: 0.75 });
    spawnParticleBurst({ count: 80, power: 2, speed: 0.7 });
  }, 392);
  // Phase F — MAX状態へ定着
  fxTimeout(() => document.body.classList.remove("fx-max-entrance"), 1000);
}

/** MAX中の正解：コンボが伸びるほど各レイヤーの出力を上げる（上限あり）。 */
function triggerMaxCorrect(power = 1, combo = 0) {
  const level = effectsLevel();
  if (level === "off") return;
  playEffectSound(power);
  pulseVibration(power);
  if (level === "reduced") {
    triggerScreenFlash(0.24, 240);
    return;
  }
  const intensity = Math.min(1, combo / COMBO_INTENSITY_CAP);
  document.body.classList.add("fx-answer");
  fxTimeout(() => document.body.classList.remove("fx-answer"), 340);
  triggerScreenFlash(0.2 + intensity * 0.42, 220 + intensity * 120);
  triggerWorldImpact({
    zoom: 0.014 + intensity * 0.032,
    shake: combo >= 3 ? 2 + intensity * 6 : 0,
    duration: 260 + intensity * 150,
  });
  spawnParticleBurst({ count: 34 + intensity * 150, power: 1 + intensity * 3, shards: combo >= 8 });
  if (combo >= 3) triggerShockwave({ speed: 10 + intensity * 18, width: 3 + intensity * 8 });
  if (combo >= 5) {
    triggerShockwave({ speed: 7 + intensity * 10, width: 2, color: "rgba(130,220,255,.6)", decay: 0.024, alpha: 0.7 });
  }
  if (combo >= 8) {
    triggerScreenPulse(0.28 + intensity * 0.26, 420);
    spawnSpeedLines({ count: 14 + Math.round(intensity * 14), power: 2 + intensity * 2 });
  }
  if (combo >= 10) triggerRgbSplit(120);
}

/** MAX終了：突入の逆再生。エネルギーが抜けて通常世界へ戻る。 */
function triggerMaxExit() {
  clearFxTimers();
  clearTimeout(calloutTimer);
  document.body.classList.remove("fx-freeze", "fx-rgb", "fx-answer", "fx-max-entrance");
  fx.frozen = false;
  fx.rays = [];
  if (elements.maxCallout) {
    elements.maxCallout.hidden = true;
    elements.maxCallout.innerHTML = "";
  }
  document.body.classList.add("fx-max-exit");
  if (!prefersReducedMotion()) {
    const keyframes = [
      { transform: "translate3d(0,0,0) scale(1)", filter: "saturate(1)" },
      { offset: 0.4, transform: "translate3d(0,0,0) scale(.988)", filter: "saturate(.7)" },
      { transform: "translate3d(0,0,0) scale(1)", filter: "saturate(1)" },
    ];
    for (const node of worldStageElements()) {
      fxAnimate(node, keyframes, { duration: 460, easing: "cubic-bezier(.3,.7,.3,1)" });
    }
    triggerScreenPulse(0.3, 440);
  }
  fxTimeout(() => document.body.classList.remove("fx-max-exit"), 520);
}

/** MAX中だけ背景そのものにエネルギーを持たせる。 */
function syncMaxAmbience() {
  const backdrop = elements.fxBackdrop;
  if (!backdrop) return;
  const shouldRun = isMaxMode();
  backdrop.classList.toggle("is-quiz", shouldRun && state.view === "quiz");
  if (shouldRun === fx.ambient) return;
  fx.ambient = shouldRun;
  backdrop.classList.toggle("is-on", shouldRun);
  if (!shouldRun) triggerMaxExit();
}

/** overlay・class・transform・rAFの残骸を残さないための共通後始末。 */
function resetMaxEffects({ keepAmbience = false } = {}) {
  clearFxTimers();
  clearTimeout(calloutTimer);
  cancelFxAnimations();
  fx.frozen = false;
  fx.particles = [];
  fx.rings = [];
  fx.rays = [];
  stopFxLoop();
  if (fx.context && fx.width) fx.context.clearRect(0, 0, fx.width, fx.height);
  document.body.classList.remove("fx-freeze", "fx-rgb", "fx-answer", "fx-max-entrance", "fx-max-exit");
  if (elements.maxCallout) {
    elements.maxCallout.hidden = true;
    elements.maxCallout.innerHTML = "";
  }
  if (!keepAmbience && elements.fxBackdrop) {
    elements.fxBackdrop.classList.remove("is-on", "is-quiz");
    fx.ambient = false;
  }
}

function correctEffect(special = "") {
  if (!isMaxMode()) return;
  let label = "CORRECT";
  let detail = "";
  let power = 1;
  if (state.combo >= 30) { label = "UNSTOPPABLE"; detail = `${state.combo} COMBO`; power = 4; }
  else if (state.combo >= 20) { label = `🔥 ${state.combo} COMBO 🔥`; power = 4; }
  else if (state.combo >= 10) { label = `🔥 ${state.combo} COMBO 🔥`; power = 3; }
  else if (state.combo >= 5) { label = `${state.combo} COMBO`; power = 2; }
  else if (state.combo >= 3) { label = `${state.combo} COMBO`; power = 2; }
  if (special) {
    label = special;
    detail = special === "NEW RECORD" ? `${state.combo} COMBO` : "";
    power = 4;
  }
  renderMaxCallout(label, detail, power >= 4 ? "slam" : "pop");
  triggerMaxCorrect(power, state.combo);
}

function setView(view) {
  if (view === "list" && isHealthSubject()) view = "health-notes";
  if (view === "health-notes" && !isHealthSubject()) view = "list";
  if (!["period", "subject"].includes(view) && !state.subject) view = state.selectedPeriod ? "subject" : "period";
  if (view !== "quiz" && state.session?.reviewTimer) {
    clearTimeout(state.session.reviewTimer);
    state.session.reviewTimer = null;
  }
  state.view = view;
  document.querySelectorAll("[data-view]").forEach((section) => {
    section.hidden = section.dataset.view !== view;
  });
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.viewTarget === view ||
        (["study-content", "study-method", "study-scope", "study-range-select", "study-importance-kind", "study-importance-select", "study-performance", "study-sort-kind", "study-sort-other"].includes(view) &&
          button.dataset.viewTarget === "study-content"),
    );
  });
  elements.bottomNav.hidden = ["quiz", "period", "subject"].includes(view);
  elements.appHeader.hidden = ["quiz", "period", "subject"].includes(view);
  document.body.classList.toggle("quiz-active", view === "quiz");
  document.body.classList.toggle("health-notes-active", view === "health-notes");
  window.scrollTo({ top: 0, behavior: "auto" });

  if (view === "home") renderHome();
  if (view === "study-content") renderStudyContent();
  if (view === "study-method") renderStudyMethod();
  if (view === "study-scope") renderStudyScope();
  if (view === "study-range-select") renderStudyRangeSelect();
  if (view === "study-importance-kind") renderStudyImportanceKind();
  if (view === "study-importance-select") renderStudyImportanceSelect();
  if (view === "study-performance") renderStudyPerformance();
  if (view === "study-sort-kind") renderStudySortKind();
  if (view === "study-sort-other") renderStudySortOther();
  if (view === "list") renderList(true);
  if (view === "analysis") renderAnalysis();
  if (view === "settings") renderSettings();
  applySettings();
}

function renderHeader() {
  const summary = summarizeHistory(state.items, state.history);
  elements.headerStatus.textContent = summary.attempts
    ? `${summary.correct.toLocaleString()} 正解 / ${summary.attempts.toLocaleString()} 回答`
    : `${state.items.length}${isRecallSubject() ? "問" : "語句"}`;
}

function renderHome() {
  const hour = new Date().getHours();
  elements.greeting.textContent = isPublicSubject()
    ? "PUBLIC · 2026.2"
    : isHealthSubject()
      ? "HEALTH · 2026.2"
      : hour < 11 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
  elements.homeTitle.textContent = isPublicSubject()
    ? "公共を、思い出せるまで。"
    : isHealthSubject()
      ? "保健を、思い出せるまで。"
      : "英コミを、思い出せるまで。";
  elements.homeCopy.textContent = isRecallSubject()
    ? "問題を見て答えを思い出し、左右のタップで自己採点します。"
    : "英語と日本語を行き来しながら、4択とフラッシュカードで確かめます。";

  const activeSubject = state.activeStudy?.config?.subject
    ?? state.activeStudy?.config?.selection?.subject
    ?? "english";
  if (state.activeStudy?.config?.selection && activeSubject === state.subject) {
    const answered = Number(state.activeStudy.answeredCount) || 0;
    const total = Number(state.activeStudy.totalCount) || 0;
    elements.resumeStudyCard.hidden = false;
    elements.resumeStudyCard.innerHTML = `
      <div>
        <span class="subtle-label">前回の学習</span>
        <strong>途中から</strong>
        <small>${escapeHtml(studySelectionLabel(state.activeStudy.config.selection))} · ${answered} / ${total}問まで回答</small>
      </div>
      <button class="primary-button compact" type="button" data-resume-active>途中から再開</button>`;
  } else {
    elements.resumeStudyCard.hidden = true;
    elements.resumeStudyCard.innerHTML = "";
  }

  renderRecentStudies();
  renderHeader();
}

function activeFilterLabels(filters = state.filters) {
  const labels = [];
  if (filters.ranges.length) labels.push(filters.ranges.join("・"));
  if (filters.importance.length) labels.push(filters.importance.join(" + "));
  if (filters.types.length) labels.push(filters.types.map((type) => TYPE_LABELS[type]).join("・"));
  if (filters.performance !== "all") labels.push(PERFORMANCE_LABELS[filters.performance]);
  if (filters.minimumWrong > 0) labels.push(`ミス ${filters.minimumWrong}回以上`);
  if (filters.tags.length) labels.push(filters.tags.join("・"));
  return labels;
}

function filteredItems(filters = state.filters) {
  const { modes: _ignoredModes, ...withoutModes } = filters;
  return applyFilters(state.items, state.history, withoutModes);
}

function learningItems(filters = state.filters, selection = state.studySelection) {
  if (!selectionIsComplete(selection)) return [];
  return applyFilters(state.items, state.history, {
    ...filters,
    modes: [],
    performanceModes: studyPerformanceModes(selection),
  })
    .filter((item) => studyModeForItem(item, selection));
}

function renderList(resetLimit = false) {
  if (resetLimit) state.listLimit = 60;
  const filters = { ...state.filters, search: elements.listSearch.value.trim() };
  const items = sortItems(
    filteredItems(filters),
    state.history,
    state.listSortKey,
  );
  elements.listCount.textContent = `${items.length.toLocaleString()}${isRecallSubject() ? "問" : "語句"}`;
  elements.listSort.value = state.listSortKey;
  elements.wordList.classList.toggle("public-question-list", isRecallSubject());
  elements.wordList.innerHTML = items.slice(0, state.listLimit).map((item) => {
    const record = getHistory(state.history, item.id);
    const accuracy = accuracyFor(record);
    if (isRecallSubject()) {
      return `
        <article class="public-question-card">
          <div class="public-question-meta">
            <span class="public-number">Q${item.number}</span>
            <span class="importance-badge importance-${item.importance.toLowerCase()}">${item.importance}</span>
            <span class="type-label">${TYPE_LABELS[item.type]}</span>
            <span class="public-range">${escapeHtml(item.range)}</span>
          </div>
          <h2>${escapeHtml(recallQuestion(item))}</h2>
          <div class="public-list-answer"><span>答え</span><strong>${escapeHtml(recallAnswer(item))}</strong></div>
          <div class="public-list-footer">
            <span>${escapeHtml(item.sourceDetail)}</span>
            <span>${record.totalAttempts ? `${record.wrongCount}ミス・${formatPercent(accuracy)}` : "未回答"}</span>
          </div>
        </article>`;
    }
    return `
      <article class="word-card">
        <div class="word-card-main">
          <div class="word-card-title">
            <span class="importance-badge importance-${item.importance.toLowerCase()}">${item.importance}</span>
            <span class="type-label">${TYPE_LABELS[item.type]}</span>
          </div>
          <h2>${escapeHtml(item.english)}</h2>
          <p>${escapeHtml(item.japanese)}</p>
          <div class="item-tags word-card-tags">${renderTags([item.type, ...item.tags])}</div>
        </div>
        <div class="word-card-meta">
          <span>${escapeHtml(item.range)}</span>
          <span>${escapeHtml(item.sourceDetail || item.lesson)}</span>
          <span>${record.totalAttempts ? `${record.wrongCount}ミス・${formatPercent(accuracy)}` : "未回答"}</span>
        </div>
      </article>`;
  }).join("");
  elements.loadMore.hidden = state.listLimit >= items.length;
  elements.loadMore.dataset.total = String(items.length);
  renderHeader();
}

function checkInput(name, value, label, checked) {
  return `
    <label class="filter-chip">
      <input type="checkbox" name="${name}" value="${escapeHtml(value)}" ${checked ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>`;
}

function renderFilterForm() {
  elements.filterRanges.innerHTML = currentRangeOrder().map((range) =>
    checkInput("ranges", range, range, state.filters.ranges.includes(range)),
  ).join("");
  elements.filterImportance.innerHTML = currentImportanceOrder().map((importance) =>
    checkInput(
      "importance",
      importance,
      importance,
      state.filters.importance.includes(importance),
    ),
  ).join("");
  elements.filterTypes.innerHTML = "";
  elements.filterTags.innerHTML = "";
  elements.filterPerformanceFieldset.hidden = false;
  elements.filterPerformance.value = state.filters.performance;
  elements.filterMinimumWrong.value = String(state.filters.minimumWrong);
  renderFilterPreview();
}

function valuesFor(name) {
  return [...elements.filterForm.querySelectorAll(`input[name="${name}"]:checked`)].map(
    (input) => input.value,
  );
}

function collectFilterForm() {
  return {
    ...state.filters,
    ranges: valuesFor("ranges"),
    importance: valuesFor("importance"),
    types: [],
    tags: [],
    performance: elements.filterPerformance.value,
    minimumWrong: Math.max(0, Number(elements.filterMinimumWrong.value || 0)),
  };
}

function renderFilterPreview() {
  const draft = collectFilterForm();
  const items = filteredItems(draft);
  elements.filterPreviewCount.textContent = items.length.toLocaleString();
}

function openFilter() {
  renderFilterForm();
  elements.filterBackdrop.hidden = false;
  elements.filterSheet.hidden = false;
  document.body.classList.add("sheet-open");
  document.getElementById("close-filter").focus();
}

function closeFilter() {
  elements.filterBackdrop.hidden = true;
  elements.filterSheet.hidden = true;
  document.body.classList.remove("sheet-open");
}

function resetFilters() {
  state.filters = {
    ...state.filters,
    ranges: [],
    importance: [],
    types: [],
    tags: [],
    performance: "all",
    minimumWrong: 0,
  };
  renderFilterForm();
}

function startSession(overrides = {}) {
  const mode = overrides.mode ?? overrides.modes?.[0] ?? state.selectedMode;
  const selection = normalizeStudySelection(overrides.selection ?? state.studySelection);
  const usesSelection = Boolean(
    selection.method
      && (selection.subject === "english" ? selection.contents.length : selection.content)
      && !overrides.mode
      && !overrides.modes,
  );
  if (!usesSelection && (!mode || !ALL_MODES.includes(mode))) {
    showToast("先に学習内容と出題方法を選んでください");
    setView("study-content");
    return;
  }
  let config = {
    subject: overrides.subject ?? state.subject,
    filters: overrides.filters ?? { ...state.filters, search: "" },
    ...(usesSelection ? { selection } : { mode }),
    sortKey: overrides.sortKey ?? state.sortKey,
    count: overrides.itemIds ? (overrides.count ?? "all") : "all",
    itemIds: overrides.itemIds ?? null,
  };
  const resumeSnapshot = state.activeStudy
    && recentStudyConfigKey(state.activeStudy.config) === recentStudyConfigKey(config)
    ? state.activeStudy
    : null;
  if (resumeSnapshot?.config?.itemIds?.length && !config.itemIds) {
    config = { ...config, count: "all", itemIds: resumeSnapshot.config.itemIds };
  }
  const sessionItems = config.itemIds
    ? state.items.filter((item) => config.itemIds.includes(item.id))
    : state.items;
  const combinationKey = usesSelection ? studyCombinationKey(selection) : null;
  const progress = usesSelection ? progressForSelection(selection) : { completedItemIds: [] };
  let queue = usesSelection
    ? buildStudySession({
        items: sessionItems,
        history: state.history,
        filters: config.filters,
        selection,
        completedItemIds: resumeSnapshot || config.filters.performance === "all"
          ? progress.completedItemIds
          : [],
        sortKey: config.sortKey,
        count: config.count,
      })
    : buildSession({
        items: sessionItems,
        history: state.history,
        filters: config.filters,
        selectedModes: [config.mode],
        sortKey: config.sortKey,
        count: config.count,
      });
  if (usesSelection && !queue.length && progress.completedItemIds.length) {
    const resetProgress = {
      ...progress,
      completedItemIds: [],
      completedCycles: (progress.completedCycles ?? 0) + 1,
    };
    state.progress.set(combinationKey, resetProgress);
    setMeta(`studyProgress:${combinationKey}`, resetProgress).catch(console.warn);
    queue = buildStudySession({
      items: sessionItems,
      history: state.history,
      filters: config.filters,
      selection,
      completedItemIds: [],
      sortKey: config.sortKey,
      count: config.count,
    });
    if (queue.length) showToast("この組み合わせを最初からもう一周します");
  }
  if (!queue.length) {
    showToast("この条件に合う問題がありません");
    return;
  }
  if (usesSelection) {
    state.recentStudies = addRecentStudy(state.recentStudies, config);
    setMeta("recentStudies", state.recentStudies).catch(console.warn);
  }
  if (usesSelection) state.studySelection = selection;
  state.selectedMode = queue[0].mode;
  setMeta("selectedMode", state.selectedMode).catch(console.warn);
  setMeta("lastSessionConfig", config).catch(console.warn);
  state.session = {
    queue,
    cursor: 0,
    results: [],
    deferredReviews: [],
    reviewTimer: null,
    currentQuestion: null,
    currentAnswer: "",
    answered: false,
    revealed: false,
    questionStartedAt: 0,
    startedAt: Date.now(),
    complete: false,
    combinationKey,
    selection: usesSelection ? selection : null,
  };
  if (usesSelection) {
    state.activeStudy = {
      config: { ...config, itemIds: queue.map((entry) => entry.item.id) },
      answeredCount: Number(resumeSnapshot?.answeredCount) || 0,
      totalCount: Number(resumeSnapshot?.totalCount) || queue.length,
      startedAt: resumeSnapshot?.startedAt ?? Date.now(),
    };
    setMeta("activeStudy", state.activeStudy).catch(console.warn);
  }
  state.combo = 0;
  setView("quiz");
  prepareQuestion();
}

function prepareQuestion() {
  const session = state.session;
  const entry = session.queue[session.cursor];
  const recentItemIds = session.results.slice(-12).map((result) => result.itemId);
  session.currentQuestion = buildQuestion(entry.item, entry.mode, state.items, Math.random, recentItemIds);
  session.currentAnswer = "";
  session.answered = false;
  session.revealed = false;
  session.lastReviewDelayMs = null;
  session.spellingIndex = 0;
  session.spellingAnswer = [];
  session.spellingSelected = null;
  session.spellingChoices = session.currentQuestion.mode === "ja_to_en_spelling"
    ? generateLetterChoices(session.currentQuestion.spellingLetters[0])
    : [];
  session.questionStartedAt = performance.now();
  renderQuiz();
}

function sourceLine(item) {
  return item.sources
    .map((source) => `${source.lesson} · ${source.title}${source.detail ? ` · ${source.detail}` : ""}`)
    .join(" / ");
}

function renderChoiceArea(question, answered, currentAnswer) {
  const letters = ["A", "B", "C", "D", "？"];
  return `<div class="choice-list">
    ${question.choices
      .map((choice, index) => {
        const selected = normalizeAnswer(choice) === normalizeAnswer(currentAnswer);
        const correct = normalizeAnswer(choice) === normalizeAnswer(question.correctChoice);
        const resultClass = answered
          ? correct
            ? " correct"
            : selected
              ? " wrong"
              : ""
          : "";
        const unknownClass = choice === UNKNOWN_CHOICE ? " choice-unknown" : "";
        return `<button class="choice-button${unknownClass}${resultClass}" type="button" data-choice="${escapeHtml(choice)}" ${answered ? "disabled" : ""}>
          <span>${letters[index]}</span><strong>${escapeHtml(choice)}</strong>
        </button>`;
      })
      .join("")}
  </div>`;
}

function renderWordSlots(question, answered, currentAnswer) {
  const tokens = slotTokensForQuestion(question.item, question.mode);
  const supplied = String(currentAnswer).split(/\s+/).filter(Boolean);
  return `
    <div class="word-slots" data-word-slot-count="${tokens.length}" aria-label="${tokens.length}語の英語入力">
      ${tokens
        .map(
          (_, index) => `<input
            class="word-slot-input"
            data-slot-index="${index}"
            type="text"
            value="${escapeHtml(supplied[index] ?? "")}"
            aria-label="${index + 1}語目"
            autocapitalize="none"
            autocomplete="off"
            spellcheck="false"
            ${answered ? "disabled" : ""}
          />`,
        )
        .join("")}
    </div>
    <button class="primary-button answer-button" type="button" data-submit-input ${answered ? "disabled" : ""}>回答する</button>`;
}

function renderTextInput(answered, currentAnswer) {
  return `
    <label class="answer-field">
      <span class="sr-only">答え</span>
      <input
        id="single-answer-input"
        type="text"
        value="${escapeHtml(currentAnswer)}"
        placeholder="ここに入力"
        autocapitalize="none"
        autocomplete="off"
        spellcheck="false"
        ${answered ? "disabled" : ""}
      />
    </label>
    <button class="primary-button answer-button" type="button" data-submit-input ${answered ? "disabled" : ""}>回答する</button>`;
}

function renderFeedback(question, answer, correct) {
  if (!state.session.answered) return "";
  const isChoice = question.mode.endsWith("choice");
  const correctAnswer = answersForMode(question.item, question.mode)[0];
  return `
    <section class="feedback-card ${correct ? "feedback-correct" : "feedback-wrong"}" aria-live="polite">
      <div class="feedback-result">
        <span aria-hidden="true">${correct ? "✓" : "×"}</span>
        <strong>${correct ? "正解" : "不正解"}</strong>
      </div>
      ${state.session.lastReviewDelayMs === WRONG_REVIEW_DELAY_MS ? '<p class="review-scheduled-note">3分後にもう一度出題します</p>' : ""}
      ${!correct && !isChoice ? `<p class="input-correct-answer"><span>正解</span><strong>${escapeHtml(correctAnswer)}</strong></p>` : ""}
      ${state.settings.showSources ? `<div class="source-box">
        <span class="importance-badge importance-${question.item.importance.toLowerCase()}">${question.item.importance}</span>
        <div>
          <strong class="source-range">範囲：${escapeHtml(question.item.range)}</strong>
          <p>${escapeHtml(sourceLine(question.item))}</p>
        </div>
      </div>` : ""}
    </section>`;
}

// .next-button は position:fixed のため、transformがかかる .quiz-shell の外に置く。
function renderNextButton() {
  if (!state.session?.answered) return "";
  const atEnd = state.session.cursor + 1 >= state.session.queue.length;
  const label = atEnd && state.session.deferredReviews.length
    ? "残りの復習へ"
    : atEnd
      ? "結果を見る"
      : "次の問題へ";
  return `
    <button class="primary-button next-button" type="button" data-next-question>
      ${label}
      <span aria-hidden="true">→</span>
    </button>`;
}

let lastRenderedCombo = 0;

function renderComboPill(changed) {
  const combo = state.combo;
  const heat = combo >= 10 ? " combo-pill--blaze" : combo >= 5 ? " combo-pill--hot" : "";
  const pop = changed ? " combo-pill--pop" : "";
  const text = `🔥 ${combo} COMBO`;
  return `<div class="combo-pill${heat}${pop}"><span class="combo-pill-text" data-text="${escapeHtml(text)}">${escapeHtml(text)}</span></div>`;
}

function renderSpellingChoiceArea(question, answered) {
  const session = state.session;
  const targetLetters = question.spellingLetters ?? spellingLetters(question.answer);
  const currentIndex = Math.min(session.spellingIndex ?? 0, Math.max(0, targetLetters.length - 1));
  let letterIndex = 0;
  const word = [...question.answer].map((character) => {
    if (!/[A-Za-z]/.test(character)) {
      return `<span class="spelling-separator">${character === " " ? "&nbsp;" : escapeHtml(character)}</span>`;
    }
    const index = letterIndex;
    letterIndex += 1;
    const supplied = session.spellingAnswer?.[index];
    const value = supplied ?? (index === currentIndex && !answered ? "?" : "·");
    const wrong = answered && index === currentIndex && supplied
      && normalizeAnswer(supplied) !== normalizeAnswer(targetLetters[index]);
    const className = wrong
      ? " wrong"
      : index === currentIndex && !answered
        ? " current"
        : supplied
          ? " completed"
          : "";
    return `<span class="spelling-character${className}">${escapeHtml(String(value).toUpperCase())}</span>`;
  }).join("");
  const correctLetter = targetLetters[currentIndex]?.toUpperCase();
  const choices = session.spellingChoices ?? [];
  return `
    <div class="spelling-builder" aria-label="スペル ${currentIndex + 1}文字目 / ${targetLetters.length}文字">
      <div class="spelling-word" aria-live="polite">${word}</div>
      <p class="spelling-progress">${Math.min(currentIndex + 1, targetLetters.length)} / ${targetLetters.length}文字</p>
      <div class="spelling-letter-grid">
        ${choices.map((letter) => {
          const selected = normalizeAnswer(letter) === normalizeAnswer(session.spellingSelected);
          const correct = normalizeAnswer(letter) === normalizeAnswer(correctLetter);
          const resultClass = answered ? (correct ? " correct" : selected ? " wrong" : "") : "";
          return `<button class="spelling-letter-button${resultClass}" type="button" data-spelling-letter="${letter}" ${answered ? "disabled" : ""}>${letter}</button>`;
        }).join("")}
      </div>
    </div>`;
}

function chooseSpellingLetter(letter) {
  const session = state.session;
  if (!session || session.answered || session.currentQuestion.mode !== "ja_to_en_spelling") return;
  const targetLetters = session.currentQuestion.spellingLetters;
  const index = session.spellingIndex ?? 0;
  const correctLetter = targetLetters[index];
  session.spellingSelected = letter;
  if (normalizeAnswer(letter) !== normalizeAnswer(correctLetter)) {
    session.spellingAnswer.push(letter);
    submitAnswer(session.spellingAnswer.join(""));
    return;
  }
  session.spellingAnswer.push(correctLetter);
  if (session.spellingAnswer.length >= targetLetters.length) {
    submitAnswer(session.currentQuestion.answer);
    return;
  }
  session.spellingIndex += 1;
  session.spellingSelected = null;
  session.spellingChoices = generateLetterChoices(targetLetters[session.spellingIndex]);
  renderQuiz();
}

function renderRecallQuiz() {
  const session = state.session;
  const question = session.currentQuestion;
  const progress = Math.round((session.cursor / session.queue.length) * 100);
  const revealed = session.revealed;
  elements.quizContent.innerHTML = `
    <div class="quiz-shell public-quiz${revealed ? " answer-revealed" : ""}">
      <header class="quiz-header">
        <button class="icon-button" type="button" data-quit-quiz aria-label="学習を終了">×</button>
        <div class="quiz-progress-copy"><strong>${session.cursor + 1}</strong> / ${session.queue.length}</div>
        <span class="mode-pill">${TYPE_LABELS[question.item.type]}</span>
      </header>
      <div class="quiz-progress"><span style="width:${progress}%"></span></div>
      <article class="public-recall-card">
        <div class="public-recall-meta">
          <span class="importance-badge importance-${question.item.importance.toLowerCase()}">${question.item.importance}</span>
          <span>${escapeHtml(question.item.range)}</span>
          ${question.item.number ? `<span>Q${question.item.number}</span>` : ""}
        </div>
        <p class="question-instruction">${revealed ? "答えを確認して自己採点" : "問題"}</p>
        <h1>${escapeHtml(question.prompt)}</h1>
        ${revealed ? `
          <div class="public-recall-answer" aria-live="polite">
            <span>答え</span>
            <strong>${escapeHtml(question.answer)}</strong>
          </div>
          ${state.settings.showSources ? `<p class="public-recall-source">${escapeHtml(question.item.sourceDetail)}</p>` : ""}
        ` : `
          <div class="public-reveal-hint"><span aria-hidden="true">👆</span><strong>画面をタップして答えを表示</strong></div>
        `}
      </article>
    </div>
    ${revealed ? `
      <div class="public-grade-guide" aria-label="自己採点">
        <button type="button" data-public-grade="three-minutes"><span>もう一度</span><strong>3分後</strong></button>
        <button type="button" data-public-grade="one-hour"><span>あとで復習</span><strong>1時間後</strong></button>
        <button type="button" data-public-grade="mastered"><span>覚えた</span><strong>習得</strong></button>
      </div>
    ` : ""}`;
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

function renderQuiz() {
  const session = state.session;
  if (!session || session.complete) {
    renderSessionComplete();
    return;
  }
  const question = session.currentQuestion;
  if (question.mode.endsWith("_recall") || question.mode.endsWith("_flashcard")) {
    renderRecallQuiz();
    return;
  }
  const answered = session.answered;
  const comboChanged = state.combo !== lastRenderedCombo;
  lastRenderedCombo = state.combo;
  const lastResult = session.results.at(-1);
  const progress = Math.round(((session.cursor + (answered ? 1 : 0)) / session.queue.length) * 100);
  const isChoice = question.mode.endsWith("choice");
  const isSpellingChoice = question.mode === "ja_to_en_spelling";
  const usesSlots = ["ja_to_en_input", "spelling_input"].includes(question.mode);
  const translation = question.mode === "phrase_blank_input"
    ? `<p class="question-translation"><span>日本語訳</span>${escapeHtml(question.item.japanese)}</p>`
    : "";
  const answerArea = isSpellingChoice
    ? renderSpellingChoiceArea(question, answered)
    : isChoice
      ? renderChoiceArea(question, answered, session.currentAnswer)
    : usesSlots
      ? renderWordSlots(question, answered, session.currentAnswer)
      : renderTextInput(answered, session.currentAnswer);

  elements.quizContent.innerHTML = `
    <div class="quiz-shell${answered ? " quiz-answered" : ""}">
      <header class="quiz-header">
        <button class="icon-button" type="button" data-quit-quiz aria-label="学習を終了">×</button>
        <div class="quiz-progress-copy"><strong>${session.cursor + 1}</strong> / ${session.queue.length}</div>
        <span class="mode-pill">${escapeHtml(question.label)}</span>
      </header>
      ${isMaxMode() && state.combo ? renderComboPill(comboChanged) : ""}
      <div class="quiz-progress"><span style="width:${progress}%"></span></div>
      <article class="question-card">
        <p class="question-instruction">${escapeHtml(question.instruction)}</p>
        <h1>${escapeHtml(question.prompt)}</h1>
        ${translation}
        <div class="answer-area">${answerArea}</div>
      </article>
      ${answered ? renderFeedback(question, session.currentAnswer, lastResult.correct) : ""}
    </div>
    ${answered ? renderNextButton() : ""}`;

  if (!answered) {
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      elements.quizContent.querySelector("input")?.focus({ preventScroll: true });
    });
  } else {
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      elements.quizContent.querySelector("[data-next-question]")?.focus({ preventScroll: true });
    });
  }
}

function currentTypedAnswer() {
  const slotInputs = [...elements.quizContent.querySelectorAll(".word-slot-input")];
  if (slotInputs.length) return slotInputs.map((input) => input.value.trim()).join(" ").trim();
  return elements.quizContent.querySelector("#single-answer-input")?.value.trim() ?? "";
}

async function submitAnswer(answer, selfGrade = null, reviewDelayMs = null) {
  const session = state.session;
  if (!session || session.answered) return;
  const question = session.currentQuestion;
  const isChoice = question.mode.endsWith("choice");
  const correct = typeof selfGrade === "boolean"
    ? selfGrade
    : isChoice
      ? normalizeAnswer(answer) === normalizeAnswer(question.correctChoice)
      : isAnswerCorrect(answer, question.acceptedAnswers);
  const durationMs = Math.round(performance.now() - session.questionStartedAt);
  session.currentAnswer = answer;
  session.answered = true;
  const previousHistory = getHistory(state.history, question.item.id);
  let savedHistory = null;

  try {
    savedHistory = await recordAttempt(
      question.item.id,
      question.mode,
      correct,
      durationMs,
    );
    state.history.set(question.item.id, savedHistory);
  } catch (error) {
    console.error(error);
    showToast("履歴の保存に失敗しました");
  }

  session.results.push({
    itemId: question.item.id,
    item: question.item,
    mode: question.mode,
    correct,
    answer,
    durationMs,
  });

  if (session.combinationKey && state.activeStudy) {
    state.activeStudy = {
      ...state.activeStudy,
      answeredCount: (Number(state.activeStudy.answeredCount) || 0) + 1,
      updatedAt: Date.now(),
    };
    setMeta("activeStudy", state.activeStudy).catch(console.warn);
  }

  let pendingCorrectEffect = null;
  if (correct) {
    state.combo += 1;
    let special = previousHistory.wrongCount >= 3 && (savedHistory?.currentCorrectStreak ?? 0) >= 3
      ? "WEAKNESS DESTROYED"
      : "";
    if (state.combo > state.bestCombo) {
      state.bestCombo = state.combo;
      setMeta("bestCombo", state.bestCombo).catch(console.warn);
      if (state.combo >= 3) special = "NEW RECORD";
    }
    pendingCorrectEffect = special;
  } else {
    state.combo = 0;
  }

  if (session.combinationKey) {
    const currentProgress = state.progress.get(session.combinationKey) ?? {
      completedItemIds: [],
    };
    const completedItemIds = [
      ...new Set([...(currentProgress.completedItemIds ?? []), question.item.id]),
    ];
    const nextProgress = {
      completedItemIds,
      attempts: (currentProgress.attempts ?? 0) + 1,
      correctCount: (currentProgress.correctCount ?? 0) + (correct ? 1 : 0),
      wrongCount: (currentProgress.wrongCount ?? 0) + (correct ? 0 : 1),
      itemResults: {
        ...(currentProgress.itemResults ?? {}),
        [question.item.id]: {
          lastResult: correct ? "correct" : "wrong",
          answeredAt: Date.now(),
        },
      },
      updatedAt: Date.now(),
    };
    state.progress.set(session.combinationKey, nextProgress);
    setMeta(`studyProgress:${session.combinationKey}`, nextProgress).catch((error) => {
      console.warn("学習位置の保存に失敗しました", error);
    });
  }

  const scheduledDelay = reviewDelayForAnswer(question.mode, correct, reviewDelayMs);
  session.lastReviewDelayMs = scheduledDelay;
  if (scheduledDelay) {
    session.deferredReviews.push({
      dueAt: Date.now() + scheduledDelay,
      entry: { item: question.item, mode: question.mode, review: true },
    });
    session.deferredReviews.sort((a, b) => a.dueAt - b.dueAt);
  }
  renderQuiz();
  renderHeader();
  // 描画が終わってから演出を出す。フラッシュカードは直後に nextQuestion() が
  // 再描画するため、rAF に載せて「今表示されている画面」に衝撃を当てる。
  if (pendingCorrectEffect !== null) {
    const special = pendingCorrectEffect;
    requestAnimationFrame(() => correctEffect(special));
  }
}

function injectDueReviews(session, forceNext = false) {
  const { ready, pending } = releaseDeferredReviews(
    session.deferredReviews,
    Date.now(),
    forceNext,
  );
  session.deferredReviews = pending;
  if (ready.length) session.queue.splice(session.cursor, 0, ...ready.map((review) => review.entry));
}

function formatReviewCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderReviewWait() {
  const session = state.session;
  if (!session || !session.deferredReviews.length) return;
  injectDueReviews(session, session.cursor >= session.queue.length);
  if (session.cursor < session.queue.length) {
    prepareQuestion();
    return;
  }
  const nextDueAt = session.deferredReviews[0].dueAt;
  const remainingMs = Math.max(0, nextDueAt - Date.now());
  elements.quizContent.innerHTML = `
    <div class="quiz-shell review-wait-shell">
      <header class="quiz-header">
        <button class="icon-button" type="button" data-quit-quiz aria-label="学習を終了">×</button>
        <div class="quiz-progress-copy">復習待ち</div>
        <span class="mode-pill">${session.deferredReviews.length}問</span>
      </header>
      <article class="review-wait-card" aria-live="polite">
        <span class="review-wait-icon" aria-hidden="true">↻</span>
        <p class="eyebrow">NEXT REVIEW</p>
        <h1>${formatReviewCountdown(remainingMs)}</h1>
        <p>時間になったら、この画面のまま自動で次の問題を出します。</p>
        <button class="secondary-button" type="button" data-quit-quiz>ここで学習を終了</button>
      </article>
    </div>`;
  clearTimeout(session.reviewTimer);
  session.reviewTimer = setTimeout(() => {
    session.reviewTimer = null;
    if (state.session === session && state.view === "quiz") renderReviewWait();
  }, Math.min(1000, Math.max(100, remainingMs)));
}

function nextQuestion() {
  const session = state.session;
  if (!session?.answered) return;
  session.cursor += 1;
  injectDueReviews(session, session.cursor >= session.queue.length);
  if (session.cursor >= session.queue.length) {
    if (session.deferredReviews.length) {
      renderReviewWait();
      return;
    }
    session.complete = true;
    renderSessionComplete();
    return;
  }
  prepareQuestion();
}

function renderSessionComplete() {
  const session = state.session;
  if (!session) return;
  const summary = summarizeSession(session.results);
  const overall = summarizeHistory(state.items, state.history);
  const itemUnit = isRecallSubject() ? "問" : "語句";
  if (session.combinationKey) {
    state.activeStudy = null;
    setMeta("activeStudy", null).catch(console.warn);
  }
  const wrongItems = [
    ...new Map(
      session.results
        .filter((result) => !result.correct)
        .map((result) => [result.itemId, result]),
    ).values(),
  ];
  const rangeRows = [...new Set(session.results.map((result) => result.item.range))]
    .map((range) => {
      const rangeSummary = summarizeSession(
        session.results.filter((result) => result.item.range === range),
      );
      return `<div class="result-breakdown-row">
        <span>${escapeHtml(range)}</span>
        <strong>${rangeSummary.correct} / ${rangeSummary.total}</strong>
        <span>${formatPercent(rangeSummary.accuracy)}</span>
      </div>`;
    })
    .join("");
  elements.quizContent.innerHTML = `
    <div class="result-shell">
      <p class="eyebrow">SESSION COMPLETE</p>
      <div class="result-score"><strong>${summary.correct}</strong><span>/ ${summary.total}</span></div>
      <h1>${summary.correct === summary.total ? "全問正解です。" : "学習を記録しました。"}</h1>
      <p>${escapeHtml(session.selection ? studySelectionLabel(session.selection) : MODE_LABELS[state.selectedMode])}</p>
      <div class="result-stat-grid">
        <div><span>2回連続達成</span><strong>${formatPercent(overall.twoCorrectStreakRate)}</strong></div>
        <div><span>達成${itemUnit}</span><strong>${overall.twoCorrectStreakItems} / ${state.items.length}</strong></div>
        <div><span>平均回答</span><strong>${formatSeconds(summary.averageDurationMs)}</strong></div>
        <div><span>学習時間</span><strong>${formatSeconds(summary.durationMs)}</strong></div>
      </div>
      <section class="result-breakdown">
        <div class="result-section-heading"><h2>範囲別</h2><span>${summary.uniqueItems}${itemUnit}</span></div>
        ${rangeRows}
      </section>
      ${
        wrongItems.length
          ? `<div class="result-wrong-list"><h2>今回間違えた${itemUnit}</h2>${wrongItems
              .map(
                (result) => `<div>
                  <span class="result-word-copy"><strong>${escapeHtml(result.item.english)}</strong><small>${escapeHtml(result.item.japanese)}</small></span>
                  <span class="item-tags">${renderTags([result.item.type, ...result.item.tags], 3)}</span>
                </div>`,
              )
              .join("")}</div>`
          : ""
      }
      <div class="result-actions">
        ${wrongItems.length ? '<button class="secondary-button" type="button" data-retry-wrong>間違いだけ復習</button>' : ""}
        <button class="secondary-button" type="button" data-view-analysis>分析を見る</button>
        <button class="primary-button" type="button" data-result-home>ホームへ</button>
      </div>
    </div>`;
  if (summary.total && summary.correct === summary.total) {
    const sssOnly = session.results.every((result) => result.item.importance === "SSS");
    requestAnimationFrame(() => showMaxCallout(sssOnly ? "SSS MASTER" : "PERFECT", `${summary.correct} / ${summary.total}`, 4));
  }
  renderHeader();
}

function renderAnalysis() {
  const overall = summarizeHistory(state.items, state.history);
  const ranges = summarizeByRange(state.items, state.history);
  const modes = summarizeByMode(state.items, state.history)
    .filter((stat) => isRecallSubject() || ACTIVE_ENGLISH_STUDY_MODES.includes(stat.mode));
  const itemUnit = isRecallSubject() ? "問" : "語句";
  const rangeMarkup = ranges.map((stat) => `
    <article class="analysis-row">
      <div>
        <strong>${escapeHtml(stat.range)}</strong>
        <small>${stat.answeredItems} / ${stat.itemCount}${itemUnit}を学習</small>
      </div>
      <div class="analysis-progress" aria-label="定着度 ${formatPercent(stat.mastery)}">
        <span style="width:${Math.round(stat.mastery * 100)}%"></span>
      </div>
      <div class="analysis-numbers">
        <strong>${formatPercent(stat.accuracy)}</strong>
        <small>${stat.wrong}ミス</small>
      </div>
    </article>`).join("");
  const modeMarkup = modes.map((stat) => `
    <article class="mode-analysis-card${state.selectedMode === stat.mode ? " selected" : ""}">
      <div class="mode-analysis-heading">
        <span class="mode-card-icon" aria-hidden="true">${MODE_META[stat.mode].icon}</span>
        <div><strong>${escapeHtml(stat.label)}</strong><small>${stat.attempts}回答</small></div>
      </div>
      <div class="mode-analysis-score">${formatPercent(stat.accuracy)}</div>
      <div class="item-tags">${renderTags(MODE_META[stat.mode].tags)}</div>
      <p>${stat.attempts ? `${stat.wrong}ミス・平均 ${formatSeconds(stat.averageDurationMs)}` : "まだ学習していません"}</p>
      <button class="secondary-button compact" type="button" data-start-study>学習条件を選ぶ</button>
    </article>`).join("");

  elements.analysisContent.innerHTML = `
    <section class="analysis-stat-grid" aria-label="全体の学習結果">
      <div><span>正答率</span><strong>${formatPercent(overall.accuracy)}</strong></div>
      <div><span>回答</span><strong>${overall.attempts.toLocaleString()}</strong></div>
      <div><span>学習済み</span><strong>${overall.answeredItems}</strong></div>
      <div><span>要復習</span><strong>${overall.weakItems}</strong></div>
    </section>
    <section class="analysis-section">
      <div class="section-heading"><div><p class="eyebrow">BY RANGE</p><h2>範囲別分析</h2></div></div>
      <div class="analysis-table">${rangeMarkup}</div>
    </section>
    <section class="analysis-section">
      <div class="section-heading"><div><p class="eyebrow">BY MODE</p><h2>形式別分析</h2></div></div>
      <div class="mode-analysis-grid">${modeMarkup}</div>
    </section>`;
  renderHeader();
}

function retryWrongItems() {
  const session = state.session;
  const wrong = [
    ...new Map(
      session.results
        .filter((result) => !result.correct)
        .map((result) => [result.itemId, { item: result.item, mode: result.mode }]),
    ).values(),
  ];
  if (!wrong.length) return;
  state.session = {
    queue: wrong,
    cursor: 0,
    results: [],
    deferredReviews: [],
    reviewTimer: null,
    currentQuestion: null,
    currentAnswer: "",
    answered: false,
    revealed: false,
    questionStartedAt: 0,
    startedAt: Date.now(),
    complete: false,
  };
  prepareQuestion();
}

function distributeSlotText(startInput, text) {
  const inputs = [...elements.quizContent.querySelectorAll(".word-slot-input")];
  const start = inputs.indexOf(startInput);
  const parts = text.trim().split(/\s+/).filter(Boolean);
  parts.forEach((part, offset) => {
    if (inputs[start + offset]) inputs[start + offset].value = part;
  });
  inputs[Math.min(start + parts.length, inputs.length - 1)]?.focus();
}

function bindEvents() {
  addEventListener("resize", markFxResize, { passive: true });
  addEventListener("orientationchange", markFxResize, { passive: true });
  document.addEventListener("visibilitychange", () => {
    document.body.classList.toggle("fx-hidden", document.hidden);
    if (document.hidden) resetMaxEffects({ keepAmbience: true });
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    const recallSession = state.view === "quiz" && ["_recall", "_flashcard"]
      .some((suffix) => state.session?.currentQuestion?.mode.endsWith(suffix));
    if (recallSession && !target?.hasAttribute("data-quit-quiz")) {
      if (!state.session.revealed) {
        state.session.revealed = true;
        renderQuiz();
      } else if (!state.session.answered) {
        const horizontalPosition = event.clientX / window.innerWidth;
        const grade = target?.dataset.publicGrade
          ?? (horizontalPosition < 1 / 3
            ? "three-minutes"
            : horizontalPosition < 2 / 3
              ? "one-hour"
              : "mastered");
        const answer = state.session.currentQuestion.answer;
        const delay = grade === "three-minutes"
          ? WRONG_REVIEW_DELAY_MS
          : grade === "one-hour"
            ? ONE_HOUR_REVIEW_DELAY_MS
            : null;
        submitAnswer(answer, grade === "mastered", delay).then(nextQuestion);
      }
      return;
    }
    if (!target) {
      if (state.view === "quiz" && state.session?.answered) nextQuestion();
      return;
    }
    if (target.dataset.viewTarget) setView(target.dataset.viewTarget);
    if (target.dataset.period) {
      state.selectedPeriod = target.dataset.period;
      setMeta("selectedPeriod", state.selectedPeriod).catch(console.warn);
      setView("subject");
    }
    if (target.dataset.subject) selectSubject(target.dataset.subject);
    if (target.dataset.selectEffects) {
      state.settings.effectsMode = target.dataset.selectEffects;
      elements.onboarding.hidden = true;
      saveSettings();
      if (isMaxMode()) triggerMaxEntrance("READY");
    }
    if (target.dataset.effectsMode) {
      state.settings.effectsMode = target.dataset.effectsMode;
      saveSettings();
      renderSettings();
      if (isMaxMode()) triggerMaxEntrance("ON");
    }
    if (target.hasAttribute("data-reset-data")) {
      if (!window.confirm("本当に学習履歴を削除しますか？")) return;
      if (!window.confirm("この操作は取り消せません。削除しますか？")) return;
      clearAllData()
        .then(() => location.reload())
        .catch(() => showToast("データを削除できませんでした"));
    }
    if (target.hasAttribute("data-start-study")) {
      resetStudyFlow();
      setView("study-range-select");
    }
    if (target.hasAttribute("data-open-performance-detail")) openFilter();
    if (target.hasAttribute("data-resume-active") && state.activeStudy?.config) {
      startSession(state.activeStudy.config);
    }
    if (target.dataset.recentStudyIndex !== undefined) {
      const entry = state.recentStudies[Number(target.dataset.recentStudyIndex)];
      if (entry?.config) {
        if (entry.config.subject !== state.subject) selectSubject(entry.config.subject);
        startSession(entry.config);
      }
    }
    if (target.hasAttribute("data-study-content-all") && !isRecallSubject()) {
      const clearing = state.contentSelectionMode === "all";
      state.contentSelectionMode = clearing ? null : "all";
      state.studySelection = {
        subject: "english",
        content: clearing ? null : "all",
        contents: clearing ? [] : [...ENGLISH_CONTENT_TYPES],
        direction: null,
        method: null,
        scope: "full",
      };
      renderStudyContent();
    }
    if (target.dataset.studyContent) {
      if (isRecallSubject()) {
        state.studySelection = {
          subject: state.subject,
          content: target.dataset.studyContent,
          contents: [],
          direction: null,
          method: "recall",
          scope: "full",
        };
        setView("study-importance-kind");
      } else {
        const content = target.dataset.studyContent;
        const current = state.studySelection.contents ?? [];
        const contents = current.includes(content)
          ? current.filter((value) => value !== content)
          : [...current, content];
        state.contentSelectionMode = contents.length ? "custom" : null;
        state.studySelection = {
          subject: "english",
          content: contents.length === ENGLISH_CONTENT_TYPES.length
            ? "all"
            : contents.length === 1
              ? contents[0]
              : null,
          contents,
          direction: null,
          method: null,
          scope: "full",
        };
        renderStudyContent();
      }
    }
    if (target.id === "confirm-study-content" && state.studySelection.contents?.length) {
      setView("study-method");
    }
    if (target.dataset.studyDirection) {
      state.studySelection.direction = target.dataset.studyDirection;
      state.studySelection.method = null;
      setView("study-scope");
    }
    if (target.dataset.studyFormat && state.studySelection.direction) {
      state.studySelection.method = `${state.studySelection.direction}_${target.dataset.studyFormat}`;
      state.studySelection.scope = "full";
      setView("study-importance-kind");
    }
    if (target.hasAttribute("data-study-range-all")) {
      const clearing = state.rangeSelectionMode === "all";
      state.rangeSelectionMode = clearing ? null : "all";
      state.filters.ranges = clearing ? [] : [...currentRangeOrder()];
      renderStudyRangeSelect();
    }
    if (target.dataset.studyRange) {
      const range = target.dataset.studyRange;
      state.rangeSelectionMode = "custom";
      state.filters.ranges = state.filters.ranges.includes(range)
        ? state.filters.ranges.filter((value) => value !== range)
        : [...state.filters.ranges, range];
      if (!state.filters.ranges.length) state.rangeSelectionMode = null;
      renderStudyRangeSelect();
    }
    if (target.id === "confirm-study-ranges" && state.filters.ranges.length) {
      setView("study-content");
    }
    if (target.hasAttribute("data-back-before-importance")) {
      setView(viewBeforeImportanceSelection());
    }
    if (target.dataset.importanceFilterMode) {
      state.importanceFilterMode = target.dataset.importanceFilterMode;
      if (state.importanceFilterMode === "all") {
        state.filters.importance = [];
        setView("study-performance");
      } else {
        state.filters.importance = [];
        setView("study-importance-select");
      }
    }
    if (target.dataset.studyImportance) {
      const importance = target.dataset.studyImportance;
      state.filters.importance = state.filters.importance.includes(importance)
        ? state.filters.importance.filter((value) => value !== importance)
        : [...state.filters.importance, importance];
      renderStudyImportanceSelect();
    }
    if (target.id === "confirm-study-importance" && state.filters.importance.length) {
      setView("study-performance");
    }
    if (target.hasAttribute("data-back-before-performance")) {
      setView(state.importanceFilterMode === "custom" ? "study-importance-select" : "study-importance-kind");
    }
    if (target.dataset.studyPerformance) {
      state.filters.performance = target.dataset.studyPerformance;
      state.filters.minimumWrong = 0;
      setView("study-sort-kind");
    }
    if (target.hasAttribute("data-back-before-sort")) {
      setView("study-performance");
    }
    if (target.dataset.studySortKind) {
      if (target.dataset.studySortKind === "other") {
        setView("study-sort-other");
      } else {
        state.sortKey = target.dataset.studySortKind;
        startSession();
      }
    }
    if (target.dataset.studySort) {
      state.sortKey = target.dataset.studySort;
      startSession();
    }
    if (target.id === "open-filter" || target.id === "list-open-filter") openFilter();
    if (target.id === "close-filter") closeFilter();
    if (target.id === "reset-filter") resetFilters();
    if (target.id === "apply-filter") {
      state.filters = collectFilterForm();
      closeFilter();
      state.view === "list" ? renderList(true) : renderHeader();
    }
    if (target.id === "load-more") {
      state.listLimit += 60;
      renderList(false);
    }
    if (target.dataset.choice !== undefined) submitAnswer(target.dataset.choice);
    if (target.dataset.spellingLetter !== undefined) chooseSpellingLetter(target.dataset.spellingLetter);
    if (target.hasAttribute("data-submit-input")) submitAnswer(currentTypedAnswer());
    if (target.hasAttribute("data-next-question")) nextQuestion();
    if (target.hasAttribute("data-quit-quiz")) {
      if (!state.session.results.length || window.confirm("この学習を終了しますか？")) {
        if (state.session.reviewTimer) clearTimeout(state.session.reviewTimer);
        state.session = null;
        setView("home");
      }
    }
    if (target.hasAttribute("data-retry-wrong")) retryWrongItems();
    if (target.hasAttribute("data-view-analysis")) {
      state.session = null;
      setView("analysis");
    }
    if (target.hasAttribute("data-result-home")) {
      state.session = null;
      setView("home");
    }
  });

  elements.listSort.addEventListener("change", () => {
    state.listSortKey = elements.listSort.value;
    renderList(true);
  });
  elements.listSearch.addEventListener("input", () => renderList(true));
  elements.filterForm.addEventListener("input", renderFilterPreview);
  elements.filterBackdrop.addEventListener("click", closeFilter);

  document.addEventListener("change", (event) => {
    const setting = event.target.dataset?.setting;
    if (!setting || !(setting in state.settings)) return;
    state.settings[setting] = event.target.checked;
    saveSettings();
  });

  elements.quizContent.addEventListener("keydown", (event) => {
    if (state.session?.currentQuestion?.mode === "ja_to_en_spelling") return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (state.session?.answered) nextQuestion();
      else submitAnswer(currentTypedAnswer());
      return;
    }
    const input = event.target.closest(".word-slot-input");
    if (!input) return;
    const inputs = [...elements.quizContent.querySelectorAll(".word-slot-input")];
    const index = inputs.indexOf(input);
    if (event.key === " " && input.value.trim()) {
      event.preventDefault();
      inputs[index + 1]?.focus();
    }
    if (event.key === "Backspace" && !input.value && index > 0) {
      inputs[index - 1].focus();
    }
  });
  elements.quizContent.addEventListener("paste", (event) => {
    const input = event.target.closest(".word-slot-input");
    if (!input) return;
    const text = event.clipboardData?.getData("text") ?? "";
    if (/\s/.test(text.trim())) {
      event.preventDefault();
      distributeSlotText(input, text);
    }
  });
  elements.quizContent.addEventListener("input", (event) => {
    const input = event.target.closest(".word-slot-input");
    if (input && /\s/.test(input.value)) distributeSlotText(input, input.value);
  });
}

async function boot() {
  bindEvents();
  try {
    const progressPromise = Promise.all(
      KNOWN_STUDY_SELECTIONS.map(async (selection) => {
        const key = studyCombinationKey(selection);
        return [key, await getMeta(`studyProgress:${key}`, { completedItemIds: [] })];
      }),
    );
    const [response, publicResponse, healthResponse, history, selectedMode, progressEntries, settings, bestCombo, activeStudy, selectedPeriod, recentStudies, lastSessionConfig] = await Promise.all([
      fetch("./data/items.json?v=2026.08.26"),
      fetch("./data/public-items.json?v=2026.2.4"),
      fetch("./data/health-items.json?v=2026.2.4"),
      loadHistory(),
      getMeta("selectedMode"),
      progressPromise,
      getMeta("settings", DEFAULT_SETTINGS),
      getMeta("bestCombo", 0),
      getMeta("activeStudy", null),
      getMeta("selectedPeriod", null),
      getMeta("recentStudies", []),
      getMeta("lastSessionConfig", null),
    ]);
    if (!response.ok) throw new Error(`教材データを読み込めませんでした (${response.status})`);
    if (!publicResponse.ok) throw new Error(`公共データを読み込めませんでした (${publicResponse.status})`);
    if (!healthResponse.ok) throw new Error(`保健データを読み込めませんでした (${healthResponse.status})`);
    state.englishItems = await response.json();
    state.publicItems = await publicResponse.json();
    state.healthItems = await healthResponse.json();
    state.items = state.englishItems;
    state.history = history;
    state.selectedMode = ALL_MODES.includes(selectedMode) ? selectedMode : null;
    state.progress = new Map(progressEntries);
    state.settings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
    state.bestCombo = Number(bestCombo) || 0;
    state.activeStudy = activeStudy?.config?.selection && selectionIsComplete(activeStudy.config.selection)
      ? activeStudy
      : null;
    state.recentStudies = normalizeRecentStudies([
      ...(Array.isArray(recentStudies) ? recentStudies : []),
      ...(state.activeStudy ? [{ config: state.activeStudy.config, lastUsedAt: state.activeStudy.startedAt }] : []),
      ...(lastSessionConfig ? [{ config: lastSessionConfig, lastUsedAt: 0 }] : []),
    ]);
    state.selectedPeriod = selectedPeriod === "2026.2" ? selectedPeriod : null;
    elements.appShell.setAttribute("aria-busy", "false");
    setView(state.selectedPeriod ? "subject" : "period");
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("オフライン準備に失敗しました", error));
    }
  } catch (error) {
    console.error(error);
    elements.appShell.setAttribute("aria-busy", "false");
    elements.headerStatus.textContent = "読み込みエラー";
    document.querySelector(".main-content").innerHTML = `
      <section class="fatal-error">
        <h1>アプリを読み込めませんでした</h1>
        <p>${escapeHtml(error.message)}</p>
        <button class="primary-button" type="button" onclick="location.reload()">再読み込み</button>
      </section>`;
  }
}

boot();
