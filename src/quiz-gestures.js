export const QUIZ_GESTURE_DEFAULTS = Object.freeze({
  tapSlopPx: 10,
  dragStartPx: 10,
  swipeViewportRatio: 0.12,
  minSwipePx: 64,
  maxSwipePx: 90,
  flickMinDistancePx: 36,
  flickVelocityPxMs: 0.72,
  maxFlickDurationMs: 320,
  edgeGuardPx: 24,
  syntheticClickGuardMs: 360,
});

export const SWIPE_DIRECTIONS = Object.freeze(["left", "right", "up", "down"]);
export const RECALL_SWIPE_DIRECTIONS = Object.freeze(["left", "right", "up"]);

const RECALL_ACTIONS = Object.freeze({
  left: "three-minutes",
  right: "one-hour",
  up: "mastered",
});

const INTERACTIVE_SELECTOR = "button, input, select, textarea, a, label, [data-quiz-gesture-ignore]";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mergedOptions(options = {}) {
  return { ...QUIZ_GESTURE_DEFAULTS, ...options };
}

export function isRecallMode(mode) {
  return typeof mode === "string"
    && (mode.endsWith("_recall") || mode.endsWith("_flashcard"));
}

export function isSwipeAdvanceMode(mode) {
  return typeof mode === "string"
    && mode.endsWith("choice");
}

export function recallActionForDirection(direction) {
  return RECALL_ACTIONS[direction] ?? null;
}

export function oppositeDirection(direction) {
  return {
    left: "right",
    right: "left",
    up: "down",
    down: "up",
  }[direction] ?? null;
}

export function resolveSwipeDirection(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

export function swipeThreshold(direction, viewport = {}, options = {}) {
  const config = mergedOptions(options);
  const horizontal = direction === "left" || direction === "right";
  const viewportSize = horizontal
    ? Number(viewport.width) || 0
    : Number(viewport.height) || 0;
  return clamp(
    viewportSize * config.swipeViewportRatio,
    config.minSwipePx,
    config.maxSwipePx,
  );
}

export function isEdgeGuardedStart(clientX, viewportWidth, options = {}) {
  const config = mergedOptions(options);
  const x = Number(clientX) || 0;
  const width = Math.max(0, Number(viewportWidth) || 0);
  return x <= config.edgeGuardPx || x >= width - config.edgeGuardPx;
}

export function classifyQuizGesture({
  dx = 0,
  dy = 0,
  durationMs = 0,
  wasDragging = false,
  viewport = {},
  options = {},
} = {}) {
  const config = mergedOptions(options);
  const totalDistance = Math.hypot(dx, dy);
  if (!wasDragging && totalDistance <= config.tapSlopPx) {
    return { type: "tap", direction: null, threshold: null, velocity: 0 };
  }

  const direction = resolveSwipeDirection(dx, dy);
  const axisDistance = direction === "left" || direction === "right"
    ? Math.abs(dx)
    : Math.abs(dy);
  const threshold = swipeThreshold(direction, viewport, config);
  const elapsed = Math.max(1, Number(durationMs) || 0);
  const velocity = axisDistance / elapsed;
  const isFlick = elapsed <= config.maxFlickDurationMs
    && axisDistance >= config.flickMinDistancePx
    && velocity >= config.flickVelocityPxMs;
  return {
    type: axisDistance >= threshold || isFlick ? "swipe" : "cancel",
    direction,
    threshold,
    velocity,
  };
}

export function quizGesturePolicy({
  mode = "",
  answered = false,
  revealed = false,
  isTransitioning = false,
} = {}) {
  if (isTransitioning) {
    return { tapEnabled: false, dragEnabled: false, allowedDirections: [] };
  }
  if (isRecallMode(mode)) {
    return {
      tapEnabled: !answered,
      dragEnabled: !answered && revealed,
      allowedDirections: !answered && revealed ? RECALL_SWIPE_DIRECTIONS : [],
    };
  }
  if (isSwipeAdvanceMode(mode) && answered) {
    return {
      tapEnabled: false,
      dragEnabled: true,
      allowedDirections: SWIPE_DIRECTIONS,
    };
  }
  return { tapEnabled: false, dragEnabled: false, allowedDirections: [] };
}

export function createQuizGestureRecognizer(options = {}) {
  const config = mergedOptions(options);
  let active = null;
  let locked = false;

  return {
    start({ x, y, time = 0, viewport = {} } = {}) {
      if (locked || active) return false;
      active = {
        startX: Number(x) || 0,
        startY: Number(y) || 0,
        startTime: Number(time) || 0,
        viewport,
        wasDragging: false,
      };
      return true;
    },
    move({ x, y } = {}) {
      if (!active) return null;
      const dx = (Number(x) || 0) - active.startX;
      const dy = (Number(y) || 0) - active.startY;
      if (Math.hypot(dx, dy) > config.dragStartPx) active.wasDragging = true;
      return {
        dx,
        dy,
        direction: resolveSwipeDirection(dx, dy),
        wasDragging: active.wasDragging,
      };
    },
    end({ x, y, time = 0 } = {}) {
      if (!active) return null;
      const dx = (Number(x) || 0) - active.startX;
      const dy = (Number(y) || 0) - active.startY;
      const result = classifyQuizGesture({
        dx,
        dy,
        durationMs: Math.max(0, (Number(time) || 0) - active.startTime),
        wasDragging: active.wasDragging,
        viewport: active.viewport,
        options: config,
      });
      active = null;
      if (result.type === "swipe") locked = true;
      return { ...result, dx, dy };
    },
    cancel() {
      const snapshot = active;
      active = null;
      return snapshot;
    },
    unlock() {
      locked = false;
    },
    reset() {
      active = null;
      locked = false;
    },
    get active() {
      return active;
    },
    get locked() {
      return locked;
    },
  };
}

function isUsablePrimaryPointer(event) {
  return event.isPrimary !== false && (event.button === undefined || event.button === 0);
}

function isEnabledInteractiveTarget(target) {
  const control = target.closest?.(INTERACTIVE_SELECTOR);
  return Boolean(control && !("disabled" in control && control.disabled));
}

export function bindQuizGestures(container, {
  getPolicy,
  onTap,
  onDrag,
  onCancel,
  onSwipe,
  options = {},
  now = () => performance.now(),
} = {}) {
  const config = mergedOptions(options);
  const recognizer = createQuizGestureRecognizer(config);
  let activePointerId = null;
  let activeSurface = null;
  let activePolicy = null;
  let canceling = false;
  let suppressClickUntil = 0;

  const suppressSyntheticClick = (milliseconds = config.syntheticClickGuardMs) => {
    suppressClickUntil = Math.max(suppressClickUntil, now() + milliseconds);
  };

  const clearActivePointer = () => {
    activePointerId = null;
    activeSurface = null;
    activePolicy = null;
  };

  const releaseCapture = (surface, pointerId) => {
    if (!surface?.hasPointerCapture?.(pointerId)) return;
    try {
      surface.releasePointerCapture(pointerId);
    } catch {
      // Safari may release capture before pointerup when native scrolling wins.
    }
  };

  const finishCancel = (payload) => {
    canceling = true;
    Promise.resolve(onCancel?.(payload)).finally(() => {
      canceling = false;
      recognizer.unlock();
    });
  };

  const handlePointerDown = (event) => {
    const surface = event.target.closest?.("[data-quiz-gesture-surface]");
    if (!surface || !container.contains(surface) || !isUsablePrimaryPointer(event)) return;
    if (recognizer.locked || recognizer.active || canceling) return;
    const policy = getPolicy?.(surface, event)
      ?? { tapEnabled: false, dragEnabled: false, allowedDirections: [] };
    if (!policy.tapEnabled && !policy.dragEnabled) return;
    if (isEnabledInteractiveTarget(event.target)) return;

    const edgeGuarded = policy.dragEnabled
      && isEdgeGuardedStart(event.clientX, window.innerWidth, config);
    activePolicy = edgeGuarded ? { ...policy, dragEnabled: false } : policy;
    const started = recognizer.start({
      x: event.clientX,
      y: event.clientY,
      time: now(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    if (!started) return;
    activePointerId = event.pointerId;
    activeSurface = surface;
    try {
      surface.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; document-level bubbling still completes the gesture.
    }
  };

  const handlePointerMove = (event) => {
    if (event.pointerId !== activePointerId || !activeSurface) return;
    const movement = recognizer.move({ x: event.clientX, y: event.clientY });
    if (!movement?.wasDragging) return;
    suppressSyntheticClick();
    if (!activePolicy?.dragEnabled) return;
    event.preventDefault();
    onDrag?.({
      surface: activeSurface,
      ...movement,
    });
  };

  const handlePointerUp = (event) => {
    if (event.pointerId !== activePointerId || !activeSurface) return;
    const surface = activeSurface;
    const policy = activePolicy;
    const result = recognizer.end({ x: event.clientX, y: event.clientY, time: now() });
    clearActivePointer();
    releaseCapture(surface, event.pointerId);
    if (!result) return;

    if (result.type === "tap") {
      if (policy?.tapEnabled) {
        event.preventDefault();
        suppressSyntheticClick();
        onTap?.({ surface, ...result });
      }
      return;
    }

    suppressSyntheticClick();
    if (!policy?.dragEnabled) {
      recognizer.unlock();
      return;
    }
    event.preventDefault();
    const allowed = policy.allowedDirections?.includes(result.direction);
    if (result.type !== "swipe" || !allowed) {
      finishCancel({ surface, ...result });
      return;
    }
    Promise.resolve(onSwipe?.({ surface, ...result })).finally(() => {
      recognizer.unlock();
    });
  };

  const handlePointerCancel = (event) => {
    if (event.pointerId !== activePointerId || !activeSurface) return;
    const surface = activeSurface;
    const policy = activePolicy;
    const wasDragging = recognizer.active?.wasDragging;
    recognizer.cancel();
    clearActivePointer();
    releaseCapture(surface, event.pointerId);
    if (wasDragging) suppressSyntheticClick();
    if (wasDragging && policy?.dragEnabled) finishCancel({ surface, direction: null });
  };

  const handleClickCapture = (event) => {
    if (event.detail === 0 || now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  container.addEventListener("pointerdown", handlePointerDown);
  container.addEventListener("pointermove", handlePointerMove, { passive: false });
  container.addEventListener("pointerup", handlePointerUp);
  container.addEventListener("pointercancel", handlePointerCancel);
  container.addEventListener("lostpointercapture", handlePointerCancel);
  container.addEventListener("click", handleClickCapture, true);

  return {
    reset() {
      recognizer.reset();
      clearActivePointer();
      canceling = false;
      suppressClickUntil = 0;
    },
    destroy() {
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerup", handlePointerUp);
      container.removeEventListener("pointercancel", handlePointerCancel);
      container.removeEventListener("lostpointercapture", handlePointerCancel);
      container.removeEventListener("click", handleClickCapture, true);
      recognizer.reset();
    },
    get isLocked() {
      return recognizer.locked || canceling;
    },
  };
}
