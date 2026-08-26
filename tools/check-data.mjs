import assert from "node:assert/strict";
import fs from "node:fs";

import { ALL_MODES, RANGE_ORDER, slotTokensForQuestion } from "../src/logic.js";

const items = JSON.parse(fs.readFileSync(new URL("../data/items.json", import.meta.url), "utf8"));

assert.equal(items.length, 641, "Workbook must contain 641 unique English entries");
assert.equal(new Set(items.map((item) => item.id)).size, items.length, "IDs must be unique");
assert.equal(
  new Set(items.map((item) => item.english.toLocaleLowerCase())).size,
  items.length,
  "English entries must be unique",
);
assert.equal(
  items.reduce((sum, item) => sum + item.sources.length, 0),
  654,
  "All 654 workbook source rows must be preserved",
);
assert.deepEqual(
  Object.fromEntries(
    ["word", "phrase", "structure"].map((type) => [
      type,
      items.filter((item) => item.type === type).length,
    ]),
  ),
  { word: 383, phrase: 197, structure: 61 },
  "Workbook type counts must match the replacement lists",
);

for (const item of items) {
  for (const field of [
    "id",
    "english",
    "japanese",
    "type",
    "importance",
    "difficulty",
    "range",
    "lesson",
    "title",
    "source",
  ]) {
    assert.ok(item[field], `${item.id}: ${field} is required`);
  }
  assert.ok(RANGE_ORDER.includes(item.range), `${item.id}: unknown range ${item.range}`);
  assert.ok(item.sources.length >= 1, `${item.id}: at least one source is required`);
  assert.ok(item.acceptedAnswers.length >= 1, `${item.id}: accepted answer is required`);
  assert.ok(item.questionModes.length >= 3, `${item.id}: core modes are required`);
  assert.ok(
    item.questionModes.every((mode) => ALL_MODES.includes(mode)),
    `${item.id}: unknown question mode`,
  );
  if (item.questionModes.includes("preposition_input")) {
    assert.ok(item.blanks?.preposition?.prompt.includes("___"), `${item.id}: bad preposition blank`);
    assert.ok(item.blanks.preposition.answer, `${item.id}: missing preposition answer`);
  }
  if (item.questionModes.includes("phrase_blank_input")) {
    assert.ok(item.blanks?.phrase?.prompt.includes("___"), `${item.id}: bad phrase blank`);
    assert.ok(item.blanks.phrase.answer, `${item.id}: missing phrase answer`);
  }
  if (["ja_to_en_input", "spelling_input"].some((mode) => item.questionModes.includes(mode))) {
    assert.ok(slotTokensForQuestion(item, "ja_to_en_input").length >= 1, `${item.id}: no word slots`);
  }
}

const ranges = new Set(items.map((item) => item.range));
assert.deepEqual([...ranges].sort(), [...RANGE_ORDER].sort(), "All eight ranges are required");

console.log(`Data check passed: ${items.length} items across ${ranges.size} ranges.`);
