#!/usr/bin/env python3
"""3定（2026.3）公共の問題集（xlsx）を、アプリの公共データ（JSON）へ変換する。

使い方:
    python3 tools/import_public_2026_3.py 問題集20-30.xlsx data/public-2026-3.json

シート「問題集」の列:
    No, 単元, 重要度, 問題, 選択肢A〜D, 正解, 正解語句, 解説, 根拠原文〈抜粋〉, 原文の確認, 出典

2定の公共（data/public-items.json）と同じ形にそろえる。
- 範囲は単元ごとの見開き（p.88–89 など）、題名は単元名（「法と社会規範の役割」）。
- 一問一答（public_recall）と、問題集の選択肢をそのまま使う4択（public_choice）で出題する。
- 解説・選択肢・正解の記号・根拠の抜粋は editorial に入れる（2定と同じ項目名）。
- 「原文の確認」が「要確認」の行は、抜粋が教科書の画像から読み取ったものなので、
  その旨を evidenceNote に書いておく。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from import_public_xlsx import classify_kind  # noqa: E402
from import_xlsx import clean_text, question_sheet_rows, run_workbook_cli  # noqa: E402

SHEET_NAME = "問題集"
HEADERS = (
    "No", "単元", "重要度", "問題", "選択肢A", "選択肢B", "選択肢C", "選択肢D",
    "正解", "正解語句", "解説", "根拠原文〈抜粋〉", "原文の確認", "出典",
)
UNIT_RE = re.compile(r"^(\d+)\s+(.+)$")
PAGE_RE = re.compile(r"p\.(\d+)")
UNCHECKED_NOTE = "抜粋は教科書の画像から読み取ったもので、字句が教科書と少し違うことがあります。"


def unit_ranges(rows: list[tuple]) -> dict[str, str]:
    """単元ごとに、出典にあるいちばん前のページから始まる見開きを範囲にする。"""
    first_pages: dict[str, int] = {}
    for row in rows:
        unit = clean_text(row[1])
        pages = [int(page) for page in PAGE_RE.findall(clean_text(row[13]))]
        if not pages:
            raise ValueError(f"出典にページがありません: No.{row[0]}")
        first_pages[unit] = min(first_pages.get(unit, pages[0]), *pages)
    return {unit: f"p.{page}–{page + 1}" for unit, page in first_pages.items()}


def strip_quote_marks(text: str) -> str:
    return re.sub(r"^「|」$", "", clean_text(text))


def convert(workbook_path: Path) -> list[dict[str, object]]:
    rows = [row for row in question_sheet_rows(workbook_path, SHEET_NAME, HEADERS) if row[0] is not None]
    ranges = unit_ranges(rows)
    items: list[dict[str, object]] = []
    for number, row in enumerate(rows, start=1):
        unit = clean_text(row[1])
        match = UNIT_RE.match(unit)
        if not match:
            raise ValueError(f"単元の書き方が分かりません: {unit!r}")
        unit_number, title = match.groups()
        question = clean_text(row[3])
        answer = clean_text(row[9])
        choices = {key: clean_text(value) for key, value in zip("ABCD", row[4:8])}
        correct = clean_text(row[8])
        if choices.get(correct) != answer:
            raise ValueError(f"No.{row[0]}: 正解の記号と正解語句が合いません")
        source = clean_text(row[13])
        study_range = ranges[unit]
        kind = classify_kind(question, answer, source)
        quote = strip_quote_marks(row[11])
        items.append({
            "id": f"public-20261111-{number:04d}",
            "subject": "public",
            "number": number,
            "importance": clean_text(row[2]) or "C",
            "english": question,
            "japanese": answer,
            "publicQuestion": question,
            "publicAnswer": answer,
            "type": "public-term",
            "answerFormat": "term",
            "kind": kind,
            "range": study_range,
            "lesson": study_range,
            "title": title,
            "source": source,
            "sourceDetail": source,
            "sources": [{"lesson": study_range, "title": title, "detail": source}],
            "tags": [kind, "語句"],
            "acceptedAnswers": [answer],
            "questionModes": ["public_recall", "public_choice"],
            "editorial": {
                "questionNumber": f"問{number:03d}",
                "chapter": title,
                "unit": int(unit_number),
                "choices": choices,
                "correctChoice": correct,
                "explanation": clean_text(row[10]),
                "evidenceQuotes": [quote] if quote else [],
                "evidenceNote": "" if clean_text(row[12]) == "○" else UNCHECKED_NOTE,
            },
        })
    return items


def main() -> None:
    run_workbook_cli(convert)


if __name__ == "__main__":
    main()
