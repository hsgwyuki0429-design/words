#!/usr/bin/env python3
"""3定（2026.3）英語の語彙表（CSV）を、アプリの英語データ（JSON）へ変換する。

使い方:
    python3 tools/import_english_csv.py vocab_ch8_ch9.csv data/english-2026-3.json

CSVの列: 原形, 本文中の形, 品詞, 本文中の意味, 一般的な意味, 出典, 重要度, 難易度

変換の決まり（2定の import_xlsx.py と同じ考え方）:
- 単語は原形でまとめる。品詞や意味が違う行も1件にし、訳は「／」でつなぐ。
  重要度はいちばん高いもの、難易度はいちばん難しいものを採る。
- まとめたあとの重要度が C の語句（and・of・be・have to do などの基本語）は、
  単語・熟語とも収録しない。C の行の訳は、B 以上の行と同じ原形なら、まとめた訳に加える。
- 熟語は1行1件。
- 日本語訳の中に答えの英語が出ている注記は、答えの部分を「___」に置き換える。
  「（fast asleep で）ぐっすりと」→「（___ asleep で）ぐっすりと」
- 「（P136-S8）」のような本文の位置だけの注記は訳から外す。
- 一般的な意味は訳に混ぜず generalMeaning に、「⇔ ma'am」「← madam」のような
  補足は memo に分けて持つ（単語帳に表示する）。
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import OrderedDict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from import_xlsx import (  # noqa: E402
    accepted_answers,
    best_importance,
    build_phrase_blank,
    build_preposition_blank,
    clean_text,
    hardest_difficulty,
    word_matches,
)

# 出典の書き方 → 範囲。範囲名は画面に出るので短くする。
LESSONS = OrderedDict(
    [
        (
            "A Loving Story",
            {
                "range": "A Loving Story",
                "slug": "loving",
                "lesson": "Chapter 8",
                "title": "A Loving Story",
            },
        ),
        (
            "Edo, the Resilient City",
            {
                "range": "Edo",
                "slug": "edo",
                "lesson": "Chapter 9",
                "title": "Edo, the Resilient City",
            },
        ),
    ]
)

APP_IMPORTANCE = {"SSS", "SS", "S", "A", "B"}
PAGE_REF_RE = re.compile(r"P\d{3}-S\d+")

# 自動の整形ではうまく直せない訳を、元の訳（本文中の意味）ごとに書き直す。
# 値が None の行は、まとめた訳に加えない（熟語の一部であることしか書いていない行）。
MEANING_OVERRIDES: dict[tuple[str, str], str | None] = {
    ("legal", "合法の（P120-S30 の legal support では「法的な」）"): "合法の／（___ support で）法的な",
    ("report", "〜を通報する（P120-S12）／〜を報じる（P137-S8）"): "〜を通報する／〜を報じる",
    ("make", "〜に…させる（P136-S8）／〜を…にする（P136-S18）"): "〜に…させる／〜を…にする",
    ("reach", "〜に達する（P136-S16）／〜にたどり着く（P136-S25）"): "〜に達する／〜にたどり着く",
    ("explain", "〜を説明する（P136-S21 は「〜の理由となる」）"): "〜を説明する・〜の理由となる",
    ("different", "異なる・別々の（P121-S8 では「さまざまな」）"): "異なる・別々の・さまざまな",
    ("around", "〜中の・あちこちの（P121-S4）／〜の周りに（P121-S16）"): "〜中の・あちこちの／〜の周りに",
    ("around", "〜頃に（P136-S4）／およそ（P136-S16）"): "〜頃に／およそ",
    ("with", "〜で（いっぱいで）（P136-S4）／〜に関して（P137-S16）"): "〜で（いっぱいで）／〜に関して",
    ("reduce A to B", "AをB（の状態）にする（reduce … to ashes で灰にする）"): "AをB（の状態）にする（___ 〜 to ashes で灰にする）",
    ("it", "（時刻を表す it／形式目的語の it）"): None,
    ("it", "それ（its：その）"): "それ・その",
    ("the District", "＝Washington D.C."): "（＝ワシントン市）コロンビア特別区",
    ("anything", "何か（P121-S15）／何も（P121-S22）"): "何か／（否定文で）何も",
    ("from", "〜から／〜出身の（P121-S19）"): "〜から／〜出身の",
}

# 一般的な意味の欄のうち、意味ではなく補足（対になる語・語源）を書いている印。
MEMO_PREFIXES = ("⇔", "←")


def split_top_level(text: str, separator: str = "／") -> list[str]:
    """括弧の外にある区切りだけで分ける。括弧の中の「／」では分けない。"""
    parts: list[str] = []
    depth = 0
    current = ""
    for char in text:
        if char in "（(":
            depth += 1
        elif char in "）)":
            depth = max(0, depth - 1)
        if char == separator and depth == 0:
            parts.append(current)
            current = ""
            continue
        current += char
    parts.append(current)
    return [clean_text(part) for part in parts if clean_text(part)]


def answer_forms(lemma: str, surface_forms: list[str]) -> set[str]:
    """答えの語と、本文中の形・規則変化した形。訳の中の答えを隠すのに使う。"""
    forms = {lemma.casefold()}
    for surface in surface_forms:
        for match in word_matches(surface):
            forms.add(match.group().casefold())
    base = lemma.casefold()
    if re.fullmatch(r"[a-z]+", base):
        stems = {base}
        if base.endswith("e"):
            stems.add(base[:-1])
        if base.endswith("y"):
            stems.add(base[:-1] + "i")
        for stem in stems:
            for suffix in ("s", "es", "ed", "d", "ing", "er", "est", "ier", "iest"):
                forms.add(stem + suffix)
        forms.add(base + base[-1] + "ed")
        forms.add(base + base[-1] + "ing")
    return forms


def hide_answer(text: str, lemma: str, surface_forms: list[str]) -> str:
    """訳の中に出てくる答えの英語（活用した形も含む）を「___」にする。"""
    forms = answer_forms(lemma, surface_forms)
    lemma_tokens = [match.group().casefold() for match in word_matches(lemma)]
    if len(lemma_tokens) > 1:
        # 「the District」のような複数語の答えは、語の並びごと隠す。
        pattern = r"\b" + r"\s+".join(re.escape(token) for token in lemma_tokens) + r"\b"
        return re.sub(pattern, "___", text, flags=re.IGNORECASE)

    def replace(match: re.Match[str]) -> str:
        return "___" if match.group().casefold() in forms else match.group()

    return re.sub(r"[A-Za-z]+(?:['’][A-Za-z]+)?", replace, text)


def normalize_ellipsis(text: str) -> str:
    """「…を逮捕する」の「…」を、他の訳と同じ「〜」にそろえる。

    「〜に…させる」のように「〜」と「…」を使い分けている訳はそのままにする。
    """
    return text if "〜" in text else text.replace("…", "〜")


def clean_meaning(lemma: str, meaning: str, surface_forms: list[str], hide: bool) -> list[str]:
    key = (lemma, meaning)
    if key in MEANING_OVERRIDES:
        replaced = MEANING_OVERRIDES[key]
        if replaced is None:
            return []
        meaning = replaced
    else:
        meaning = re.sub(rf"（{PAGE_REF_RE.pattern}）", "", meaning)
    if PAGE_REF_RE.search(meaning):
        raise ValueError(f"本文の位置が訳に残っています: {lemma}: {meaning}")
    meaning = normalize_ellipsis(meaning)
    if hide:
        meaning = hide_answer(meaning, lemma, surface_forms)
    return split_top_level(meaning)


def parse_lessons(value: str) -> list[dict[str, str]]:
    lessons = []
    for part in re.split(r"\s+/\s+", clean_text(value)):
        if part not in LESSONS:
            raise ValueError(f"出典が分かりません: {value!r}")
        lessons.append(LESSONS[part])
    return lessons


def split_forms(value: str) -> list[str]:
    """「Loving / loving」は1つにまとめ、小文字の形を残す。"""
    forms: list[str] = []
    for form in re.split(r"\s+/\s+", clean_text(value)):
        if not form:
            continue
        existing = next((index for index, kept in enumerate(forms) if kept.casefold() == form.casefold()), None)
        if existing is None:
            forms.append(form)
        elif form != form.capitalize() or form.islower():
            # 文頭で大文字になっただけの形より、小文字の形を代表にする。
            if forms[existing][:1].isupper() and form[:1].islower():
                forms[existing] = form
    return forms


def append_unique(target: list[str], values: list[str]) -> None:
    seen = {value.casefold() for value in target}
    for value in values:
        if value and value.casefold() not in seen:
            target.append(value)
            seen.add(value.casefold())


def make_source(lesson: dict[str, str]) -> dict[str, str]:
    return {
        "range": lesson["range"],
        "lesson": lesson["lesson"],
        "title": lesson["title"],
        "page": "",
        "paragraph": "",
        "note": "",
        "detail": "",
        "label": f"{lesson['lesson']} {lesson['title']}",
    }


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return [
            {key: clean_text(value) for key, value in row.items()}
            for row in csv.DictReader(handle)
            if clean_text(row.get("原形"))
        ]


def build_records(rows: list[dict[str, str]]) -> list[dict[str, object]]:
    grouped: OrderedDict[str, dict[str, object]] = OrderedDict()
    for row in rows:
        lemma = row["原形"]
        is_phrase = row["品詞"].startswith("熟語")
        source_type = "熟語" if is_phrase else "単語"
        key = f"{source_type}|{lemma.casefold()}"
        record = grouped.setdefault(
            key,
            {
                "english": lemma,
                "source_type": source_type,
                "japanese": [],
                "general": [],
                "memo": [],
                "parts_of_speech": [],
                "surface_forms": [],
                "lessons": [],
                "importances": [],
                "difficulties": [],
            },
        )
        forms = split_forms(row["本文中の形"])
        append_unique(record["surface_forms"], forms)
        append_unique(
            record["japanese"],
            clean_meaning(lemma, row["本文中の意味"], record["surface_forms"], hide=True),
        )
        general = row["一般的な意味"]
        if general.startswith(MEMO_PREFIXES):
            append_unique(record["memo"], [general])
        elif general:
            append_unique(record["general"], split_top_level(normalize_ellipsis(general), "・"))
        append_unique(record["parts_of_speech"], [row["品詞"]])
        for lesson in parse_lessons(row["出典"]):
            if lesson not in record["lessons"]:
                record["lessons"].append(lesson)
        record["importances"].append(row["重要度"])
        record["difficulties"].append(row["難易度"])

    records: list[dict[str, object]] = []
    for record in grouped.values():
        # 一般的な意味のうち、訳にすでに入っているものは重ねて出さない。
        meanings = {
            part
            for variant in record["japanese"]
            for part in split_top_level(variant, "・")
        }
        record["general"] = [
            general
            for general in record["general"]
            if re.sub(r"^（[^）]*）", "", general) not in meanings
        ]
        record["importance"] = best_importance(record.pop("importances"))
        record["difficulty"] = hardest_difficulty(record.pop("difficulties"))
        if record["importance"] not in APP_IMPORTANCE:
            continue
        if not record["japanese"]:
            raise ValueError(f"訳が残りませんでした: {record['english']}")
        records.append(record)
    return records


def make_item(record: dict[str, object], order: int) -> dict[str, object]:
    english = str(record["english"])
    source_type = str(record["source_type"])
    is_word = source_type == "単語"
    lessons = record["lessons"]
    primary = lessons[0]
    digest = hashlib.sha1(f"{source_type}|{english}".casefold().encode("utf-8")).hexdigest()[:10]
    answers = accepted_answers(english)
    if english == "Washington D.C.":
        answers.append("Washington, D.C.")
    primary_answer = answers[0]
    tokens = word_matches(primary_answer)
    has_placeholder = any(match.group() in {"A", "B"} for match in tokens)
    item_type = "word" if is_word else ("structure" if has_placeholder else "phrase")

    modes = ["en_to_ja_choice", "ja_to_en_choice", "ja_to_en_input"]
    tags = [item_type]
    if is_word and len(tokens) == 1 and re.fullmatch(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", primary_answer):
        modes.append("spelling_input")
        tags.append("spelling")
    preposition_blank = None if is_word else build_preposition_blank(primary_answer)
    phrase_blank = None if is_word else build_phrase_blank(primary_answer)
    if preposition_blank:
        modes.append("preposition_input")
        tags.append("preposition")
    if phrase_blank:
        modes.append("phrase_blank_input")
        tags.append("blank")

    sources = [make_source(lesson) for lesson in lessons]
    item: dict[str, object] = {
        "id": f"{primary['slug']}_{digest}",
        "english": english,
        "japanese": "／".join(record["japanese"]),
        "type": item_type,
        "sourceType": source_type,
        "importance": record["importance"],
        "difficulty": record["difficulty"],
        "range": primary["range"],
        "lesson": primary["lesson"],
        "title": primary["title"],
        "source": "; ".join(source["label"] for source in sources),
        # 単語帳では範囲名の横に出るので、章だけを書く（範囲名と重ねない）。
        "sourceDetail": " / ".join(source["lesson"] for source in sources),
        "sources": sources,
        "tags": tags,
        "acceptedAnswers": answers,
        "questionModes": modes,
        "order": order,
        "partOfSpeech": "・".join(record["parts_of_speech"]),
    }
    surface_forms = record["surface_forms"] or [english]
    if is_word:
        item["lemma"] = english
        item["surfaceForms"] = surface_forms
    else:
        examples = [form for form in surface_forms if form.casefold() != english.casefold()]
        if examples:
            item["examples"] = examples
    if record["general"]:
        item["generalMeaning"] = "・".join(record["general"])
    if record["memo"]:
        item["memo"] = "／".join(record["memo"])
    blanks: dict[str, dict[str, str]] = {}
    if preposition_blank:
        blanks["preposition"] = preposition_blank
    if phrase_blank:
        blanks["phrase"] = phrase_blank
    if blanks:
        item["blanks"] = blanks
    return item


def convert(path: Path) -> list[dict[str, object]]:
    records = build_records(read_rows(path))
    return [make_item(record, order) for order, record in enumerate(records, start=1)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    items = convert(args.csv)
    args.output.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(items)}件を {args.output} に書き出しました")


if __name__ == "__main__":
    main()
