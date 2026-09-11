// 教材の元データ（data/*.json）の読み込み。
//
// wordsはGitHub Pagesの静的サイトなので、元データはHTTPでも読める。
// サーバーレス環境ではファイルを持てないため、既定はHTTPで読み、
// Nodeで動かすときだけリポジトリのファイルを直接読む。
// どちらの場合も元データは書き換えない（AIによる変更は重ね合わせで表す）。

import { SUBJECTS, SUBJECT_IDS } from "./subjects.js";

const DEFAULT_CACHE_MS = 10 * 60 * 1000;

/** 公開サイトのdata/を読む。あらゆるサーバーレス環境で動く既定の方法。 */
export function createFetchDataSource(baseUrl, { fetchImpl = fetch } = {}) {
  const root = String(baseUrl).replace(/\/+$/, "");
  return {
    name: "fetch",
    origin: root,
    async read(subject) {
      const config = SUBJECTS[subject];
      const response = await fetchImpl(`${root}/data/${config.file}`);
      if (!response.ok) {
        throw new Error(`${config.label}の教材データを読み込めませんでした (${response.status})`);
      }
      return config.pick(await response.json());
    },
  };
}

/** リポジトリの data/ を直接読む。Nodeでの開発とテスト用。 */
export function createFileDataSource(directory, { readFile } = {}) {
  return {
    name: "file",
    origin: String(directory),
    async read(subject) {
      const config = SUBJECTS[subject];
      const load = readFile ?? (await import("node:fs/promises")).readFile;
      const path = await import("node:path");
      const raw = await load(path.join(directory, config.file), "utf8");
      return config.pick(JSON.parse(raw));
    },
  };
}

/**
 * 教材データを教科ごとに読み、しばらく覚えておく。
 * 元データはめったに変わらないので、毎回の取得はしない。
 */
export function createQuestionCatalog(dataSource, { cacheMs = DEFAULT_CACHE_MS, now = Date.now } = {}) {
  const cache = new Map();
  async function load(subject) {
    const cached = cache.get(subject);
    if (cached && now() - cached.at < cacheMs) return cached.items;
    const items = await dataSource.read(subject);
    if (!Array.isArray(items)) throw new Error(`${subject} の教材データが配列ではありません`);
    cache.set(subject, { at: now(), items });
    return items;
  }
  return {
    source: dataSource.name,
    /** 1教科ぶんの元データ。 */
    baseItems: load,
    /** 全教科ぶんの元データをまとめて返す。 */
    async allBaseItems() {
      const lists = await Promise.all(SUBJECT_IDS.map((subject) => load(subject)));
      return lists.flat();
    },
    clearCache() {
      cache.clear();
    },
  };
}
