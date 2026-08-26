import fs from "node:fs";

const dataUrl = new URL("../data/public-items.json", import.meta.url);
const items = JSON.parse(fs.readFileSync(dataUrl, "utf8"));

function compact(value) {
  return value
    .normalize("NFKC")
    .replace(/[\s、。・,，.．！？!?「」『』（）()【】［］\[\]]/g, "");
}

function canonicalQuestion(value) {
  return compact(value)
    .replace(/^次の説明に当てはまる用語を答えよ/, "")
    .replace(/(を何というか|を答えよ|は何か|とは何か|を何と呼ぶか)$/, "");
}

const seen = new Set();
const explicitlyDuplicatedIds = new Set([
  "public-0287",
  "public-0288",
  "public-0289",
  "public-0862",
]);

const deduplicated = items.filter((item) => {
  if (explicitlyDuplicatedIds.has(item.id)) return false;
  const key = `${compact(item.publicAnswer)}|${canonicalQuestion(item.publicQuestion)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const replacements = new Map([
  ["public-0013", "p.37の説明で、憲法によって政治権力をしばる考え方を何というか。"],
  ["public-0047", "p.42の説明で、憲法によって権力をしばり、人権を保障する考え方を何というか。"],
  ["public-0015", "p.37の説明で、民主的な政治制度を通じて国民の意思決定を行う考え方を何というか。"],
  ["public-0024", "p.40の説明で、私たち自身が決める政治の方法を何というか。"],
  ["public-0022", "p.40の説明で、社会生活を支えるルールやしくみをつくる決定を行うことを何というか。"],
  ["public-0087", "p.60の説明で、『私たち』にかかわる問題のルールや政策を意思決定する活動を何というか。"],
  ["public-0057", "民主主義に制約を課す原理としての、憲法の最高法規性とは何か。"],
  ["public-0081", "法律などの効力に関する、憲法の最高法規性とは何か。"],
  ["public-0208", "1789年にフランスで始まった革命は何か。"],
  ["public-0210", "1789年のフランス革命の中で採択された人権宣言は何か。"],
  ["public-0236", "1776年にバージニアで制定された権利文書は何か。"],
  ["public-0238", "1776年にアメリカが発した独立に関する宣言は何か。"],
  ["public-0339", "1999年に制定され、国から地方への権限移譲を進めた法律は何か。"],
  ["public-0520", "1999年に制定された、男女共同参画社会の形成を促進する基本法は何か。"],
  ["public-0594", "1999年に制定された、行政機関の情報公開を定める法律は何か。"],
  ["public-0596", "1999年に制定された、国家公務員の倫理を定める法律は何か。"],
  ["public-0509", "国際連合で障害者権利条約が採択されたのは何年か。"],
  ["public-0796", "2006年に国際連合で採択された、障害者の権利に関する条約は何か。"],
]);

for (const item of deduplicated) {
  if (replacements.has(item.id)) item.publicQuestion = replacements.get(item.id);
  if (item.id === "public-0509") item.publicAnswer = "2006年";
}

fs.writeFileSync(dataUrl, `${JSON.stringify(deduplicated, null, 2)}\n`);
console.log(`Removed ${items.length - deduplicated.length} duplicate public questions.`);
