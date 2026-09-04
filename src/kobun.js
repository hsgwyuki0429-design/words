import {
  CONJUGATION_FORMS, KOBUN_CATEGORIES, KOBUN_MODES, NO_CONJUGATION,
  allConnectionOptions, allMeaningOptions, conjugationOptions, gradeQuestion,
  questionsForMode, restoreKobunSession, splitForms, summarizeKobun, toggleForm,
  validateAuxiliaries, validateVocabulary,
} from "./kobun-logic.js?v=2026.9.26b";
import { mergeAttempt, summarizeProgressGauge } from "./logic.js?v=2026.9.26b";
import { getMetaObject, putHistory, setMeta, stashMeta } from "./storage.js?v=2026.9.26b";

const META_KEY = "kobunStudy:v1";
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const statusLabel = { correct: "✓ 正解", partial: "一部正解", incorrect: "× 不正解", unanswered: "未回答" };
const button = (action, label, extra = "", className = "kb-button") => `<button type="button" class="${className}" data-kb-action="${action}" ${extra}>${label}</button>`;

export function createKobunController({ root, getHistory, onQuizChange, onHeaderChange }) {
  let items = [];
  let vocabulary = [];
  let revision;
  let saved = {};
  let loading;
  let screen = "home";
  let mode;
  let questions = [];
  let session;
  let activeCell = 0;
  let busy = false;
  let error = "";
  let questionStartedAt = Date.now();
  let visible = false;
  let showToken = 0;

  async function load() {
    if (!loading) loading = (async () => {
      const [auxResponse, vocabResponse, progress] = await Promise.all([
        fetch("./data/kobun-auxiliaries.json?v=2026.9.26b"),
        fetch("./data/kobun-vocabulary.json?v=2026.9.26b"),
        getMetaObject(META_KEY, {}),
      ]);
      if (!auxResponse.ok || !vocabResponse.ok) throw new Error("古文の教材を読み込めませんでした。通信を確認して再試行してください。");
      const auxData = await auxResponse.json();
      const vocabData = await vocabResponse.json();
      items = validateAuxiliaries(auxData.items);
      vocabulary = validateVocabulary(vocabData.items);
      revision = auxData.revision;
      // 教材更新時も長期履歴は保持し、古い正解のまま途中問題を再開しない。
      saved = progress.revision === revision ? progress : { revision };
    })().catch((failure) => { loading = null; throw failure; });
    return loading;
  }

  function currentQuestion() {
    return questions.find((question) => question.id === session?.queue[session.index]);
  }

  function saveDraft() {
    if (!session || !mode) return;
    saved[mode] = session;
    stashMeta(META_KEY, saved);
  }

  function newDraft(question) {
    if (question.mode.startsWith("kobun_table_")) return Array.from({ length: 6 }, () => "");
    if (question.mode === "kobun_base_input") return question.answers.map(() => "");
    return [];
  }

  function prepareQuestion() {
    activeCell = 0;
    const question = currentQuestion();
    if (question && !session.draft) session.draft = newDraft(question);
    questionStartedAt = Date.now();
    screen = question ? "quiz" : "result";
    saveDraft();
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function start(nextMode, retryIds = null) {
    mode = nextMode;
    questions = questionsForMode(items, mode);
    const restored = retryIds ? null : restoreKobunSession(saved[mode], questions);
    session = restored?.queue.length && restored.index < restored.queue.length ? restored : null;
    if (!session) {
      const history = getHistory();
      // 未回答を先頭にし、同じ状態の中は毎回シャッフルする。
      const weighted = questions.filter((question) => !retryIds || retryIds.includes(question.id)).map((question) => {
        const stat = history.get(question.id)?.modeStats?.[mode];
        return { id: question.id, priority: !stat?.attempts ? 0 : stat.lastResult === "wrong" ? 1 : 2, random: Math.random() };
      }).sort((a, b) => a.priority - b.priority || a.random - b.random);
      session = { queue: weighted.map((entry) => entry.id), index: 0, results: [], draft: null, feedback: null, startedAt: Date.now() };
    }
    prepareQuestion();
  }

  function heading(title, copy = "", back = "home") {
    return `<div class="kb-heading"><div>${button(back, "←", `aria-label="${back === "subject" ? "教科選択へ" : "戻る"}"`, "kb-back")}<h1 tabindex="-1">${escape(title)}</h1></div>${copy ? `<p>${escape(copy)}</p>` : ""}</div>`;
  }

  function modeCard(key) {
    const summary = summarizeKobun(items, getHistory(), key);
    const pending = saved[key];
    const inProgress = pending?.queue?.length > pending?.index;
    const gauge = summarizeProgressGauge({ totalItems: summary.total, answeredItems: summary.answered, masteredItems: summary.correctItems });
    // 長期履歴の直近の完全正解を表示する。周回の習得とは区別して名前を付ける。
    return button("start", `<span class="mode-progress-head"><strong>${KOBUN_MODES[key]}</strong>${inProgress ? '<span class="mode-progress-cycle">続きから</span>' : ""}<span class="card-arrow" aria-hidden="true">›</span></span>
      <span class="progress-gauge-stack"><span class="progress-gauge" data-cycle="1" role="img" aria-label="解答済み ${gauge.answeredPercent}%、正解済み ${gauge.masteredPercent}%"><span class="progress-gauge-answered" style="width:${gauge.answeredWidth}%"></span><span class="progress-gauge-mastered" style="width:${gauge.masteredWidth}%"></span></span></span>
      <span class="progress-legend" data-cycle="1"><span class="progress-figure is-answered">解答済み ${gauge.answeredPercent}%（${gauge.answeredItems}/${gauge.totalItems}）</span><span class="progress-figure is-mastered">正解済み ${gauge.masteredPercent}%（${gauge.masteredItems}/${gauge.totalItems}）</span></span>`, `data-kb-mode="${key}"`, `mode-progress-card${inProgress ? " is-in-progress" : ""}`);
  }

  function menuMarkup() {
    if (screen === "home") return heading("古文", "覚える内容を選ぶ", "subject") + `<div class="kb-menu">${KOBUN_CATEGORIES.map((category) => button(category.id,
      `<span><span class="range-choice-name">${category.label}</span><small class="kb-category-copy">${category.id === "auxiliary" ? `${items.length}種類 · 5つの学習形式` : vocabulary.length ? `${vocabulary.length}語句 · ${category.description}` : "教材準備中"}</small></span><span class="card-arrow" aria-hidden="true">›</span>`, "", "range-choice kb-category")).join("")}</div>`;
    if (screen === "auxiliary" || screen === "conjugation") return heading("助動詞", "学習する形式を選ぶ") + `<div class="mode-card-list kb-mode-list">${Object.keys(KOBUN_MODES).map(modeCard).join("")}</div><p class="kb-note">正解済みは、その形式の直近の回答ですべて正解した問題数です。</p>${button("reference", "助動詞一覧を確認", "", "kb-text-button")}`;
    // 教材があるときはこの画面を出さずに学習画面へ渡すため、ここは未提供時の案内だけ。
    if (screen === "vocabulary") return heading("古文単語", "大切な意味をまとめて覚える")
      + `<div class="kb-empty"><h2>古文単語は準備中です</h2><p>教材追加後は、本文中の用例を見て意味と覚えるポイントを確かめるフラッシュカードで学習できるようにします。</p><p>助動詞は今から学習できます。</p>${button("auxiliary", "助動詞を学習する", "", "kb-button kb-primary")}</div>`;
    if (screen === "records") return heading("古文の学習記録", "正答率は全項目を答えきった回答の割合です") + `<div class="kb-menu">${Object.entries(KOBUN_MODES).map(([key, label]) => {
      const summary = summarizeKobun(items, getHistory(), key);
      return `<div class="kb-record"><h2>${label}</h2><strong>${summary.accuracy === null ? "未学習" : `${summary.accuracy}%`}</strong><p>${summary.correct}正解 / ${summary.attempts}回答 · 解答済み ${summary.answered} / ${summary.total}問</p>${button("start", "学習する", `data-kb-mode="${key}"`)}</div>`;
    }).join("")}</div>`;
    if (screen === "reference") return heading("助動詞一覧", "意味を確認し、開くと接続と活用表が見られます", "auxiliary") + items.map((item) => `<details class="kb-reference"><summary><span class="kb-reference-title">${escape(item.label)}<small>${escape(item.conjugationType)}</small></span><span class="kb-reference-meanings">${escape(item.meanings.join("・"))}</span></summary>
      <p><b>接続</b> ${escape(item.connections.join(" ／ "))}</p><p><b>意味</b> ${escape(item.meanings.join("・"))}</p>
      <table class="kb-reference-table"><caption>活用表</caption><thead><tr><th scope="col">活用形</th><th scope="col">形</th></tr></thead><tbody>${CONJUGATION_FORMS.map((form) => `<tr><th scope="row">${form}</th><td>${item.conjugation[form].length ? item.conjugation[form].map((value) => `<span>${escape(value)}</span>`).join('<span class="kb-form-separator">／</span>') : NO_CONJUGATION}</td></tr>`).join("")}</tbody></table>
      ${item.notes.map((note) => `<p class="kb-note">${escape(note)}</p>`).join("")}
      <small>出典：${escape(item.source.file)} · ${escape(item.source.sheet)} ${escape(item.source.range)}</small>
      ${item.audit.length ? `<details class="kb-audit"><summary>教材の訂正・補足 ${item.audit.length}件</summary>${item.audit.map((entry) => `<p>${escape(entry.reason)} <a href="${escape(entry.url)}" target="_blank" rel="noopener noreferrer">根拠（${entry.page}ページ）</a></p>`).join("")}</details>` : ""}</details>`).join("");
    return "";
  }

  function optionsMarkup(question, feedback) {
    const options = question.mode === "kobun_meaning" ? allMeaningOptions(items) : allConnectionOptions(items);
    return `<div class="kb-options" role="group" aria-label="${question.mode === "kobun_meaning" ? "意味" : "接続"}の候補">${options.map((option, index) => {
      const selected = session.draft.includes(option);
      const verdict = feedback?.correct.includes(option) ? "correct" : feedback?.missing.includes(option) ? "missing" : feedback?.incorrect.includes(option) ? "incorrect" : "";
      const label = verdict === "correct" ? "✓ 正解" : verdict === "missing" ? "未選択" : verdict === "incorrect" ? "× 不正解" : selected ? "✓ 選択中" : "";
      return button("option", `<span>${escape(option)}</span><small>${label}</small>`, `data-kb-option="${index}" aria-pressed="${selected}" ${feedback || busy ? "disabled" : ""}`, `kb-option ${selected ? "selected" : ""} ${verdict}`);
    }).join("")}</div>`;
  }

  function tableMarkup(question, feedback) {
    const selecting = question.mode === "kobun_table_select";
    const inputRows = Math.max(1, ...CONJUGATION_FORMS.map((form) => Math.ceil(question.item.conjugation[form].join("／").length / 4)));
    const cells = CONJUGATION_FORMS.map((form, index) => {
      const result = feedback?.cells[index];
      const value = Array.isArray(session.draft[index]) ? session.draft[index].join("／") : session.draft[index];
      const formCount = question.item.conjugation[form].length;
      const label = `${form}${formCount > 1 ? `（${formCount}つ）` : ""}`;
      const input = selecting
        ? button("cell", escape(value || "選択する"), `data-kb-cell="${index}" aria-label="${label}: ${escape(value || "未回答")}" aria-pressed="${activeCell === index}" ${feedback || busy ? "disabled" : ""}`, "kb-cell-value")
        : `<textarea rows="${inputRows}" lang="ja" inputmode="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="${index === 5 ? "done" : "next"}" id="kb-cell-${index}" data-kb-input="${index}" aria-label="${label}" placeholder="未回答" ${feedback || busy ? "disabled" : ""}>${escape(value)}</textarea>`;
      return `<div class="kb-cell ${!feedback && activeCell === index ? "active" : ""} ${result ? result.complete ? "correct" : "incorrect" : ""}"><label for="kb-cell-${index}">${label}</label>${input}${result ? `<small>${result.complete ? "✓ 正解" : result.status === "unanswered" ? "未回答" : "要確認"}</small><small>正解：${escape(question.item.conjugation[form].join("／") || NO_CONJUGATION)}</small>` : ""}</div>`;
    }).join("");
    const controls = feedback ? "" : `<div class="kb-input-tools"><p><b data-kb-active-label>${CONJUGATION_FORMS[activeCell]}</b>に入力</p>
      ${selecting ? `<div class="kb-candidates">${conjugationOptions(question.item).map((value, index) => button("candidate", escape(value), `data-kb-candidate="${index}" aria-pressed="${splitForms(session.draft[activeCell]).includes(value)}" ${busy ? "disabled" : ""}`, `kb-button ${splitForms(session.draft[activeCell]).includes(value) ? "selected" : ""}`)).join("")}</div>`
        : button("circle", "○ 活用なし", `${busy ? "disabled" : ""}`, "kb-button kb-circle")}
      ${button("clear-cell", "この欄を消す", `${busy ? "disabled" : ""}`, "kb-text-button")}</div>`;
    return `<div class="kb-table-grid">${cells}</div>${controls}`;
  }

  function baseMarkup(question, feedback) {
    return `<p class="kb-answer-count">正解は${question.answers.length}つあります</p><div class="kb-base-inputs">${question.answers.map((_, index) => `<label>基本形 ${index + 1}<input type="text" lang="ja" inputmode="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="${index === question.answers.length - 1 ? "done" : "next"}" data-kb-input="${index}" value="${escape(session.draft[index])}" placeholder="基本形を入力" ${feedback || busy ? "disabled" : ""}></label>`).join("")}</div>${feedback ? `<div class="kb-base-feedback">${setFeedback(feedback)}<p>該当する助動詞：${escape(question.labels.join(" ／ "))}</p></div>` : ""}`;
  }

  function setFeedback(feedback) {
    return [
      ["correct", "✓ 正解"], ["missing", "未選択・未入力"], ["incorrect", "× 不正解"], ["duplicates", "重複"],
    ].filter(([key]) => feedback[key]?.length).map(([key, label]) => `<p class="kb-feedback-line ${key}"><b>${label}</b> ${escape(feedback[key].join(" ／ "))}</p>`).join("");
  }

  function quizMarkup() {
    const question = currentQuestion();
    if (!question) return resultMarkup();
    const feedback = session.feedback;
    const meaning = mode === "kobun_meaning";
    const table = mode.startsWith("kobun_table_");
    const base = mode === "kobun_base_input";
    const title = base ? question.surface : meaning ? question.item.base : question.item.label;
    const instruction = base ? `【${question.form}】考えられる基本形をすべて入力`
      : table ? "6つの欄を埋めて活用表を完成させよう"
        : meaning ? "この助動詞の意味をすべて選ぼう" : "この基本形の接続をすべて選ぼう";
    // 同じ基本形でも別の助動詞であることを示す。意味問題では正解の意味を見出しに出さない。
    const disambiguation = meaning && items.filter((item) => item.base === question.item.base).length > 1 ? question.item.conjugationType : "";
    return `<div class="kb-quiz-top">${button("pause", "← 中断", `${busy ? "disabled" : ""}`, "kb-text-button")}<span>${session.index + 1} / ${session.queue.length}問</span><span>${KOBUN_MODES[mode]}</span></div>
      <div class="kb-question"><h1>${escape(title)}</h1>${disambiguation ? `<p>${escape(disambiguation)}</p>` : ""}<h2>${instruction}</h2>
      ${table ? `<p class="kb-note">複数の形はすべて${mode === "kobun_table_input" ? "「／」で区切って入力" : "選択"}。活用なしは「○」。空欄は未回答です。</p>` : !base ? '<p class="kb-note">タップで選択・解除。最後に「回答する」で採点します。</p>' : ""}</div>
      ${feedback ? `<div class="kb-verdict ${feedback.complete ? "correct" : "incorrect"}" role="status" tabindex="-1">${statusLabel[feedback.status]}${feedback.complete ? "" : " · 正解を確認しよう"}</div>` : ""}
      ${table ? tableMarkup(question, feedback) : base ? baseMarkup(question, feedback) : optionsMarkup(question, feedback)}
      ${feedback && !base ? `<div class="kb-notes">${question.item.notes.map((note) => `<p>${escape(note)}</p>`).join("")}</div>` : ""}
      ${error ? `<p class="kb-error" role="alert">${escape(error)}</p>` : ""}
      <div class="kb-actions">${feedback ? button("next", session.index + 1 < session.queue.length ? "次へ" : "結果を見る", "", "kb-button kb-primary")
        : button("submit", busy ? "保存中…" : "回答する", `${busy ? "disabled" : ""}`, "kb-button kb-primary")}</div>`;
  }

  function resultMarkup() {
    const results = session.results;
    const correct = results.filter((result) => result.complete).length;
    const duration = Math.round(results.reduce((sum, result) => sum + result.durationMs, 0) / 1000);
    return heading("今回の結果", KOBUN_MODES[mode], "auxiliary") + `<div class="kb-result"><strong>${correct} / ${results.length}問 正解</strong><p>要確認 ${results.length - correct}問 · 学習時間 ${Math.floor(duration / 60)}分${duration % 60}秒</p>
      ${results.some((result) => !result.complete) ? button("retry", "間違えた問題を復習", "", "kb-button kb-primary") : ""}${button("restart", "同じ形式でもう一度")}${button("auxiliary", "学習形式を選ぶ")}</div>`;
  }

  function render() {
    if (!visible) return;
    onQuizChange(screen === "quiz");
    onHeaderChange("古文 · 助動詞 " + items.length + "種類");
    root.innerHTML = screen === "quiz" ? quizMarkup() : screen === "result" ? resultMarkup() : menuMarkup();
  }

  async function submit() {
    if (busy || session.feedback || !currentQuestion()) return;
    const question = currentQuestion();
    const values = structuredClone(session.draft);
    const feedback = gradeQuestion(question, values);
    const durationMs = Math.max(0, Date.now() - questionStartedAt);
    busy = true;
    error = "";
    render();
    try {
      const history = getHistory();
      const record = mergeAttempt(history.get(question.id), { itemId: question.id, mode, correct: feedback.complete, durationMs });
      record.subject = "kobun";
      record.category = "auxiliary";
      record.relatedItemIds = question.itemIds;
      record.modeStats[mode].lastAnswer = { revision, values, feedback };
      await putHistory(record);
      history.set(question.id, record);
      session.feedback = feedback;
      session.results.push({ questionId: question.id, complete: feedback.complete, status: feedback.status, durationMs });
      saveDraft();
      // 同期の控えを先に残すため、メタ情報の書き込みが遅れても二重採点しない。
      await setMeta(META_KEY, saved).catch(() => { error = "回答履歴は保存済みです。途中状態はこの端末に控えました。"; });
    } catch {
      error = "回答を保存できませんでした。空き容量などを確認し、もう一度「回答する」を押してください。";
    } finally {
      busy = false;
      render();
      const verdict = root.querySelector(".kb-verdict");
      verdict?.focus({ preventScroll: true });
      verdict?.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }

  root.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-kb-action]");
    if (!target || busy) return;
    const action = target.dataset.kbAction;
    if (action === "subject") { root.dispatchEvent(new CustomEvent("kobun-subject", { bubbles: true })); return; }
    // 古文単語は英語・公共・保健と同じ学習画面（範囲 → 重要度 → 並び替え → カード）へ渡す。
    if (action === "vocabulary" && vocabulary.length) {
      root.dispatchEvent(new CustomEvent("kobun-vocabulary", { bubbles: true }));
      return;
    }
    if (action === "reload") { await show(screen); return; }
    if (action === "start") { start(target.dataset.kbMode); return; }
    if (action === "restart") { saved[mode] = null; start(mode); return; }
    if (action === "retry") { start(mode, session.results.filter((result) => !result.complete).map((result) => result.questionId)); return; }
    if (action === "submit") { await submit(); return; }
    if (action === "next") {
      if (!session.feedback) return;
      session.index += 1;
      session.draft = null;
      session.feedback = null;
      prepareQuestion();
      return;
    }
    if (action === "pause") { saveDraft(); screen = "auxiliary"; render(); return; }
    if (screen === "quiz" && !session.feedback) {
      const question = currentQuestion();
      if (action === "option") {
        const options = mode === "kobun_meaning" ? allMeaningOptions(items) : allConnectionOptions(items);
        const option = options[Number(target.dataset.kbOption)];
        session.draft = session.draft.includes(option) ? session.draft.filter((value) => value !== option) : [...session.draft, option];
      }
      if (action === "cell") activeCell = Number(target.dataset.kbCell);
      if (action === "candidate") session.draft[activeCell] = toggleForm(splitForms(session.draft[activeCell]), conjugationOptions(question.item)[Number(target.dataset.kbCandidate)]);
      if (action === "circle") session.draft[activeCell] = NO_CONJUGATION;
      if (action === "clear-cell") session.draft[activeCell] = "";
      saveDraft();
      const scroll = window.scrollY;
      render();
      window.scrollTo({ top: scroll, behavior: "auto" });
      // 再描画でキーボード利用時のフォーカスを失わない。
      const selector = action === "cell" ? `[data-kb-cell="${activeCell}"]` : `[data-kb-action="${action}"]${target.dataset.kbOption !== undefined ? `[data-kb-option="${target.dataset.kbOption}"]` : target.dataset.kbCandidate !== undefined ? `[data-kb-candidate="${target.dataset.kbCandidate}"]` : ""}`;
      root.querySelector(selector)?.focus({ preventScroll: true });
      return;
    }
    if (["home", "auxiliary", "conjugation", "vocabulary", "reference", "records"].includes(action)) {
      screen = action;
      render();
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  });

  root.addEventListener("input", (event) => {
    const index = event.target.dataset.kbInput;
    if (index === undefined || busy || session?.feedback) return;
    session.draft[Number(index)] = event.target.value;
    saveDraft();
  });
  root.addEventListener("focusin", (event) => {
    if (event.target.dataset.kbInput === undefined || !mode?.startsWith("kobun_table_")) return;
    activeCell = Number(event.target.dataset.kbInput);
    root.querySelectorAll(".kb-cell").forEach((cell, index) => cell.classList.toggle("active", index === activeCell && !session.feedback));
    const label = root.querySelector("[data-kb-active-label]");
    if (label) label.textContent = CONJUGATION_FORMS[activeCell];
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing || event.keyCode === 229 || event.target.dataset.kbInput === undefined) return;
    event.preventDefault();
    const inputs = [...root.querySelectorAll("[data-kb-input]")];
    const next = inputs[inputs.indexOf(event.target) + 1];
    if (next) next.focus();
    else root.querySelector('[data-kb-action="submit"]')?.focus();
  });
  window.addEventListener("pagehide", saveDraft);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveDraft(); });

  async function show(nextScreen = "home") {
    const token = ++showToken;
    visible = true;
    screen = nextScreen;
    root.innerHTML = '<p role="status">古文の教材を読み込み中…</p>';
    try {
      await load();
      if (token === showToken && visible) render();
    } catch (failure) {
      if (token === showToken && visible) root.innerHTML = `<div class="kb-empty"><p role="alert">${escape(failure.message)}</p>${button("reload", "再試行")}${button("subject", "教科選択へ")}</div>`;
    }
  }

  return { show, canLeave: () => !busy, hide: () => {
    visible = false;
    showToken += 1;
    saveDraft();
    session = null;
    mode = null;
    onQuizChange(false);
  } };
}
