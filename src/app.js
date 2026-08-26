import {
  ALL_MODES,
  IMPORTANCE_ORDER,
  MODE_LABELS,
  RANGE_ORDER,
  TYPE_LABELS,
  STUDY_CONTENT_LABELS,
  STUDY_METHOD_LABELS,
  accuracyFor,
  answersForMode,
  applyFilters,
  buildQuestion,
  buildSession,
  buildStudySession,
  getHistory,
  isAnswerCorrect,
  normalizeAnswer,
  slotTokensForQuestion,
  sortItems,
  recommendStudy,
  normalizeStudySelection,
  studyCombinationKey,
  studyCyclePolicy,
  studyModeForItem,
  summarizeByMode,
  summarizeByRange,
  summarizeHistory,
  summarizeSession,
} from "./logic.js?v=phase7.9";
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
  history: new Map(),
  view: "home",
  selectedMode: null,
  studySelection: { content: null, method: null, scope: null },
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
  questionCount: 15,
  repeatWrong: false,
  listLimit: 60,
  session: null,
  settings: { ...DEFAULT_SETTINGS },
  combo: 0,
  bestCombo: 0,
  activeStudy: null,
  performanceExplicit: false,
  cycleContextKey: null,
  rangeFilterMode: null,
  importanceFilterMode: null,
};

const elements = Object.fromEntries(
  [
    "app-shell",
    "app-header",
    "header-status",
    "greeting",
    "home-accuracy",
    "home-progress",
    "home-summary",
    "resume-study-card",
    "study-content-options",
    "study-method-heading",
    "study-method-copy",
    "study-method-options",
    "study-scope-options",
    "study-range-kind-options",
    "study-range-options",
    "confirm-study-ranges",
    "study-importance-kind-options",
    "study-importance-options",
    "confirm-study-importance",
    "study-sort-kind-options",
    "study-sort-other-options",
    "quick-grid",
    "range-grid",
    "cycle-performance-card",
    "question-count-options",
    "repeat-wrong",
    "start-session",
    "start-session-label",
    "list-search",
    "list-sort",
    "list-count",
    "word-list",
    "load-more",
    "quiz-content",
    "analysis-content",
    "settings-content",
    "bottom-nav",
    "effects-canvas",
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
  all: "全ての成績",
  unanswered: "未回答",
  answered: "回答済み",
  everCorrect: "正解したことがある",
  everMissed: "一度でも間違えた",
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

const QUICK_ACTIONS = [
  { id: "weak", icon: "↘", title: "苦手だけ", detail: "ミスした語句を苦手順で", tone: "red" },
  { id: "missed", icon: "×", title: "間違えた問題", detail: "一度でも間違えた項目", tone: "orange" },
  { id: "sss", icon: "S", title: "SSSだけ", detail: "最重要語句を集中確認", tone: "violet" },
  { id: "resume", icon: "↺", title: "前回の続き", detail: "前回と同じ学習条件", tone: "blue" },
  { id: "recommended", icon: "✦", title: "おすすめ15問", detail: "履歴と重要度から優先", tone: "green" },
  { id: "random", icon: "⌁", title: "ランダム20問", detail: "全範囲からバランスよく", tone: "gray" },
  { id: "preposition", icon: "_", title: "前置詞だけ", detail: "前置詞を完全入力", tone: "cyan" },
  { id: "spelling", icon: "Aa", title: "スペルだけ", detail: "日本語から英単語へ", tone: "yellow" },
];

const MODE_META = {
  en_to_ja_choice: { icon: "英→日", tags: ["4択", "意味"] },
  ja_to_en_choice: { icon: "日→英", tags: ["4択", "英語"] },
  ja_to_en_input: { icon: "日→英", tags: ["完全入力", "語句"] },
  spelling_input: { icon: "Aa", tags: ["完全入力", "スペル"] },
  preposition_input: { icon: "_", tags: ["穴埋め", "前置詞"] },
  phrase_blank_input: { icon: "…", tags: ["穴埋め", "熟語・構文"] },
};

const STUDY_CONTENT_META = {
  word: { icon: "Aa", title: "単語", detail: "英単語を中心に学習", tags: ["単語"] },
  phrase: { icon: "…", title: "熟語・構文", detail: "熟語・構文・表現を学習", tags: ["熟語", "構文"] },
  all: { icon: "＋", title: "どちらも", detail: "単語と熟語・構文を続けて学習", tags: ["単語", "熟語・構文"] },
};

const STUDY_METHOD_META = {
  ja_to_en_choice: { icon: "日→英", detail: "日本語に合う英語を4つから選ぶ", tags: ["4択"] },
  en_to_ja_choice: { icon: "英→日", detail: "英語に合う日本語を4つから選ぶ", tags: ["4択"] },
  write: { icon: "✎", detail: "日本語を見て英語を正しく書く", tags: ["記述"] },
};

const KNOWN_STUDY_SELECTIONS = [
  ...["word", "phrase", "all"].flatMap((content) => [
    { content, method: "ja_to_en_choice", scope: "full" },
    { content, method: "en_to_ja_choice", scope: "full" },
    { content, method: "write", scope: "full" },
  ]),
  { content: "phrase", method: "write", scope: "partial" },
  { content: "all", method: "write", scope: "partial" },
];

const TAG_LABELS = {
  word: "単語",
  phrase: "熟語",
  structure: "構文",
  expression: "表現",
  preposition: "前置詞",
  spelling: "スペル",
  blank: "穴埋め",
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

function pluralQuestions(value) {
  return value === "all" ? "全問" : `${value}問`;
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

function selectionIsComplete(selection = state.studySelection) {
  const normalized = normalizeStudySelection(selection);
  return Boolean(normalized.content && normalized.method);
}

function studySelectionLabel(selection = state.studySelection) {
  const normalized = normalizeStudySelection(selection);
  if (!normalized.content || !normalized.method) return "—";
  const parts = [
    STUDY_CONTENT_LABELS[normalized.content],
    STUDY_METHOD_LABELS[normalized.method],
  ];
  if (normalized.method === "write" && normalized.content !== "word") {
    parts.push(normalized.scope === "partial" ? "一部を穴埋め" : "全部を書く");
  }
  return parts.join(" / ");
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

function renderStudyContent() {
  elements.studyContentOptions.innerHTML = Object.entries(STUDY_CONTENT_META)
    .map(([content, meta]) => selectionCard({
      ...meta,
      dataAttribute: `data-study-content="${content}"`,
    }))
    .join("");
}

function renderStudyMethod() {
  const contentLabel = STUDY_CONTENT_LABELS[state.studySelection.content] ?? "教材";
  elements.studyMethodHeading.textContent = `${contentLabel}の出題方法`;
  elements.studyMethodCopy.textContent = "4択または記述から一つ選んでください。";
  elements.studyMethodOptions.innerHTML = Object.entries(STUDY_METHOD_META)
    .map(([method, meta]) => selectionCard({
      icon: meta.icon,
      title: STUDY_METHOD_LABELS[method],
      detail: meta.detail,
      tags: meta.tags,
      dataAttribute: `data-study-method="${method}"`,
    }))
    .join("");
}

function renderStudyScope() {
  elements.studyScopeOptions.innerHTML = [
    {
      scope: "partial",
      icon: "＿",
      title: "一部を入力",
      detail: "日本語訳を見ながら、熟語・構文の空欄部分だけを書く",
      tags: ["穴埋め"],
    },
    {
      scope: "full",
      icon: "ABC",
      title: "全部を書く",
      detail: "日本語訳を見て、英語を最初から最後まで書く",
      tags: ["完全入力"],
    },
  ].map((meta) => selectionCard({
    ...meta,
    dataAttribute: `data-study-scope="${meta.scope}"`,
  })).join("");
}

function renderStudyRangeKind() {
  elements.studyRangeKindOptions.innerHTML = [
    { mode: "all", icon: "∞", title: "全範囲", detail: "8範囲をすべて学習", tags: ["すべて"] },
    { mode: "custom", icon: "✓", title: "その他", detail: "学習する範囲を複数選択", tags: ["複数選択可"] },
  ].map((meta) => selectionCard({
    ...meta,
    dataAttribute: `data-range-filter-mode="${meta.mode}"`,
  })).join("");
}

function renderStudyRangeSelect() {
  elements.studyRangeOptions.innerHTML = RANGE_ORDER.map((range) => {
    const selected = state.filters.ranges.includes(range);
    const count = state.items.filter((item) => item.range === range && studyModeForItem(item, state.studySelection)).length;
    return `<button class="multi-select-card${selected ? " selected" : ""}" type="button" data-study-range="${escapeHtml(range)}" aria-pressed="${selected}">
      <span class="multi-check" aria-hidden="true">${selected ? "✓" : ""}</span>
      <span><strong>${escapeHtml(range)}</strong><small>${count}語句</small></span>
    </button>`;
  }).join("");
  elements.confirmStudyRanges.disabled = state.filters.ranges.length === 0;
}

function renderStudyImportanceKind() {
  elements.studyImportanceKindOptions.innerHTML = [
    { mode: "all", icon: "∞", title: "重要度全部", detail: "SSSからBまですべて学習", tags: ["すべて"] },
    { mode: "custom", icon: "✓", title: "その他の重要度", detail: "重要度を複数選択", tags: ["複数選択可"] },
  ].map((meta) => selectionCard({
    ...meta,
    dataAttribute: `data-importance-filter-mode="${meta.mode}"`,
  })).join("");
}

function renderStudyImportanceSelect() {
  elements.studyImportanceOptions.innerHTML = IMPORTANCE_ORDER.map((importance) => {
    const selected = state.filters.importance.includes(importance);
    const count = learningItems({ ...state.filters, importance: [importance] }).length;
    return `<button class="multi-select-card importance-option${selected ? " selected" : ""}" type="button" data-study-importance="${importance}" aria-pressed="${selected}">
      <span class="multi-check" aria-hidden="true">${selected ? "✓" : ""}</span>
      <span><strong>${importance}</strong><small>${count}語句</small></span>
    </button>`;
  }).join("");
  elements.confirmStudyImportance.disabled = state.filters.importance.length === 0;
}

function renderStudySortKind() {
  elements.studySortKindOptions.innerHTML = [
    { key: "importance-desc", icon: "S", title: "重要度順", detail: "重要度が高い問題から出題", tags: ["おすすめ"] },
    { key: "difficulty", icon: "↘", title: "苦手順", detail: "間違いが多い問題から出題", tags: ["復習"] },
    { key: "other", icon: "…", title: "その他", detail: "ランダムや正答率順などから選択", tags: ["15種類"] },
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

function viewBeforeRangeSelection() {
  return state.studySelection.method === "write" && state.studySelection.content !== "word"
    ? "study-scope"
    : "study-method";
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

let effectFrame = 0;
let calloutTimer = 0;

function playEffectSound(power = 1) {
  if (!state.settings.sound) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
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
    oscillator.onended = () => context.close();
  } catch { /* Audio is an optional enhancement. */ }
}

function drawParticles(power = 1) {
  if (!state.settings.particles || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = elements.effectsCanvas;
  const context = canvas.getContext("2d", { alpha: true });
  const scale = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * scale);
  canvas.height = Math.round(innerHeight * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4;
  const count = Math.min(lowPower ? 90 : 300, power >= 4 ? 300 : power >= 2 ? 150 : 80);
  const colors = ["#70d7ff", "#ffffff", "#9b7cff", "#ffd86b", "#ff5db1"];
  const particles = Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.3;
    const speed = 2.5 + Math.random() * (5 + power);
    return {
      x: innerWidth / 2,
      y: innerHeight * 0.42,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,
      size: 1.5 + Math.random() * 3.5,
      color: colors[index % colors.length],
      life: 1,
    };
  });
  cancelAnimationFrame(effectFrame);
  let previous = performance.now();
  const animate = (now) => {
    const frameDuration = now - previous;
    const frameScale = Math.min(2, frameDuration / 16.67);
    if (frameDuration > 30 && particles.length > 80) {
      particles.length = Math.max(80, Math.ceil(particles.length * 0.6));
    }
    previous = now;
    context.clearRect(0, 0, innerWidth, innerHeight);
    let alive = false;
    for (const particle of particles) {
      if (particle.life <= 0) continue;
      alive = true;
      particle.x += particle.vx * frameScale;
      particle.y += particle.vy * frameScale;
      particle.vy += 0.08 * frameScale;
      particle.life -= 0.022 * frameScale;
      context.globalAlpha = Math.max(0, particle.life);
      context.fillStyle = particle.color;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    if (alive) effectFrame = requestAnimationFrame(animate);
    else context.clearRect(0, 0, innerWidth, innerHeight);
  };
  effectFrame = requestAnimationFrame(animate);
}

function showMaxCallout(label, detail = "", power = 1) {
  if (!isMaxMode() || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  clearTimeout(calloutTimer);
  elements.maxCallout.innerHTML = `${escapeHtml(label)}${detail ? `<small>${escapeHtml(detail)}</small>` : ""}`;
  elements.maxCallout.hidden = false;
  elements.maxCallout.style.animation = "none";
  requestAnimationFrame(() => { elements.maxCallout.style.animation = ""; });
  calloutTimer = setTimeout(() => { elements.maxCallout.hidden = true; }, 650);
  drawParticles(power);
  playEffectSound(power);
  if (state.settings.vibration && navigator.vibrate) navigator.vibrate(power >= 4 ? [35, 30, 55] : power >= 2 ? 35 : 15);
  if (state.settings.shake && power >= 2 && (navigator.hardwareConcurrency ?? 8) > 4) {
    document.body.classList.remove("screen-shake");
    requestAnimationFrame(() => document.body.classList.add("screen-shake"));
    setTimeout(() => document.body.classList.remove("screen-shake"), 280);
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
  showMaxCallout(label, detail, power);
}

function setView(view) {
  if (view === "setup" && !selectionIsComplete()) view = "study-content";
  state.view = view;
  document.querySelectorAll("[data-view]").forEach((section) => {
    section.hidden = section.dataset.view !== view;
  });
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.viewTarget === view ||
        (["study-content", "study-method", "study-scope", "study-range-kind", "study-range-select", "study-importance-kind", "study-importance-select", "study-sort-kind", "study-sort-other", "setup"].includes(view) &&
          button.dataset.viewTarget === "study-content"),
    );
  });
  elements.bottomNav.hidden = view === "quiz";
  elements.appHeader.hidden = view === "quiz";
  document.body.classList.toggle("quiz-active", view === "quiz");
  window.scrollTo({ top: 0, behavior: "auto" });

  if (view === "home") renderHome();
  if (view === "study-content") renderStudyContent();
  if (view === "study-method") renderStudyMethod();
  if (view === "study-scope") renderStudyScope();
  if (view === "study-range-kind") renderStudyRangeKind();
  if (view === "study-range-select") renderStudyRangeSelect();
  if (view === "study-importance-kind") renderStudyImportanceKind();
  if (view === "study-importance-select") renderStudyImportanceSelect();
  if (view === "study-sort-kind") renderStudySortKind();
  if (view === "study-sort-other") renderStudySortOther();
  if (view === "setup") renderSetup();
  if (view === "list") renderList(true);
  if (view === "analysis") renderAnalysis();
  if (view === "settings") renderSettings();
  applySettings();
}

function renderHeader() {
  const summary = summarizeHistory(state.items, state.history);
  elements.headerStatus.textContent = summary.attempts
    ? `${summary.correct.toLocaleString()} 正解 / ${summary.attempts.toLocaleString()} 回答`
    : `${state.items.length}語句`;
}

function renderHome() {
  const hour = new Date().getHours();
  elements.greeting.textContent =
    hour < 11 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";

  const summary = summarizeHistory(state.items, state.history);
  elements.homeAccuracy.textContent = formatPercent(summary.accuracy);
  elements.homeProgress.style.width = `${Math.round((summary.accuracy ?? 0) * 100)}%`;
  elements.homeSummary.textContent = summary.attempts
    ? `${summary.answeredItems}語句を学習・苦手 ${summary.weakItems}語句`
    : "まだ回答履歴がありません";

  if (state.activeStudy?.config?.selection) {
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

  elements.quickGrid.innerHTML = QUICK_ACTIONS.map(
    (action) => `
      <button class="quick-card" type="button" data-quick="${action.id}">
        <span class="quick-icon tone-${action.tone}" aria-hidden="true">${action.icon}</span>
        <span>
          <strong>${action.title}</strong>
          <small>${action.detail}</small>
        </span>
        <span class="card-arrow" aria-hidden="true">›</span>
      </button>`,
  ).join("");

  elements.rangeGrid.innerHTML = RANGE_ORDER.map((range) => {
    const items = state.items.filter((item) => item.range === range);
    const stats = summarizeHistory(items, state.history);
    return `
      <button class="range-card" type="button" data-range-start="${escapeHtml(range)}">
        <span class="range-name">${escapeHtml(range)}</span>
        <strong>${items.length}<small>語句</small></strong>
        <span class="range-meta">${stats.attempts ? `正答率 ${formatPercent(stats.accuracy)}` : "未学習"}</span>
        <span class="mini-progress" aria-hidden="true"><i style="width:${Math.round((stats.accuracy ?? 0) * 100)}%"></i></span>
      </button>`;
  }).join("");
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
  return applyFilters(state.items, state.history, { ...filters, modes: [] })
    .filter((item) => studyModeForItem(item, selection));
}

function remainingLearningItems(filters = state.filters, selection = state.studySelection) {
  const completed = new Set(progressForSelection(selection).completedItemIds ?? []);
  return learningItems(filters, selection).filter((item) => !completed.has(item.id));
}

function cycleItems(selection, performance, minimumWrong = 0) {
  return applyFilters(state.items, state.history, {
    ...state.filters,
    types: [],
    tags: [],
    performance,
    minimumWrong,
    modes: [],
  }).filter((item) => studyModeForItem(item, selection));
}

function syncStudyCycle(selection) {
  const key = studyCombinationKey(selection);
  let progress = progressForSelection(selection);
  let cycle = (progress.completedCycles ?? 0) + 1;
  const completed = new Set(progress.completedItemIds ?? []);
  const policy = studyCyclePolicy(cycle, state.performanceExplicit ? state.filters.performance : null);
  const performance = policy.performance ?? "all";
  const minimumWrong = cycle <= 2 ? 0 : state.filters.minimumWrong;
  const target = cycleItems(selection, performance, minimumWrong);
  const completedTarget = target.length > 0 && target.every((item) => completed.has(item.id));
  const emptySecondCycle = cycle === 2 && target.length === 0;

  if (completedTarget || emptySecondCycle) {
    progress = {
      ...progress,
      completedItemIds: [],
      completedCycles: (progress.completedCycles ?? 0) + 1,
    };
    state.progress.set(key, progress);
    setMeta(`studyProgress:${key}`, progress).catch(console.warn);
    cycle = (progress.completedCycles ?? 0) + 1;
  }

  if (cycle === 2 && cycleItems(selection, "everMissed", 0).length === 0) {
    progress = {
      ...progress,
      completedItemIds: [],
      completedCycles: (progress.completedCycles ?? 0) + 1,
    };
    state.progress.set(key, progress);
    setMeta(`studyProgress:${key}`, progress).catch(console.warn);
    cycle = (progress.completedCycles ?? 0) + 1;
  }

  const contextKey = `${key}:${cycle}`;
  if (state.cycleContextKey !== contextKey) {
    state.cycleContextKey = contextKey;
    state.performanceExplicit = false;
    state.filters.types = [];
    state.filters.tags = [];
    state.filters.minimumWrong = 0;
    state.filters.performance = cycle === 2 ? "everMissed" : "all";
  }

  if (cycle === 1) {
    state.filters.performance = "all";
    state.filters.minimumWrong = 0;
  } else if (cycle === 2) {
    state.filters.performance = "everMissed";
    state.filters.minimumWrong = 0;
  }
  return { cycle, progress };
}

function renderSetup() {
  if (!selectionIsComplete()) {
    setView("study-content");
    return;
  }
  const selection = normalizeStudySelection(state.studySelection);
  const { cycle } = syncStudyCycle(selection);
  elements.cyclePerformanceCard.hidden = cycle < 3;
  elements.cyclePerformanceCard.innerHTML = cycle < 3 ? "" : `<div>
      <span class="subtle-label">${cycle}周目・選択必須</span>
      <h2>今回の成績条件</h2>
      <p>${state.performanceExplicit ? PERFORMANCE_LABELS[state.filters.performance] : "どちらかを選んでください"}</p>
    </div>
    <div class="cycle-performance-actions">
      <button class="secondary-button compact${state.performanceExplicit && state.filters.performance === "everMissed" ? " selected" : ""}" type="button" data-cycle-performance="everMissed">間違えた問題</button>
      <button class="secondary-button compact${state.performanceExplicit && state.filters.performance === "all" ? " selected" : ""}" type="button" data-cycle-performance="all">全部</button>
      <button class="text-button" type="button" data-open-performance-detail>詳細を選ぶ</button>
    </div>`;
  const eligible = learningItems();
  const remaining = remainingLearningItems();
  const count = remaining.length || eligible.length;
  elements.repeatWrong.checked = state.repeatWrong;
  elements.questionCountOptions.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("selected", String(state.questionCount) === button.dataset.count);
    button.setAttribute(
      "aria-checked",
      String(String(state.questionCount) === button.dataset.count),
    );
  });
  const actual = state.questionCount === "all" ? count : Math.min(count, state.questionCount);
  elements.startSessionLabel.textContent = `${pluralQuestions(actual)}をスタート`;
  elements.startSession.disabled = eligible.length === 0 || (cycle >= 3 && !state.performanceExplicit);
  renderHeader();
}

function renderList(resetLimit = false) {
  if (resetLimit) state.listLimit = 60;
  const filters = { ...state.filters, search: elements.listSearch.value.trim() };
  const items = sortItems(
    filteredItems(filters),
    state.history,
    state.listSortKey,
  );
  elements.listCount.textContent = `${items.length.toLocaleString()}語句`;
  elements.listSort.value = state.listSortKey;
  elements.wordList.innerHTML = items.slice(0, state.listLimit).map((item) => {
    const record = getHistory(state.history, item.id);
    const accuracy = accuracyFor(record);
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
  elements.filterRanges.innerHTML = RANGE_ORDER.map((range) =>
    checkInput("ranges", range, range, state.filters.ranges.includes(range)),
  ).join("");
  elements.filterImportance.innerHTML = IMPORTANCE_ORDER.map((importance) =>
    checkInput(
      "importance",
      importance,
      importance,
      state.filters.importance.includes(importance),
    ),
  ).join("");
  elements.filterTypes.innerHTML = "";
  elements.filterTags.innerHTML = "";
  const cycle = state.view === "setup" && selectionIsComplete()
    ? (progressForSelection().completedCycles ?? 0) + 1
    : 3;
  elements.filterPerformanceFieldset.hidden = state.view === "setup" && cycle < 3;
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
  const items = state.view === "setup" ? learningItems(draft) : filteredItems(draft);
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
  if (state.view === "setup") state.performanceExplicit = false;
  renderFilterForm();
}

async function quickStart(id) {
  const base = {
    ...state.filters,
    ranges: [],
    importance: [],
    types: [],
    tags: [],
    performance: "all",
    minimumWrong: 0,
    search: "",
  };
  if (id === "resume") {
    const previous = await getMeta("lastSessionConfig");
    if (!previous) {
      showToast("前回の学習条件はまだありません");
      return;
    }
    startSession({ ...previous, mode: previous.mode ?? previous.modes?.[0] });
    return;
  }

  const recommendation = recommendStudy(state.items, state.history);
  const config = {
    filters: base,
    mode: state.selectedMode ?? recommendation.mode ?? "ja_to_en_input",
    sortKey: "random",
    count: 15,
    repeatWrong: false,
  };
  if (id === "weak") {
    config.filters.performance = "everMissed";
    config.sortKey = "difficulty";
  }
  if (id === "missed") config.filters.performance = "everMissed";
  if (id === "sss") config.filters.importance = ["SSS"];
  if (id === "recommended") {
    config.mode = recommendation.mode;
    config.itemIds = recommendation.itemIds;
    config.count = recommendation.count;
    config.sortKey = "difficulty";
  }
  if (id === "random") config.count = 20;
  if (id === "preposition") config.mode = "preposition_input";
  if (id === "spelling") config.mode = "spelling_input";
  startSession(config);
}

function startSession(overrides = {}) {
  const resumeSnapshot = state.activeStudy && overrides === state.activeStudy.config
    ? state.activeStudy
    : null;
  const mode = overrides.mode ?? overrides.modes?.[0] ?? state.selectedMode;
  const selection = normalizeStudySelection(overrides.selection ?? state.studySelection);
  const usesSelection = Boolean(selection.content && selection.method && !overrides.mode && !overrides.modes);
  if (!usesSelection && (!mode || !ALL_MODES.includes(mode))) {
    showToast("先に学習内容と出題方法を選んでください");
    setView("study-content");
    return;
  }
  const config = {
    filters: overrides.filters ?? { ...state.filters, search: "" },
    ...(usesSelection ? { selection } : { mode }),
    sortKey: overrides.sortKey ?? state.sortKey,
    count: overrides.count ?? state.questionCount,
    repeatWrong: overrides.repeatWrong ?? state.repeatWrong,
    itemIds: overrides.itemIds ?? null,
  };
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
        completedItemIds: progress.completedItemIds,
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
  if (usesSelection) state.studySelection = selection;
  state.selectedMode = queue[0].mode;
  setMeta("selectedMode", state.selectedMode).catch(console.warn);
  setMeta("lastSessionConfig", config).catch(console.warn);
  state.session = {
    queue,
    cursor: 0,
    results: [],
    repeatedIds: new Set(),
    repeatWrong: config.repeatWrong,
    currentQuestion: null,
    currentAnswer: "",
    answered: false,
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
  session.currentQuestion = buildQuestion(entry.item, entry.mode, state.items);
  session.currentAnswer = "";
  session.answered = false;
  session.questionStartedAt = performance.now();
  renderQuiz();
}

function sourceLine(item) {
  return item.sources
    .map((source) => `${source.lesson} · ${source.title}${source.detail ? ` · ${source.detail}` : ""}`)
    .join(" / ");
}

function renderChoiceArea(question, answered, currentAnswer) {
  const letters = ["A", "B", "C", "D"];
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
        return `<button class="choice-button${resultClass}" type="button" data-choice="${escapeHtml(choice)}" ${answered ? "disabled" : ""}>
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
      ${!correct && !isChoice ? `<p class="input-correct-answer"><span>正解</span><strong>${escapeHtml(correctAnswer)}</strong></p>` : ""}
      ${state.settings.showSources ? `<div class="source-box">
        <span class="importance-badge importance-${question.item.importance.toLowerCase()}">${question.item.importance}</span>
        <div>
          <strong class="source-range">範囲：${escapeHtml(question.item.range)}</strong>
          <p>${escapeHtml(sourceLine(question.item))}</p>
        </div>
      </div>` : ""}
    </section>
    <button class="primary-button next-button" type="button" data-next-question>
      ${state.session.cursor + 1 >= state.session.queue.length ? "結果を見る" : "次の問題へ"}
      <span aria-hidden="true">→</span>
    </button>`;
}

function renderQuiz() {
  const session = state.session;
  if (!session || session.complete) {
    renderSessionComplete();
    return;
  }
  const question = session.currentQuestion;
  const answered = session.answered;
  const lastResult = session.results.at(-1);
  const progress = Math.round(((session.cursor + (answered ? 1 : 0)) / session.queue.length) * 100);
  const isChoice = question.mode.endsWith("choice");
  const usesSlots = ["ja_to_en_input", "spelling_input"].includes(question.mode);
  const translation = question.mode === "phrase_blank_input"
    ? `<p class="question-translation"><span>日本語訳</span>${escapeHtml(question.item.japanese)}</p>`
    : "";
  const answerArea = isChoice
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
      ${isMaxMode() && state.combo ? `<div class="combo-pill">🔥 ${state.combo} COMBO</div>` : ""}
      <div class="quiz-progress"><span style="width:${progress}%"></span></div>
      <article class="question-card">
        <p class="question-instruction">${escapeHtml(question.instruction)}</p>
        <h1>${escapeHtml(question.prompt)}</h1>
        ${translation}
        <div class="answer-area">${answerArea}</div>
      </article>
      ${answered ? renderFeedback(question, session.currentAnswer, lastResult.correct) : ""}
    </div>`;

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

async function submitAnswer(answer) {
  const session = state.session;
  if (!session || session.answered) return;
  const question = session.currentQuestion;
  const isChoice = question.mode.endsWith("choice");
  const correct = isChoice
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
    correctEffect(special);
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

  if (
    !correct &&
    session.repeatWrong &&
    !session.repeatedIds.has(question.item.id)
  ) {
    session.repeatedIds.add(question.item.id);
    const insertAt = Math.min(session.cursor + 6, session.queue.length);
    session.queue.splice(insertAt, 0, {
      item: question.item,
      mode: question.mode,
      review: true,
    });
  }
  renderQuiz();
  renderHeader();
}

function nextQuestion() {
  const session = state.session;
  if (!session?.answered) return;
  session.cursor += 1;
  if (session.cursor >= session.queue.length) {
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
  const recommendation = recommendStudy(state.items, state.history);
  elements.quizContent.innerHTML = `
    <div class="result-shell">
      <p class="eyebrow">SESSION COMPLETE</p>
      <div class="result-score"><strong>${summary.correct}</strong><span>/ ${summary.total}</span></div>
      <h1>${summary.correct === summary.total ? "全問正解です。" : "学習を記録しました。"}</h1>
      <p>${escapeHtml(session.selection ? studySelectionLabel(session.selection) : MODE_LABELS[state.selectedMode])}</p>
      <div class="result-stat-grid">
        <div><span>正答率</span><strong>${formatPercent(summary.accuracy)}</strong></div>
        <div><span>連続正解</span><strong>${summary.bestStreak}</strong></div>
        <div><span>平均回答</span><strong>${formatSeconds(summary.averageDurationMs)}</strong></div>
        <div><span>学習時間</span><strong>${formatSeconds(summary.durationMs)}</strong></div>
      </div>
      <section class="result-breakdown">
        <div class="result-section-heading"><h2>範囲別</h2><span>${summary.uniqueItems}語句</span></div>
        ${rangeRows}
      </section>
      ${
        wrongItems.length
          ? `<div class="result-wrong-list"><h2>今回間違えた語句</h2>${wrongItems
              .map(
                (result) => `<div>
                  <span class="result-word-copy"><strong>${escapeHtml(result.item.english)}</strong><small>${escapeHtml(result.item.japanese)}</small></span>
                  <span class="item-tags">${renderTags([result.item.type, ...result.item.tags], 3)}</span>
                </div>`,
              )
              .join("")}</div>`
          : ""
      }
      ${renderRecommendationCard(recommendation, "result")}
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

function renderRecommendationCard(recommendation, context = "analysis") {
  if (!recommendation.mode || !recommendation.count) return "";
  return `
    <section class="recommendation-card recommendation-${context}">
      <div class="recommendation-icon" aria-hidden="true">✦</div>
      <div class="recommendation-copy">
        <p class="eyebrow">NEXT RECOMMENDATION</p>
        <h2>次は「${escapeHtml(recommendation.title)}」</h2>
        <p>${escapeHtml(recommendation.detail)}</p>
        <div class="item-tags">${renderTags(MODE_META[recommendation.mode].tags)}</div>
      </div>
      <button class="primary-button" type="button" data-recommended-start="${context}">
        おすすめ${recommendation.count}問をやる
      </button>
    </section>`;
}

function renderAnalysis() {
  const overall = summarizeHistory(state.items, state.history);
  const ranges = summarizeByRange(state.items, state.history);
  const modes = summarizeByMode(state.items, state.history);
  const recommendation = recommendStudy(state.items, state.history);
  const rangeMarkup = ranges.map((stat) => `
    <article class="analysis-row">
      <div>
        <strong>${escapeHtml(stat.range)}</strong>
        <small>${stat.answeredItems} / ${stat.itemCount}語句を学習</small>
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
    ${renderRecommendationCard(recommendation)}
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
    repeatedIds: new Set(),
    repeatWrong: false,
    currentQuestion: null,
    currentAnswer: "",
    answered: false,
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
  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) {
      if (state.view === "quiz" && state.session?.answered) nextQuestion();
      return;
    }
    if (target.dataset.viewTarget) setView(target.dataset.viewTarget);
    if (target.dataset.selectEffects) {
      state.settings.effectsMode = target.dataset.selectEffects;
      elements.onboarding.hidden = true;
      saveSettings();
      if (isMaxMode()) showMaxCallout("MAX MODE", "READY", 3);
    }
    if (target.dataset.effectsMode) {
      state.settings.effectsMode = target.dataset.effectsMode;
      saveSettings();
      renderSettings();
      if (isMaxMode()) showMaxCallout("MAX MODE", "ON", 3);
    }
    if (target.hasAttribute("data-reset-data")) {
      if (!window.confirm("本当に学習履歴を削除しますか？")) return;
      if (!window.confirm("この操作は取り消せません。削除しますか？")) return;
      clearAllData()
        .then(() => location.reload())
        .catch(() => showToast("データを削除できませんでした"));
    }
    if (target.hasAttribute("data-start-study")) {
      state.studySelection = { content: null, method: null, scope: null };
      state.sortKey = "importance-desc";
      state.filters = {
        ranges: [],
        importance: [],
        types: [],
        tags: [],
        performance: "all",
        minimumWrong: 0,
        search: "",
      };
      state.performanceExplicit = false;
      state.cycleContextKey = null;
      state.rangeFilterMode = null;
      state.importanceFilterMode = null;
      setView("study-content");
    }
    if (target.dataset.cyclePerformance) {
      state.filters.performance = target.dataset.cyclePerformance;
      state.filters.minimumWrong = 0;
      state.performanceExplicit = true;
      renderSetup();
    }
    if (target.hasAttribute("data-open-performance-detail")) openFilter();
    if (target.hasAttribute("data-resume-active") && state.activeStudy?.config) {
      startSession(state.activeStudy.config);
    }
    if (target.dataset.studyContent) {
      state.studySelection = {
        content: target.dataset.studyContent,
        method: null,
        scope: null,
      };
      setView("study-method");
    }
    if (target.dataset.studyMethod) {
      state.studySelection.method = target.dataset.studyMethod;
      if (target.dataset.studyMethod === "write" && state.studySelection.content !== "word") {
        state.studySelection.scope = null;
        setView("study-scope");
      } else {
        state.studySelection.scope = "full";
        setView("study-range-kind");
      }
    }
    if (target.dataset.studyScope) {
      state.studySelection.scope = target.dataset.studyScope;
      setView("study-range-kind");
    }
    if (target.hasAttribute("data-back-before-ranges")) setView(viewBeforeRangeSelection());
    if (target.dataset.rangeFilterMode) {
      state.rangeFilterMode = target.dataset.rangeFilterMode;
      if (state.rangeFilterMode === "all") {
        state.filters.ranges = [];
        setView("study-importance-kind");
      } else {
        state.filters.ranges = [];
        setView("study-range-select");
      }
    }
    if (target.dataset.studyRange) {
      const range = target.dataset.studyRange;
      state.filters.ranges = state.filters.ranges.includes(range)
        ? state.filters.ranges.filter((value) => value !== range)
        : [...state.filters.ranges, range];
      renderStudyRangeSelect();
    }
    if (target.id === "confirm-study-ranges" && state.filters.ranges.length) {
      setView("study-importance-kind");
    }
    if (target.hasAttribute("data-back-before-importance")) {
      setView(state.rangeFilterMode === "custom" ? "study-range-select" : "study-range-kind");
    }
    if (target.dataset.importanceFilterMode) {
      state.importanceFilterMode = target.dataset.importanceFilterMode;
      if (state.importanceFilterMode === "all") {
        state.filters.importance = [];
        setView("study-sort-kind");
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
      setView("study-sort-kind");
    }
    if (target.hasAttribute("data-back-before-sort")) {
      setView(state.importanceFilterMode === "custom" ? "study-importance-select" : "study-importance-kind");
    }
    if (target.dataset.studySortKind) {
      if (target.dataset.studySortKind === "other") {
        setView("study-sort-other");
      } else {
        state.sortKey = target.dataset.studySortKind;
        setView("setup");
      }
    }
    if (target.dataset.studySort) {
      state.sortKey = target.dataset.studySort;
      setView("setup");
    }
    if (target.dataset.quick) quickStart(target.dataset.quick);
    if (target.dataset.rangeStart) {
      state.filters = {
        ranges: [target.dataset.rangeStart],
        importance: [],
        types: [],
        tags: [],
        performance: "all",
        minimumWrong: 0,
        search: "",
      };
      state.studySelection = { content: null, method: null, scope: null };
      state.sortKey = "importance-desc";
      setView("study-content");
    }
    if (target.id === "open-filter" || target.id === "list-open-filter") openFilter();
    if (target.id === "close-filter") closeFilter();
    if (target.id === "reset-filter") resetFilters();
    if (target.id === "apply-filter") {
      state.filters = collectFilterForm();
      if (state.view === "setup" && selectionIsComplete()) {
        const cycle = (progressForSelection().completedCycles ?? 0) + 1;
        if (cycle >= 3) state.performanceExplicit = true;
      }
      closeFilter();
      state.view === "list" ? renderList(true) : renderSetup();
    }
    if (target.dataset.count) {
      state.questionCount = target.dataset.count === "all" ? "all" : Number(target.dataset.count);
      renderSetup();
    }
    if (target.id === "start-session") startSession();
    if (target.id === "load-more") {
      state.listLimit += 60;
      renderList(false);
    }
    if (target.dataset.choice !== undefined) submitAnswer(target.dataset.choice);
    if (target.hasAttribute("data-submit-input")) submitAnswer(currentTypedAnswer());
    if (target.hasAttribute("data-next-question")) nextQuestion();
    if (target.hasAttribute("data-quit-quiz")) {
      if (!state.session.results.length || window.confirm("この学習を終了しますか？")) {
        if (state.session.combinationKey) {
          state.activeStudy = null;
          setMeta("activeStudy", null).catch(console.warn);
        }
        state.session = null;
        setView("home");
      }
    }
    if (target.hasAttribute("data-retry-wrong")) retryWrongItems();
    if (target.dataset.recommendedStart) {
      const recommendation = recommendStudy(state.items, state.history);
      startSession({
        mode: recommendation.mode,
        itemIds: recommendation.itemIds,
        count: recommendation.count,
        sortKey: "difficulty",
        filters: {
          ranges: [],
          importance: [],
          types: [],
          tags: [],
          performance: "all",
          minimumWrong: 0,
          search: "",
        },
      });
    }
    if (target.hasAttribute("data-view-analysis")) {
      state.session = null;
      setView("analysis");
    }
    if (target.hasAttribute("data-result-home")) {
      state.session = null;
      setView("home");
    }
  });

  elements.repeatWrong.addEventListener("change", () => {
    state.repeatWrong = elements.repeatWrong.checked;
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
    const [response, history, selectedMode, progressEntries, settings, bestCombo, activeStudy] = await Promise.all([
      fetch("./data/items.json?v=phase3.1"),
      loadHistory(),
      getMeta("selectedMode"),
      progressPromise,
      getMeta("settings", DEFAULT_SETTINGS),
      getMeta("bestCombo", 0),
      getMeta("activeStudy", null),
    ]);
    if (!response.ok) throw new Error(`教材データを読み込めませんでした (${response.status})`);
    state.items = await response.json();
    state.history = history;
    state.selectedMode = ALL_MODES.includes(selectedMode) ? selectedMode : null;
    state.progress = new Map(progressEntries);
    state.settings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
    state.bestCombo = Number(bestCombo) || 0;
    state.activeStudy = activeStudy?.config?.selection ? activeStudy : null;
    elements.appShell.setAttribute("aria-busy", "false");
    setView("home");
    if (!state.settings.effectsMode) elements.onboarding.hidden = false;
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
