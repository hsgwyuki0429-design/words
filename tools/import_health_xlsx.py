"""Convert the audited 保健 workbook into data/health-items.json."""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from import_xlsx import clean_text, question_sheet_rows, run_workbook_cli  # noqa: E402

SHEET_NAME = "問題集"
HEADERS = ("No.", "問題", "答え", "重要度", "出典", "出題タイプ", "図表・資料")

# The workbook records the textbook page each question comes from; the app
# groups questions by the page spreads it filters and reports on.
PAGE_RANGES = {
    "12": "p.12–13", "13": "p.12–13",
    "14": "p.14–15", "15": "p.14–15",
    "16": "p.16–17", "17": "p.16–17",
    "20": "p.20–21", "21": "p.20–21",
    "24": "p.24–25", "25": "p.24–25",
    "26": "p.26–27", "27": "p.26–27",
    "30": "p.30–31", "31": "p.30–31",
    "34": "p.34–35", "35": "p.34–35",
}

RANGE_ORDER = [
    "p.12–13", "p.14–15", "p.16–17", "p.20–21",
    "p.24–25", "p.26–27", "p.30–31", "p.34–35",
]

KINDS = {"語句": "用語", "図表": "図表", "資料": "資料"}

SOURCE_PATTERN = re.compile(r"^(写真\d+)・p\.(\d+)(.+)$")


def parse_source(label: str) -> tuple[str, str, str]:
    """Split 写真1・p.12図2 into (range, printable source, photo label)."""
    match = SOURCE_PATTERN.match(clean_text(label))
    if not match:
        raise ValueError(f"unreadable source label: {label!r}")
    photo, page, section = match.groups()
    if page not in PAGE_RANGES:
        raise ValueError(f"unknown page in source label: {label!r}")
    return PAGE_RANGES[page], f"p.{page} {section}", photo


def classify_kind(answer: str, question_type: str) -> str:
    if question_type in KINDS:
        return KINDS[question_type]
    return "年号" if re.fullmatch(r"\d{3,4}年", answer) else "数値"


def convert(workbook_path: Path) -> list[dict[str, object]]:
    rows = question_sheet_rows(workbook_path, SHEET_NAME, HEADERS)

    items: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        question = clean_text(row[1])
        answer = clean_text(row[2])
        if not question or not answer:
            continue
        importance = clean_text(row[3]) or "C"
        study_range, source, photo = parse_source(row[4])
        key = (question, answer)
        if key in seen:
            continue
        seen.add(key)

        kind = classify_kind(answer, clean_text(row[5]))
        items.append({
            "id": "",
            "subject": "health",
            "number": 0,
            "importance": importance,
            "english": question,
            "japanese": answer,
            "healthQuestion": question,
            "healthAnswer": answer,
            "type": "health-term",
            "answerFormat": "term",
            "kind": kind,
            "range": study_range,
            "lesson": study_range,
            "title": source,
            "source": source,
            "sourceDetail": source,
            "sources": [{"lesson": study_range, "title": source, "detail": photo}],
            "tags": [kind, "語句"],
            "acceptedAnswers": [answer],
            "questionModes": ["health_recall"],
        })

    items.sort(key=lambda item: RANGE_ORDER.index(item["range"]))
    for number, item in enumerate(items, start=1):
        item["number"] = number
        item["id"] = f"health-{number:04d}"
    return items


def main() -> None:
    run_workbook_cli(convert)


if __name__ == "__main__":
    main()
