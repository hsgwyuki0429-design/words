import {
  ALL_MODES,
  IMPORTANCE_ORDER,
  MODE_LABELS,
  RANGE_ORDER,
  TYPE_LABELS,
  accuracyFor,
  answersForMode,
  applyFilters,
  buildQuestion,
  buildSession,
  getHistory,
  isAnswerCorrect,
  normalizeAnswer,
  slotTokensForQuestion,
  sortItems,
  summarizeHistory,
} from "./logic.js";
import { getMeta, loadHistory, recordAttempt, setMeta } from "./storage.js";

const state = {
  items: [],
  history: new Map(),
  view: "home",
  filters: {
    ranges: [],
    importance: [],
    types: [],
    modes: [...ALL_MODES],
    tags: [],
    performance: "all",
    minimumWrong: 0,
    search: "",
  },
  sortKey: "random",
  listSortKey: "importance-desc",
  questionCount: 15,
  repeatWrong: false,
  listLimit: 60,
  session: null,
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
    "quick-grid",
    "range-grid",
    "active-filter-list",
    "setup-match-count",
    "sort-select",
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
    "bottom-nav",
    "filter-backdrop",
    "filter-sheet",
    "filter-form",
    "filter-ranges",
    "filter-importance",
    "filter-types",
    "filter-modes",
    "filter-performance",
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

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 2400);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll("[data-view]").forEach((section) => {
    section.hidden = section.dataset.view !== view;
  });
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === view);
  });
  elements.bottomNav.hidden = view === "quiz";
  elements.appHeader.hidden = view === "quiz";
  document.body.classList.toggle("quiz-active", view === "quiz");
  window.scrollTo({ top: 0, behavior: "auto" });

  if (view === "home") renderHome();
  if (view === "setup") renderSetup();
  if (view === "list") renderList(true);
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
  if (filters.modes.length && filters.modes.length < ALL_MODES.length) {
    labels.push(filters.modes.map((mode) => MODE_LABELS[mode].replace(/完全|入力/g, "")).join("・"));
  }
  if (filters.performance !== "all") labels.push(PERFORMANCE_LABELS[filters.performance]);
  if (filters.minimumWrong > 0) labels.push(`ミス ${filters.minimumWrong}回以上`);
  if (filters.tags.length) labels.push(filters.tags.join("・"));
  return labels;
}

function filteredItems(filters = state.filters) {
  return applyFilters(state.items, state.history, filters);
}

function renderSetup() {
  const labels = activeFilterLabels();
  elements.activeFilterList.innerHTML = labels.length
    ? labels.map((label) => `<span class="filter-summary-chip">${escapeHtml(label)}</span>`).join("")
    : '<span class="empty-filter">全範囲・全重要度</span>';
  const count = filteredItems().length;
  elements.setupMatchCount.textContent = count.toLocaleString();
  elements.sortSelect.value = state.sortKey;
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
  elements.startSession.disabled = count === 0;
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
  elements.filterTypes.innerHTML = Object.entries(TYPE_LABELS)
    .map(([value, label]) => checkInput("types", value, label, state.filters.types.includes(value)))
    .join("");
  elements.filterModes.innerHTML = Object.entries(MODE_LABELS)
    .map(
      ([value, label]) => `
        <label>
          <input type="checkbox" name="modes" value="${value}" ${state.filters.modes.includes(value) ? "checked" : ""} />
          <span>${label}</span>
        </label>`,
    )
    .join("");
  const tagLabels = { preposition: "前置詞", spelling: "スペル", blank: "穴埋め" };
  elements.filterTags.innerHTML = Object.entries(tagLabels)
    .map(([value, label]) => checkInput("tags", value, label, state.filters.tags.includes(value)))
    .join("");
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
    types: valuesFor("types"),
    modes: valuesFor("modes"),
    tags: valuesFor("tags"),
    performance: elements.filterPerformance.value,
    minimumWrong: Math.max(0, Number(elements.filterMinimumWrong.value || 0)),
  };
}

function renderFilterPreview() {
  const draft = collectFilterForm();
  elements.filterPreviewCount.textContent = filteredItems(draft).length.toLocaleString();
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
    modes: [...ALL_MODES],
    tags: [],
    performance: "all",
    minimumWrong: 0,
  };
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
    startSession(previous);
    return;
  }

  const config = {
    filters: base,
    modes: [...ALL_MODES],
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
  if (id === "recommended") config.sortKey = "difficulty";
  if (id === "random") config.count = 20;
  if (id === "preposition") config.modes = ["preposition_input"];
  if (id === "spelling") config.modes = ["spelling_input"];
  startSession(config);
}

function startSession(overrides = {}) {
  const config = {
    filters: overrides.filters ?? { ...state.filters, search: "" },
    modes: overrides.modes ?? state.filters.modes,
    sortKey: overrides.sortKey ?? state.sortKey,
    count: overrides.count ?? state.questionCount,
    repeatWrong: overrides.repeatWrong ?? state.repeatWrong,
  };
  const queue = buildSession({
    items: state.items,
    history: state.history,
    filters: config.filters,
    selectedModes: config.modes,
    sortKey: config.sortKey,
    count: config.count,
  });
  if (!queue.length) {
    showToast("この条件に合う問題がありません");
    return;
  }
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
  };
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
  const correctAnswer = question.mode.endsWith("choice")
    ? question.correctChoice
    : answersForMode(question.item, question.mode)[0];
  return `
    <section class="feedback-card ${correct ? "feedback-correct" : "feedback-wrong"}" aria-live="polite">
      <div class="feedback-result">
        <span aria-hidden="true">${correct ? "✓" : "×"}</span>
        <strong>${correct ? "正解" : "不正解"}</strong>
      </div>
      <dl>
        <div><dt>あなた</dt><dd>${escapeHtml(answer || "（未入力）")}</dd></div>
        <div><dt>正解</dt><dd>${escapeHtml(correctAnswer)}</dd></div>
      </dl>
      <div class="source-box">
        <span class="importance-badge importance-${question.item.importance.toLowerCase()}">${question.item.importance}</span>
        <p>${escapeHtml(sourceLine(question.item))}</p>
      </div>
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
  const answerArea = isChoice
    ? renderChoiceArea(question, answered, session.currentAnswer)
    : usesSlots
      ? renderWordSlots(question, answered, session.currentAnswer)
      : renderTextInput(answered, session.currentAnswer);

  elements.quizContent.innerHTML = `
    <div class="quiz-shell">
      <header class="quiz-header">
        <button class="icon-button" type="button" data-quit-quiz aria-label="学習を終了">×</button>
        <div class="quiz-progress-copy"><strong>${session.cursor + 1}</strong> / ${session.queue.length}</div>
        <span class="mode-pill">${escapeHtml(question.label)}</span>
      </header>
      <div class="quiz-progress"><span style="width:${progress}%"></span></div>
      <article class="question-card">
        <p class="question-instruction">${escapeHtml(question.instruction)}</p>
        <h1>${escapeHtml(question.prompt)}</h1>
        <div class="answer-area">${answerArea}</div>
      </article>
      ${answered ? renderFeedback(question, session.currentAnswer, lastResult.correct) : ""}
    </div>`;

  if (!answered) {
    requestAnimationFrame(() => {
      elements.quizContent.querySelector("input")?.focus({ preventScroll: true });
    });
  } else {
    elements.quizContent.querySelector("[data-next-question]")?.focus({ preventScroll: true });
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

  try {
    const nextHistory = await recordAttempt(
      question.item.id,
      question.mode,
      correct,
      durationMs,
    );
    state.history.set(question.item.id, nextHistory);
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
  const correct = session.results.filter((result) => result.correct).length;
  const total = session.results.length;
  const wrongItems = [
    ...new Map(
      session.results
        .filter((result) => !result.correct)
        .map((result) => [result.itemId, result]),
    ).values(),
  ];
  elements.quizContent.innerHTML = `
    <div class="result-shell">
      <p class="eyebrow">SESSION COMPLETE</p>
      <div class="result-score"><strong>${correct}</strong><span>/ ${total}</span></div>
      <h1>${correct === total ? "全問正解です。" : "学習を記録しました。"}</h1>
      <p>正答率 ${formatPercent(total ? correct / total : null)}・${Math.round((Date.now() - session.startedAt) / 1000)}秒</p>
      ${
        wrongItems.length
          ? `<div class="result-wrong-list"><h2>今回間違えた語句</h2>${wrongItems
              .map(
                (result) => `<div><strong>${escapeHtml(result.item.english)}</strong><span>${escapeHtml(result.item.japanese)}</span></div>`,
              )
              .join("")}</div>`
          : ""
      }
      <div class="result-actions">
        ${wrongItems.length ? '<button class="secondary-button" type="button" data-retry-wrong>間違いだけ復習</button>' : ""}
        <button class="primary-button" type="button" data-result-home>ホームへ</button>
      </div>
    </div>`;
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
    if (!target) return;
    if (target.dataset.viewTarget) setView(target.dataset.viewTarget);
    if (target.dataset.quick) quickStart(target.dataset.quick);
    if (target.dataset.rangeStart) {
      state.filters = {
        ranges: [target.dataset.rangeStart],
        importance: [],
        types: [],
        modes: [...ALL_MODES],
        tags: [],
        performance: "all",
        minimumWrong: 0,
        search: "",
      };
      setView("setup");
    }
    if (target.id === "open-filter" || target.id === "list-open-filter") openFilter();
    if (target.id === "close-filter") closeFilter();
    if (target.id === "reset-filter") resetFilters();
    if (target.id === "apply-filter") {
      state.filters = collectFilterForm();
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
        state.session = null;
        setView("home");
      }
    }
    if (target.hasAttribute("data-retry-wrong")) retryWrongItems();
    if (target.hasAttribute("data-result-home")) {
      state.session = null;
      setView("home");
    }
  });

  elements.sortSelect.addEventListener("change", () => {
    state.sortKey = elements.sortSelect.value;
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
    const [response, history] = await Promise.all([
      fetch("./data/items.json?v=phase3.1"),
      loadHistory(),
    ]);
    if (!response.ok) throw new Error(`教材データを読み込めませんでした (${response.status})`);
    state.items = await response.json();
    state.history = history;
    elements.appShell.setAttribute("aria-busy", "false");
    setView("home");
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
