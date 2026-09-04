import {
  ALL_MODES,
  ALPHABET_KEYBOARD_ROWS,
  DEFAULT_MASTERY_CRITERION,
  ENGLISH_CONTENT_TYPES,
  ENGLISH_STUDY_MODES,
  MASTERY_CRITERIA,
  MASTERY_CRITERION_LABELS,
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
  accuracyFor,
  advanceStudyProgress,
  applyKeyboardKey,
  applyStudyAnswer,
  clampSlotIndex,
  cloneStudyProgress,
  createStudyProgress,
  answersForMode,
  applyFilters,
  buildQuestion,
  buildSession,
  buildStudySession,
  characterHintForToken,
  deleteKeyboardCharacter,
  distributeInputText,
  exactStudyMode,
  getHistory,
  historyForModes,
  isCycleComplete,
  masteredIdsForMode,
  moveKeyboardSlot,
  inputPlanForQuestion,
  isAnswerCorrect,
  normalizeAnswer,
  normalizeMasteryCriterion,
  normalizeStudyProgress,
  pendingCycleItemIds,
  reviewDelayForAnswer,
  sortItems,
  normalizeStudySelection,
  normalizeRecentStudyConfig,
  releaseDeferredReviews,
  studyConfigForTarget,
  studyModeForItem,
  inProgressStudyEntries,
  studyEntriesByRecency,
  isStudyInProgress,
  studyContentsKey,
  studyProgressEntriesForMode,
  studyProgressKey,
  studyProgressSummary,
  studyPerformanceModes,
  studyTargetsForDashboard,
  summarizeHistory,
  summarizeRangeModeProgress,
  summarizeReviewItems,
  summarizeSession,
} from "./logic.js?v=2026.9.18a";
import { createMaxAudioEngine } from "./audio.js?v=2026.2.18";
import {
  MAX_TIMELINE_PHASES,
  maxCueForAnswer,
  maxCueForFinale,
  resolveMaxCue,
  scaledVisualPlan,
  shouldPlayMaxSound,
} from "./max-cues.js?v=2026.2.18";
import {
  clearAllData,
  getMeta,
  getMetaObject,
  loadHistory,
  putHistory,
  recordAttempt,
  removeHistory,
  setMeta,
  stashMeta,
} from "./storage.js?v=2026.9.18a";
import {
  bindQuizGestures,
  isRecallMode,
  isSwipeAdvanceMode,
  oppositeDirection,
  quizGesturePolicy,
  recallActionForDirection,
} from "./quiz-gestures.js?v=2026.9.18a";

const DEFAULT_SETTINGS = {
  effectsMode: null,
  sound: false,
  soundIntensity: "gentle",
  vibration: true,
  particles: true,
  shake: true,
  showSources: true,
  showCharacterCount: false,
  // true にするとアプリ内キーボードを出さず、端末標準キーボードだけを使う。
  // 既存の保存データにこのキーが無くても getMetaObject() が既定値で補う。
  useSystemKeyboard: false,
  masteryCriterion: DEFAULT_MASTERY_CRITERION,
};

// アクティブな入力枠はDOMではなく、この入力UI専用の状態で管理する。
const inputKeyboardState = {
  activeSlotIndex: 0,
  slotCount: 0,
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
  listLimit: 60,
  session: null,
  // 直前に完了した学習のリザルト（保存済み。分析画面で前回分として表示する）
  lastSessionResult: null,
  settings: { ...DEFAULT_SETTINGS },
  combo: 0,
  bestCombo: 0,
  // 学習途中の周回から続きを始めるための、周回キーごとの学習条件。
  studyConfigs: {},
  importanceFilterMode: null,
  rangeSelectionMode: null,
  contentSelectionMode: null,
  rangeFlow: "dashboard",
  studyFlowMode: "dashboard",
  studyProgress: {},
};

const elements = Object.fromEntries(
  [
    "app-shell",
    "app-header",
    "header-status",
    "dashboard-eyebrow",
    "dashboard-title",
    "dashboard-copy",
    "dashboard-range-list",
    "range-detail-title",
    "range-detail-copy",
    "range-detail-groups",
    "study-range-back",
    "study-range-eyebrow",
    "study-content-heading",
    "study-content-copy",
    "study-content-options",
    "study-content-back",
    "confirm-study-content",
    "study-content-action-copy",
    "study-method-heading",
    "study-method-copy",
    "study-method-options",
    "study-scope-options",
    "study-range-options",
    "confirm-study-ranges",
    "study-range-action-copy",
    "study-importance-options-single",
    "study-importance-options",
    "confirm-study-importance",
    "study-content-multi-options",
    "study-sort-kind-options",
    "study-sort-other-options",
    "list-search",
    "list-count",
    "list-eyebrow",
    "list-title",
    "nav-list-button",
    "nav-list-label",
    "word-list",
    "load-more",
    "quiz-content",
    "analysis-result",
    "settings-content",
    "bottom-nav",
    "effects-canvas",
    "fx-backdrop",
    "fx-vignette",
    "fx-invert",
    "fx-flash",
    "fx-stage",
    "fx-energy-core",
    "fx-light-column",
    "fx-gold-frame",
    "fx-crack",
    "max-callout",
    "onboarding",
    "toast",
  ].map((id) => [
    id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
    document.getElementById(id),
  ]),
);

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
  "difficulty-level-desc": "難易度順",
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
  en_to_ja_flashcard: { icon: "英→日", tags: ["自己採点", "フラッシュカード"] },
  ja_to_en_flashcard: { icon: "日→英", tags: ["自己採点", "フラッシュカード"] },
  ja_to_en_input: { icon: "⌨", tags: ["キーボード入力", "英語"] },
  spelling_input: { icon: "Aa", tags: ["完全入力", "スペル"] },
  preposition_input: { icon: "_", tags: ["穴埋め", "前置詞"] },
  phrase_blank_input: { icon: "…", tags: ["穴埋め", "熟語・語法"] },
  public_recall: { icon: "公", tags: ["自己採点", "一問一答"] },
  health_recall: { icon: "保", tags: ["自己採点", "一問一答"] },
};


const STUDY_CONTENT_META = {
  word: { icon: "Aa", title: "単語", detail: "英単語を中心に学習", tags: ["単語"] },
  phrase: { icon: "…", title: "熟語", detail: "熟語だけを学習", tags: ["熟語"] },
  structure: { icon: "V", title: "構文", detail: "構文だけを学習", tags: ["構文"] },
  all: { icon: "＋", title: "全選択", detail: "単語・熟語・構文をまとめて学習", tags: ["単語", "熟語", "構文"] },
};

const STUDY_DIRECTION_META = {
  en_to_ja: { icon: "英→日", title: "英語 → 日本語", detail: "英語を見て日本語の意味を答える", tags: ["英語から"] },
  ja_to_en: { icon: "日→英", title: "日本語 → 英語", detail: "日本語を見て対応する英語を答える", tags: ["日本語から"] },
};

const STUDY_FORMAT_META = {
  choice: { icon: "4", title: "4択問題", detail: "4つの候補から正しい答えを選ぶ", tags: ["選択式"] },
  flashcard: { icon: "▣", title: "フラッシュカード", detail: "タップで表裏、スワイプで自己採点", tags: ["自己採点"] },
  input: { icon: "⌨", title: "キーボード入力", detail: "日本語を見て、英語をキーボードで入力する", tags: ["単語", "熟語・語法"] },
};

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
  const ranges = [...currentRangeOrder()];
  const selectAllEnglishContents = !isRecallSubject();
  state.studySelection = {
    subject: isRecallSubject() ? state.subject : "english",
    content: selectAllEnglishContents ? "all" : null,
    contents: selectAllEnglishContents ? [...ENGLISH_CONTENT_TYPES] : [],
    direction: null,
    method: null,
    scope: "full",
  };
  state.sortKey = "importance-desc";
  state.filters = emptyFilters();
  state.filters.ranges = ranges;
  state.importanceFilterMode = null;
  state.rangeSelectionMode = "all";
  state.contentSelectionMode = selectAllEnglishContents ? "all" : null;
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
  elements.navListButton.dataset.viewTarget = isHealthSubject()
    ? "health-notes"
    : isPublicSubject()
      ? "public-notes"
      : "list";
  elements.navListLabel.textContent = isHealthSubject()
    ? "まとめノート"
    : isPublicSubject()
      ? "重要語句"
      : "単語帳";
  state.rangeFlow = "dashboard";
  setView("dashboard");
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

// 学習条件から範囲の見出しを作る（続きのカードで使う）。
function configRangeLabel(config) {
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
  const meta = {};
  if (termCount) {
    meta.term = { icon: "語", title: "語句回答問題", detail: "用語・人物・制度名・年号など", tags: [`${termCount}問`] };
  }
  if (shortCount) {
    meta.short = { icon: "文", title: "短文回答問題", detail: "定義・理由・特徴・しくみなど", tags: [`${shortCount}問`] };
  }
  if (termCount && shortCount) {
    meta.all = { icon: "＋", title: "どっちとも", detail: "語句回答と短文回答をまとめて学習", tags: [`${termCount + shortCount}問`] };
  }
  return meta;
}

// 単語 / 熟語 / 構文 / 全選択 は1タップで確定して次へ。「その他」だけ複数選択へ。
function renderStudyContent() {
  const fromDashboard = state.studyFlowMode === "dashboard";
  elements.studyContentBack.dataset.viewTarget = fromDashboard ? "range-detail" : "study-range-select";
  elements.studyContentBack.setAttribute("aria-label", fromDashboard ? "形式を選び直す" : "範囲を選び直す");
  elements.studyContentHeading.textContent = isRecallSubject()
    ? "どの問題を学習しますか？"
    : "何を学習しますか？";
  // 続きのある学習内容（単語・熟語・構文・全選択）を赤枠で示す。
  const resumableContents = contentsInProgress();
  if (isRecallSubject()) {
    const recallContents = recallContentMeta();
    elements.studyContentCopy.textContent = "";
    elements.studyContentOptions.className = "content-choice-list";
    elements.studyContentOptions.innerHTML = Object.entries(recallContents)
      .map(([content, meta]) => contentChoiceRow({
        title: meta.title,
        detail: meta.detail,
        attribute: `data-study-content="${content}"`,
        progress: selectionProgress({ types: recallTypesForContent(content) }),
        inProgress: resumableContents.has(content),
        cycleNumber: cycleNumberForContents(content),
      }))
      .join("");
    return;
  }

  elements.studyContentCopy.textContent = "";
  const baseItems = studyContentBaseItems();
  const count = (type) => baseItems.filter((item) => item.type === type).length;
  elements.studyContentOptions.className = "content-choice-list";
  elements.studyContentOptions.innerHTML = [
    ...ENGLISH_CONTENT_TYPES.map((content) => contentChoiceRow({
      title: STUDY_CONTENT_META[content].title,
      detail: count(content) ? `${count(content)}語句` : "出題できません",
      attribute: `data-study-content-choice="${content}"${count(content) ? "" : ' disabled aria-disabled="true"'}`,
      progress: count(content) ? selectionProgress({ types: [content] }) : null,
      inProgress: resumableContents.has(studyContentsKey([content])),
      cycleNumber: cycleNumberForContents(studyContentsKey([content])),
    })),
    contentChoiceRow({
      title: "全選択",
      detail: `${baseItems.length}語句`,
      attribute: 'data-study-content-choice="all"',
      progress: selectionProgress({ types: [...ENGLISH_CONTENT_TYPES] }),
      inProgress: resumableContents.has(studyContentsKey([...ENGLISH_CONTENT_TYPES])),
      cycleNumber: cycleNumberForContents(studyContentsKey([...ENGLISH_CONTENT_TYPES])),
    }),
    contentChoiceRow({
      title: "その他",
      detail: "組み合わせを複数選択する",
      attribute: "data-study-content-other",
      variant: "secondary",
    }),
  ].join("");
}

function contentChoiceRow({
  title,
  detail,
  attribute,
  variant = "primary",
  progress = null,
  inProgress = false,
  cycleNumber = 1,
}) {
  const classes = [
    "content-choice",
    variant === "secondary" ? "content-choice--secondary" : "",
    progress ? "content-choice--gauge" : "",
    inProgress ? "is-in-progress" : "",
  ].filter(Boolean).join(" ");
  const badge = inProgress ? studyBadgeMarkup() : "";
  if (!progress) {
    return `
    <button class="${classes}" type="button" ${attribute}>
      <span class="content-choice-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>
      ${badge}
      <span class="card-arrow" aria-hidden="true">›</span>
    </button>`;
  }
  return `
    <button class="${classes}" type="button" ${attribute}>
      <span class="content-choice-head">
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(detail)}</small>
        ${badge}
        <span class="card-arrow" aria-hidden="true">›</span>
      </span>${progressGaugeMarkup(progress, cycleNumber)}
    </button>`;
}

// 学習内容の件数は、範囲だけで絞った母数を使う（重要度はこの後の画面で選ぶ）
function studyContentBaseItems() {
  return applyFilters(state.items, state.history, {
    ...state.filters,
    importance: [],
    performance: "all",
    minimumWrong: 0,
    search: "",
    modes: [],
  });
}

function renderStudyContentMulti() {
  const selectedContents = state.studySelection.contents ?? [];
  const baseItems = studyContentBaseItems();
  elements.studyContentMultiOptions.innerHTML = ENGLISH_CONTENT_TYPES.map((content) => {
    const selected = selectedContents.includes(content);
    const meta = STUDY_CONTENT_META[content];
    const count = baseItems.filter((item) => item.type === content).length;
    return `<button class="multi-select-card${selected ? " selected" : ""}" type="button" data-study-content="${content}" aria-pressed="${selected}">
      <span class="multi-check" aria-hidden="true">${selected ? "✓" : ""}</span>
      <span><strong>${escapeHtml(meta.title)}</strong><small>${count}語句</small></span>
    </button>`;
  }).join("");
  const ready = selectedContents.length > 0;
  elements.confirmStudyContent.disabled = !ready;
  elements.confirmStudyContent.classList.toggle("ready-to-continue", ready);
  elements.studyContentActionCopy.hidden = !ready;
  elements.studyContentActionCopy.textContent = `${selectedContents.length}種類を選択中。次へ進めます`;
}

function applyContentChoice(choice) {
  const contents = choice === "all" ? [...ENGLISH_CONTENT_TYPES] : [choice];
  state.contentSelectionMode = choice === "all" ? "all" : "custom";
  state.studySelection = {
    ...state.studySelection,
    subject: "english",
    content: contents.length === ENGLISH_CONTENT_TYPES.length ? "all" : contents[0],
    contents,
  };
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
    if (format !== "input") return true;
    return state.studySelection.direction === "ja_to_en";
  });
  elements.studyScopeOptions.innerHTML = formats
    .map(([format, meta]) => selectionCard({
      ...meta,
      dataAttribute: `data-study-format="${format}"`,
    }))
    .join("");
}

function renderStudyRangeSelect() {
  const fromDashboard = state.rangeFlow === "dashboard";
  elements.studyRangeBack.dataset.viewTarget = "dashboard";
  elements.studyRangeBack.textContent = fromDashboard ? "← 範囲一覧へ戻る" : "← ダッシュボードへ戻る";
  elements.studyRangeEyebrow.textContent = fromDashboard ? "MULTIPLE RANGES" : "STEP 1 · MULTIPLE";
  const ranges = currentRangeOrder();
  const allSelected = state.rangeSelectionMode === "all";
  const allResumable = allRangesInProgress();
  const allCard = `<button class="multi-select-card select-all-card${allSelected ? " selected" : ""}${allResumable ? " is-in-progress" : ""}" type="button" data-study-range-all aria-pressed="${allSelected}">
    <span class="multi-check" aria-hidden="true">${allSelected ? "✓" : ""}</span>
    <span><strong>全選択</strong><small>すべての範囲（${state.items.length}${isRecallSubject() ? "問" : "語句"}）</small>${allResumable ? studyBadgeMarkup() : ""}</span>
  </button>`;
  const rangeCards = ranges.map((range) => {
    const selected = !allSelected && state.filters.ranges.includes(range);
    const count = state.items.filter((item) => item.range === range).length;
    return `<button class="multi-select-card${selected ? " selected" : ""}" type="button" data-study-range="${escapeHtml(range)}" aria-pressed="${selected}">
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

// 「何を学習しますか？」と同じ1列リスト。全重要度だけは一番上に置く。
function renderStudyImportance() {
  const available = currentImportanceOrder();
  const unit = isRecallSubject() ? "問" : "語句";
  const countFor = (importance) => learningItems({
    ...state.filters,
    importance: importance ? [importance] : [],
    performance: "all",
    minimumWrong: 0,
  }).length;
  const types = studyContentTypes();
  const rows = [
    contentChoiceRow({
      title: "全重要度",
      detail: `${countFor(null)}${unit}`,
      attribute: 'data-study-importance-choice="all"',
      progress: selectionProgress({ types }),
    }),
    ...available.map((importance) => {
      const count = countFor(importance);
      return contentChoiceRow({
        title: importance,
        detail: count ? `${count}${unit}` : "出題できません",
        attribute: `data-study-importance-choice="${importance}"${count ? "" : ' disabled aria-disabled="true"'}`,
        progress: count ? selectionProgress({ types, importance: [importance] }) : null,
      });
    }),
    contentChoiceRow({
      title: "その他",
      detail: "重要度を複数選択する",
      attribute: "data-study-importance-other",
      variant: "secondary",
    }),
  ];
  elements.studyImportanceOptionsSingle.innerHTML = rows.join("");
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

function renderStudySortKind() {
  const rows = [
    { key: "importance-desc", title: "重要度順", detail: "重要度が高い問題から（同じ重要度の中はランダム）" },
    ...(!isRecallSubject()
      ? [{ key: "difficulty-level-desc", title: "難易度順", detail: "難易度が高い問題から（同じ難易度の中はランダム）" }]
      : []),
    { key: "difficulty", title: "苦手順", detail: "間違いが多い問題から" },
    { key: "random", title: "ランダム", detail: "毎回シャッフルして出題" },
  ].map((option) => contentChoiceRow({
    title: option.title,
    detail: option.detail,
    attribute: `data-study-sort-kind="${option.key}"`,
  }));
  rows.push(contentChoiceRow({
    title: "その他",
    detail: "正答率順・範囲順・A–Z など",
    attribute: 'data-study-sort-kind="other"',
    variant: "secondary",
  }));
  elements.studySortKindOptions.innerHTML = rows.join("");
}

function renderStudySortOther() {
  elements.studySortOtherOptions.innerHTML = OTHER_SORT_OPTIONS.map(([key, label]) => `
    <button class="multi-select-card sort-option" type="button" data-study-sort="${key}">
      <span class="multi-check sort-icon" aria-hidden="true">↕</span>
      <span><strong>${label}</strong><small>この順番で出題</small></span>
    </button>`).join("");
}

function viewBeforeImportanceSelection() {
  if (state.studyFlowMode === "dashboard") {
    return isRecallSubject() ? "range-detail" : "study-content";
  }
  if (isRecallSubject()) return "study-content";
  return "study-scope";
}

function dashboardTargetGroups() {
  const contents = isRecallSubject()
    ? [...new Set(state.items.map((item) => item.answerFormat).filter(Boolean))]
    : [];
  return studyTargetsForDashboard({ subject: state.subject ?? "english", contents });
}

function dashboardTargetByKey(key) {
  return dashboardTargetGroups()
    .flatMap((group) => group.cards)
    .find((card) => card.key === key) ?? null;
}

function dashboardRanges() {
  return currentRangeOrder().filter((range) => state.items.some((item) => item.range === range));
}

// いまの教科・いまの習得条件の周回を、最後に学習した順で返す。
function recentStudyEntries() {
  return studyEntriesByRecency(state.studyProgress, {
    subject: state.subject ?? "english",
    criterion: masteryCriterion(),
  });
}

// 学習途中の周回だけを、最後に学習した順で返す。
function inProgressEntries() {
  return inProgressStudyEntries(state.studyProgress, {
    subject: state.subject ?? "english",
    criterion: masteryCriterion(),
  });
}

// ハイライトの基準になるセット。周回の途中かどうかに関わらず、
// いちばん最近学習した条件を採用する。
function latestStudyEntry() {
  return recentStudyEntries()[0] ?? null;
}

// 範囲ボタンのハイライトは、いちばん最近学習したセットひとつだけを指す。
// 途中の周回をほかに抱えていても、入口は迷わずひとつになる。
function latestStudyRanges() {
  return latestStudyEntry()?.meta.ranges ?? [];
}

// その範囲だけを対象にした周回なら、その範囲ボタンから続きへ入れる。
function rangesInProgress() {
  const list = latestStudyRanges();
  return new Set(list.length === 1 ? list : []);
}

// 全範囲を対象にした周回なら、「全範囲」「全選択」ボタンの担当になる。
function allRangesInProgress() {
  const total = dashboardRanges().length;
  if (!total) return false;
  return latestStudyRanges().length >= total;
}

// いま選んでいる範囲（形式まで決まっていればその形式）に一致する、
// 学習途中の周回が対象にしている学習内容。単語・熟語・構文・全選択の
// どれを選べば続きになるかを示すために使う。
// いま選んでいる範囲・形式で、その学習内容が何周目かを返す（バーの本数と色に使う）。
function cycleNumberForContents(contentsKey) {
  const mode = exactStudyMode(state.studySelection);
  if (!mode) return 1;
  const entry = studyProgressEntriesForMode(state.studyProgress, {
    mode,
    ranges: state.filters.ranges,
    filters: state.filters,
    criterion: masteryCriterion(),
  }).find(({ meta }) => meta.contents === contentsKey);
  return entry?.progress?.cycleNumber ?? 1;
}

function contentsInProgress() {
  const wantedRanges = studyContentsKey(state.filters.ranges);
  const mode = exactStudyMode(state.studySelection);
  const meta = latestStudyEntry()?.meta;
  if (!meta) return new Set();
  if (studyContentsKey(meta.ranges ?? []) !== wantedRanges) return new Set();
  if (mode && meta.mode !== mode) return new Set();
  return new Set([meta.contents]);
}

// ハイライトのラベル。周回の途中なら残りがあることを、終えていれば
// 次の周回へ進めることを示す。
function studyBadgeMarkup() {
  const label = isStudyInProgress(latestStudyEntry()?.progress) ? "学習途中" : "前回の続き";
  return `<span class="in-progress-badge">${label}</span>`;
}

function rangeDetailLabel(ranges = state.filters.ranges) {
  if (!ranges.length) return "範囲";
  if (ranges.length === 1) return ranges[0];
  if (ranges.length >= dashboardRanges().length) return "全範囲";
  return `${ranges.length}範囲`;
}

// 範囲一覧は範囲名だけを見せる。正答率・習得率などの数値はここでは出さない。
function renderDashboard() {
  const completed = state.session?.complete ? state.session : null;
  const hour = new Date().getHours();
  elements.dashboardEyebrow.textContent = completed
    ? "NEXT STUDY"
    : isPublicSubject()
      ? "PUBLIC · 2026.2"
      : isHealthSubject()
        ? "HEALTH · 2026.2"
        : hour < 11 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
  elements.dashboardTitle.textContent = completed ? "次の学習範囲" : "学習する範囲を選ぶ";
  elements.dashboardCopy.textContent = completed
    ? "結果を確認したら、そのまま次の範囲へ進めます。"
    : isRecallSubject()
      ? "範囲を選ぶと、一問一答の現在地が見られます。"
      : "範囲を選ぶと、5つの学習形式それぞれの現在地が見られます。";
  const ranges = dashboardRanges();
  const unit = isRecallSubject() ? "問" : "語句";
  // 学習途中の範囲は赤枠で示し、続きから進められることを伝える。
  const resumableRanges = rangesInProgress();
  const allResumable = allRangesInProgress();
  elements.dashboardRangeList.innerHTML = [
    `<button class="range-choice range-choice--all${allResumable ? " is-in-progress" : ""}" type="button" data-dashboard-all-ranges>
      <span class="range-choice-name">全範囲</span>
      ${allResumable ? studyBadgeMarkup() : ""}
      <span class="range-choice-detail">${ranges.length}範囲 ${state.items.length}${unit}</span>
      <span class="card-arrow" aria-hidden="true">›</span>
    </button>`,
    ...ranges.map((range) => `
    <button class="range-choice${resumableRanges.has(range) ? " is-in-progress" : ""}" type="button" data-dashboard-range="${escapeHtml(range)}">
      <span class="range-choice-name">${escapeHtml(range)}</span>
      ${resumableRanges.has(range) ? studyBadgeMarkup() : ""}
      <span class="card-arrow" aria-hidden="true">›</span>
    </button>`),
  ].join("");
  renderHeader();
}

function contentLabelFromProgressKey(meta) {
  const contents = String(meta?.contents ?? "").split("+").filter(Boolean);
  if (!contents.length) return "";
  if (contents.length >= ENGLISH_CONTENT_TYPES.length) return "全内容";
  return contents
    .map((content) => STUDY_CONTENT_META[content]?.title ?? STUDY_CONTENT_LABELS[content] ?? content)
    .join("＋");
}

// 表示中の範囲・形式に一致する周回のうち、最後に学習したものを見せる。
function cardStudyProgress(card) {
  return studyProgressEntriesForMode(state.studyProgress, {
    mode: card.mode,
    ranges: state.filters.ranges.length ? state.filters.ranges : dashboardRanges(),
    filters: state.filters,
    criterion: masteryCriterion(),
  })[0] ?? null;
}

// バーの色は周回ごとに変える。1周目・2周目（赤）・3周目…と変わり、
// 5周目まで一巡したら最初の色へ戻る。
const GAUGE_COLOR_COUNT = 5;

function gaugeColorIndex(cycleNumber) {
  return ((Math.max(1, cycleNumber) - 1) % GAUGE_COLOR_COUNT) + 1;
}

// 形式カード・学習内容・重要度で共通の進捗ゲージ。
// 1本のトラックに「未回答（背景）」「解答済み（薄い塗り）」「習得（濃い塗り）」を重ね、
// 周回が進むごとに新しいバーを下へ足していく（終えた周回のバーは満了のまま残す）。
function progressGaugeMarkup(progress, cycleNumber = 1) {
  const cycles = Math.max(1, Number(cycleNumber) || 1);
  const answeredPercent = Math.round(progress.answeredRate * 100);
  const masteredPercent = Math.round(progress.masteredRate * 100);
  const currentColor = gaugeColorIndex(cycles);
  const label = `${cycles}周目：解答済み ${answeredPercent}パーセント、習得 ${masteredPercent}パーセント`;
  const finishedBars = Array.from({ length: cycles - 1 }, (unused, index) => `
        <span class="progress-gauge is-finished" data-cycle="${gaugeColorIndex(index + 1)}" role="img" aria-label="${index + 1}周目は完了">
          <span class="progress-gauge-answered" style="width:100%"></span>
          <span class="progress-gauge-mastered" style="width:100%"></span>
        </span>`).join("");
  return `
      <span class="progress-gauge-stack">
        ${finishedBars}
        <span class="progress-gauge" data-cycle="${currentColor}" role="img" aria-label="${escapeHtml(label)}">
          <span class="progress-gauge-answered" style="width:${answeredPercent}%"></span>
          <span class="progress-gauge-mastered" style="width:${masteredPercent}%"></span>
        </span>
      </span>
      <span class="progress-legend" data-cycle="${currentColor}">
        ${cycles > 1 ? `<span class="progress-figure is-cycle">${cycles}周目</span>` : ""}
        <span class="progress-figure is-answered">解答済み ${answeredPercent}%（${progress.answeredItems}/${progress.totalItems}）</span>
        <span class="progress-figure is-mastered">習得 ${masteredPercent}%（${progress.masteredItems}/${progress.totalItems}）</span>
      </span>`;
}

// 現在選んでいる形式で、指定した内容・重要度に絞った進捗を出す。
function recallTypesForContent(content) {
  if (!isRecallSubject()) return [];
  return content === "all"
    ? [`${state.subject}-term`, `${state.subject}-short`]
    : [`${state.subject}-${content}`];
}

// いま選んでいる学習内容が対象にしている項目種別
function studyContentTypes() {
  if (isRecallSubject()) return recallTypesForContent(state.studySelection.content ?? "all");
  const contents = state.studySelection.contents ?? [];
  return contents.length ? [...contents] : [...ENGLISH_CONTENT_TYPES];
}

function selectionProgress({ types = [], importance = [] } = {}) {
  const mode = exactStudyMode(state.studySelection);
  if (!mode) return null;
  return summarizeRangeModeProgress({
    items: state.items,
    history: state.history,
    ranges: state.filters.ranges,
    types,
    importance,
    mode,
    masteredIds: masteredIdsForMode(state.studyProgress, mode, { criterion: masteryCriterion() }),
  });
}

function modeProgressCard(card) {
  const entry = cardStudyProgress(card);
  const cycle = studyProgressSummary(entry?.progress ?? null);
  const progress = summarizeRangeModeProgress({
    items: state.items,
    history: state.history,
    ranges: state.filters.ranges,
    types: card.types,
    mode: card.mode,
    masteredIds: masteredIdsForMode(state.studyProgress, card.mode, { criterion: masteryCriterion() }),
  });
  // 表示中の範囲・条件に一致する周回が、いちばん最近学習したセットのときだけ
  // この形式をハイライトする。
  const resumable = Boolean(entry) && entry.key === latestStudyEntry()?.key;
  const cycleLabel = entry ? contentLabelFromProgressKey(entry.meta) : "";
  const cycleCopy = cycle
    ? `${cycleLabel ? `${cycleLabel} ` : ""}${cycle.masteryRound > 1 ? `R${cycle.masteryRound}· ` : ""}${cycle.cycleNumber}周目 残り${cycle.remainingCount}`
    : "";
  return `
    <button class="mode-progress-card${resumable ? " is-in-progress" : ""}" type="button" data-study-target="${escapeHtml(card.key)}"${progress.totalItems ? "" : ' disabled aria-disabled="true"'}>
      <span class="mode-progress-head">
        <strong>${escapeHtml(card.title)}</strong>
        ${progress.totalItems
          ? cycleCopy ? `<span class="mode-progress-cycle">${escapeHtml(cycleCopy)}</span>` : ""
          : '<span class="mode-progress-cycle">出題できません</span>'}
        <span class="card-arrow" aria-hidden="true">›</span>
      </span>
${progressGaugeMarkup(progress, cycle?.cycleNumber ?? 1)}
    </button>`;
}

function renderRangeDetail() {
  const ranges = state.filters.ranges;
  if (!ranges.length) {
    setView("dashboard");
    return;
  }
  elements.rangeDetailTitle.textContent = rangeDetailLabel(ranges);
  elements.rangeDetailCopy.textContent = ranges.length > 1 ? `${ranges.length}範囲` : "";
  elements.rangeDetailGroups.innerHTML = dashboardTargetGroups().map((group) => `
    <section class="mode-group" aria-label="${escapeHtml(group.label)}">
      <h2 class="mode-group-title">${escapeHtml(group.label)}</h2>
      <div class="mode-card-list">${group.cards.map((card) => modeProgressCard(card)).join("")}</div>
    </section>`).join("");
}

function startStudyFromTarget(key) {
  const target = dashboardTargetByKey(key);
  if (!target) return;
  const config = studyConfigForTarget({
    target,
    ranges: state.filters.ranges.length ? state.filters.ranges : dashboardRanges(),
    filters: state.filters,
    sortKey: state.sortKey,
  });
  state.filters = { ...state.filters, ...config.filters };
  state.rangeSelectionMode = "custom";
  state.studySelection = config.selection;
  state.studyFlowMode = "dashboard";
  // 一問一答は形式カードの時点で学習内容も決まっているので重要度へ直行する。
  setView(isRecallSubject() ? "study-importance" : "study-content");
}

// 画面を離れる直前に、いまの周回を同期で控えへ逃がす。非同期の保存が
// 間に合わなくても、次回の起動時に控えから復元される。
function stashStudyProgress() {
  const session = state.session;
  const progress = session?.progressKey && session.progress
    ? { ...state.studyProgress, [session.progressKey]: session.progress }
    : state.studyProgress;
  if (!progress || !Object.keys(progress).length) return;
  stashMeta("studyProgress", progress);
}

// クイズから別の画面へ移るときの後始末。左上のマークからでも、×からでも
// 同じ経路を通し、再出題タイマーを止めて学習途中の状態を保存し切る。
function leaveQuiz() {
  const session = state.session;
  if (!session) return true;
  if (session.results.length && !window.confirm("この学習を終了しますか？")) return false;
  if (session.reviewTimer) clearTimeout(session.reviewTimer);
  stashStudyProgress();
  state.session = null;
  return true;
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
  if (!isMaxMode() || !state.settings.sound) maxAudio.stopAll();
  else maxAudio.setIntensity(state.settings.soundIntensity);
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
      <div class="settings-row sound-intensity-row">
        <span><strong>効果音の強さ</strong><small>音量ではなくレイヤーと余韻を調整</small></span>
        <div class="segmented-options compact-segments" role="radiogroup" aria-label="効果音の強さ">
          <button type="button" data-sound-intensity="gentle" class="${state.settings.soundIntensity === "full" ? "" : "selected"}">控えめ</button>
          <button type="button" data-sound-intensity="full" class="${state.settings.soundIntensity === "full" ? "selected" : ""}">フル</button>
        </div>
      </div>
      ${toggle("vibration", "振動", "対応端末のみ短く振動")}
    </section>
    <section class="settings-card">
      <h2>学習状況・周回</h2>
      <p>出題する問題はアプリが周回状況から自動で決めます。ここでは「習得」とみなす条件だけを選びます。</p>
      <div class="criterion-options" role="radiogroup" aria-label="習得条件">
        ${MASTERY_CRITERIA.map((criterion) => `
          <button
            class="criterion-option${masteryCriterion() === criterion ? " selected" : ""}"
            type="button"
            role="radio"
            aria-checked="${masteryCriterion() === criterion}"
            data-mastery-criterion="${criterion}"
          >
            <span class="criterion-mark" aria-hidden="true"></span>
            <span><strong>${escapeHtml(MASTERY_CRITERION_LABELS[criterion].title)}</strong><small>${escapeHtml(MASTERY_CRITERION_LABELS[criterion].detail)}</small></span>
          </button>`).join("")}
      </div>
      <p class="settings-note">習得条件を変えると、周回と習得の判定だけを新しいラウンドとしてやり直します。回答数・正解数などの学習履歴は残ります。</p>
    </section>
    <section class="settings-card">
      <h2>学習画面</h2>
      ${toggle("showSources", "出典を表示", "回答後に教材と範囲を表示")}
      ${toggle("useSystemKeyboard", "端末のキーボードを使う", "オフにすると、キーボード入力でアプリ内の小文字英字キーボードを表示します")}
    </section>
    <section class="settings-card">
      <h2>学習データ</h2><p>正誤履歴、最近の学習条件、設定をこの端末から削除します。</p>
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
  timelineTimers: [],
  animations: new Set(),
  ambient: false,
  cueClass: "",
};

const maxAudio = createMaxAudioEngine();
let calloutTimer = 0;

function prefersReducedMotion() {
  return REDUCED_MOTION_QUERY.matches;
}

function isLowPowerDevice() {
  return (navigator.hardwareConcurrency ?? 8) <= 4
    || (navigator.deviceMemory ?? 8) <= 4
    || navigator.connection?.saveData === true;
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

function cueTimeout(callback, delay) {
  if (delay <= 0) {
    callback();
    return 0;
  }
  const id = setTimeout(() => {
    fx.timelineTimers = fx.timelineTimers.filter((timer) => timer !== id);
    callback();
  }, delay);
  fx.timelineTimers.push(id);
  return id;
}

function clearCueTimeline() {
  fx.timelineTimers.forEach(clearTimeout);
  fx.timelineTimers = [];
}

function clearFxTimers() {
  fx.timers.forEach(clearTimeout);
  fx.timers = [];
  clearCueTimeline();
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
  context.save();
  context.globalCompositeOperation = "lighter";
  for (const particle of fx.particles) {
    particle.life -= particle.decay * step;
    if (particle.life <= 0) continue;
    particle.x += particle.vx * step;
    particle.y += particle.vy * step;
    particle.vy += particle.gravity * step;
    particle.vx *= 1 - particle.drag * step;
    particle.rotation += particle.spin * step;
    context.globalAlpha = Math.min(1, particle.life * 1.7) * particle.alpha;
    context.fillStyle = particle.color;
    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(particle.rotation);
    if (particle.kind === "prism") {
      context.beginPath();
      context.moveTo(0, -particle.size * 1.4);
      context.lineTo(particle.size, particle.size);
      context.lineTo(-particle.size * 0.8, particle.size * 0.55);
      context.closePath();
      context.fill();
    } else if (particle.kind === "shard") {
      context.fillRect(-particle.size, -particle.size * 0.3, particle.size * 2, particle.size * 0.6);
    } else if (particle.kind === "coin") {
      context.strokeStyle = particle.color;
      context.lineWidth = Math.max(1, particle.size * 0.24);
      context.beginPath();
      context.ellipse(0, 0, particle.size, particle.size * Math.max(0.18, Math.abs(Math.cos(particle.rotation))), 0, 0, Math.PI * 2);
      context.stroke();
    } else if (particle.kind === "star") {
      context.beginPath();
      for (let point = 0; point < 8; point += 1) {
        const radius = point % 2 === 0 ? particle.size * 1.6 : particle.size * 0.42;
        const angle = -Math.PI / 2 + point * Math.PI / 4;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (point === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fill();
    } else {
      context.beginPath();
      context.arc(0, 0, particle.size, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    alive.push(particle);
  }
  context.restore();
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
    context.globalCompositeOperation = "lighter";
    context.lineWidth = Math.max(0.6, ring.width * ring.life);
    context.strokeStyle = ring.color;
    context.beginPath();
    context.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    context.stroke();
    alive.push(ring);
  }
  context.globalCompositeOperation = "source-over";
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
    context.globalAlpha = Math.max(0, ray.life) * ray.alpha;
    context.globalCompositeOperation = "lighter";
    context.strokeStyle = ray.color;
    context.lineWidth = ray.width;
    context.beginPath();
    context.moveTo(ray.x + cos * ray.distance, ray.y + sin * ray.distance);
    context.lineTo(ray.x + cos * (ray.distance + ray.length), ray.y + sin * (ray.distance + ray.length));
    context.stroke();
    alive.push(ray);
  }
  context.globalCompositeOperation = "source-over";
  fx.rays = alive;
}

function particleBudget() {
  return isLowPowerDevice() ? 170 : 460;
}

function impactOrigin() {
  const context = ensureFxCanvas();
  if (!context) return fxOrigin();
  const target = elements.quizContent?.querySelector(
    ".choice-button.correct, .word-slot.is-correct, .feedback-result, .question-card, .result-complete-mark",
  );
  const bounds = target?.getBoundingClientRect();
  if (!bounds?.width) return fxOrigin();
  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
}

function spawnParticleBurst({
  count = 90,
  power = 1,
  origin = null,
  speed = 1,
  shards = false,
  palette = PARTICLE_COLORS,
  kinds = ["spark"],
  gravity = 0.06,
  spread = Math.PI * 2,
  direction = -Math.PI / 2,
} = {}) {
  if (!canvasEffectsEnabled()) return;
  const context = ensureFxCanvas();
  if (!context) return;
  const center = origin ?? impactOrigin();
  const total = Math.min(Math.round(count), particleBudget() - fx.particles.length);
  if (total <= 0) return;
  for (let index = 0; index < total; index += 1) {
    const angle = direction - spread / 2 + spread * (index / Math.max(1, total - 1)) + (Math.random() - 0.5) * 0.34;
    const velocity = (1.8 + Math.random() * (4.4 + power)) * speed;
    const depth = 0.55 + Math.random() * 0.8;
    const kind = shards && index % 3 === 0
      ? "shard"
      : kinds[index % kinds.length] ?? "spark";
    fx.particles.push({
      x: center.x,
      y: center.y,
      vx: Math.cos(angle) * velocity * depth,
      vy: Math.sin(angle) * velocity * depth - 0.7,
      size: (1.1 + Math.random() * (2.2 + power * 0.7)) * depth,
      gravity: gravity * (0.7 + Math.random() * 0.7),
      drag: 0.006 + Math.random() * 0.006,
      decay: 0.015 + Math.random() * 0.018,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.26,
      kind,
      alpha: 0.58 + depth * 0.32,
      color: palette[index % palette.length],
      life: 1,
    });
  }
  startFxLoop();
}

function spawnConvergingParticles({ count = 36, origin = null, palette = PARTICLE_COLORS, power = 2 } = {}) {
  if (!canvasEffectsEnabled()) return;
  const context = ensureFxCanvas();
  if (!context) return;
  const center = origin ?? impactOrigin();
  const total = Math.min(count, particleBudget() - fx.particles.length);
  for (let index = 0; index < total; index += 1) {
    const angle = Math.PI * 2 * index / Math.max(1, total) + Math.random() * 0.2;
    const radius = Math.max(fx.width, fx.height) * (0.3 + Math.random() * 0.34);
    const speed = 6 + power * 1.5 + Math.random() * 4;
    fx.particles.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      vx: -Math.cos(angle) * speed,
      vy: -Math.sin(angle) * speed,
      size: 1.2 + Math.random() * 2.6,
      gravity: 0,
      drag: 0.002,
      decay: 0.026 + Math.random() * 0.012,
      rotation: angle,
      spin: 0.06,
      kind: index % 4 === 0 ? "prism" : "spark",
      alpha: 0.8,
      color: palette[index % palette.length],
      life: 1,
    });
  }
  startFxLoop();
}

function spawnGoldShower({ count = 30, palette = PARTICLE_COLORS, power = 3 } = {}) {
  if (!canvasEffectsEnabled()) return;
  const context = ensureFxCanvas();
  if (!context) return;
  const total = Math.min(count, particleBudget() - fx.particles.length);
  for (let index = 0; index < total; index += 1) {
    const depth = 0.55 + Math.random() * 0.8;
    fx.particles.push({
      x: Math.random() * fx.width,
      y: -20 - Math.random() * fx.height * 0.3,
      vx: (Math.random() - 0.5) * (1.2 + power * 0.25),
      vy: (2 + Math.random() * 2.8) * depth,
      size: (2 + Math.random() * (2.5 + power * 0.4)) * depth,
      gravity: 0.055 * depth,
      drag: 0.004,
      decay: 0.008 + Math.random() * 0.008,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.32,
      kind: index % 3 === 0 ? "star" : "coin",
      alpha: 0.72 + depth * 0.2,
      color: palette[index % palette.length],
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
  if (fx.rings.length > 12) return;
  const center = origin ?? impactOrigin();
  fx.rings.push({ x: center.x, y: center.y, radius, speed, width, color, decay, alpha, life: 1 });
  startFxLoop();
}

function spawnSpeedLines({ origin = null, count = 24, power = 1, palette = PARTICLE_COLORS, inward = false } = {}) {
  if (!canvasEffectsEnabled()) return;
  const context = ensureFxCanvas();
  if (!context) return;
  if (fx.rays.length > 96) return;
  const center = origin ?? impactOrigin();
  const total = isLowPowerDevice() ? Math.ceil(count / 2) : count;
  for (let index = 0; index < total; index += 1) {
    const angle = (Math.PI * 2 * index) / total + Math.random() * 0.25;
    fx.rays.push({
      x: center.x,
      y: center.y,
      angle,
      distance: inward ? 220 + Math.random() * 180 : 40 + Math.random() * 90,
      length: 90 + Math.random() * (140 + power * 40),
      speed: (inward ? -1 : 1) * (16 + Math.random() * (12 + power * 6)),
      width: 1 + Math.random() * 2.2,
      decay: 0.035 + Math.random() * 0.02,
      color: palette[index % palette.length],
      alpha: inward ? 0.34 : 0.52,
      life: 1,
    });
  }
  startFxLoop();
}

function spawnLightColumns({ count = 2, origin = null, palette = PARTICLE_COLORS, power = 3 } = {}) {
  if (!canvasEffectsEnabled()) return;
  const context = ensureFxCanvas();
  if (!context) return;
  const center = origin ?? impactOrigin();
  const total = Math.min(count * 2, 12);
  for (let index = 0; index < total; index += 1) {
    const upward = index % 2 === 0;
    fx.rays.push({
      x: center.x + (index - total / 2) * 14,
      y: center.y,
      angle: upward ? -Math.PI / 2 : Math.PI / 2,
      distance: 0,
      length: fx.height * (0.42 + Math.random() * 0.38),
      speed: 3 + power,
      width: 3 + Math.random() * (3 + power),
      decay: 0.014 + Math.random() * 0.008,
      color: palette[index % palette.length],
      alpha: 0.3,
      life: 1,
    });
  }
  startFxLoop();
}

/* --- world layer ---------------------------------------------------------- */

/**
 * transformを載せてよい要素だけを返す。
 * position:fixed の子（.next-button / .bottom-nav）を
 * 内包する要素は含めない（含めると固定配置の基準がずれて回答UIが飛ぶ）。
 */
function worldStageElements() {
  const nodes = [];
  if (state.view === "quiz") {
    const shell = elements.quizContent?.querySelector(".quiz-shell");
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

function pulseVibration(power = 1, event = "correct") {
  if (!state.settings.vibration || !navigator.vibrate) return;
  if (event === "wrong") navigator.vibrate(8);
  else if (["perfect", "sss-master", "combo-30"].includes(event)) navigator.vibrate([32, 24, 48, 28, 62]);
  else if (power >= 4) navigator.vibrate([30, 24, 52]);
  else navigator.vibrate(power >= 2 ? 30 : 13);
}

function maxSoundEnabled() {
  return shouldPlayMaxSound(state.settings, {
    hidden: document.hidden,
    audioAvailable: Boolean(window.AudioContext || window.webkitAudioContext),
  });
}

function unlockMaxAudio() {
  return maxAudio.unlock({
    enabled: maxSoundEnabled(),
    intensity: state.settings.soundIntensity,
  });
}

function playMaxSound(event, options = {}) {
  return maxAudio.play(event, {
    ...options,
    enabled: maxSoundEnabled(),
    hidden: document.hidden,
    intensity: state.settings.soundIntensity,
  });
}

/* --- UI layer ------------------------------------------------------------- */

function renderMaxCallout(label, detail = "", variant = "pop", options = {}) {
  const callout = elements.maxCallout;
  if (!callout) return 0;
  clearTimeout(calloutTimer);
  const calm = prefersReducedMotion();
  const duration = calm ? Math.min(900, options.duration ?? 700) : options.duration ?? (variant === "slam" ? 1000 : 680);
  callout.className = `max-callout max-callout--${calm ? "calm" : variant} max-callout--cue-${options.event ?? "correct"}`;
  callout.dataset.cue = options.event ?? "correct";
  callout.style.setProperty("--max-callout-duration", `${duration}ms`);
  callout.innerHTML = `
    <div class="max-callout-inner" data-label="${escapeHtml(label)}">
      ${options.emblem ? `<span class="max-callout-emblem" aria-hidden="true">${escapeHtml(options.emblem)}</span>` : ""}
      <span class="max-callout-label">${escapeHtml(label)}</span>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
      <span class="max-callout-shine" aria-hidden="true"></span>
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

function clearCueVisualState() {
  if (fx.cueClass) document.body.classList.remove(fx.cueClass);
  fx.cueClass = "";
  document.body.classList.remove("fx-anticipation", "fx-answer", "fx-fanfare", "fx-jackpot", "fx-destroyed");
  document.body.removeAttribute("data-max-cue");
  if (elements.fxStage) elements.fxStage.className = "fx-stage";
}

function applyCueAnticipation(plan, visual) {
  document.body.classList.add("fx-anticipation");
  if (elements.fxStage) elements.fxStage.className = `fx-stage fx-stage--${plan.event}`;
  if (elements.fxEnergyCore && effectsLevel() === "full") {
    const duration = Math.max(150, plan.timeline.impactAt + 90);
    fxAnimate(elements.fxEnergyCore, [
      { opacity: 0, transform: "translate3d(-50%,-50%,0) scale(.12)" },
      { opacity: 0.92, offset: 0.7, transform: "translate3d(-50%,-50%,0) scale(.72)" },
      { opacity: 0, transform: "translate3d(-50%,-50%,0) scale(1.8)" },
    ], { duration, easing: "cubic-bezier(.2,.78,.25,1)" });
  }
  if (visual.converge) {
    spawnConvergingParticles({ count: visual.converge, palette: visual.colors, power: plan.power });
    spawnSpeedLines({ count: Math.min(visual.rays, visual.converge), power: plan.power, palette: visual.colors, inward: true });
  }
}

function applyCueHitStop(plan, visual) {
  if (visual.freeze > 0) triggerImpactFreeze(visual.freeze);
  if (plan.event === "max-enter") triggerScreenInvert(54);
}

function applyCueFlash(plan, visual) {
  if (visual.flash > 0) triggerScreenFlash(visual.flash, 220 + plan.power * 42);
  if (visual.palette === "gold" || ["perfect", "sss-master", "combo-30"].includes(plan.event)) {
    fxAnimate(elements.fxGoldFrame, [
      { opacity: 0 },
      { opacity: effectsLevel() === "reduced" ? 0.22 : 0.78, offset: 0.18 },
      { opacity: 0 },
    ], { duration: Math.min(720, plan.duration), easing: "ease-out" });
  }
}

function applyCueCallout(plan, visual, label, detail) {
  if (visual.callout === "none" || !label) return;
  renderMaxCallout(label, detail, visual.callout, {
    duration: Math.min(plan.duration, ["perfect", "sss-master"].includes(plan.event) ? 1500 : 1120),
    emblem: visual.emblem,
    event: plan.event,
  });
}

function applyCueImpact(plan, visual) {
  const origin = impactOrigin();
  if (plan.event === "wrong") {
    const wrongTarget = elements.quizContent?.querySelector(".choice-button.wrong, .word-slot.is-wrong, .feedback-wrong");
    fxAnimate(wrongTarget, [
      { transform: "translate3d(0,0,0) scale(1)", filter: "saturate(1)" },
      { transform: "translate3d(0,2px,0) scale(.985)", filter: "saturate(.62)", offset: 0.35 },
      { transform: "translate3d(0,0,0) scale(1)", filter: "saturate(1)" },
    ], { duration: 210, easing: "ease-out" });
    triggerShockwave({ origin, speed: 7, width: 2, color: "rgba(170,178,190,.55)", decay: 0.06, alpha: 0.5 });
    return;
  }
  document.body.classList.add("fx-answer");
  triggerWorldImpact({ zoom: visual.zoom, shake: visual.shake, duration: 280 + plan.power * 42 });
  triggerScreenPulse(Math.min(0.62, 0.16 + visual.aura * 0.08), Math.min(760, plan.duration));
  if (plan.power >= 3) triggerRgbSplit(Math.min(170, 90 + plan.power * 18));
  pulseVibration(plan.power, plan.event);
  for (let index = 0; index < visual.rings; index += 1) {
    triggerShockwave({
      origin,
      radius: 6 + index * 4,
      speed: 12 + plan.power * 4 - index * 1.5,
      width: Math.max(2, 8 + plan.power * 1.2 - index * 1.3),
      color: visual.colors[index % visual.colors.length],
      decay: 0.026 + index * 0.004,
      alpha: Math.max(0.38, 1 - index * 0.13),
    });
  }
  if (visual.beams) spawnLightColumns({ count: visual.beams, origin, palette: visual.colors, power: plan.power });
  if (plan.event === "weakness-destroyed") {
    document.body.classList.add("fx-destroyed");
    fxAnimate(elements.fxCrack, [
      { opacity: 0, transform: "scale(.4)" },
      { opacity: 0.9, offset: 0.28, transform: "scale(1)" },
      { opacity: 0, transform: "scale(1.5)" },
    ], { duration: 740, easing: "cubic-bezier(.15,.8,.2,1)" });
  }
}

function applyCueParticles(plan, visual) {
  const origin = impactOrigin();
  const baseKinds = visual.prisms ? ["spark", "prism", "shard"] : ["spark"];
  spawnParticleBurst({
    count: visual.particles,
    power: plan.power,
    origin,
    speed: 0.9 + plan.power * 0.12,
    palette: visual.colors,
    kinds: baseKinds,
    shards: visual.prisms > 20,
  });
  if (visual.prisms) {
    spawnParticleBurst({ count: visual.prisms, power: plan.power, origin, speed: 1.15, palette: visual.colors, kinds: ["prism", "shard"] });
  }
  if (visual.coins || visual.stars) {
    spawnParticleBurst({
      count: visual.coins + visual.stars,
      power: plan.power,
      origin,
      speed: 0.86,
      palette: visual.colors,
      kinds: ["coin", "star", "coin"],
      gravity: 0.085,
      spread: Math.PI * 1.45,
    });
  }
  if (visual.rays) spawnSpeedLines({ origin, count: visual.rays, power: plan.power, palette: visual.colors });
  if (visual.shower) spawnGoldShower({ count: visual.shower, palette: visual.colors, power: plan.power });
}

function applyCueFanfare(plan, visual) {
  if (plan.power < 2) return;
  document.body.classList.add("fx-fanfare");
  if (plan.power >= 4) document.body.classList.add("fx-jackpot");
  fxAnimate(elements.fxLightColumn, [
    { opacity: 0, transform: "translate3d(-50%,8%,0) scaleX(.35)" },
    { opacity: effectsLevel() === "reduced" ? 0.16 : 0.7, offset: 0.22, transform: "translate3d(-50%,0,0) scaleX(1)" },
    { opacity: 0, transform: "translate3d(-50%,-5%,0) scaleX(1.4)" },
  ], { duration: Math.min(920, plan.duration), easing: "ease-out" });
}

function runMaxCue(event, { combo = 0, power = undefined, label = "", detail = "", variation = null } = {}) {
  if (!isMaxMode()) return null;
  const plan = resolveMaxCue(event, { combo, power, variation });
  const visual = scaledVisualPlan(plan.visual, {
    lowPower: isLowPowerDevice(),
    reducedMotion: prefersReducedMotion(),
  });
  clearCueTimeline();
  clearCueVisualState();
  fx.cueClass = `fx-cue-${plan.event}`;
  document.body.classList.add(fx.cueClass);
  document.body.dataset.maxCue = plan.event;
  playMaxSound(plan.event, { combo: plan.combo, power: plan.power, variation: plan.pitch.variation });

  const handlers = {
    anticipationAt: () => applyCueAnticipation(plan, visual),
    hitStopAt: () => applyCueHitStop(plan, visual),
    flashAt: () => applyCueFlash(plan, visual),
    calloutAt: () => applyCueCallout(plan, visual, label, detail),
    impactAt: () => applyCueImpact(plan, visual),
    particleBurstAt: () => applyCueParticles(plan, visual),
    fanfareAt: () => applyCueFanfare(plan, visual),
    tailEndAt: () => {
      document.body.classList.remove("fx-max-entrance");
      clearCueVisualState();
    },
  };
  for (const phase of MAX_TIMELINE_PHASES) cueTimeout(handlers[phase], plan.timeline[phase]);
  return plan;
}

function installMaxEffectsLab() {
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  if (!localHost || !new URLSearchParams(location.search).has("max-effects-lab")) return;
  const samples = Object.freeze({
    "max-enter": { combo: 0, label: "MAX MODE", detail: "READY" },
    correct: { combo: 1, label: "CORRECT" },
    "combo-3": { combo: 3, label: "3 COMBO", detail: "FLOW START" },
    "combo-5": { combo: 5, label: "5 COMBO", detail: "RISING" },
    "combo-10": { combo: 10, label: "10 COMBO", detail: "BLAZE" },
    "combo-20": { combo: 20, label: "20 COMBO", detail: "JACKPOT NEAR" },
    "combo-30": { combo: 30, label: "UNSTOPPABLE", detail: "30 COMBO" },
    "new-record": { combo: 12, label: "NEW RECORD", detail: "12 COMBO" },
    "weakness-destroyed": { combo: 8, label: "WEAKNESS DESTROYED", detail: "BREAK THROUGH" },
    perfect: { combo: 20, label: "PERFECT", detail: "20 / 20" },
    "sss-master": { combo: 30, label: "SSS MASTER", detail: "30 / 30" },
    wrong: { combo: 0, label: "" },
  });
  window.__WORDS_MAX_EFFECTS_LAB__ = Object.freeze({
    events: Object.freeze(Object.keys(samples)),
    play: (event, options = {}) => runMaxCue(event, options),
    stop: () => resetMaxEffects({ keepAmbience: true }),
    audioState: () => maxAudio.debugState(),
  });
  state.settings.effectsMode = "max";
  state.settings.vibration = false;
  const panel = document.createElement("details");
  panel.className = "max-effects-lab";
  panel.open = true;
  panel.innerHTML = `
    <summary>MAX EFFECTS LAB <span data-lab-status>visual / muted</span></summary>
    <div class="max-effects-lab-controls">
      <button type="button" data-lab-max>MAX ON</button>
      <button type="button" data-lab-sound>SOUND ON</button>
      <button type="button" data-lab-simple>SIMPLE / STOP</button>
      ${Object.keys(samples).map((event) => `<button type="button" data-lab-cue="${event}">${event}</button>`).join("")}
    </div>`;
  panel.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-lab-max")) {
      state.settings.effectsMode = "max";
      applySettings();
      triggerMaxEntrance("LAB");
    } else if (button.hasAttribute("data-lab-sound")) {
      state.settings.effectsMode = "max";
      state.settings.sound = true;
      applySettings();
      unlockMaxAudio();
      triggerMaxEntrance("AUDIO READY");
    } else if (button.hasAttribute("data-lab-simple")) {
      state.settings.effectsMode = "simple";
      state.settings.sound = false;
      applySettings();
    } else if (button.dataset.labCue) {
      if (!isMaxMode()) {
        state.settings.effectsMode = "max";
        applySettings();
      }
      runMaxCue(button.dataset.labCue, samples[button.dataset.labCue]);
    }
    const status = panel.querySelector("[data-lab-status]");
    if (status) {
      const audio = maxAudio.debugState();
      status.textContent = `${isMaxMode() ? "MAX" : "SIMPLE"} / ${audio.contextState} / ${audio.activeVoices} voices`;
    }
  });
  document.body.append(panel);
}

/* --- sequences ------------------------------------------------------------ */

function triggerMaxEntrance(detail = "READY") {
  if (!isMaxMode()) return;
  resetMaxEffects({ keepAmbience: true, keepAudio: true });
  syncMaxAmbience();
  document.body.classList.add("fx-max-entrance");
  runMaxCue("max-enter", { label: "MAX MODE", detail, power: 4 });
}

/** MAX終了：突入の逆再生。エネルギーが抜けて通常世界へ戻る。 */
function triggerMaxExit() {
  clearFxTimers();
  clearTimeout(calloutTimer);
  clearCueVisualState();
  maxAudio.stopAll();
  document.body.classList.remove("fx-freeze", "fx-rgb", "fx-answer", "fx-max-entrance", "fx-fanfare", "fx-jackpot", "fx-destroyed");
  fx.frozen = false;
  fx.particles = [];
  fx.rings = [];
  fx.rays = [];
  stopFxLoop();
  if (fx.context && fx.width) fx.context.clearRect(0, 0, fx.width, fx.height);
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
function resetMaxEffects({ keepAmbience = false, keepAudio = false } = {}) {
  clearFxTimers();
  clearTimeout(calloutTimer);
  cancelFxAnimations();
  clearCueVisualState();
  if (!keepAudio) maxAudio.stopAll();
  fx.frozen = false;
  fx.particles = [];
  fx.rings = [];
  fx.rays = [];
  stopFxLoop();
  if (fx.context && fx.width) fx.context.clearRect(0, 0, fx.width, fx.height);
  document.body.classList.remove(
    "fx-freeze",
    "fx-rgb",
    "fx-answer",
    "fx-max-entrance",
    "fx-max-exit",
    "fx-fanfare",
    "fx-jackpot",
    "fx-destroyed",
  );
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
  const event = maxCueForAnswer({ correct: true, combo: state.combo, special });
  const copy = {
    correct: ["CORRECT", ""],
    "combo-3": [`${state.combo} COMBO`, "FLOW START"],
    "combo-5": [`${state.combo} COMBO`, "RISING"],
    "combo-10": [`${state.combo} COMBO`, "BLAZE"],
    "combo-20": [`${state.combo} COMBO`, "JACKPOT NEAR"],
    "combo-30": ["UNSTOPPABLE", `${state.combo} COMBO`],
    "new-record": ["NEW RECORD", `${state.combo} COMBO`],
    "weakness-destroyed": ["WEAKNESS DESTROYED", "BREAK THROUGH"],
  }[event] ?? ["CORRECT", ""];
  runMaxCue(event, { combo: state.combo, label: copy[0], detail: copy[1] });
}

const STUDY_PROGRESS_LIMIT = 40;

function setView(view) {
  if (view === "home") view = "dashboard";
  if (view === "range-detail" && !state.filters.ranges.length) view = "dashboard";
  if (view === "list" && isHealthSubject()) view = "health-notes";
  if (view === "list" && isPublicSubject()) view = "public-notes";
  if (view === "health-notes" && !isHealthSubject()) view = "list";
  if (view === "public-notes" && !isPublicSubject()) view = "list";
  if (!["period", "subject"].includes(view) && !state.subject) view = state.selectedPeriod ? "subject" : "period";
  if (view !== "quiz" && state.session?.reviewTimer) {
    clearTimeout(state.session.reviewTimer);
    state.session.reviewTimer = null;
  }
  if (view !== "quiz") {
    clearCardFlights();
    quizGestureController?.reset();
  }
  state.view = view;
  document.querySelectorAll("[data-view]").forEach((section) => {
    section.hidden = section.dataset.view !== view;
  });
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.viewTarget === view ||
        (button.dataset.viewTarget === "dashboard" && view === "range-detail"),
    );
  });
  elements.bottomNav.hidden = ["quiz", "period", "subject"].includes(view);
  elements.appHeader.hidden = ["quiz", "period", "subject"].includes(view);
  document.body.classList.toggle("quiz-active", view === "quiz");
  document.body.classList.toggle("health-notes-active", view === "health-notes");
  document.body.classList.toggle("public-notes-active", view === "public-notes");
  window.scrollTo({ top: 0, behavior: "auto" });

  if (view === "dashboard") renderDashboard();
  if (view === "range-detail") renderRangeDetail();
  if (view === "study-content") renderStudyContent();
  if (view === "study-method") renderStudyMethod();
  if (view === "study-scope") renderStudyScope();
  if (view === "study-range-select") renderStudyRangeSelect();
  if (view === "study-importance") renderStudyImportance();
  if (view === "study-importance-select") renderStudyImportanceSelect();
  if (view === "study-content-multi") renderStudyContentMulti();
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
    ? `累計 ${summary.correct.toLocaleString()}正解 / ${summary.attempts.toLocaleString()}回答`
    : `${state.items.length}${isRecallSubject() ? "問" : "語句"}`;
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

// 単語帳は検索だけで絞り、並びは重要度順に固定する。
const LIST_SORT_KEY = "importance-desc";

function renderList(resetLimit = false) {
  if (resetLimit) state.listLimit = 60;
  const search = elements.listSearch.value.trim();
  const items = sortItems(
    filteredItems({ ...emptyFilters(), search }),
    state.history,
    LIST_SORT_KEY,
  );
  elements.listCount.textContent = `${items.length.toLocaleString()}${isRecallSubject() ? "問" : "語句"}`;
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
          ${item.type === "word" ? '<span class="word-form-kind">原形</span>' : ""}
          <h2>${escapeHtml(item.english)}</h2>
          <p>${escapeHtml(item.japanese)}</p>
          ${item.type === "word" && item.surfaceForms?.length
            ? `<p class="word-surface-forms"><span>本文中の形</span>${escapeHtml(item.surfaceForms.join(" / "))}</p>`
            : ""}
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

function cloneSessionConfig(config) {
  if (!config) return null;
  return {
    ...config,
    filters: config.filters ? {
      ...config.filters,
      ranges: [...(config.filters.ranges ?? [])],
      importance: [...(config.filters.importance ?? [])],
      types: [...(config.filters.types ?? [])],
      tags: [...(config.filters.tags ?? [])],
    } : null,
    selection: config.selection ? normalizeStudySelection(config.selection) : null,
    itemIds: config.itemIds ? [...config.itemIds] : null,
  };
}

function masteryCriterion() {
  return normalizeMasteryCriterion(state.settings.masteryCriterion);
}

// 周回状態はメタ領域に組み合わせキーごとで保存する。件数は最終更新順で上限を設ける。
function persistStudyProgress(key, progress) {
  if (!key || !progress) return;
  const next = { ...state.studyProgress, [key]: progress };
  state.studyProgress = Object.fromEntries(
    Object.entries(next)
      .sort((left, right) => (right[1]?.lastUpdatedAt ?? 0) - (left[1]?.lastUpdatedAt ?? 0))
      .slice(0, STUDY_PROGRESS_LIMIT),
  );
  setMeta("studyProgress", state.studyProgress).catch(console.warn);
}

// 学習途中の周回から続きを始められるよう、条件を周回キーごとに控える。
// 周回状態が消えたキーは一緒に落とす。
function persistStudyConfig(key, config) {
  const normalized = config ? normalizeRecentStudyConfig(config) : null;
  if (!key || !normalized) return;
  state.studyConfigs = Object.fromEntries(
    Object.entries({ ...state.studyConfigs, [key]: normalized })
      .filter(([storedKey]) => storedKey === key || storedKey in state.studyProgress),
  );
  setMeta("studyConfigs", state.studyConfigs).catch(console.warn);
}

function storedStudyProgress(key, { itemIds = null } = {}) {
  if (!key) return null;
  return normalizeStudyProgress(state.studyProgress[key], {
    itemIds,
    criterion: masteryCriterion(),
  });
}

// 回答状況の絞り込みは周回エンジンが決めるので、ここでは performance を使わない。
function studyPoolItems(config) {
  const selection = normalizeStudySelection(config.selection);
  return applyFilters(state.items, state.history, {
    ...config.filters,
    performance: "all",
    search: "",
    modes: [],
    performanceModes: [],
  }).filter((item) => studyModeForItem(item, selection));
}

function ensureStudyProgress(config, poolItems) {
  const key = studyProgressKey(config);
  if (!key) return { key: null, progress: null, restarted: false };
  const itemIds = poolItems.map((item) => item.id);
  const stored = storedStudyProgress(key, { itemIds });
  if (stored) return { key, progress: { ...stored, key }, restarted: false };
  return {
    key,
    progress: createStudyProgress({ key, itemIds, criterion: masteryCriterion() }),
    restarted: Boolean(state.studyProgress[key]),
  };
}

// 周回の残り（まだこの周回で正解していない問題）だけを並べる。
// 再出題待ちは dueAt を保ったまま deferredReviews へ戻す。
function buildCycleQueue({ progress, poolItems, mode, sortKey }) {
  const pending = new Set(pendingCycleItemIds(progress));
  const scopedHistory = new Map(
    poolItems.map((item) => [item.id, historyForModes(getHistory(state.history, item.id), [mode])]),
  );
  const ordered = sortItems(
    poolItems.filter((item) => pending.has(item.id)),
    scopedHistory,
    sortKey,
    Math.random,
    { randomizeTies: true },
  );
  const dueById = new Map((progress.pendingReviews ?? []).map((review) => [review.itemId, review.dueAt]));
  const now = Date.now();
  const queue = [];
  const deferredReviews = [];
  ordered.forEach((item) => {
    const dueAt = dueById.get(item.id) ?? 0;
    if (dueAt > now) deferredReviews.push({ dueAt, entry: { item, mode, review: true } });
    else queue.push({ item, mode });
  });
  deferredReviews.sort((left, right) => left.dueAt - right.dueAt);
  // 通常問題が残っていないなら、最も早い再出題を前倒ししてでも周回を続ける。
  if (!queue.length && deferredReviews.length) {
    queue.push(deferredReviews.shift().entry);
  }
  return { queue, deferredReviews };
}

function beginSession(queue, {
  selection = null,
  config = null,
  progress = null,
  progressKey = null,
  poolItemIds = null,
  deferredReviews = [],
} = {}) {
  if (state.session?.reviewTimer) clearTimeout(state.session.reviewTimer);
  const copyQueue = () => queue.map((entry) => ({ ...entry }));
  state.selectedMode = queue[0].mode;
  setMeta("selectedMode", state.selectedMode).catch(console.warn);
  state.session = {
    queue: copyQueue(),
    initialQueue: copyQueue(),
    cursor: 0,
    results: [],
    deferredReviews: deferredReviews.map((review) => ({ dueAt: review.dueAt, entry: { ...review.entry } })),
    reviewTimer: null,
    currentQuestion: null,
    currentAnswer: "",
    currentCorrect: null,
    answered: false,
    revealed: false,
    isTransitioning: false,
    cardEnterFrom: null,
    cardEnterPromise: null,
    questionStartedAt: 0,
    startedAt: Date.now(),
    complete: false,
    selection,
    config: cloneSessionConfig(config),
    showAllReviewItems: false,
    progress: progress ? cloneStudyProgress(progress) : null,
    progressKey,
    poolItemIds: poolItemIds ? [...poolItemIds] : null,
    startProgressSummary: studyProgressSummary(progress),
    cycleAdvanced: false,
    undo: null,
  };
  state.combo = 0;
  setView("quiz");
  prepareQuestion();
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
  const config = {
    subject: overrides.subject ?? state.subject,
    filters: overrides.filters ?? { ...state.filters, search: "" },
    ...(usesSelection ? { selection } : { mode }),
    sortKey: overrides.sortKey ?? state.sortKey,
    count: overrides.itemIds ? (overrides.count ?? "all") : "all",
    itemIds: overrides.itemIds ?? null,
  };

  // 間違い直しなど、対象を明示したセッションは周回状態を進めない。
  if (!usesSelection || config.itemIds) {
    const sessionItems = config.itemIds
      ? state.items.filter((item) => config.itemIds.includes(item.id))
      : state.items;
    const queue = usesSelection
      ? buildStudySession({
          items: sessionItems,
          history: state.history,
          filters: { ...config.filters, performance: "all" },
          selection,
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
    if (!queue.length) {
      showToast("この条件に合う問題がありません");
      return;
    }
    if (usesSelection) state.studySelection = selection;
    beginSession(queue, {
      selection: usesSelection ? selection : null,
      config: { ...config, ...(usesSelection ? { selection } : {}) },
    });
    return;
  }

  const poolItems = studyPoolItems(config);
  if (!poolItems.length) {
    showToast("この条件に合う問題がありません");
    return;
  }
  const { key, progress, restarted } = ensureStudyProgress(config, poolItems);
  const exactMode = exactStudyMode(selection);
  let activeProgress = progress;
  let built = buildCycleQueue({ progress: activeProgress, poolItems, mode: exactMode, sortKey: config.sortKey });
  if (!built.queue.length) {
    // 周回が完了済みの状態で入り直した場合は、次の周回（または新ラウンド）から始める。
    activeProgress = advanceStudyProgress(activeProgress, { roundItemIds: poolItems.map((item) => item.id) });
    built = buildCycleQueue({ progress: activeProgress, poolItems, mode: exactMode, sortKey: config.sortKey });
  }
  if (!built.queue.length) {
    showToast("この条件に合う問題がありません");
    return;
  }
  persistStudyProgress(key, activeProgress);
  persistStudyConfig(key, { ...config, selection });
  state.studySelection = selection;
  if (restarted) showToast("習得条件を変更したため、進捗判定を新しく開始します");
  beginSession(built.queue, {
    selection,
    config: { ...config, selection },
    progress: activeProgress,
    progressKey: key,
    poolItemIds: poolItems.map((item) => item.id),
    deferredReviews: built.deferredReviews,
  });
}

function prepareQuestion({ enterFrom = null } = {}) {
  const session = state.session;
  const entry = session.queue[session.cursor];
  const recentItemIds = session.results.slice(-12).map((result) => result.itemId);
  session.currentQuestion = buildQuestion(entry.item, entry.mode, state.items, Math.random, recentItemIds);
  session.currentAnswer = "";
  session.currentSlotValues = null;
  session.currentCorrect = null;
  // 新しい問題では最初の入力枠を選択状態に戻す。
  resetInputKeyboardState();
  session.answered = false;
  session.revealed = false;
  session.cardEnterFrom = enterFrom;
  session.cardEnterPromise = null;
  session.lastReviewDelayMs = null;
  session.questionStartedAt = performance.now();
  renderQuiz();
}

function sourceLine(item) {
  return (item.sources ?? [])
    .map((source) => `${source.lesson} · ${source.title}${source.detail ? ` · ${source.detail}` : ""}`)
    .join(" / ");
}

function itemEvidenceLine(item) {
  if (item.type === "word" && item.surfaceForms?.length) {
    return `本文中の形：${item.surfaceForms.join(" / ")}`;
  }
  if (item.examples?.length) return `本文例：${item.examples.join(" / ")}`;
  return "";
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

function characterHintMarkup(token, value = "") {
  const hint = characterHintForToken(token);
  let suppliedCount = ([...String(value)].filter((character) => /[A-Za-z0-9]/.test(character))).length;
  return [...hint].map((character) => {
    if (character !== "_") {
      return `<span class="character-hint-fixed">${escapeHtml(character)}</span>`;
    }
    const filled = suppliedCount > 0;
    suppliedCount = Math.max(0, suppliedCount - 1);
    return `<span class="character-hint-mark ${filled ? "is-filled" : "is-remaining"}">_</span>`;
  }).join("");
}

function inputSlotValues(question, currentAnswer) {
  const plan = question.inputPlan ?? inputPlanForQuestion(question.item, question.mode);
  const savedValues = state.session?.currentSlotValues;
  return Array.isArray(savedValues)
    ? plan.slots.map((_, index) => savedValues[index] ?? "")
    : distributeInputText(plan, currentAnswer);
}

function inputSlotResultClass(slot, value, answered, correct) {
  if (!answered) return "";
  if (correct) return " is-correct";
  if (!value && slot.optional) return " is-optional-empty";
  return slot.alternatives.some((answer) => normalizeAnswer(answer) === normalizeAnswer(value))
    ? " is-correct"
    : " is-wrong";
}

function renderWordSlots(question, answered, currentAnswer) {
  const plan = question.inputPlan ?? inputPlanForQuestion(question.item, question.mode);
  const supplied = inputSlotValues(question, currentAnswer);
  const showCharacterCount = Boolean(state.settings.showCharacterCount);
  const useAppKeyboard = !answered && shouldUseAlphabetKeyboard(question.mode);
  // アプリ内キーボード使用中は端末キーボードを開かせない。切替後は通常入力へ戻す。
  const keyboardAttributes = useAppKeyboard
    ? 'inputmode="none" readonly'
    : 'inputmode="text"';
  inputKeyboardState.slotCount = plan.slots.length;
  inputKeyboardState.activeSlotIndex = clampSlotIndex(inputKeyboardState.activeSlotIndex, plan.slots.length);
  const slotMarkup = new Map(plan.slots.map((slot, index) => {
    const value = supplied[index] ?? "";
    const activeClass = !answered && index === inputKeyboardState.activeSlotIndex ? " is-active-slot" : "";
    // 正解の文字数をCSSへ渡し、枠の幅を文字数に合わせる。
    const slotLength = Math.max(3, characterHintForToken(slot.answer).length);
    const resultClass = inputSlotResultClass(slot, value, answered, state.session.currentCorrect);
    const resultIcon = answered && resultClass
      ? `<span class="word-slot-result" aria-hidden="true">${resultClass.includes("is-wrong") ? "×" : resultClass.includes("is-correct") ? "✓" : ""}</span>`
      : "";
    return [index, `<label class="word-slot${resultClass}${activeClass}" style="--slot-length:${slotLength}" data-word-slot-container>
      ${slot.optional ? '<span class="word-slot-optional">任意</span>' : ""}
      <input
        class="word-slot-input"
        data-slot-index="${index}"
        data-hint-token="${escapeHtml(slot.answer)}"
        type="text"
        ${keyboardAttributes}
        value="${escapeHtml(value)}"
        aria-label="${index + 1}語目${slot.optional ? "（任意）" : ""}"
        aria-current="${!answered && index === inputKeyboardState.activeSlotIndex ? "true" : "false"}"
        ${answered && resultClass.includes("is-wrong") ? 'aria-invalid="true"' : ""}
        autocomplete="off"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        lang="en"
        enterkeyhint="${index === plan.slots.length - 1 ? "done" : "next"}"
        ${answered ? "disabled" : ""}
      />
      <span class="word-slot-hint" data-character-hint aria-hidden="true">${showCharacterCount ? characterHintMarkup(slot.answer, value) : ""}</span>
      ${resultIcon}
    </label>`];
  }));
  const segments = plan.segments.map((segment) => segment.kind === "slot"
    ? slotMarkup.get(segment.slotIndex) ?? ""
    : `<span class="word-slot-fixed" aria-hidden="true">${escapeHtml(segment.text)}</span>`).join("");
  return `
    <div class="word-slots${showCharacterCount ? " show-character-count" : ""}" data-word-slot-count="${plan.slots.length}" aria-label="${plan.slots.length}語の英語入力">
      ${segments}
    </div>
    ${answered ? "" : '<button class="primary-button answer-button" type="button" data-submit-input>回答する</button>'}`;
}

function updateCharacterCountDisplay() {
  const slots = elements.quizContent.querySelector(".word-slots");
  if (!slots) return;
  const show = Boolean(state.settings.showCharacterCount);
  slots.classList.toggle("show-character-count", show);
  slots.querySelectorAll(".word-slot-input").forEach((input) => {
    const hint = input.closest("[data-word-slot-container]")?.querySelector("[data-character-hint]");
    if (hint) hint.innerHTML = show ? characterHintMarkup(input.dataset.hintToken, input.value) : "";
  });
  const toggle = elements.quizContent.querySelector("[data-toggle-character-count]");
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(show));
    toggle.textContent = `文字数：${show ? "表示" : "非表示"}`;
  }
}

function ensureInputVisible(input = document.activeElement) {
  if (!input?.classList?.contains("word-slot-input")) return;
  const behavior = reducedMotionRequested() ? "auto" : "smooth";
  requestAnimationFrame(() => input.scrollIntoView({ block: "center", inline: "nearest", behavior }));
}

function isCoarsePointerDevice() {
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

// アプリ内キーボードは ja_to_en_input の未回答状態、かつタッチ端末でだけ出す。
// 4択・フラッシュカード・公共/保健の一問一答は question.mode が違うので対象外。
function shouldUseAlphabetKeyboard(mode = state.session?.currentQuestion?.mode) {
  if (mode !== "ja_to_en_input") return false;
  if (state.settings.useSystemKeyboard) return false;
  return isCoarsePointerDevice();
}

function wordSlotInputs() {
  return [...elements.quizContent.querySelectorAll(".word-slot-input")];
}

function currentSlotValueList() {
  return wordSlotInputs().map((input) => input.value);
}

function resetInputKeyboardState(slotCount = 0) {
  inputKeyboardState.slotCount = slotCount;
  inputKeyboardState.activeSlotIndex = 0;
}

function renderAlphabetKeyboard() {
  const rows = ALPHABET_KEYBOARD_ROWS.map((row, rowIndex) => `
    <div class="alphabet-keyboard-row alphabet-keyboard-row--${rowIndex + 1}">
      ${row.map((key) => `<button class="alphabet-key" type="button" data-alphabet-key="${escapeHtml(key)}" aria-label="${escapeHtml(key)}">${escapeHtml(key)}</button>`).join("")}
    </div>`).join("");
  return `
    <div class="alphabet-keyboard" data-alphabet-keyboard role="group" aria-label="英字キーボード">
      ${rows}
      <div class="alphabet-keyboard-row alphabet-keyboard-actions">
        <button class="alphabet-key alphabet-key--action" type="button" data-alphabet-action="previous">前の語</button>
        <button class="alphabet-key alphabet-key--action" type="button" data-alphabet-action="next">次の語</button>
        <button class="alphabet-key alphabet-key--action" type="button" data-alphabet-action="delete" aria-label="削除">削除</button>
        <button class="alphabet-key alphabet-key--submit" type="button" data-alphabet-action="submit">回答する</button>
      </div>
      <button class="alphabet-keyboard-switch" type="button" data-use-system-keyboard>端末キーボードを使う</button>
    </div>`;
}

// 入力欄・文字数ヒント・アクティブ表示だけを局所更新する。renderQuiz() は呼ばない。
function syncInputSlotState(values = null) {
  const container = elements.quizContent.querySelector(".word-slots");
  if (!container) return;
  const inputs = [...container.querySelectorAll(".word-slot-input")];
  inputKeyboardState.slotCount = inputs.length;
  inputKeyboardState.activeSlotIndex = clampSlotIndex(inputKeyboardState.activeSlotIndex, inputs.length);
  inputs.forEach((input, index) => {
    if (Array.isArray(values) && values[index] !== undefined) input.value = values[index];
    const active = index === inputKeyboardState.activeSlotIndex;
    input.closest("[data-word-slot-container]")?.classList.toggle("is-active-slot", active);
    input.setAttribute("aria-current", active ? "true" : "false");
  });
  if (state.session) state.session.currentSlotValues = inputs.map((input) => input.value.trim());
  updateCharacterCountDisplay();
}

function activateInputSlot(index, { focus = true } = {}) {
  const inputs = wordSlotInputs();
  if (!inputs.length) return;
  inputKeyboardState.activeSlotIndex = clampSlotIndex(index, inputs.length);
  syncInputSlotState();
  const input = inputs[inputKeyboardState.activeSlotIndex];
  if (focus && input) {
    input.focus({ preventScroll: true });
    const caret = input.value.length;
    try {
      input.setSelectionRange(caret, caret);
    } catch {
      // readonly / 未対応の入力欄ではキャレット指定を諦める。
    }
  }
  if (input) ensureInputVisible(input);
}

function applyAlphabetKey(key) {
  if (state.session?.answered) return;
  const result = applyKeyboardKey(currentSlotValueList(), inputKeyboardState.activeSlotIndex, key);
  inputKeyboardState.activeSlotIndex = result.activeIndex;
  syncInputSlotState(result.values);
}

function deleteAlphabetCharacter() {
  if (state.session?.answered) return;
  const result = deleteKeyboardCharacter(currentSlotValueList(), inputKeyboardState.activeSlotIndex);
  inputKeyboardState.activeSlotIndex = result.activeIndex;
  syncInputSlotState(result.values);
}

function moveActiveInputSlot(delta) {
  if (state.session?.answered) return;
  const inputs = wordSlotInputs();
  if (!inputs.length) return;
  activateInputSlot(moveKeyboardSlot(inputKeyboardState.activeSlotIndex, delta, inputs.length), { focus: false });
}

// 端末キーボードへの切替。値・フォーカス・ジェスチャー状態を壊さないよう、
// renderQuiz() ではなく入力欄の属性だけを差し替える。
function switchToSystemKeyboard() {
  state.settings.useSystemKeyboard = true;
  saveSettings();
  elements.quizContent.querySelector("[data-alphabet-keyboard]")?.remove();
  elements.quizContent.querySelector(".quiz-shell")?.classList.remove("has-alphabet-keyboard");
  const inputs = wordSlotInputs();
  inputs.forEach((input) => {
    input.readOnly = false;
    input.setAttribute("inputmode", "text");
  });
  const input = inputs[clampSlotIndex(inputKeyboardState.activeSlotIndex, inputs.length)];
  input?.focus();
  ensureInputVisible(input);
  showToast("端末のキーボードに切り替えました");
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

function renderFeedback(question, _answer, correct) {
  if (!state.session.answered) return "";
  const isChoice = question.mode.endsWith("choice");
  const isKeyboardInput = question.mode === "ja_to_en_input";
  const correctAnswer = answersForMode(question.item, question.mode)[0];
  if (isKeyboardInput) {
    return `
      <section class="feedback-card keyboard-feedback-card ${correct ? "feedback-correct" : "feedback-wrong"}" aria-live="polite" aria-label="${correct ? "正解" : "不正解"}">
        <div class="keyboard-feedback-detail">
          <span>正答</span>
          <strong>${escapeHtml(correctAnswer)}</strong>
        </div>
        <div class="keyboard-feedback-detail keyboard-feedback-range">
          <span>範囲</span>
          <strong>${escapeHtml(question.item.range)}</strong>
        </div>
      </section>`;
  }
  const showSourceBox = state.settings.showSources;
  return `
    <section class="feedback-card ${correct ? "feedback-correct" : "feedback-wrong"}" aria-live="polite">
      <div class="feedback-result">
        <span aria-hidden="true">${correct ? "✓" : "×"}</span>
        <strong>${correct ? "正解" : "不正解"}</strong>
      </div>
      ${state.session.lastReviewDelayMs === WRONG_REVIEW_DELAY_MS ? '<p class="review-scheduled-note">3分後にもう一度出題します</p>' : ""}
      ${!correct && !isChoice ? `<p class="input-correct-answer"><span>正解</span><strong>${escapeHtml(correctAnswer)}</strong></p>` : ""}
      ${showSourceBox ? `<div class="source-box">
        <span class="importance-badge importance-${question.item.importance.toLowerCase()}">${question.item.importance}</span>
        <div>
          <strong class="source-range">範囲：${escapeHtml(question.item.range)}</strong>
          ${state.settings.showSources && !isChoice && sourceLine(question.item) ? `<p>${escapeHtml(sourceLine(question.item))}</p>` : ""}
          ${state.settings.showSources && !isChoice && itemEvidenceLine(question.item) ? `<p class="source-evidence">${escapeHtml(itemEvidenceLine(question.item))}</p>` : ""}
        </div>
      </div>` : ""}
    </section>`;
}

function renderNextButton(swipePrimary = false) {
  if (!state.session?.answered) return "";
  const atEnd = state.session.cursor + 1 >= state.session.queue.length;
  const label = atEnd && state.session.deferredReviews.length
    ? "残りの復習へ"
    : atEnd
      ? "結果を見る"
      : "次の問題へ";
  return `
    <button class="secondary-button next-button${swipePrimary ? " next-button--fallback" : ""}" type="button" data-next-question aria-label="${label}">
      <span class="next-button-label">${label}</span>
      <span aria-hidden="true">→</span>
    </button>`;
}

function renderRecallSwipeHints() {
  return `
    <div class="recall-gesture-guide" aria-hidden="true">
      <span class="gesture-guide-item gesture-guide-left" data-swipe-direction="left"><i>←</i><strong>3分</strong></span>
      <span class="gesture-guide-item gesture-guide-up" data-swipe-direction="up"><i>↑</i><strong>習得</strong></span>
      <span class="gesture-guide-item gesture-guide-right" data-swipe-direction="right"><strong>1時間</strong><i>→</i></span>
    </div>`;
}

function renderChoiceSwipeHints() {
  return `
    <div class="choice-gesture-footer" aria-hidden="true">
      <span class="choice-gesture-directions">
        <i data-swipe-direction="left">←</i>
        <i data-swipe-direction="right">→</i>
        <i data-swipe-direction="up">↑</i>
        <i data-swipe-direction="down">↓</i>
      </span>
      <strong>スワイプで次へ</strong>
    </div>`;
}

function previewPromptForEntry(entry) {
  const item = entry?.item;
  const mode = entry?.mode;
  if (!item || !mode) return "";
  if (mode === "public_recall" || mode === "health_recall") {
    return item[`${item.subject}Question`] ?? item.recallQuestion ?? item.publicQuestion ?? item.english ?? "";
  }
  if (mode === "en_to_ja_flashcard" || mode === "en_to_ja_choice") return item.english ?? "";
  if (["ja_to_en_flashcard", "ja_to_en_choice", "spelling_input", "ja_to_en_input"].includes(mode)) {
    return item.japanese ?? "";
  }
  if (mode === "preposition_input") return item.blanks?.preposition?.prompt ?? "";
  if (mode === "phrase_blank_input") return item.blanks?.phrase?.prompt ?? "";
  return item.japanese ?? item.english ?? "";
}

function renderCardPreview(kind) {
  const session = state.session;
  const nextEntry = session?.queue?.[session.cursor + 1] ?? null;
  const prompt = previewPromptForEntry(nextEntry);
  const promptContent = prompt
    ? escapeHtml(prompt)
    : '<span class="quiz-card-preview-line"></span><span class="quiz-card-preview-line preview-line-short"></span>';
  const lowerContent = kind === "choice"
    ? `<div class="quiz-card-preview-options">
        <span></span><span></span><span></span><span></span>
      </div>`
    : '<div class="quiz-card-preview-answer"><span></span></div>';
  return `
    <div class="quiz-card-preview quiz-card-preview--${kind}" aria-hidden="true" inert>
      <div class="quiz-card-preview-meta"><span></span><i></i></div>
      <div class="quiz-card-preview-kicker"></div>
      <p class="quiz-card-preview-prompt${prompt ? "" : " is-placeholder"}">${promptContent}</p>
      ${lowerContent}
    </div>`;
}

function renderRecallGradeFallback() {
  return `
    <div class="recall-grade-fallback" aria-label="自己採点">
      <button type="button" data-recall-grade="left" aria-label="3分後にもう一度">3m</button>
      <button type="button" data-recall-grade="right" aria-label="1時間後に復習">1h</button>
      <button type="button" data-recall-grade="up" aria-label="習得">✓</button>
    </div>`;
}

const CARD_EXIT_DURATION_MS = 205;
const CARD_ENTER_DURATION_MS = 205;
const CARD_OVERLAP_DELAY_MS = 48;
const activeCardFlights = new Set();
let quizGestureController = null;

function reducedMotionRequested() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function waitMilliseconds(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function clearGestureSurfaceStyles(surface) {
  if (!surface) return;
  surface.classList.remove("is-dragging", "is-swipe-cancelling");
  surface.removeAttribute("data-active-direction");
  surface.style.removeProperty("--quiz-drag-x");
  surface.style.removeProperty("--quiz-drag-y");
  surface.style.removeProperty("--quiz-drag-rotate");
  clearCardPreviewStyles(surface);
}

function setCardPreviewProgress(surface, distance) {
  const stage = surface?.closest(".quiz-card-stage");
  const preview = stage?.querySelector(".quiz-card-preview");
  if (!stage || !preview) return;
  const progress = Math.min(1, Math.max(0, Number(distance) || 0) / 96);
  stage.classList.toggle("is-preview-exposed", progress > 0.02);
  preview.style.setProperty("--quiz-preview-opacity", String(0.74 + progress * 0.24));
  preview.style.setProperty("--quiz-preview-scale", String(0.982 + progress * 0.018));
  preview.style.setProperty("--quiz-preview-y", `${5 - progress * 5}px`);
}

function clearCardPreviewStyles(surface) {
  const stage = surface?.closest(".quiz-card-stage");
  const preview = stage?.querySelector(".quiz-card-preview");
  stage?.classList.remove("is-preview-exposed");
  preview?.style.removeProperty("--quiz-preview-opacity");
  preview?.style.removeProperty("--quiz-preview-scale");
  preview?.style.removeProperty("--quiz-preview-y");
}

function handleQuizDrag({ surface, dx, dy, direction }) {
  const rotation = Math.abs(dx) > Math.abs(dy)
    ? Math.max(-3.5, Math.min(3.5, dx / 38))
    : 0;
  surface.classList.remove("is-swipe-cancelling");
  surface.classList.add("is-dragging");
  surface.dataset.activeDirection = direction;
  surface.style.setProperty("--quiz-drag-x", `${dx}px`);
  surface.style.setProperty("--quiz-drag-y", `${dy}px`);
  surface.style.setProperty("--quiz-drag-rotate", `${rotation}deg`);
  setCardPreviewProgress(surface, Math.hypot(dx, dy));
}

function animateSwipeCancel({ surface }) {
  if (!surface?.isConnected) return Promise.resolve();
  surface.classList.remove("is-dragging");
  surface.classList.add("is-swipe-cancelling");
  surface.removeAttribute("data-active-direction");
  surface.style.setProperty("--quiz-drag-x", "0px");
  surface.style.setProperty("--quiz-drag-y", "0px");
  surface.style.setProperty("--quiz-drag-rotate", "0deg");
  setCardPreviewProgress(surface, 0);
  if (reducedMotionRequested()) {
    clearGestureSurfaceStyles(surface);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      surface.removeEventListener("transitionend", onTransitionEnd);
      clearGestureSurfaceStyles(surface);
      resolve();
    };
    const onTransitionEnd = (event) => {
      if (event.target === surface && event.propertyName === "transform") finish();
    };
    surface.addEventListener("transitionend", onTransitionEnd);
    setTimeout(finish, 240);
  });
}

function cardExitTranslation(direction, rect) {
  const margin = 48;
  if (direction === "left") return { x: -(rect.right + margin), y: 0, rotate: -4 };
  if (direction === "right") return { x: window.innerWidth - rect.left + margin, y: 0, rotate: 4 };
  if (direction === "up") return { x: 0, y: -(rect.bottom + margin), rotate: 0 };
  return { x: 0, y: window.innerHeight - rect.top + margin, rotate: 0 };
}

function removeCardFlight(flight) {
  if (!flight) return;
  activeCardFlights.delete(flight);
  flight.remove();
}

function clearCardFlights() {
  for (const flight of activeCardFlights) removeCardFlight(flight);
}

function animateCardExit(surface, direction) {
  if (!surface?.isConnected || reducedMotionRequested()) {
    if (surface) surface.style.visibility = "hidden";
    return Promise.resolve();
  }
  const rect = surface.getBoundingClientRect();
  const translation = cardExitTranslation(direction, rect);
  const cardClone = surface.cloneNode(true);
  cardClone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  cardClone.querySelectorAll("button, input, select, textarea, a").forEach((element) => {
    element.setAttribute("tabindex", "-1");
  });
  cardClone.removeAttribute("data-quiz-gesture-surface");
  cardClone.removeAttribute("data-active-direction");
  cardClone.classList.remove("is-dragging", "is-swipe-cancelling", "is-card-entering", "is-card-entered");
  cardClone.style.setProperty("--quiz-drag-x", "0px");
  cardClone.style.setProperty("--quiz-drag-y", "0px");
  cardClone.style.setProperty("--quiz-drag-rotate", "0deg");
  const flight = document.createElement("div");
  flight.className = `quiz-card-flight${surface.closest(".quiz-answered") ? " quiz-answered" : ""}`;
  flight.setAttribute("aria-hidden", "true");
  flight.append(cardClone);
  Object.assign(flight.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    padding: "0",
    transform: "translate3d(0, 0, 0) rotate(0deg)",
    transition: `transform ${CARD_EXIT_DURATION_MS}ms cubic-bezier(.2,.78,.24,1), opacity ${CARD_EXIT_DURATION_MS}ms ease-out`,
  });
  document.body.append(flight);
  activeCardFlights.add(flight);
  surface.style.visibility = "hidden";
  flight.getBoundingClientRect();
  requestAnimationFrame(() => {
    flight.style.transform = `translate3d(${translation.x}px, ${translation.y}px, 0) rotate(${translation.rotate}deg)`;
    flight.style.opacity = "0.18";
  });
  return waitMilliseconds(CARD_EXIT_DURATION_MS + 30).then(() => removeCardFlight(flight));
}

function cardEnterTranslation(direction, rect) {
  const margin = 36;
  if (direction === "left") return { x: -(rect.right + margin), y: 0 };
  if (direction === "right") return { x: window.innerWidth - rect.left + margin, y: 0 };
  if (direction === "up") return { x: 0, y: -(rect.bottom + margin) };
  return { x: 0, y: window.innerHeight - rect.top + margin };
}

function startCardEnterAnimation(direction) {
  const surface = elements.quizContent.querySelector("[data-quiz-gesture-surface]");
  if (!direction || !surface) return Promise.resolve();
  if (reducedMotionRequested()) return Promise.resolve();
  const rect = surface.getBoundingClientRect();
  const translation = cardEnterTranslation(direction, rect);
  surface.classList.add("is-card-entering");
  surface.dataset.enterFrom = direction;
  surface.style.setProperty("--quiz-enter-x", `${translation.x}px`);
  surface.style.setProperty("--quiz-enter-y", `${translation.y}px`);
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      surface.removeEventListener("transitionend", onTransitionEnd);
      surface.classList.remove("is-card-entering", "is-card-entered");
      surface.removeAttribute("data-enter-from");
      surface.style.removeProperty("--quiz-enter-x");
      surface.style.removeProperty("--quiz-enter-y");
      resolve();
    };
    const onTransitionEnd = (event) => {
      if (event.target === surface && event.propertyName === "transform") finish();
    };
    surface.addEventListener("transitionend", onTransitionEnd);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      surface.classList.add("is-card-entered");
    }));
    setTimeout(finish, CARD_ENTER_DURATION_MS + 100);
  });
}

function activateRenderedGestureCard() {
  const session = state.session;
  if (!session) return;
  const enterFrom = session.cardEnterFrom;
  session.cardEnterFrom = null;
  session.cardEnterPromise = startCardEnterAnimation(enterFrom);
}

function currentQuizGesturePolicy() {
  const session = state.session;
  const question = session?.currentQuestion;
  return quizGesturePolicy({
    mode: question?.mode,
    answered: session?.answered,
    revealed: session?.revealed,
    isTransitioning: session?.isTransitioning,
  });
}

function toggleRecallFace() {
  const session = state.session;
  if (!session || !isRecallMode(session.currentQuestion?.mode)) return;
  if (!currentQuizGesturePolicy().tapEnabled) return;
  session.revealed = !session.revealed;
  renderQuiz();
}

async function transitionToNextCard(surface, direction, session) {
  const exitPromise = animateCardExit(surface, direction);
  await waitMilliseconds(reducedMotionRequested() ? 0 : CARD_OVERLAP_DELAY_MS);
  if (state.session !== session || !session.answered) {
    await exitPromise;
    return;
  }
  nextQuestion({ enterFrom: oppositeDirection(direction) });
  const enterPromise = session.cardEnterPromise ?? Promise.resolve();
  await Promise.all([exitPromise, enterPromise]);
}

async function handleRecallSwipe({ surface, direction }) {
  const session = state.session;
  const question = session?.currentQuestion;
  const action = recallActionForDirection(direction);
  if (!session || !question || !action || !currentQuizGesturePolicy().dragEnabled) {
    await animateSwipeCancel({ surface });
    return;
  }
  session.isTransitioning = true;
  const reviewDelayMs = action === "three-minutes"
    ? WRONG_REVIEW_DELAY_MS
    : action === "one-hour"
      ? ONE_HOUR_REVIEW_DELAY_MS
      : null;
  try {
    await submitAnswer(question.answer, action === "mastered", reviewDelayMs, { renderResult: false });
    if (state.session !== session || session.currentQuestion !== question) return;
    await waitForPaint();
    await transitionToNextCard(surface, direction, session);
  } finally {
    if (state.session === session) session.isTransitioning = false;
  }
}

async function handleChoiceNextSwipe({ surface, direction }) {
  const session = state.session;
  if (!session?.answered || session.isTransitioning
    || !isSwipeAdvanceMode(session.currentQuestion?.mode)) {
    await animateSwipeCancel({ surface });
    return;
  }
  session.isTransitioning = true;
  try {
    await transitionToNextCard(surface, direction, session);
  } finally {
    if (state.session === session) session.isTransitioning = false;
  }
}

function handleQuizSwipe(payload) {
  const mode = state.session?.currentQuestion?.mode;
  return isRecallMode(mode)
    ? handleRecallSwipe(payload)
    : handleChoiceNextSwipe(payload);
}

function advanceAnsweredCard(direction = "right") {
  const session = state.session;
  const surface = elements.quizContent.querySelector("[data-quiz-gesture-surface]");
  if (!session?.answered || session.isTransitioning) return;
  if (surface && isSwipeAdvanceMode(session.currentQuestion?.mode)) {
    handleChoiceNextSwipe({ surface, direction });
  } else {
    nextQuestion();
  }
}

let lastRenderedCombo = 0;

function renderComboPill(changed) {
  const combo = state.combo;
  const heat = combo >= 10 ? " combo-pill--blaze" : combo >= 5 ? " combo-pill--hot" : "";
  const pop = changed ? " combo-pill--pop" : "";
  const text = `🔥 ${combo} COMBO`;
  return `<div class="combo-pill${heat}${pop}"><span class="combo-pill-text" data-text="${escapeHtml(text)}">${escapeHtml(text)}</span></div>`;
}

function renderRecallQuiz() {
  const session = state.session;
  const question = session.currentQuestion;
  const progress = Math.round((session.cursor / session.queue.length) * 100);
  const revealed = session.revealed;
  elements.quizContent.innerHTML = `
    <div class="quiz-shell public-quiz${revealed ? " answer-revealed" : ""}">
      <header class="quiz-header">
        <div class="quiz-header-left">
          <button class="icon-button" type="button" data-quit-quiz aria-label="学習を終了">×</button>
          ${undoButtonMarkup()}
        </div>
        <div class="quiz-progress-copy"><strong>${session.cursor + 1}</strong> / ${session.queue.length}</div>
        <span class="mode-pill">${TYPE_LABELS[question.item.type]}</span>
      </header>
      <div class="quiz-progress"><span style="width:${progress}%"></span></div>
      <div class="quiz-card-stage recall-card-stage${revealed ? " is-swipe-ready" : ""}">
        ${revealed ? renderCardPreview("recall") : ""}
        <article
          class="public-recall-card quiz-gesture-card"
          data-quiz-gesture-surface
          data-gesture-state="${revealed ? "recall-answer" : "recall-question"}"
          role="button"
          tabindex="0"
          aria-pressed="${revealed}"
          aria-label="${revealed ? "答え面。タップで問題面。左は3分後、右は1時間後、上は習得" : "問題面。タップで答えを表示"}"
        >
          <div class="public-recall-meta">
            <span class="importance-badge importance-${question.item.importance.toLowerCase()}">${question.item.importance}</span>
            <span>${escapeHtml(question.item.range)}</span>
            ${question.item.number ? `<span>Q${question.item.number}</span>` : ""}
          </div>
          <p class="question-instruction">${revealed ? "答え" : "問題"}</p>
          <h1>${escapeHtml(question.prompt)}</h1>
          ${revealed ? `
            <div class="public-recall-answer" aria-live="polite">
              <strong>${escapeHtml(question.answer)}</strong>
            </div>
            ${state.settings.showSources ? `<p class="public-recall-source">${escapeHtml(question.item.sourceDetail)}</p>` : ""}
            ${renderRecallSwipeHints()}
            <span class="quiz-tap-hint quiz-tap-hint-back" aria-hidden="true">tap</span>
          ` : '<span class="quiz-tap-hint" aria-hidden="true">tap</span>'}
        </article>
      </div>
      ${revealed ? renderRecallGradeFallback() : ""}
    </div>`;
  activateRenderedGestureCard();
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
  const isKeyboardInput = question.mode === "ja_to_en_input";
  const isSwipeAdvance = isSwipeAdvanceMode(question.mode);
  const usesSlots = ["ja_to_en_input", "spelling_input"].includes(question.mode);
  const translation = question.mode === "phrase_blank_input"
    ? `<p class="question-translation"><span>日本語訳</span>${escapeHtml(question.item.japanese)}</p>`
    : "";
  const answerArea = isChoice
      ? renderChoiceArea(question, answered, session.currentAnswer)
    : usesSlots
      ? renderWordSlots(question, answered, session.currentAnswer)
      : renderTextInput(answered, session.currentAnswer);
  const feedbackArea = answered
    ? renderFeedback(question, session.currentAnswer, lastResult.correct)
    : "";
  // 回答確定後は非表示。キーボードはスワイプ面の外側に置く。
  const showAlphabetKeyboard = !answered && shouldUseAlphabetKeyboard(question.mode);

  elements.quizContent.innerHTML = `
    <div class="quiz-shell${answered ? " quiz-answered" : ""}${isChoice ? " quiz-choice" : ""}${isKeyboardInput ? " quiz-keyboard-input" : ""}${showAlphabetKeyboard ? " has-alphabet-keyboard" : ""}">
      <header class="quiz-header${isKeyboardInput ? " quiz-header--input" : ""}">
        <div class="quiz-header-left">
          <button class="icon-button" type="button" data-quit-quiz aria-label="学習を終了">×</button>
          ${undoButtonMarkup()}
        </div>
        <div class="quiz-progress-copy"><strong>${session.cursor + 1}</strong> / ${session.queue.length}</div>
        ${isKeyboardInput ? `<div class="quiz-header-tools">
          <span class="mode-pill">${escapeHtml(question.label)}</span>
          <button class="character-count-toggle" type="button" data-toggle-character-count aria-pressed="${state.settings.showCharacterCount}">文字数：${state.settings.showCharacterCount ? "表示" : "非表示"}</button>
        </div>` : `<span class="mode-pill">${escapeHtml(question.label)}</span>`}
      </header>
      ${isMaxMode() && state.combo ? renderComboPill(comboChanged) : ""}
      <div class="quiz-progress"><span style="width:${progress}%"></span></div>
      <div class="quiz-card-stage${answered && isSwipeAdvance ? " is-swipe-ready" : ""}">
        ${answered && isSwipeAdvance ? renderCardPreview(isChoice ? "choice" : "input") : ""}
        <div
          class="quiz-gesture-card quiz-question-stack"
          ${isSwipeAdvance ? "data-quiz-gesture-surface" : ""}
          data-gesture-state="${answered && isSwipeAdvance ? "choice-answer" : "choice-question"}"
          ${answered && isSwipeAdvance ? 'tabindex="0" aria-label="回答済みカード。上下左右どの方向へ払っても次へ進みます"' : ""}
        >
          <article class="question-card${isChoice ? " swipe-choice-card" : isKeyboardInput ? " swipe-input-card" : ""}">
            <p class="question-instruction">${escapeHtml(question.instruction)}</p>
            <h1>${escapeHtml(question.prompt)}</h1>
            ${translation}
            <div class="answer-area">${answerArea}</div>
            ${answered && isSwipeAdvance ? feedbackArea : ""}
            ${answered && isSwipeAdvance ? renderChoiceSwipeHints() : ""}
          </article>
          ${answered && !isSwipeAdvance ? feedbackArea : ""}
        </div>
      </div>
      ${showAlphabetKeyboard ? renderAlphabetKeyboard() : ""}
    </div>
    ${answered ? renderNextButton(isSwipeAdvance) : ""}`;

  activateRenderedGestureCard();

  if (!answered) {
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      const firstInput = elements.quizContent.querySelector("input");
      firstInput?.focus({ preventScroll: true });
      if (firstInput?.classList.contains("word-slot-input")) {
        activateInputSlot(inputKeyboardState.activeSlotIndex, { focus: false });
        ensureInputVisible(firstInput);
      }
    });
  } else {
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      if (!isSwipeAdvance) {
        elements.quizContent.querySelector("[data-next-question]")?.focus({ preventScroll: true });
      }
    });
  }
}

function currentTypedAnswer() {
  const slotInputs = [...elements.quizContent.querySelectorAll(".word-slot-input")];
  if (slotInputs.length) {
    const values = slotInputs.map((input) => input.value.trim());
    if (state.session) state.session.currentSlotValues = values;
    return values.join(" ").trim();
  }
  return elements.quizContent.querySelector("#single-answer-input")?.value.trim() ?? "";
}

async function submitAnswer(
  answer,
  selfGrade = null,
  reviewDelayMs = null,
  { renderResult = true } = {},
) {
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
  const scheduledDelay = reviewDelayForAnswer(question.mode, correct, reviewDelayMs);
  const correctAnswer = isChoice
    ? question.correctChoice
    : question.answer ?? answersForMode(question.item, question.mode)[0];
  const reviewDueAt = scheduledDelay ? Date.now() + scheduledDelay : null;
  const previousHistory = getHistory(state.history, question.item.id);
  // 回答を確定する直前の状態を丸ごと控える。undoはこのsnapshotから復元する。
  session.undo = {
    itemId: question.item.id,
    mode: question.mode,
    historyRecord: state.history.has(question.item.id)
      ? JSON.parse(JSON.stringify(state.history.get(question.item.id)))
      : null,
    progress: cloneStudyProgress(session.progress),
    progressKey: session.progressKey,
    combo: state.combo,
    bestCombo: state.bestCombo,
    cursor: session.cursor,
    queue: session.queue.map((entry) => ({ ...entry })),
    deferredReviews: session.deferredReviews.map((review) => ({ dueAt: review.dueAt, entry: { ...review.entry } })),
    resultsLength: session.results.length,
    cycleAdvanced: session.cycleAdvanced,
    complete: session.complete,
  };
  session.currentAnswer = answer;
  session.currentCorrect = correct;
  session.answered = true;
  // 周回の進み具合は履歴の保存を待たずに先に確定させる。履歴の保存中に
  // 画面を離れられても、どこまで進めたかは残るようにするため。
  if (session.progress) {
    session.progress = applyStudyAnswer(session.progress, {
      itemId: question.item.id,
      correct,
      reviewDueAt,
    });
    persistStudyProgress(session.progressKey, session.progress);
  }

  session.results.push({
    itemId: question.item.id,
    item: question.item,
    mode: question.mode,
    correct,
    answer,
    durationMs,
    prompt: question.prompt,
    correctAnswer,
    reviewDelayMs: scheduledDelay,
  });

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

  session.lastReviewDelayMs = scheduledDelay;
  if (scheduledDelay) {
    session.deferredReviews.push({
      dueAt: reviewDueAt,
      entry: { item: question.item, mode: question.mode, review: true },
    });
    session.deferredReviews.sort((a, b) => a.dueAt - b.dueAt);
  }
  if (renderResult) renderQuiz();
  renderHeader();
  // 保存とUI更新の後に既存のMAX演出を起動する。自己採点スワイプでは
  // 現在カードを残したまま演出を始め、その後カード退場へつなぐ。
  if (pendingCorrectEffect !== null) {
    const special = pendingCorrectEffect;
    requestAnimationFrame(() => correctEffect(special));
  } else if (isMaxMode()) {
    requestAnimationFrame(() => runMaxCue(maxCueForAnswer({ correct: false }), { label: "", combo: 0 }));
  }
  return { correct, scheduledDelay };
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
        <div class="quiz-header-left">
          <button class="icon-button" type="button" data-quit-quiz aria-label="学習を終了">×</button>
          ${undoButtonMarkup()}
        </div>
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

// 周回対象のうち、まだこの周回で正解していない問題が残っていれば必ず出し直す。
function canUndoLastAnswer() {
  return Boolean(state.session?.undo);
}

// 直前の回答を「なかったこと」にする。表示を戻すだけでなく、履歴・周回・習得・
// 再出題予約・コンボまで回答直前のsnapshotへ復元する。
async function undoLastAnswer() {
  const session = state.session;
  const undo = session?.undo;
  if (!undo || session.isTransitioning) return;
  session.undo = null;
  try {
    if (undo.historyRecord) {
      state.history.set(undo.itemId, undo.historyRecord);
      await putHistory(undo.historyRecord);
    } else {
      state.history.delete(undo.itemId);
      await removeHistory(undo.itemId);
    }
  } catch (error) {
    console.error(error);
    showToast("履歴を戻せませんでした");
  }
  if (undo.progressKey) {
    session.progress = undo.progress;
    persistStudyProgress(undo.progressKey, undo.progress);
  }
  state.combo = undo.combo;
  if (state.bestCombo !== undo.bestCombo) {
    state.bestCombo = undo.bestCombo;
    setMeta("bestCombo", state.bestCombo).catch(console.warn);
  }
  lastRenderedCombo = state.combo;
  session.queue = undo.queue;
  session.cursor = undo.cursor;
  session.deferredReviews = undo.deferredReviews;
  session.results = session.results.slice(0, undo.resultsLength);
  session.cycleAdvanced = undo.cycleAdvanced;
  session.completedProgressSummary = null;
  if (session.complete) clearSessionResult();
  session.complete = false;
  session.showAllReviewItems = false;
  session.isTransitioning = false;
  if (session.reviewTimer) {
    clearTimeout(session.reviewTimer);
    session.reviewTimer = null;
  }
  clearCardFlights();
  quizGestureController?.reset();
  resetMaxEffects({ keepAmbience: true });
  setView("quiz");
  prepareQuestion();
  showToast("直前の回答を取り消しました");
  renderHeader();
}

function undoButtonMarkup() {
  if (!canUndoLastAnswer()) return "";
  return '<button class="icon-button undo-button" type="button" data-undo-answer aria-label="1つ前の回答に戻る" title="1つ前の回答に戻る">↶</button>';
}

function requeuePendingCycleItems(session) {
  if (!session.progress) return false;
  const deferred = new Set(session.deferredReviews.map((review) => review.entry.item.id));
  const missing = pendingCycleItemIds(session.progress)
    .filter((itemId) => !deferred.has(itemId))
    .map((itemId) => state.items.find((item) => item.id === itemId))
    .filter(Boolean);
  if (!missing.length) return false;
  const mode = session.queue[0]?.mode ?? state.selectedMode;
  session.queue.push(...missing.map((item) => ({ item, mode, review: true })));
  return true;
}

function nextQuestion({ enterFrom = null } = {}) {
  const session = state.session;
  if (!session?.answered) return;
  session.cursor += 1;
  injectDueReviews(session, session.cursor >= session.queue.length);
  if (session.cursor >= session.queue.length) {
    if (session.deferredReviews.length) {
      renderReviewWait();
      return;
    }
    // 全対象問題が最低1回正解するまでは周回を終わらせない。
    if (session.progress && pendingCycleItemIds(session.progress).length) {
      if (requeuePendingCycleItems(session)) {
        prepareQuestion({ enterFrom });
        return;
      }
    }
    completeSession(session);
    return;
  }
  prepareQuestion({ enterFrom });
}

function completeSession(session) {
  session.complete = true;
  if (session.progress && isCycleComplete(session.progress)) {
    session.completedProgressSummary = studyProgressSummary(session.progress);
    session.progress = advanceStudyProgress(session.progress, { roundItemIds: session.poolItemIds });
    session.cycleAdvanced = true;
    persistStudyProgress(session.progressKey, session.progress);
  }
  persistSessionResult(session);
  renderSessionComplete();
}

const LAST_RESULT_META_KEY = "lastSessionResult";

// 学習結果は端末に保存し、次に分析画面を開いたときに直前の学習として見せる。
function sessionResultSnapshot(session) {
  return {
    subject: state.subject ?? "english",
    finishedAt: Date.now(),
    startedAt: session.startedAt ?? null,
    complete: true,
    results: session.results.map((result) => ({ ...result })),
    selection: session.selection ? normalizeStudySelection(session.selection) : null,
    config: cloneSessionConfig(session.config),
    progress: session.progress ? cloneStudyProgress(session.progress) : null,
    progressKey: session.progressKey ?? null,
    poolItemIds: session.poolItemIds ? [...session.poolItemIds] : null,
    initialQueue: (session.initialQueue ?? []).map((entry) => ({ ...entry })),
    completedProgressSummary: session.completedProgressSummary ?? null,
    cycleAdvanced: Boolean(session.cycleAdvanced),
    showAllReviewItems: false,
  };
}

function normalizeSessionResultSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.results) || !raw.results.length) return null;
  return {
    ...raw,
    complete: true,
    progress: raw.progress ? normalizeStudyProgress(raw.progress) : null,
    initialQueue: Array.isArray(raw.initialQueue) ? raw.initialQueue : [],
    showAllReviewItems: false,
  };
}

function persistSessionResult(session) {
  state.lastSessionResult = sessionResultSnapshot(session);
  setMeta(LAST_RESULT_META_KEY, state.lastSessionResult).catch(console.warn);
}

function clearSessionResult() {
  if (!state.lastSessionResult) return;
  state.lastSessionResult = null;
  setMeta(LAST_RESULT_META_KEY, null).catch(console.warn);
}

// 以前の「最近の学習条件」しか持っていない端末でも、その条件から周回キーを
// 割り出して控えに移し、学習途中のセットを続けられるようにする。
function adoptLegacyStudyConfigs(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  entries.forEach((entry) => {
    const config = normalizeRecentStudyConfig(entry?.config ?? entry);
    if (!config) return;
    const key = studyProgressKey({
      subject: config.subject,
      selection: config.selection,
      filters: config.filters,
    });
    if (!key || !(key in state.studyProgress) || key in state.studyConfigs) return;
    state.studyConfigs[key] = config;
  });
  setMeta("studyConfigs", state.studyConfigs).catch(console.warn);
}

// 学習途中の周回があれば、その続きを始められるようにする。条件の控えが
// 残っているものだけを対象にする（控えが無いと同じ条件で始め直せないため）。
function resumableStudy() {
  const entry = inProgressEntries()[0];
  const config = entry ? state.studyConfigs[entry.key] : null;
  return config ? { entry, config } : null;
}

function resumeStudyMarkup({ entry, config }) {
  const cycle = studyProgressSummary(entry.progress);
  const contentLabel = contentLabelFromProgressKey(entry.meta) || "教材";
  const methodLabel = STUDY_METHOD_LABELS[config.selection.method] ?? "学習";
  const context = [
    ["教科", SUBJECT_LABELS[config.subject] ?? "英語"],
    ["範囲", configRangeLabel(config)],
    ["教材", contentLabel],
    ["出題形式", methodLabel],
  ];
  return `
    <section class="result-panel" aria-labelledby="resume-panel-title">
      <header class="result-complete-header">
        <p class="eyebrow">CONTINUE</p>
        <h1 id="resume-panel-title">学習途中のセットがあります</h1>
        <ul class="result-context-list" aria-label="学習条件">
          ${context.map(([label, value]) => `<li><span>${label}</span><strong>${escapeHtml(value)}</strong></li>`).join("")}
        </ul>
      </header>
      <section class="result-record" aria-labelledby="resume-record-title">
        <h2 id="resume-record-title">${cycle.masteryRound > 1 ? `R${cycle.masteryRound}・` : ""}${cycle.cycleNumber}周目の途中</h2>
        <div class="result-record-grid">
          <div><span>今回の対象</span><strong>${cycle.targetCount}</strong></div>
          <div><span>正解済み</span><strong>${cycle.correctCount}</strong></div>
          <div><span>残り</span><strong>${cycle.remainingCount}</strong></div>
        </div>
      </section>
      <section class="result-next-card" aria-labelledby="resume-next-title">
        <div>
          <p class="eyebrow">NEXT STEP</p>
          <h2 id="resume-next-title">続きから学習する</h2>
          <p>まだ正解していない${cycle.remainingCount}問から再開します</p>
        </div>
        <button class="primary-button result-primary-action" type="button" data-resume-study>続きを始める<span aria-hidden="true">→</span></button>
      </section>
    </section>`;
}

// 学習中のセッションが完了していればそれを、無ければ保存済みの直近の結果を返す。
// 教科をまたいでも「1番最近のリザルト」を出す（開始ボタンだけ同じ教科に限る）。
function resultSession() {
  return state.session?.complete ? state.session : state.lastSessionResult;
}

// 保存済みの結果がいまの教科のものなら、そこから学習を再開できる。
function canStartFromResult(session) {
  if (!session || session === state.session) return true;
  return (session.subject ?? "english") === (state.subject ?? "english");
}

function sessionResultMarkup(session) {
  // 学習直後ではなく保存済みの結果を開いたときは、見出しで直前の学習だと示す。
  const isPastSession = session !== state.session;
  const resultSubject = session.subject ?? state.subject ?? "english";
  // 別の教科の結果は、その教科へ切り替えてからでないと続きを始められない。
  const canStart = canStartFromResult(session);
  const summary = summarizeSession(session.results);
  const reviewItems = summarizeReviewItems(session.results);
  const visibleItems = session.showAllReviewItems ? reviewItems : reviewItems.slice(0, 5);
  const isSelfGraded = session.results.some((result) => isRecallMode(result.mode));
  const ranges = [...new Set(session.results.map((result) => result.item.range).filter(Boolean))];
  const rangeLabel = ranges.length <= 1 ? ranges[0] ?? "選択範囲" : `${ranges.length}範囲`;
  const types = [...new Set(session.results.map((result) => result.item.type)
    .filter((type) => ENGLISH_CONTENT_TYPES.includes(type)))];
  const contentLabel = session.selection
    ? studyContentLabel(session.selection)
    : isSelfGraded
      ? "一問一答"
      : types.map((type) => STUDY_CONTENT_LABELS[type]).join("＋") || "教材";
  const methodLabel = session.selection?.method
    ? STUDY_METHOD_LABELS[session.selection.method]
    : isSelfGraded
      ? "自己採点"
      : MODE_LABELS[session.results[0]?.mode] ?? "学習";
  const resultContext = [
    ["教科", SUBJECT_LABELS[resultSubject] ?? "英語"],
    ["範囲", rangeLabel],
    ["教材", contentLabel],
    ["出題形式", methodLabel],
  ];
  const reviewUserAnswer = (result) => isRecallMode(result.mode)
    ? result.reviewDelayMs === ONE_HOUR_REVIEW_DELAY_MS ? "1時間後の復習へ" : "3分後の復習へ"
    : result.answer || "（未入力）";
  const reviewMarkup = visibleItems.map((result) => `
    <article class="result-review-item">
      <div class="result-review-heading">
        <span class="result-review-range">${escapeHtml(result.item.range)}</span>
        ${result.wrongCount > 1 ? `<span class="result-review-count">${result.wrongCount}回</span>` : ""}
      </div>
      <h3>${escapeHtml(result.prompt ?? result.item.japanese ?? result.item.english)}</h3>
      <dl>
        <div><dt>正しい回答</dt><dd>${escapeHtml(result.correctAnswer ?? result.item.acceptedAnswers?.[0] ?? "—")}</dd></div>
        <div><dt>あなたの回答</dt><dd>${escapeHtml(reviewUserAnswer(result))}</dd></div>
      </dl>
    </article>`).join("");
  const finished = session.completedProgressSummary;
  const nextCycle = session.cycleAdvanced ? studyProgressSummary(session.progress) : null;
  const newRound = Boolean(finished && nextCycle && nextCycle.masteryRound > finished.masteryRound);
  const cycleMarkup = finished ? `
      <section class="result-cycle" aria-label="周回の進み具合">
        <p class="eyebrow">CYCLE</p>
        <h2>${finished.cycleNumber}周目が完了しました</h2>
        <ul class="result-cycle-list">
          <li><span>今回の対象</span><strong>${finished.targetCount}問</strong></li>
          <li><span>習得（${escapeHtml(MASTERY_CRITERION_LABELS[finished.criterion].title)}）</span><strong>${finished.masteredCount}問</strong></li>
          <li><span>${newRound ? "次のラウンド" : `${nextCycle?.cycleNumber ?? finished.cycleNumber + 1}周目の対象`}</span><strong>${nextCycle?.targetCount ?? 0}問</strong></li>
        </ul>
        ${newRound ? "<p class=\"result-cycle-note\">すべて習得しました。新しい習得ラウンドを全問題から始めます（回答履歴は残ります）。</p>" : ""}
      </section>` : "";
  const primaryAction = reviewItems.length
    ? {
        heading: "間違えた問題を固めよう",
        detail: `今回間違えた${reviewItems.length}問だけを、もう一度確認できます（この再挑戦は周回・習得の判定には影響しません）`,
        label: `間違えた${reviewItems.length}問をもう一度`,
        attribute: "data-retry-wrong",
      }
    : nextCycle
      ? {
          heading: newRound ? "新しい習得ラウンドへ" : `${nextCycle.cycleNumber}周目へ進もう`,
          detail: newRound
            ? `全問題を対象に、もう一度${nextCycle.targetCount}問から始めます`
            : `まだ習得していない${nextCycle.targetCount}問だけを続けて学習します`,
          label: newRound ? "新しいラウンドを始める" : `${nextCycle.cycleNumber}周目を始める`,
          attribute: "data-continue-cycle",
        }
      : {
          heading: "今回の範囲は完了",
          detail: "同じ条件でもう一周するか、下から別の範囲へ進めます",
          label: "同じ条件でもう一周",
          attribute: "data-repeat-session",
        };
  return `
    <section class="result-panel" aria-labelledby="result-panel-title">
      <header class="result-complete-header">
        <span class="result-complete-mark" aria-hidden="true">✓</span>
        <p class="eyebrow">${isPastSession ? "LAST SESSION" : "SESSION COMPLETE"}</p>
        <h1 id="result-panel-title">${isPastSession ? "直前の学習結果" : "今回の学習結果"}</h1>
        <ul class="result-context-list" aria-label="学習条件">
          ${resultContext.map(([label, value]) => `<li><span>${label}</span><strong>${escapeHtml(value)}</strong></li>`).join("")}
        </ul>
      </header>
      <section class="result-record" aria-labelledby="result-record-title">
        <h2 id="result-record-title">${isPastSession ? "この学習の記録" : "今回の記録"}</h2>
        <div class="result-record-grid">
          <div><span>${isSelfGraded ? "習得" : "正解"}</span><strong>${summary.correct}</strong></div>
          <div><span>${isSelfGraded ? "復習へ" : "間違い"}</span><strong>${summary.wrong}</strong></div>
          <div><span>学習時間</span><strong>${formatSeconds(summary.durationMs)}</strong></div>
        </div>
      </section>
      ${cycleMarkup}
      <section class="result-next-card" aria-labelledby="result-next-title">
        <div>
          <p class="eyebrow">NEXT STEP</p>
          <h2 id="result-next-title">${canStart ? primaryAction.heading : "別の教科の学習結果です"}</h2>
          <p>${canStart ? primaryAction.detail : `${escapeHtml(SUBJECT_LABELS[resultSubject] ?? "英語")}に切り替えると、ここから続きを始められます`}</p>
        </div>
        ${canStart ? `<button class="primary-button result-primary-action" type="button" ${primaryAction.attribute}>${primaryAction.label}<span aria-hidden="true">→</span></button>` : ""}
      </section>
      ${reviewItems.length ? `<section class="result-review-section" aria-labelledby="result-review-title">
        <div class="result-section-title"><div><p class="eyebrow">CHECK</p><h2 id="result-review-title">要確認問題</h2></div><span>${reviewItems.length}問</span></div>
        <div class="result-review-list">${reviewMarkup}</div>
        ${reviewItems.length > 5 && !session.showAllReviewItems ? '<button class="text-button result-show-all" type="button" data-show-all-review>すべて表示</button>' : ""}
      </section>` : ""}
      <div class="result-other-actions">
        ${canStart && nextCycle && reviewItems.length ? `<button class="secondary-button" type="button" data-continue-cycle>${newRound ? "新しいラウンドを始める" : `${nextCycle.cycleNumber}周目を始める`}（${nextCycle.targetCount}問）</button>` : ""}
        ${canUndoLastAnswer() ? '<button class="secondary-button result-undo-button" type="button" data-undo-answer>↶ 直前の回答を取り消す</button>' : ""}
        ${canStart ? '<button class="secondary-button" type="button" data-change-study>学習条件を変える</button>' : ""}
        <div class="result-text-actions">
          <button class="text-button" type="button" data-dismiss-result>結果を閉じる</button>
        </div>
      </div>
    </section>`;
}

// 学習終了後は分析画面を開き、その先頭に今回の結果を表示する。
function renderSessionComplete() {
  const session = state.session;
  if (!session) return;
  session.complete = true;
  setView("analysis");
  const summary = summarizeSession(session.results);
  if (summary.total && summary.correct === summary.total) {
    const sssOnly = session.results.every((result) => result.item.importance === "SSS");
    const finale = maxCueForFinale(sssOnly);
    requestAnimationFrame(() => runMaxCue(finale, {
      combo: state.combo,
      power: 4,
      label: sssOnly ? "SSS MASTER" : "PERFECT",
      detail: `${summary.correct} / ${summary.total}`,
    }));
  }
}

function renderAnalysis() {
  // 学習途中のセットがあれば、その続きを先頭に出す。学習直後の結果や
  // 保存してある直近の結果は、その下に続けて見せる。
  const resume = state.session?.complete ? null : resumableStudy();
  const completed = resultSession();
  elements.analysisResult.hidden = false;
  elements.analysisResult.innerHTML = resume || completed
    ? [
        resume ? resumeStudyMarkup(resume) : "",
        completed ? sessionResultMarkup(completed) : "",
      ].join("")
    : emptyResultMarkup();
  renderHeader();
}

// 学習の記録も学習途中のセットも無いときの案内。
function emptyResultMarkup() {
  return `
    <section class="result-panel" aria-labelledby="result-empty-title">
      <header class="result-complete-header">
        <p class="eyebrow">NO RECORD</p>
        <h1 id="result-empty-title">まだ学習の記録がありません</h1>
      </header>
      <section class="result-next-card" aria-labelledby="result-empty-next">
        <div>
          <p class="eyebrow">NEXT STEP</p>
          <h2 id="result-empty-next">学習を始めましょう</h2>
          <p>学習を終えると、ここに結果が残ります</p>
        </div>
        <button class="primary-button result-primary-action" type="button" data-view-target="dashboard">学習する範囲を選ぶ<span aria-hidden="true">→</span></button>
      </section>
    </section>`;
}

function retryWrongItems() {
  const session = resultSession();
  if (!session || !canStartFromResult(session)) return;
  const wrong = summarizeReviewItems(session?.results)
    .map((result) => ({ item: result.item, mode: result.mode }));
  if (!wrong.length) return;
  beginSession(wrong, {
    selection: session.selection,
    config: {
      ...(session.config ?? {}),
      itemIds: wrong.map((entry) => entry.item.id),
      count: "all",
    },
  });
}

function continueStudyCycle() {
  const session = resultSession();
  if (!session?.config?.selection || !canStartFromResult(session)) return;
  startSession({ ...session.config, itemIds: null });
}

function repeatCompletedSession() {
  const session = resultSession();
  if (!session?.initialQueue?.length || !canStartFromResult(session)) return;
  beginSession(session.initialQueue.map((entry) => ({ item: entry.item, mode: entry.mode })), {
    selection: session.selection,
    config: session.config,
  });
}

function distributeSlotText(startInput, text) {
  const inputs = [...elements.quizContent.querySelectorAll(".word-slot-input")];
  const start = inputs.indexOf(startInput);
  const question = state.session?.currentQuestion;
  const plan = question?.inputPlan ?? (question ? inputPlanForQuestion(question.item, question.mode) : null);
  const values = distributeInputText(plan, text, start);
  values.forEach((value, index) => {
    if (inputs[index] && (start === 0 || value)) inputs[index].value = value;
  });
  state.session.currentSlotValues = inputs.map((input) => input.value.trim());
  updateCharacterCountDisplay();
  const lastFilled = values.reduce((last, value, index) => value ? index : last, start);
  const nextIndex = clampSlotIndex(lastFilled + 1, inputs.length);
  inputKeyboardState.activeSlotIndex = nextIndex;
  syncInputSlotState();
  inputs[nextIndex]?.focus();
}

function bindEvents() {
  addEventListener("resize", markFxResize, { passive: true });
  addEventListener("orientationchange", markFxResize, { passive: true });
  quizGestureController = bindQuizGestures(elements.quizContent, {
    getPolicy: currentQuizGesturePolicy,
    onTap: toggleRecallFace,
    onDrag: handleQuizDrag,
    onCancel: animateSwipeCancel,
    onSwipe: handleQuizSwipe,
  });
  document.addEventListener("visibilitychange", () => {
    document.body.classList.toggle("fx-hidden", document.hidden);
    if (document.hidden) {
      resetMaxEffects({ keepAmbience: true });
      maxAudio.stopAll({ suspend: true });
      stashStudyProgress();
    }
  });
  // タブを閉じる・別ページへ移る直前にも、学習の進み具合を控えへ逃がす。
  addEventListener("pagehide", stashStudyProgress);

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.viewTarget) {
      // 学習中に左上のマークなどで画面を移るときも、学習の終了処理を通す。
      if (state.view === "quiz" && !leaveQuiz()) return;
      setView(target.dataset.viewTarget);
    }
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
      if (isMaxMode()) {
        unlockMaxAudio();
        triggerMaxEntrance("READY");
      }
    }
    if (target.dataset.effectsMode) {
      state.settings.effectsMode = target.dataset.effectsMode;
      saveSettings();
      renderSettings();
      if (isMaxMode()) {
        unlockMaxAudio();
        triggerMaxEntrance("ON");
      }
    }
    if (target.dataset.soundIntensity) {
      state.settings.soundIntensity = target.dataset.soundIntensity === "full" ? "full" : "gentle";
      saveSettings();
      if (isMaxMode() && state.settings.sound) unlockMaxAudio();
      renderSettings();
    }
    if (target.hasAttribute("data-reset-data")) {
      if (!window.confirm("本当に学習履歴を削除しますか？")) return;
      if (!window.confirm("この操作は取り消せません。削除しますか？")) return;
      clearAllData()
        .then(() => location.reload())
        .catch(() => showToast("データを削除できませんでした"));
    }
    if (target.hasAttribute("data-dashboard-all-ranges")) {
      state.filters.ranges = dashboardRanges();
      state.rangeSelectionMode = "all";
      state.rangeFlow = "dashboard";
      setView("range-detail");
    }
    if (target.dataset.dashboardRange) {
      state.filters.ranges = [target.dataset.dashboardRange];
      state.rangeSelectionMode = "custom";
      state.rangeFlow = "dashboard";
      setView("range-detail");
    }
    if (target.hasAttribute("data-dashboard-multi-range")) {
      state.rangeFlow = "dashboard";
      state.rangeSelectionMode = "all";
      state.filters.ranges = [...currentRangeOrder()];
      setView("study-range-select");
    }
    if (target.dataset.studyTarget) startStudyFromTarget(target.dataset.studyTarget);
    if (target.dataset.studyContentChoice) {
      applyContentChoice(target.dataset.studyContentChoice);
      setView(state.studyFlowMode === "dashboard" ? "study-importance" : "study-method");
    }
    if (target.hasAttribute("data-study-content-other")) {
      state.contentSelectionMode = "custom";
      state.studySelection = { ...state.studySelection, subject: "english", content: null, contents: [] };
      setView("study-content-multi");
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
        setView("study-importance");
      } else {
        const content = target.dataset.studyContent;
        const current = state.contentSelectionMode === "all"
          ? []
          : state.studySelection.contents ?? [];
        const contents = state.contentSelectionMode === "all"
          ? [content]
          : current.includes(content)
            ? current.filter((value) => value !== content)
            : [...current, content];
        state.contentSelectionMode = contents.length ? "custom" : null;
        state.studySelection = {
          ...state.studySelection,
          subject: "english",
          content: contents.length === ENGLISH_CONTENT_TYPES.length
            ? "all"
            : contents.length === 1
              ? contents[0]
              : null,
          contents,
        };
        renderStudyContentMulti();
      }
    }
    if (target.id === "confirm-study-content" && state.studySelection.contents?.length) {
      setView(state.studyFlowMode === "dashboard" ? "study-importance" : "study-method");
    }
    if (target.dataset.studyDirection) {
      state.studySelection.direction = target.dataset.studyDirection;
      state.studySelection.method = null;
      setView("study-scope");
    }
    if (target.dataset.studyFormat && state.studySelection.direction) {
      state.studySelection.method = `${state.studySelection.direction}_${target.dataset.studyFormat}`;
      state.studySelection.scope = "full";
      setView("study-importance");
    }
    if (target.hasAttribute("data-study-range-all")) {
      state.rangeSelectionMode = "all";
      state.filters.ranges = [...currentRangeOrder()];
      renderStudyRangeSelect();
    }
    if (target.dataset.studyRange) {
      const range = target.dataset.studyRange;
      const wasAllSelected = state.rangeSelectionMode === "all";
      state.rangeSelectionMode = "custom";
      state.filters.ranges = wasAllSelected
        ? [range]
        : state.filters.ranges.includes(range)
          ? state.filters.ranges.filter((value) => value !== range)
          : [...state.filters.ranges, range];
      if (!state.filters.ranges.length) state.rangeSelectionMode = null;
      renderStudyRangeSelect();
    }
    if (target.id === "confirm-study-ranges" && state.filters.ranges.length) {
      setView(state.rangeFlow === "dashboard" ? "range-detail" : "study-content");
    }
    if (target.hasAttribute("data-back-before-importance")) {
      setView(viewBeforeImportanceSelection());
    }
    if (target.dataset.studyImportanceChoice) {
      const choice = target.dataset.studyImportanceChoice;
      state.importanceFilterMode = choice === "all" ? "all" : "custom";
      state.filters.importance = choice === "all" ? [] : [choice];
      setView("study-sort-kind");
    }
    if (target.hasAttribute("data-study-importance-other")) {
      state.importanceFilterMode = "custom";
      state.filters.importance = [];
      setView("study-importance-select");
    }
    if (target.dataset.studyImportance) {
      const importance = target.dataset.studyImportance;
      state.filters.importance = state.filters.importance.includes(importance)
        ? state.filters.importance.filter((value) => value !== importance)
        : [...state.filters.importance, importance];
      renderStudyImportanceSelect();
    }
    if (target.id === "confirm-study-importance" && state.filters.importance.length) {
      setView("study-sort-kind");
    }
    if (target.hasAttribute("data-back-before-sort")) {
      setView("study-importance");
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
    if (target.id === "load-more") {
      state.listLimit += 60;
      renderList(false);
    }
    if (target.dataset.choice !== undefined) submitAnswer(target.dataset.choice);
    if (target.hasAttribute("data-toggle-character-count")) {
      state.settings.showCharacterCount = !state.settings.showCharacterCount;
      saveSettings();
      updateCharacterCountDisplay();
    }
    if (target.dataset.alphabetKey !== undefined) applyAlphabetKey(target.dataset.alphabetKey);
    if (target.dataset.alphabetAction) {
      const action = target.dataset.alphabetAction;
      if (action === "delete") deleteAlphabetCharacter();
      if (action === "previous") moveActiveInputSlot(-1);
      if (action === "next") moveActiveInputSlot(1);
      if (action === "submit") submitAnswer(currentTypedAnswer());
    }
    if (target.hasAttribute("data-use-system-keyboard")) switchToSystemKeyboard();
    if (target.hasAttribute("data-submit-input")) submitAnswer(currentTypedAnswer());
    if (target.dataset.recallGrade !== undefined) {
      const surface = elements.quizContent.querySelector("[data-quiz-gesture-surface]");
      if (surface) handleRecallSwipe({ surface, direction: target.dataset.recallGrade });
    }
    if (target.hasAttribute("data-next-question")) {
      advanceAnsweredCard("right");
    }
    if (target.hasAttribute("data-quit-quiz")) {
      if (leaveQuiz()) setView("home");
    }
    if (target.hasAttribute("data-resume-study")) {
      const resume = resumableStudy();
      if (resume) {
        if (resume.config.subject !== state.subject) selectSubject(resume.config.subject);
        startSession(resume.config);
      }
    }
    if (target.hasAttribute("data-retry-wrong")) retryWrongItems();
    if (target.hasAttribute("data-repeat-session")) repeatCompletedSession();
    if (target.hasAttribute("data-continue-cycle")) continueStudyCycle();
    if (target.hasAttribute("data-undo-answer")) undoLastAnswer();
    if (target.dataset.masteryCriterion) {
      const criterion = normalizeMasteryCriterion(target.dataset.masteryCriterion);
      if (criterion !== masteryCriterion()) {
        state.settings.masteryCriterion = criterion;
        saveSettings();
        renderSettings();
        showToast("習得条件を変更したため、進捗判定を新しく開始します");
      }
    }
    if (target.hasAttribute("data-show-all-review")) {
      const completed = resultSession();
      if (completed) {
        completed.showAllReviewItems = true;
        renderAnalysis();
      }
    }
    if (target.hasAttribute("data-change-study")) {
      state.session = null;
      resetStudyFlow();
      state.rangeFlow = "study";
      state.studyFlowMode = "step";
      setView("study-range-select");
    }
    if (target.hasAttribute("data-dismiss-result")) {
      state.session = null;
      clearSessionResult();
      setView("dashboard");
    }
  });

  elements.listSearch.addEventListener("input", () => renderList(true));

  document.addEventListener("change", (event) => {
    const setting = event.target.dataset?.setting;
    if (!setting || !(setting in state.settings)) return;
    state.settings[setting] = event.target.checked;
    if (setting === "sound" && state.settings.sound && isMaxMode()) unlockMaxAudio();
    if (setting === "sound" && !state.settings.sound) maxAudio.stopAll();
    saveSettings();
  });

  elements.quizContent.addEventListener("keydown", (event) => {
    const mode = state.session?.currentQuestion?.mode;
    const gestureSurface = event.target.closest("[data-quiz-gesture-surface]");
    if (isRecallMode(mode)) {
      if (gestureSurface && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        toggleRecallFace();
      }
      return;
    }
    if (event.target.closest("button")) return;
    const input = event.target.closest(".word-slot-input");
    if (input) {
      const inputs = [...elements.quizContent.querySelectorAll(".word-slot-input")];
      const index = inputs.indexOf(input);
      if (event.key === "Enter") {
        event.preventDefault();
        if (index < inputs.length - 1) {
          inputs[index + 1].focus();
          ensureInputVisible(inputs[index + 1]);
        } else {
          submitAnswer(currentTypedAnswer());
        }
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        if (inputs[index + 1]) {
          inputs[index + 1].focus();
          ensureInputVisible(inputs[index + 1]);
        }
        return;
      }
      if (event.key === "Backspace" && !input.value && index > 0) {
        const previous = inputs[index - 1];
        previous.focus();
        previous.setSelectionRange(previous.value.length, previous.value.length);
        ensureInputVisible(previous);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (state.session?.answered) advanceAnsweredCard("right");
      else if (!isSwipeAdvanceMode(mode)) submitAnswer(currentTypedAnswer());
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
    if (!input) return;
    if (/\s/.test(input.value)) {
      distributeSlotText(input, input.value);
      return;
    }
    state.session.currentSlotValues = [...elements.quizContent.querySelectorAll(".word-slot-input")]
      .map((slotInput) => slotInput.value.trim());
    if (state.settings.showCharacterCount) updateCharacterCountDisplay();
  });
  elements.quizContent.addEventListener("focusin", (event) => {
    const input = event.target.closest(".word-slot-input");
    if (!input) return;
    // 押された枠をアクティブにする（focus はすでに移っているので再フォーカスしない）。
    if (!state.session?.answered) activateInputSlot(Number(input.dataset.slotIndex), { focus: false });
    ensureInputVisible(input);
  });
  window.visualViewport?.addEventListener("resize", () => ensureInputVisible());
}

async function boot() {
  bindEvents();
  try {
    const [response, publicResponse, healthResponse, history, selectedMode, settings, bestCombo, selectedPeriod, studyConfigs, legacyRecentStudies, studyProgress, lastSessionResult] = await Promise.all([
      fetch("./data/items.json?v=2026.08.31b"),
      fetch("./data/public-items.json?v=2026.09.01"),
      fetch("./data/health-items.json?v=2026.09.01"),
      loadHistory(),
      getMeta("selectedMode"),
      getMetaObject("settings", DEFAULT_SETTINGS),
      getMeta("bestCombo", 0),
      getMeta("selectedPeriod", null),
      getMetaObject("studyConfigs", {}),
      getMeta("recentStudies", []),
      getMetaObject("studyProgress", {}),
      getMeta("lastSessionResult", null),
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
    state.settings = settings;
    state.settings.soundIntensity = state.settings.soundIntensity === "full" ? "full" : "gentle";
    installMaxEffectsLab();
    state.bestCombo = Number(bestCombo) || 0;
    state.studyConfigs = Object.fromEntries(
      Object.entries(studyConfigs ?? {})
        .map(([key, config]) => [key, normalizeRecentStudyConfig(config)])
        .filter(([, config]) => config),
    );
    state.settings.masteryCriterion = normalizeMasteryCriterion(state.settings.masteryCriterion);
    state.studyProgress = Object.fromEntries(
      Object.entries(studyProgress ?? {})
        .map(([key, value]) => [key, normalizeStudyProgress(value)])
        .filter(([, value]) => value),
    );
    adoptLegacyStudyConfigs(legacyRecentStudies);
    state.lastSessionResult = normalizeSessionResultSnapshot(lastSessionResult);
    state.selectedPeriod = selectedPeriod === "2026.2" ? selectedPeriod : null;
    elements.appShell.setAttribute("aria-busy", "false");
    setView(state.selectedPeriod ? "subject" : "period");
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js?v=2026.9.18a").catch((error) => console.warn("オフライン準備に失敗しました", error));
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
