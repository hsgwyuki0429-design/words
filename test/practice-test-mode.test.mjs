import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applyStudyAnswer,
  buildTestQueue,
  createStudyProgress,
  summarizeTestResult,
  unmasterStudyItems,
} from "../src/logic.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} should exist`);
  assert.ok(end > start, `${nextName} should follow ${name}`);
  return appSource.slice(start, end);
}

const englishItems = JSON.parse(readFileSync(new URL("../data/items.json", import.meta.url), "utf8"))
  .filter((item) => item.type === "word");

// 教材の実物の語を借りて、範囲と重要度だけを差し替える。
function englishItem(id, { range = "Plastic", importance = "A" } = {}) {
  const index = ["a", "b", "c", "d"].indexOf(id);
  return { ...englishItems[index], id, range, importance };
}

test("教科と「演習｜テスト」は同じ形の切り替え（スライダー）で並べる", () => {
  assert.match(indexSource, /class="home-tabs-row">\s*\n\s*<nav class="subject-tabs" id="subject-tabs"[^>]*><\/nav>\s*\n\s*<div class="segment-switch mode-switch" id="mode-switch" role="radiogroup"/);
  assert.match(indexSource, /data-home-mode="practice">習得<\/button>/);
  assert.match(indexSource, /data-home-mode="test">テスト<\/button>/);
  assert.match(indexSource, /id="mode-switch"[^>]*>\s*\n\s*<span class="segment-thumb" aria-hidden="true"><\/span>/);
  assert.match(indexSource, /class="home-pane" id="home-pane"/);
  assert.match(indexSource, /class="home-pane test-home" id="test-home" hidden/);
  // 教科も同じ切り替え。同じ並びなら描き直さず、つまみだけを動かす。
  const tabs = functionSource("renderSubjectTabs", "moveSegmentSwitch");
  assert.match(tabs, /class="segment-switch subject-switch" role="radiogroup" aria-label="教科"/);
  assert.match(tabs, /if \(current && current\.dataset\.subjects === key\) \{\s*\n\s*moveSegmentSwitch\(current, index\);/);
  assert.match(functionSource("syncHomeMode", "pulseChip"), /moveSegmentSwitch\(elements\.modeSwitch, state\.homeMode === "test" \? 1 : 0\);/);
  // 切り替えは端末に覚えておき、次に開いたときも同じ側から始まる。
  assert.match(functionSource("setHomeMode", "normalizedTestRanges"), /setMeta\("homeMode", next\)/);
  assert.match(appSource, /getMeta\("homeMode", "practice"\)/);
  assert.match(appSource, /if \(target\.dataset\.homeMode\) setHomeMode\(target\.dataset\.homeMode\);/);
  // 形：丸い溝と丸いつまみの小さな切り替え（14px）。教科と「演習｜テスト」を1行に並べる。つまみはばねのように滑る。
  assert.match(stylesSource, /\.home-tabs-row \{[^}]*justify-content: space-between;/);
  assert.match(stylesSource, /\.segment-switch \{[^}]*grid-template-columns: repeat\(var\(--count, 2\), 64px\);[^}]*height: 42px;[^}]*border-radius: 999px;/);
  assert.match(stylesSource, /\.segment-switch button \{[^}]*font-size: 14px;/);
  assert.match(stylesSource, /\.segment-thumb \{[^}]*border-radius: 999px;/);
  assert.match(stylesSource, /\.segment-thumb \{[^}]*translate: calc\(var\(--index, 0\) \* 100%\) 0;[^}]*transition: translate 520ms var\(--spring\)/);
  assert.match(stylesSource, /\.home-pane\.is-entering-right \{[^}]*animation: home-pane-in-right/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.segment-thumb,/);
  assert.doesNotMatch(appSource, /class="subject-tab/);
});

test("テストは1画面で、範囲・形式・重要度を札で付け外しして選び、全部を1回ずつ出す", () => {
  const home = functionSource("renderTestHome", "startTest");
  assert.match(home, /data-test-range="\$\{escapeHtml\(range\)\}"/);
  assert.match(home, /data-test-format="\$\{escapeHtml\(option\.key\)\}"/);
  assert.match(home, /data-test-importance="\$\{value\}"/);
  assert.match(home, /data-test-start/);
  // 「全選択」の札は置かない。何も選んでいない欄があれば、開始ボタンでそれを知らせる。
  assert.doesNotMatch(appSource, /data-test-(range|format|importance)="all"/);
  assert.doesNotMatch(home, /全選択/);
  assert.match(home, /`\$\{missing\}を選んでください`/);
  // 初めは何も選んでいない（テストを開くたびに空に戻す）。範囲・重要度は付け外し、形式は1つだけ。
  assert.match(functionSource("testDraftValues", "selectedTestFormats"), /state\.testDraft\[field\] = \[\];/);
  assert.match(functionSource("setHomeMode", "normalizedTestRanges"), /if \(next === "test"\) state\.testDraft = \{ ranges: null, formats: null, importance: null \};/);
  assert.match(appSource, /state\.testDraft\[field\] = current\.includes\(value\)\s*\n\s*\? current\.filter\(\(entry\) => entry !== value\)\s*\n\s*: field === "formats" \? \[value\] : \[\.\.\.current, value\];/);
  // 指で滑らせて切り替えても、押したときと同じ音が鳴る。
  assert.match(functionSource("activateSegment", "bindEvents"), /sfx\.play\("tap"\);/);
  // 演習とちがい、範囲を選んで形式へ…と画面を進めない。スクロールしなくても1画面に収める。
  assert.match(functionSource("renderDashboard", "setRingColor"), /if \(test\) \{\s*\n\s*renderTestHome\(\);/);
  assert.match(stylesSource, /\.test-chip \{[^}]*min-height: 46px;/);
  // 形式を2つ以上選んだら、形式ごとに1回ずつ出して全体を混ぜる。
  assert.match(functionSource("testEntriesFor", "testFormatsLabel"), /return formats\.length > 1 \? shuffle\(entries\) : entries;/);

  const items = [
    englishItem("a", { range: "Plastic", importance: "A" }),
    englishItem("b", { range: "Plastic", importance: "B" }),
    englishItem("c", { range: "Mars", importance: "A" }),
    englishItem("d", { range: "Bridge", importance: "C" }),
  ];
  const ids = (queue) => queue.map((entry) => entry.item.id).sort();
  assert.deepEqual(ids(buildTestQueue({ items, mode: "en_to_ja_flashcard" })), ["a", "b", "c", "d"], "空は全範囲・すべて");
  assert.deepEqual(ids(buildTestQueue({ items, mode: "en_to_ja_flashcard", ranges: ["Plastic", "Mars"] })), ["a", "b", "c"]);
  assert.deepEqual(ids(buildTestQueue({ items, mode: "en_to_ja_flashcard", importance: ["A", "C"] })), ["a", "c", "d"]);
  assert.deepEqual(ids(buildTestQueue({ items, mode: "en_to_ja_flashcard", ranges: ["Plastic"], importance: ["B"] })), ["b"]);
  assert.deepEqual(buildTestQueue({ items, mode: null }), [], "形式が無ければ出さない");
  const queue = buildTestQueue({ items, mode: "en_to_ja_flashcard", rng: () => 0.3 });
  assert.equal(new Set(queue.map((entry) => entry.item.id)).size, queue.length, "1問1回ずつ");
  assert.ok(queue.every((entry) => entry.mode === "en_to_ja_flashcard"));
});

test("テストでは間違えても出し直さず、演習の周回にも入れない", () => {
  const submit = appSource.slice(appSource.indexOf("async function submitAnswer"), appSource.indexOf("function injectDueReviews"));
  assert.match(submit, /const scheduledDelay = session\.test \? null : reviewDelayForAnswer\(/);
  // テストのセッションは周回（progress）を持たない。
  const start = functionSource("startTest", "startTestFromDraft");
  assert.match(start, /beginSession\(entries, \{\s*\n\s*test: \{ formats: formats\.map\(\(format\) => \(\{ \.\.\.format \}\)\), ranges: \[\.\.\.ranges\], importance: \[\.\.\.importance\], retryOf \},\s*\n\s*\}\);/);
  assert.doesNotMatch(start, /progressKey|progress:/);
  // 終わったら演習の結果ではなく、テストの記録として残す。
  const complete = functionSource("completeSession", "slimResultItem");
  assert.match(complete, /if \(session\.test\) \{\s*\n\s*const record = recordTestResult\(session\);/);
  // 自己採点の札は、テストでは ○ と ✕ にする。
  assert.match(functionSource("renderRecallSwipeHints", "renderChoiceSwipeHints"), /if \(state\.session\?\.test\)[\s\S]*?<strong>○<\/strong>/);
  assert.match(functionSource("renderRecallGradeFallback", "reducedMotionRequested"), /aria-label="わかった">○<\/button>/);
});

test("テストの結果は正答率を出し、間違えた問題だけをやり直せる", () => {
  const summary = summarizeTestResult([
    { correct: true, durationMs: 1200 },
    { correct: false, durationMs: 800 },
    { correct: true, durationMs: -5 },
    { correct: true, durationMs: "x" },
  ]);
  assert.deepEqual(summary, { total: 4, correct: 3, wrong: 1, percent: 75, durationMs: 2000 });
  assert.equal(summarizeTestResult([]).percent, 0);

  const result = functionSource("testResultMarkup", "renderHistory");
  assert.match(result, /class="test-score-ring" style="--score:\$\{record\.percent\}%"/);
  assert.match(result, /<span>正答率<\/span>/);
  assert.match(result, /data-test-retry="\$\{record\.id\}"/);
  assert.match(result, /data-test-again="\$\{record\.id\}"/);
  const retry = functionSource("retryTestRecord", "lastConfigForTarget");
  assert.match(retry, /\.filter\(\(result\) => !result\.correct\)/);
  assert.match(retry, /retryOf: record\.id/);
  assert.match(appSource, /if \(target\.dataset\.testRetry\) retryTestRecord\(target\.dataset\.testRetry\);/);
  // 正答率の円は0から満ちていく。
  assert.match(stylesSource, /@property --score \{/);
  assert.match(stylesSource, /@keyframes score-fill \{\s*\n\s*from \{ --score: 0%; \}/);
});

test("テストで間違えた問題のうち、演習で習得だったものは未習得に戻せる", () => {
  let progress = createStudyProgress({ itemIds: ["a", "b", "c"], now: 1 });
  progress = applyStudyAnswer(progress, { itemId: "a", correct: true, now: 2 });
  progress = applyStudyAnswer(progress, { itemId: "b", correct: true, now: 3 });
  assert.ok(progress.masteredIds.includes("a") && progress.masteredIds.includes("b"));

  const { progress: next, changed } = unmasterStudyItems(progress, ["a", "c", "zz"], { now: 10 });
  assert.deepEqual(changed, ["a"], "習得していたものだけを戻す");
  assert.ok(!next.masteredIds.includes("a"));
  assert.ok(next.masteredIds.includes("b"), "ほかの習得は残す");
  assert.ok(!next.cycleCorrectIds.includes("a"));
  assert.ok(next.cycleTargetIds.includes("a"), "今の周回の対象に戻り、演習でまた出てくる");
  assert.equal(next.firstAttemptResults.a, undefined);
  assert.equal(next.lastUpdatedAt, 10);
  assert.ok(progress.masteredIds.includes("a"), "元の進み具合は書き換えない");
  assert.deepEqual(unmasterStudyItems(progress, []).changed, []);

  const unmaster = functionSource("unmasterFromTest", "testResultMarkup");
  assert.match(unmaster, /window\.confirm\(/);
  assert.match(unmaster, /unmasterStudyItems\(normalizeStudyProgress\(state\.studyProgress\[key\]\), itemIds\)/);
  assert.match(unmaster, /persistStudyProgress\(key, progress\)/);
  assert.match(functionSource("testResultMarkup", "renderHistory"), /data-test-unmaster="\$\{record\.id\}"/);
});

test("右上の丸ボタンからテストの履歴を開ける", () => {
  assert.match(indexSource, /<button class="header-round-button" type="button" data-view-target="history" data-header-toggle>/);
  assert.match(indexSource, /<span class="sr-only">テストの履歴<\/span>/);
  assert.match(indexSource, /id="view-history" data-view="history" hidden/);
  assert.match(appSource, /if \(view === "history"\) renderHistory\(\);/);
  const history = functionSource("renderHistory", "openTestRecord");
  assert.match(history, /data-history-open="\$\{record\.id\}"/);
  assert.match(history, /data-open-test/);
  // 記録は新しい順に一定数だけ端末へ残す。
  assert.match(appSource, /const TEST_HISTORY_LIMIT = 60;/);
  assert.match(functionSource("recordTestResult", "testRecordById"), /\[record, \.\.\.state\.testHistory\]\.slice\(0, TEST_HISTORY_LIMIT\)/);
  assert.match(appSource, /getMeta\(TEST_HISTORY_META_KEY, \[\]\)/);
  // 履歴から開いた結果を閉じると履歴へ戻る。
  assert.match(appSource, /setView\(backToHistory \? "history" : "dashboard"\);/);
});

test("テストの形式は押すと選ばれ、開始ボタンは滑り込む面の外で画面の下に貼りつく", () => {
  const home = functionSource("renderTestHome", "startTest");
  // 形式は呼ぶたびに作り直すので、選んでいるかどうかはキーで比べる（物どうしで比べると選ばれて見えない）。
  assert.match(home, /const formatKeys = formats\.map\(\(format\) => format\.key\);/);
  assert.match(home, /selected: formatKeys\.includes\(option\.key\),/);
  assert.doesNotMatch(home, /formats\.includes\(option\)/);
  // 開始ボタンは面（#test-home）の外の #test-start-bar に描く。動いている面の中に置くと、
  // 面が滑り込むあいだ画面の下に貼りつかず、途中の変な位置に出てしまう。
  assert.match(home, /elements\.testStartBar\.innerHTML = `/);
  assert.doesNotMatch(home, /elements\.testHome\.innerHTML = `[\s\S]*?test-start-bar/);
  assert.match(indexSource, /id="test-home" hidden><\/div>\s*\n\s*<div class="sticky-action test-start-bar" id="test-start-bar" hidden><\/div>/);
  assert.match(functionSource("renderDashboard", "setRingColor"), /elements\.testStartBar\.hidden = !test;/);
});

test("切り替えは、つまみを指で横へ滑らせても選べる", () => {
  const drag = functionSource("bindSegmentSwitchDrag", "activateSegment");
  assert.match(drag, /if \(Math\.abs\(dx\) < SWITCH_DRAG_THRESHOLD_PX\) return;/);
  assert.match(drag, /drag\.thumb\.style\.translate = `\$\{drag\.offset\}px 0`;/);
  assert.match(drag, /const index = Math\.round\(offset \/ segment\);/);
  assert.match(drag, /activateSegment\(buttons\[index\]\);/);
  // 離したあとに続けて届く click は押した扱いにしない。
  assert.match(drag, /suppressClickUntil = performance\.now\(\) \+ 400;/);
  const activate = functionSource("activateSegment", "bindEvents");
  assert.match(activate, /if \(button\.dataset\.homeMode\) setHomeMode\(button\.dataset\.homeMode\);/);
  assert.match(activate, /else if \(button\.dataset\.subject\) selectSubject\(button\.dataset\.subject\);/);
  assert.match(appSource, /function bindEvents\(\) \{\s*\n\s*bindSegmentSwitchDrag\(\);/);
  // 縦のスクロールは妨げず、滑らせているあいだはつまみが指にそのままついてくる。
  assert.match(stylesSource, /\.segment-switch \{\s*\n\s*touch-action: pan-y;/);
  assert.match(stylesSource, /\.segment-switch\.is-dragging \.segment-thumb \{[^}]*transition: none;/);
});
