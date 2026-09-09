const PATTERNS = { open: 12, flip: 10, correct: [15, 35, 25], wrong: [35, 45, 35] };

export function createHaptics({ isEnabled, navigatorObject = globalThis.navigator, documentObject = globalThis.document }) {
  let pendingOpen = false;
  let started = false;
  const supported = typeof navigatorObject?.vibrate === "function";

  function trigger(kind) {
    if (!Object.hasOwn(PATTERNS, kind)) return false;
    // 最初の学習操作と起動通知を重ねない。
    pendingOpen = false;
    if (!supported || !isEnabled() || documentObject.hidden || navigatorObject.userActivation?.hasBeenActive === false) return false;
    try { return navigatorObject.vibrate(PATTERNS[kind]); } catch { return false; }
  }

  function stop() {
    pendingOpen = false;
    if (supported) {
      try { navigatorObject.vibrate(0); } catch { /* 非対応でも学習を続ける。 */ }
    }
  }

  function open() {
    pendingOpen = supported && isEnabled() && !documentObject.hidden;
    if (pendingOpen && navigatorObject.userActivation?.hasBeenActive) trigger("open");
  }

  function start() {
    if (started) return;
    started = true;
    const firstInteraction = (event) => {
      if (event.isTrusted && pendingOpen) trigger("open");
    };
    documentObject.addEventListener("click", firstInteraction);
    documentObject.addEventListener("keyup", firstInteraction);
    documentObject.addEventListener("visibilitychange", () => documentObject.hidden ? stop() : open());
    open();
  }

  return { supported, trigger, stop, start };
}
