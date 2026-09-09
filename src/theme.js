// 画面の明るさ（ライト／ダーク）を決めるモジュール。
// 設定は3つ: "system"（端末の設定に合わせる）・"light"・"dark"。
// 実際に適用した結果は <html data-theme="light|dark"> で表す。

export const THEME_PREFERENCES = ["system", "light", "dark"];
export const DEFAULT_THEME_PREFERENCE = "system";
// 起動直後のちらつきを防ぐため、設定はIndexedDBだけでなくここにも控える。
export const THEME_STORAGE_KEY = "words:theme-preference";

// 画面上部（iOSのステータスバーなど）の色。背景色とそろえる。
const THEME_COLORS = { light: "#f6f6f7", dark: "#101014" };

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : DEFAULT_THEME_PREFERENCE;
}

// 設定と端末の状態から、実際に使う明るさを決める。
export function resolveTheme(preference, prefersDark = false) {
  const normalized = normalizeThemePreference(preference);
  if (normalized === "dark") return "dark";
  if (normalized === "light") return "light";
  return prefersDark ? "dark" : "light";
}

function darkQuery(view) {
  return typeof view?.matchMedia === "function"
    ? view.matchMedia("(prefers-color-scheme: dark)")
    : null;
}

// 設定を画面に反映する。戻り値は実際に適用した "light" | "dark"。
export function applyThemePreference(preference, { view = globalThis } = {}) {
  const normalized = normalizeThemePreference(preference);
  const theme = resolveTheme(normalized, Boolean(darkQuery(view)?.matches));
  const root = view?.document?.documentElement;
  if (root) {
    root.dataset.theme = theme;
    root.dataset.themePreference = normalized;
  }
  const meta = view?.document?.querySelector?.('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
  const bar = view?.document?.querySelector?.('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (bar) bar.setAttribute("content", theme === "dark" ? "black-translucent" : "default");
  try {
    view?.localStorage?.setItem(THEME_STORAGE_KEY, normalized);
  } catch {
    // プライベートモードなどで保存できなくても、表示だけは切り替える。
  }
  return theme;
}

export function readStoredThemePreference({ view = globalThis } = {}) {
  try {
    return normalizeThemePreference(view?.localStorage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

// 「端末に合わせる」ときだけ、端末側の切り替えに追従する。
export function watchSystemTheme(onChange, { view = globalThis } = {}) {
  const query = darkQuery(view);
  if (!query?.addEventListener) return () => {};
  const handler = (event) => onChange(event.matches);
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}
