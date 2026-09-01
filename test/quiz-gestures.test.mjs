import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  QUIZ_GESTURE_DEFAULTS,
  classifyQuizGesture,
  createQuizGestureRecognizer,
  isEdgeGuardedStart,
  isRecallMode,
  isSwipeAdvanceMode,
  oppositeDirection,
  quizGesturePolicy,
  recallActionForDirection,
  resolveSwipeDirection,
  swipeThreshold,
} from "../src/quiz-gestures.js";

const phoneViewport = { width: 390, height: 844 };
const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const gestureSource = readFileSync(new URL("../src/quiz-gestures.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("a few pixels of finger drift remains a tap", () => {
  assert.equal(classifyQuizGesture({
    dx: 7,
    dy: -5,
    durationMs: 120,
    viewport: phoneViewport,
  }).type, "tap");
});

test("a gesture that became a drag never turns back into a tap", () => {
  assert.equal(classifyQuizGesture({
    dx: 2,
    dy: 1,
    durationMs: 240,
    wasDragging: true,
    viewport: phoneViewport,
  }).type, "cancel");
});

test("a slow drag below the threshold cancels", () => {
  const result = classifyQuizGesture({
    dx: 48,
    dy: 5,
    durationMs: 500,
    wasDragging: true,
    viewport: phoneViewport,
  });
  assert.equal(result.type, "cancel");
  assert.equal(result.direction, "right");
});

test("a clear distance swipe commits", () => {
  const result = classifyQuizGesture({
    dx: -78,
    dy: 9,
    durationMs: 400,
    wasDragging: true,
    viewport: phoneViewport,
  });
  assert.equal(result.type, "swipe");
  assert.equal(result.direction, "left");
});

test("a short, fast flick commits without reaching the distance threshold", () => {
  const result = classifyQuizGesture({
    dx: 45,
    dy: 4,
    durationMs: 55,
    wasDragging: true,
    viewport: phoneViewport,
  });
  assert.equal(result.type, "swipe");
  assert.equal(result.direction, "right");
  assert.ok(result.velocity > QUIZ_GESTURE_DEFAULTS.flickVelocityPxMs);
});

test("the same short movement does not commit when it is slow", () => {
  assert.equal(classifyQuizGesture({
    dx: 45,
    dy: 4,
    durationMs: 600,
    wasDragging: true,
    viewport: phoneViewport,
  }).type, "cancel");
});

test("diagonal gestures use their dominant horizontal axis", () => {
  assert.equal(resolveSwipeDirection(-70, 40), "left");
  assert.equal(resolveSwipeDirection(70, -40), "right");
});

test("diagonal gestures use their dominant vertical axis", () => {
  assert.equal(resolveSwipeDirection(40, -70), "up");
  assert.equal(resolveSwipeDirection(-40, 70), "down");
});

test("swipe thresholds scale with the viewport and stay bounded", () => {
  assert.equal(swipeThreshold("left", phoneViewport), 64);
  assert.equal(swipeThreshold("up", phoneViewport), 90);
  assert.equal(swipeThreshold("right", { width: 1200, height: 900 }), 90);
});

test("the Safari navigation gutter does not start an app swipe", () => {
  assert.equal(isEdgeGuardedStart(12, 390), true);
  assert.equal(isEdgeGuardedStart(24, 390), true);
  assert.equal(isEdgeGuardedStart(25, 390), false);
  assert.equal(isEdgeGuardedStart(378, 390), true);
});

test("opposite directions drive the next card entrance", () => {
  assert.equal(oppositeDirection("left"), "right");
  assert.equal(oppositeDirection("right"), "left");
  assert.equal(oppositeDirection("up"), "down");
  assert.equal(oppositeDirection("down"), "up");
});

test("recall directions map only left, right, and up to grading actions", () => {
  assert.equal(recallActionForDirection("left"), "three-minutes");
  assert.equal(recallActionForDirection("right"), "one-hour");
  assert.equal(recallActionForDirection("up"), "mastered");
  assert.equal(recallActionForDirection("down"), null);
});

test("all flashcard and recall modes share the recall gesture policy", () => {
  for (const mode of [
    "en_to_ja_flashcard",
    "ja_to_en_flashcard",
    "public_recall",
    "health_recall",
  ]) {
    assert.equal(isRecallMode(mode), true);
    assert.deepEqual(quizGesturePolicy({ mode, revealed: false }), {
      tapEnabled: true,
      dragEnabled: false,
      allowedDirections: [],
    });
    assert.deepEqual(quizGesturePolicy({ mode, revealed: true }), {
      tapEnabled: true,
      dragEnabled: true,
      allowedDirections: ["left", "right", "up"],
    });
  }
});

test("recall swipes are disabled again while the question face is visible", () => {
  const policy = quizGesturePolicy({ mode: "public_recall", revealed: false });
  assert.equal(policy.tapEnabled, true);
  assert.equal(policy.dragEnabled, false);
});

test("choice swipes are disabled before an answer", () => {
  for (const mode of ["en_to_ja_choice", "ja_to_en_choice", "ja_to_en_spelling"]) {
    assert.equal(isSwipeAdvanceMode(mode), true);
    assert.deepEqual(quizGesturePolicy({ mode, answered: false }), {
      tapEnabled: false,
      dragEnabled: false,
      allowedDirections: [],
    });
  }
});

test("answered choice cards accept all four directions with identical policy", () => {
  assert.deepEqual(quizGesturePolicy({ mode: "en_to_ja_choice", answered: true }), {
    tapEnabled: false,
    dragEnabled: true,
    allowedDirections: ["left", "right", "up", "down"],
  });
});

test("transition lock disables tap and swipe policies", () => {
  assert.deepEqual(quizGesturePolicy({
    mode: "public_recall",
    revealed: true,
    isTransitioning: true,
  }), {
    tapEnabled: false,
    dragEnabled: false,
    allowedDirections: [],
  });
});

test("recognizer remembers that a gesture crossed the drag boundary", () => {
  const recognizer = createQuizGestureRecognizer();
  assert.equal(recognizer.start({ x: 100, y: 100, time: 0, viewport: phoneViewport }), true);
  assert.equal(recognizer.move({ x: 140, y: 100 }).wasDragging, true);
  assert.equal(recognizer.move({ x: 103, y: 101 }).wasDragging, true);
  assert.equal(recognizer.end({ x: 103, y: 101, time: 300 }).type, "cancel");
});

test("a committed swipe locks out a second gesture until explicitly unlocked", () => {
  const recognizer = createQuizGestureRecognizer();
  recognizer.start({ x: 200, y: 300, time: 0, viewport: phoneViewport });
  recognizer.move({ x: 100, y: 300 });
  assert.equal(recognizer.end({ x: 100, y: 300, time: 160 }).type, "swipe");
  assert.equal(recognizer.locked, true);
  assert.equal(recognizer.start({ x: 200, y: 300, time: 170, viewport: phoneViewport }), false);
  recognizer.unlock();
  assert.equal(recognizer.start({ x: 200, y: 300, time: 180, viewport: phoneViewport }), true);
});

test("synthetic click suppression stays short enough for rapid next-card answers", () => {
  assert.equal(QUIZ_GESTURE_DEFAULTS.syntheticClickGuardMs, 360);
  assert.ok(QUIZ_GESTURE_DEFAULTS.syntheticClickGuardMs < 400);
});

test("a canceled drag does not advance or leave the recognizer locked", () => {
  const recognizer = createQuizGestureRecognizer();
  recognizer.start({ x: 200, y: 300, time: 0, viewport: phoneViewport });
  recognizer.move({ x: 235, y: 300 });
  assert.equal(recognizer.end({ x: 235, y: 300, time: 500 }).type, "cancel");
  assert.equal(recognizer.locked, false);
});

test("recall tap integration only flips the revealed display state", () => {
  const implementation = appSource.match(/function toggleRecallFace\(\)[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(implementation, /session\.revealed = !session\.revealed/);
  assert.match(implementation, /renderQuiz\(\)/);
  assert.doesNotMatch(implementation, /submitAnswer|nextQuestion|recordAttempt|deferredReviews/);
});

test("recall swipe integration reuses the existing three-minute and one-hour constants", () => {
  const implementation = appSource.match(/async function handleRecallSwipe[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(implementation, /WRONG_REVIEW_DELAY_MS/);
  assert.match(implementation, /ONE_HOUR_REVIEW_DELAY_MS/);
  assert.match(implementation, /submitAnswer\(question\.answer, action === "mastered", reviewDelayMs/);
  assert.match(implementation, /renderResult: false/);
});

test("answered cards use one transition lock and opposite-direction entrance", () => {
  assert.match(appSource, /session\.isTransitioning = true/);
  assert.match(appSource, /nextQuestion\(\{ enterFrom: oppositeDirection\(direction\) }\)/);
  assert.match(appSource, /Promise\.all\(\[exitPromise, enterPromise\]\)/);
});

test("the old arbitrary quiz tap-to-next path is absent", () => {
  assert.doesNotMatch(appSource, /if \(!target\) \{[\s\S]{0,180}nextQuestion\(\)/);
  assert.doesNotMatch(appSource, /horizontalPosition|data-public-grade|rememberNextButtonAnchor/);
});

test("touch-action is scoped to gesture cards instead of the document", () => {
  assert.match(stylesSource, /quiz-gesture-card\[data-gesture-state="recall-answer"\][\s\S]{0,220}touch-action: none/);
  assert.doesNotMatch(stylesSource, /(?:^|\n)\s*(?:body|html|\*)[^\{]*\{[^}]*touch-action:\s*none/s);
});

test("card CSS contains drag, cancel, exit, and entrance states", () => {
  for (const selector of [
    ".quiz-gesture-card.is-dragging",
    ".quiz-gesture-card.is-swipe-cancelling",
    ".quiz-gesture-card.is-card-entering",
    ".quiz-card-flight",
  ]) {
    assert.ok(stylesSource.includes(selector), `${selector} should be styled`);
  }
});

test("pointermove drives the live card transform instead of waiting for pointerup", () => {
  assert.match(gestureSource, /const handlePointerMove[\s\S]*?onDrag\?\.\(\{/);
  assert.match(appSource, /function handleQuizDrag[\s\S]*?--quiz-drag-x[\s\S]*?--quiz-drag-y/);
});

test("answered choice guidance uses a normal-flow footer instead of a card-edge overlay", () => {
  const implementation = appSource.match(/function renderChoiceSwipeHints\(\)[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(implementation, /choice-gesture-footer/);
  assert.match(implementation, /スワイプで次へ/);
  assert.doesNotMatch(implementation, /quiz-swipe-hints|hint-left|hint-right|hint-up|hint-down/);
  assert.match(stylesSource, /\.choice-gesture-footer\s*\{[\s\S]*?position:\s*relative/);
  assert.doesNotMatch(stylesSource, /\.choice-gesture-footer\s*\{[^}]*position:\s*absolute/s);
});

test("swipe-primary next fallback is hidden on touch devices and phone widths", () => {
  assert.match(stylesSource, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.next-button--fallback\s*\{\s*display:\s*none/);
  assert.match(stylesSource, /@media \(max-width: 760px\)[\s\S]*?\.next-button--fallback\s*\{\s*display:\s*none/);
  assert.match(appSource, /next-button\$\{swipePrimary \? " next-button--fallback" : ""\}/);
});

test("swipe-ready stages render a noninteractive card preview instead of a blank pseudo-card", () => {
  assert.match(appSource, /class="quiz-card-preview quiz-card-preview--\$\{kind\}" aria-hidden="true" inert/);
  assert.match(appSource, /renderCardPreview\("recall"\)/);
  assert.match(appSource, /renderCardPreview\("choice"\)/);
  assert.match(stylesSource, /\.quiz-card-preview\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(stylesSource, /\.quiz-card-preview-options/);
  assert.match(stylesSource, /\.quiz-card-preview-answer/);
  assert.doesNotMatch(stylesSource, /\.quiz-card-stage::before/);
});

test("preview uses the queued next prompt without mutating question state", () => {
  const previewPrompt = appSource.match(/function previewPromptForEntry\(entry\)[\s\S]*?\n}/)?.[0] ?? "";
  const previewCard = appSource.match(/function renderCardPreview\(kind\)[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(previewCard, /session\?\.queue\?\.\[session\.cursor \+ 1\]/);
  assert.match(previewCard, /previewPromptForEntry\(nextEntry\)/);
  assert.doesNotMatch(`${previewPrompt}\n${previewCard}`, /buildQuestion|nextQuestion|cursor\s*\+=|deferredReviews|recordAttempt/);
});

test("recall answer guide names all three unchanged grading directions", () => {
  const implementation = appSource.match(/function renderRecallSwipeHints\(\)[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(implementation, /data-swipe-direction="left"[^>]*>[\s\S]*?←[\s\S]*?3分/);
  assert.match(implementation, /data-swipe-direction="up"[^>]*>[\s\S]*?↑[\s\S]*?習得/);
  assert.match(implementation, /data-swipe-direction="right"[^>]*>[\s\S]*?1時間[\s\S]*?→/);
  assert.match(stylesSource, /\.gesture-guide-item\s*\{[\s\S]*?opacity:\s*0\.66/);
});

test("drag progress reveals the preview and cancel clears its inline state", () => {
  assert.match(appSource, /function handleQuizDrag[\s\S]*?setCardPreviewProgress\(surface, Math\.hypot\(dx, dy\)\)/);
  assert.match(appSource, /function animateSwipeCancel[\s\S]*?setCardPreviewProgress\(surface, 0\)/);
  assert.match(appSource, /function clearGestureSurfaceStyles[\s\S]*?clearCardPreviewStyles\(surface\)/);
});

test("preview layering stays below the active card and exit flight", () => {
  assert.match(stylesSource, /\.quiz-card-preview\s*\{[\s\S]*?z-index:\s*0/);
  assert.match(stylesSource, /\.quiz-gesture-card\s*\{[\s\S]*?z-index:\s*2/);
  assert.match(stylesSource, /\.quiz-card-flight\s*\{[\s\S]*?z-index:\s*55/);
});

test("reduced motion keeps the preview stable", () => {
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.quiz-card-preview\s*\{[\s\S]*?transform:\s*scale\(0\.982\) translateY\(5px\)/);
});

test("answered choice feedback and swipe guide stay inside one question card", () => {
  assert.match(appSource, /<article class="question-card\$\{isSwipeAdvance \? " swipe-choice-card" : ""\}">[\s\S]*?answered && isSwipeAdvance \? feedbackArea[\s\S]*?renderChoiceSwipeHints\(\)[\s\S]*?<\/article>/);
  assert.match(appSource, /answered && !isSwipeAdvance \? feedbackArea/);
  assert.match(stylesSource, /\.swipe-choice-card\s*\{[\s\S]*?min-height:\s*var\(--choice-card-height\)/);
  assert.match(stylesSource, /\.swipe-choice-card > \.feedback-card\s*\{[\s\S]*?background:\s*transparent[\s\S]*?border-top:/);
});

test("front and preview choice headings share the same responsive size", () => {
  assert.match(stylesSource, /--choice-heading-size:\s*clamp\(/);
  assert.match(stylesSource, /\.swipe-choice-card h1\s*\{[\s\S]*?font-size:\s*var\(--choice-heading-size\)/);
  assert.match(stylesSource, /\.quiz-card-preview--choice \.quiz-card-preview-prompt\s*\{[\s\S]*?font-size:\s*var\(--choice-heading-size\)/);
});
