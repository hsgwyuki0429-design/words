import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyFilters, itemsForModeProgress, PUBLIC_RANGE_ORDER } from "../src/logic.js";

const items = JSON.parse(readFileSync(new URL("../data/public-items.json", import.meta.url), "utf8"));
const titles = [...new Set(items.map(item => item.title))];

test("公共の11題名で全207問を重複なく選べ、各形式の問題数も一致する", () => {
  assert.equal(titles.length, 11);
  const ids = [];
  for (const title of titles) {
    const selected = applyFilters(items, new Map(), { ranges: [title] });
    assert.ok(selected.length > 0);
    assert.ok(selected.every(item => item.title === title));
    ids.push(...selected.map(item => item.id));
    for (const mode of ["public_choice", "public_recall"]) {
      assert.deepEqual(itemsForModeProgress(items, { ranges: [title], mode }).map(item => item.id), selected.map(item => item.id));
    }
  }
  assert.equal(ids.length, 207);
  assert.equal(new Set(ids).size, 207);
  assert.equal(applyFilters(items, new Map(), { ranges: titles }).length, 207);
});

test("同じページ範囲の章を区別し、従来のページ指定も引き続き読める", () => {
  const selected = applyFilters(items, new Map(), { ranges: ["民主主義の原理"] });
  assert.ok(selected.every(item => item.title !== "立憲主義の原理"));
  for (const range of PUBLIC_RANGE_ORDER) {
    assert.deepEqual(applyFilters(items, new Map(), { ranges: [range] }).map(item => item.id), items.filter(item => item.range === range).map(item => item.id));
  }
  const two = titles.slice(0, 2);
  assert.deepEqual(applyFilters(items, new Map(), { ranges: two }).map(item => item.id), items.filter(item => two.includes(item.title)).map(item => item.id));
});
