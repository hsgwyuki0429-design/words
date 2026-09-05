// 古文は英語の出題形式・正規化・教材モデルと分離する。
export const CONJUGATION_FORMS = ["未然形", "連用形", "終止形", "連体形", "已然形", "命令形"];
export const KOBUN_MODES = {
  kobun_connection: "接続",
  kobun_meaning: "意味",
  kobun_table_select: "活用表・埋める式",
  kobun_table_input: "活用表・タイプ式",
  kobun_base_input: "基本形識別",
};
export const KOBUN_CATEGORIES = [
  { id: "auxiliary", label: "助動詞", description: "接続・意味・活用・基本形識別" },
  { id: "vocabulary", label: "古文単語", description: "本文の用例から意味と覚えるポイントを確かめる" },
];
export const NO_CONJUGATION = "○";

export function normalizeKobun(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/[〇◯]/g, "○");
}

export function splitForms(value) {
  return (Array.isArray(value) ? value : String(value ?? "").split(/[／/・、,，\s]+/u))
    .map(normalizeKobun).filter(Boolean);
}

// 正解は集合で比較するが、重複は集合に潰す前に検出する。
export function gradeSet(input, expected, aliases = {}) {
  const values = input.map(normalizeKobun).filter(Boolean).map((value) => aliases[value] ?? value);
  const selected = new Set(values);
  const required = new Set(expected.map(normalizeKobun));
  const duplicates = [...selected].filter((value) => values.filter((entry) => entry === value).length > 1);
  const correct = [...selected].filter((value) => required.has(value));
  const missing = [...required].filter((value) => !selected.has(value));
  const incorrect = [...selected].filter((value) => !required.has(value));
  const complete = !missing.length && !incorrect.length && !duplicates.length;
  return {
    complete, correct, missing, incorrect, duplicates,
    status: complete ? "correct" : incorrect.length || duplicates.length ? "incorrect" : correct.length ? "partial" : "unanswered",
  };
}

export function gradeConjugation(input, conjugation) {
  const cells = CONJUGATION_FORMS.map((form, index) => ({
    form,
    ...gradeSet(splitForms(input[index]), conjugation[form].length ? conjugation[form] : [NO_CONJUGATION]),
  }));
  return {
    complete: cells.every((cell) => cell.complete), cells,
    status: cells.every((cell) => cell.complete) ? "correct"
      : cells.some((cell) => cell.status === "incorrect") ? "incorrect"
        : cells.some((cell) => cell.correct.length) ? "partial" : "unanswered",
  };
}

export function validateAuxiliaries(items) {
  if (!Array.isArray(items) || !items.length) throw new Error("助動詞マスターが空です");
  const ids = new Set();
  for (const item of items) {
    if (!item.id?.startsWith("kobun:aux:") || ids.has(item.id) || item.subject !== "kobun" || item.category !== "auxiliary" || !item.base) {
      throw new Error("助動詞の識別情報が正しくありません");
    }
    ids.add(item.id);
    for (const field of ["connections", "meanings"]) {
      if (!Array.isArray(item[field]) || !item[field].length || item[field].some((value) => typeof value !== "string" || !value.trim()) || new Set(item[field]).size !== item[field].length) {
        throw new Error(`${item.base}の${field}を確認してください`);
      }
    }
    for (const form of CONJUGATION_FORMS) {
      const values = item.conjugation?.[form];
      if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim() || normalizeKobun(value) === NO_CONJUGATION) || new Set(values).size !== values.length) {
        throw new Error(`${item.base}の${form}を確認してください`);
      }
    }
  }
  return items;
}

export function validateVocabulary(items) {
  const ids = new Set();
  for (const item of items) {
    if (!item.id?.startsWith("kobun:vocab:") || ids.has(item.id) || item.subject !== "kobun-vocab" || item.category !== "vocabulary" || !item.headword || !Array.isArray(item.meanings) || !item.meanings.length || item.meanings.some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error("古文単語の見出し・複数の意味・識別情報を確認してください");
    }
    ids.add(item.id);
  }
  return items;
}

export function allMeaningOptions(items) {
  return [...new Set(items.flatMap((item) => item.meanings))];
}

export function allConnectionOptions(items) {
  return [...new Set([...CONJUGATION_FORMS.slice(0, 5), ...items.flatMap((item) => item.connections)])];
}

// 全マスターを走査してから絞り込む。学習範囲外の基本形も正解から落とさない。
export function buildBaseQuestions(items) {
  const groups = new Map();
  for (const item of items) {
    for (const form of CONJUGATION_FORMS) {
      for (const surface of item.conjugation[form]) {
        const key = JSON.stringify([surface, form]);
        if (!groups.has(key)) groups.set(key, {
          id: `kobun:base:${form}:${surface}`, mode: "kobun_base_input", surface, form,
          answers: [], itemIds: [], labels: [], aliases: {},
        });
        const group = groups.get(key);
        if (!group.answers.includes(item.base)) group.answers.push(item.base);
        if (!group.itemIds.includes(item.id)) group.itemIds.push(item.id);
        if (!group.labels.includes(item.label)) group.labels.push(item.label);
        for (const alias of item.baseAliases ?? []) group.aliases[alias] = item.base;
      }
    }
  }
  return [...groups.values()];
}

export function questionsForMode(items, mode) {
  if (!(mode in KOBUN_MODES)) throw new Error("未対応の古文学習形式です");
  if (mode === "kobun_base_input") return buildBaseQuestions(items);
  return items.map((item) => ({ id: item.id, mode, item, itemIds: [item.id] }));
}

export function gradeQuestion(question, values) {
  if (question.mode === "kobun_base_input") return gradeSet(values, question.answers, question.aliases);
  if (question.mode.startsWith("kobun_table_")) return gradeConjugation(values, question.item.conjugation);
  return gradeSet(values, question.item[question.mode === "kobun_connection" ? "connections" : "meanings"]);
}

export function conjugationOptions(item) {
  return [...new Set([...CONJUGATION_FORMS.flatMap((form) => item.conjugation[form]), NO_CONJUGATION])];
}

export function toggleForm(values, value) {
  if (value === NO_CONJUGATION) return values.includes(value) ? [] : [value];
  const present = values.includes(value);
  return present ? values.filter((entry) => entry !== value) : [...values.filter((entry) => entry !== NO_CONJUGATION), value];
}

export function summarizeKobun(items, history, mode) {
  const questions = questionsForMode(items, mode);
  const stats = questions.map((question) => history.get(question.id)?.modeStats?.[mode]);
  const attempts = stats.reduce((sum, stat) => sum + (stat?.attempts ?? 0), 0);
  const correct = stats.reduce((sum, stat) => sum + (stat?.correct ?? 0), 0);
  const correctItems = stats.filter((stat) => stat?.attempts > 0 && stat.lastResult === "correct").length;
  return { total: questions.length, answered: stats.filter((stat) => stat?.attempts > 0).length, correctItems, attempts, correct, accuracy: attempts ? Math.round(correct / attempts * 100) : null };
}

export function restoreKobunSession(saved, questions) {
  if (!saved || !Array.isArray(saved.queue)) return null;
  const ids = new Set(questions.map((question) => question.id));
  const queue = [...new Set(saved.queue)].filter((id) => ids.has(id));
  const index = Math.min(queue.length, Math.max(0, Number.isInteger(saved.index) ? saved.index : 0));
  return {
    queue, index, results: Array.isArray(saved.results) ? saved.results : [],
    draft: saved.draft ?? null, feedback: saved.feedback ?? null,
    startedAt: saved.startedAt ?? Date.now(),
    updatedAt: saved.updatedAt ?? saved.startedAt ?? Date.now(),
  };
}
