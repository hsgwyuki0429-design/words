#!/usr/bin/env python3
"""Convert the supplied vocabulary workbook into the app's JSON data model."""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook


SOURCE_MAP = {
    "OriHime": {
        "range": "OriHime",
        "slug": "orihime",
        "lesson": "OriHime",
        "title": "A Vehicle of Your Heart",
    },
    "Mars": {
        "range": "Mars",
        "slug": "mars",
        "lesson": "Mars",
        "title": "Human Habitation on Mars",
    },
    "Kakigori": {
        "range": "Kakigori",
        "slug": "kakigori",
        "lesson": "Kakigori",
        "title": "A Cool Food: Kakigori",
    },
    "Snow": {
        "range": "Snow",
        "slug": "snow",
        "lesson": "Lesson 4",
        "title": "Snow",
    },
    "Lesson 2": {
        "range": "Plastic",
        "slug": "plastic",
        "lesson": "Lesson 2",
        "title": "Plastic",
    },
    "Lesson 3": {
        "range": "FOMO",
        "slug": "fomo",
        "lesson": "Lesson 3",
        "title": "FOMO",
    },
    "Lesson 4": {
        "range": "Snow",
        "slug": "snow",
        "lesson": "Lesson 4",
        "title": "Snow",
    },
    "Lesson 5": {
        "range": "Shinkansen",
        "slug": "shinkansen",
        "lesson": "Lesson 5",
        "title": "Shinkansen",
    },
    "Lesson 6": {
        "range": "Taste Buds",
        "slug": "taste-buds",
        "lesson": "Lesson 6",
        "title": "Taste Buds",
    },
}

SOURCE_RE = re.compile(
    r"^(OriHime|Mars|Kakigori|Snow|Lesson [2-6])"
    r"(?:\s+p\.([^\s]+))?(?:\s+(?:¶(.+)|(.+)))?$"
)
WORD_RE = re.compile(r"[A-Za-z]+(?:['’\-][A-Za-z]+)*")
PLACEHOLDERS = {"a", "b", "s", "v"}
PREPOSITIONS = {
    "about",
    "above",
    "across",
    "after",
    "against",
    "along",
    "among",
    "around",
    "as",
    "at",
    "before",
    "below",
    "beneath",
    "beside",
    "between",
    "beyond",
    "by",
    "despite",
    "during",
    "except",
    "for",
    "from",
    "in",
    "inside",
    "into",
    "like",
    "near",
    "of",
    "on",
    "onto",
    "outside",
    "over",
    "past",
    "since",
    "through",
    "throughout",
    "to",
    "toward",
    "towards",
    "under",
    "underneath",
    "until",
    "upon",
    "with",
    "within",
    "without",
}


def clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def parse_source(label: str) -> dict[str, str]:
    match = SOURCE_RE.match(clean_text(label))
    if not match:
        raise ValueError(f"Unrecognized source label: {label!r}")
    source_key, page, paragraph, note = match.groups()
    source = SOURCE_MAP[source_key]
    detail_parts = []
    if page:
        detail_parts.append(f"p.{page}")
    if paragraph:
        detail_parts.append(f"¶{paragraph}")
    if note:
        detail_parts.append(note)
    return {
        "range": source["range"],
        "lesson": source["lesson"],
        "title": source["title"],
        "page": page or "",
        "paragraph": paragraph or "",
        "note": note or "",
        "detail": " ".join(detail_parts),
        "label": clean_text(label),
        "slug": source["slug"],
    }


def accepted_answers(english: str) -> list[str]:
    answers = [clean_text(english)]
    if re.search(r"\s+/\s+", english):
        answers = [clean_text(part) for part in re.split(r"\s+/\s+", english)]

    variants: list[str] = []
    for answer in answers:
        variants.append(answer)
        without_ellipsis = re.sub(r"(?:\s*\.{3}|\s*…+|\s*～+)$", "", answer).strip()
        if without_ellipsis and without_ellipsis != answer:
            variants.append(without_ellipsis)

    unique: list[str] = []
    seen: set[str] = set()
    for answer in variants:
        key = answer.casefold()
        if answer and key not in seen:
            seen.add(key)
            unique.append(answer)
    return unique


def classify_type(source_type: str, english: str) -> str:
    if source_type == "単語":
        return "word"
    if source_type == "熟語":
        return "phrase"
    if re.search(r"\b(?:A|B|S|V)\b", english):
        return "structure"
    structural_patterns = (
        r"\bto do\b",
        r"(?:～|\.\.\.)ing\b",
        r"^There (?:is|are)\b",
        r"^It (?:is|was)\b.*\bthat\b",
        r"\bthe (?:comparative|more|less)\b",
    )
    if any(re.search(pattern, english, re.IGNORECASE) for pattern in structural_patterns):
        return "structure"
    return "expression"


def word_matches(text: str) -> list[re.Match[str]]:
    return list(WORD_RE.finditer(text))


def replace_span(text: str, start: int, end: int) -> str:
    return clean_text(f"{text[:start]} ___ {text[end:]}")


def build_preposition_blank(answer: str) -> dict[str, str] | None:
    matches = word_matches(answer)
    eligible: list[re.Match[str]] = []
    for index, match in enumerate(matches):
        token = match.group(0).casefold()
        if token not in PREPOSITIONS:
            continue
        if token == "to" and index + 1 < len(matches):
            next_token = matches[index + 1].group(0).casefold()
            if next_token in {"do", "doing"}:
                continue
        eligible.append(match)
    if not eligible:
        return None
    target = eligible[-1]
    return {
        "prompt": replace_span(answer, target.start(), target.end()),
        "answer": target.group(0),
    }


def build_phrase_blank(answer: str) -> dict[str, str] | None:
    matches = word_matches(answer)
    if len(matches) < 2:
        return None

    placeholder_indexes = {
        index
        for index, match in enumerate(matches)
        if match.group(0).casefold() in PLACEHOLDERS
        and len(match.group(0)) == 1
    }

    if placeholder_indexes:
        segments: list[list[int]] = []
        current: list[int] = []
        for index in range(len(matches)):
            if index in placeholder_indexes:
                if current:
                    segments.append(current)
                    current = []
            else:
                current.append(index)
        if current:
            segments.append(current)
        usable = [segment for segment in segments if segment and segment[0] > 0]
        selected = usable[-1] if usable else segments[-1]
        selected = selected[-2:]
    else:
        selected = list(range(max(1, len(matches) - 2), len(matches)))

    first = matches[selected[0]]
    last = matches[selected[-1]]
    blank_answer = clean_text(answer[first.start() : last.end()])
    if not blank_answer:
        return None
    return {
        "prompt": replace_span(answer, first.start(), last.end()),
        "answer": blank_answer,
    }


def convert(workbook_path: Path) -> list[dict[str, object]]:
    workbook = load_workbook(workbook_path, read_only=True, data_only=True)
    sheet = workbook["全一覧_重要度順"]
    counters: defaultdict[str, int] = defaultdict(int)
    items: list[dict[str, object]] = []

    for order, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=1):
        if not any(value is not None for value in row):
            continue
        importance, english_raw, japanese_raw, source_type_raw, source_raw = row[:5]
        english = clean_text(english_raw)
        japanese = clean_text(japanese_raw)
        source_type = clean_text(source_type_raw)
        sources = [parse_source(part) for part in clean_text(source_raw).split(";")]
        primary = sources[0]
        counters[primary["slug"]] += 1
        item_id = f"{primary['slug']}_{counters[primary['slug']]:03d}"

        answers = accepted_answers(english)
        primary_answer = answers[0]
        item_type = classify_type(source_type, english)
        preposition_blank = build_preposition_blank(primary_answer)
        phrase_blank = (
            build_phrase_blank(primary_answer)
            if item_type in {"phrase", "structure", "expression"}
            else None
        )

        modes = ["en_to_ja_choice", "ja_to_en_choice", "ja_to_en_input"]
        tags = [item_type]
        if item_type == "word" and len(word_matches(primary_answer)) == 1:
            modes.append("spelling_input")
            tags.append("spelling")
        if preposition_blank:
            modes.append("preposition_input")
            tags.append("preposition")
        if phrase_blank:
            modes.append("phrase_blank_input")
            tags.append("blank")

        item: dict[str, object] = {
            "id": item_id,
            "english": english,
            "japanese": japanese,
            "type": item_type,
            "sourceType": source_type,
            "importance": clean_text(importance),
            "range": primary["range"],
            "lesson": primary["lesson"],
            "title": primary["title"],
            "source": clean_text(source_raw),
            "sourceDetail": primary["detail"],
            "sources": [
                {key: value for key, value in source.items() if key != "slug"}
                for source in sources
            ],
            "tags": tags,
            "acceptedAnswers": answers,
            "questionModes": modes,
            "order": order,
        }
        blanks: dict[str, dict[str, str]] = {}
        if preposition_blank:
            blanks["preposition"] = preposition_blank
        if phrase_blank:
            blanks["phrase"] = phrase_blank
        if blanks:
            item["blanks"] = blanks
        items.append(item)

    return items


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    items = convert(args.workbook)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(items)} items to {args.output}")


if __name__ == "__main__":
    main()
