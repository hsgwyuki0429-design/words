import assert from "node:assert/strict";
import fs from "node:fs";

import {
  ALL_MODES,
  HEALTH_RANGE_ORDER,
  PUBLIC_RANGE_ORDER,
  RANGE_ORDER,
  acceptedInputAnswers,
  slotTokensForQuestion,
} from "../src/logic.js";

const items = JSON.parse(fs.readFileSync(new URL("../data/items.json", import.meta.url), "utf8"));
const publicItems = JSON.parse(fs.readFileSync(new URL("../data/public-items.json", import.meta.url), "utf8"));
const healthItems = JSON.parse(fs.readFileSync(new URL("../data/health-items.json", import.meta.url), "utf8"));

assert.equal(items.length, 1314, "Workbook must contain 1,314 unique English entries");
assert.equal(new Set(items.map((item) => item.id)).size, items.length, "IDs must be unique");
assert.equal(
  new Set(items.map((item) => item.english.toLocaleLowerCase())).size,
  items.length,
  "English entries must be unique",
);
assert.equal(
  items.reduce((sum, item) => sum + item.sources.length, 0),
  2276,
  "All 2,276 selected workbook source references must be preserved",
);
assert.deepEqual(
  Object.fromEntries(
    ["word", "phrase", "structure"].map((type) => [
      type,
      items.filter((item) => item.type === type).length,
    ]),
  ),
  { word: 903, phrase: 331, structure: 80 },
  "Workbook type counts must match the audited word, phrase, and usage lists",
);

assert.deepEqual(
  Object.fromEntries(
    ["単語", "熟語", "語法"].map((type) => [
      type,
      items.filter((item) => item.sourceType === type).length,
    ]),
  ),
  { "単語": 903, "熟語": 331, "語法": 80 },
  "Source categories must preserve the workbook lineup",
);

const contentTokens = (value) =>
  new Set(
    (value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [])
      .filter((token) => token.length > 1)
      .map((token) => token.toLocaleLowerCase()),
  );
for (const item of items) {
  const answer = contentTokens(item.english);
  const prompt = contentTokens(item.japanese);
  assert.ok(
    answer.size === 0 || [...answer].some((token) => !prompt.has(token)),
    `${item.id}: the Japanese prompt gives away the whole answer (${item.english})`,
  );
}

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
  assert.ok(
    item.questionModes.includes("ja_to_en_input"),
    `${item.id}: keyboard input must support every English content type`,
  );
  assert.ok(
    acceptedInputAnswers(item.acceptedAnswers).length >= 1,
    `${item.id}: accepted answers must produce at least one keyboard-input answer`,
  );
  if (item.questionModes.includes("preposition_input")) {
    assert.ok(item.blanks?.preposition?.prompt.includes("___"), `${item.id}: bad preposition blank`);
    assert.ok(item.blanks.preposition.answer, `${item.id}: missing preposition answer`);
  }
  if (item.questionModes.includes("phrase_blank_input")) {
    assert.ok(item.blanks?.phrase?.prompt.includes("___"), `${item.id}: bad phrase blank`);
    assert.ok(item.blanks.phrase.answer, `${item.id}: missing phrase answer`);
  }
  assert.ok(slotTokensForQuestion(item, "ja_to_en_input").length >= 1, `${item.id}: no word slots`);
  if (item.type === "word") {
    assert.equal(item.english, item.lemma, `${item.id}: words must use the lemma as English`);
    assert.ok(item.surfaceForms.length >= 1, `${item.id}: source surface forms are required`);
  }
}

const ranges = new Set(items.map((item) => item.range));
assert.deepEqual([...ranges].sort(), [...RANGE_ORDER].sort(), "All eight ranges are required");

console.log(`Data check passed: ${items.length} items across ${ranges.size} ranges.`);

assert.equal(publicItems.length, 291, "Public data must contain 291 unique reviewed questions");
assert.equal(new Set(publicItems.map((item) => item.id)).size, 291, "Public IDs must be unique");
assert.deepEqual(
  Object.fromEntries(["public-term", "public-short"].map((type) => [
    type,
    publicItems.filter((item) => item.type === type).length,
  ])),
  { "public-term": 291, "public-short": 0 },
  "The one-word answer workbook must contain term questions only",
);
assert.deepEqual(
  Object.fromEntries(["S", "A", "B", "C"].map((importance) => [
    importance,
    publicItems.filter((item) => item.importance === importance).length,
  ])),
  { S: 130, A: 131, B: 22, C: 8 },
  "Public importance counts must match the workbook audit sheet",
);

const compactPublicText = (value) => value
  .normalize("NFKC")
  .replace(/[\s、。・,，.．！？!?「」『』（）()【】［］\[\]]/g, "");
const canonicalPublicQuestion = (value) => compactPublicText(value)
  .replace(/^次の説明に当てはまる用語を答えよ/, "")
  .replace(/(を何というか|を答えよ|は何か|とは何か|を何と呼ぶか)$/, "");
const publicKnowledgeKeys = publicItems.map((item) =>
  `${compactPublicText(item.publicAnswer)}|${canonicalPublicQuestion(item.publicQuestion)}`,
);
assert.equal(
  new Set(publicKnowledgeKeys).size,
  publicKnowledgeKeys.length,
  "Public data must not contain templated duplicate questions",
);
for (const item of publicItems) {
  for (const field of ["id", "number", "importance", "publicQuestion", "publicAnswer", "source", "range"]) {
    assert.ok(item[field], `${item.id}: ${field} is required`);
  }
  assert.equal(item.subject, "public", `${item.id}: subject must be public`);
  assert.deepEqual(item.questionModes, ["public_recall"], `${item.id}: public mode is required`);
  assert.ok(PUBLIC_RANGE_ORDER.includes(item.range), `${item.id}: unknown public range ${item.range}`);
  assert.equal(item.acceptedAnswers[0], item.publicAnswer, `${item.id}: accepted answer must match`);
}
assert.deepEqual(
  [...new Set(publicItems.map((item) => item.range))],
  PUBLIC_RANGE_ORDER,
  "All six public ranges are required in textbook order",
);
console.log(`Public data check passed: ${publicItems.length} questions across ${PUBLIC_RANGE_ORDER.length} ranges.`);

assert.equal(healthItems.length, 282, "Health data must contain 282 unique reviewed questions");
assert.equal(new Set(healthItems.map((item) => item.id)).size, healthItems.length, "Health IDs must be unique");
assert.deepEqual(
  Object.fromEntries(["health-term", "health-short"].map((type) => [
    type,
    healthItems.filter((item) => item.type === type).length,
  ])),
  { "health-term": 282, "health-short": 0 },
  "The one-word answer workbook must contain term questions only",
);
assert.deepEqual(
  Object.fromEntries(["S", "A", "B", "C"].map((importance) => [
    importance,
    healthItems.filter((item) => item.importance === importance).length,
  ])),
  { S: 127, A: 96, B: 48, C: 11 },
  "Health importance counts must match the workbook audit sheet",
);

const healthKnowledgeKeys = healthItems.map((item) =>
  `${compactPublicText(item.healthAnswer)}|${canonicalPublicQuestion(item.healthQuestion)}`,
);
assert.equal(
  new Set(healthKnowledgeKeys).size,
  healthKnowledgeKeys.length,
  "Health data must not contain templated duplicate questions",
);
for (const item of healthItems) {
  for (const field of ["id", "number", "importance", "healthQuestion", "healthAnswer", "source", "range"]) {
    assert.ok(item[field], `${item.id}: ${field} is required`);
  }
  assert.equal(item.subject, "health", `${item.id}: subject must be health`);
  assert.deepEqual(item.questionModes, ["health_recall"], `${item.id}: health mode is required`);
  assert.ok(HEALTH_RANGE_ORDER.includes(item.range), `${item.id}: unknown health range ${item.range}`);
  assert.equal(item.acceptedAnswers[0], item.healthAnswer, `${item.id}: accepted answer must match`);
}
assert.deepEqual(
  [...new Set(healthItems.map((item) => item.range))],
  HEALTH_RANGE_ORDER,
  "All eight health ranges are required in textbook order",
);
console.log(`Health data check passed: ${healthItems.length} questions across ${HEALTH_RANGE_ORDER.length} ranges.`);
