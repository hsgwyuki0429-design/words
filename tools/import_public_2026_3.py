#!/usr/bin/env python3
"""3定（2026.3）公共の問題集（xlsx）を、アプリの公共データ（JSON）へ変換する。

使い方:
    python3 tools/import_public_2026_3.py 問題集20-30.xlsx data/public-2026-3.json --choice-pdf 四択問題集20-30.pdf

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

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from import_public_xlsx import classify_kind  # noqa: E402
from import_xlsx import clean_text, question_sheet_rows  # noqa: E402

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


# ---------------------------------------------------------------------------
# 四択問題集（PDF）：「次の記述のうち、正しいものを一つ選べ」型の正誤問題。
# 選択肢が文になっているので一問一答には向かず、4択（public_choice）だけで出題する。
# ---------------------------------------------------------------------------

PDF_HEADER_RE = re.compile(r"^(公共 定期テスト対策 四択問題集.*|Page \d+ of \d+|​?Nov \d+, \d{4}|·|教科書p\..*全\d+問|30）)$")
PDF_LABEL_RE = re.compile(r"^[①②③④⑤⑥]?\s*(問題文|選択肢の正誤|選択肢|正解：|重要度：|出典：)(.*)$")
PDF_UNIT_RE = re.compile(r"^単元(\d+)\s+(.+)$")


def pdf_lines(pdf_path: Path) -> list[str]:
    """PDFを文字にして、ページの見出し・ページ番号と、ページ送りでちぎれた丸数字・記号を除く。"""
    text = subprocess.run(["pdftotext", str(pdf_path), "-"], check=True, capture_output=True, text=True).stdout
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or PDF_HEADER_RE.match(line) or re.fullmatch(r"[①②③④⑤⑥A-D]", line):
            continue
        lines.append(line)
    return lines


def parse_choice_pdf(pdf_path: Path) -> list[dict[str, object]]:
    questions: list[dict[str, object]] = []
    unit = None
    current: dict[str, object] | None = None
    section = None
    for line in pdf_lines(pdf_path):
        unit_match = PDF_UNIT_RE.match(line)
        if unit_match:
            unit = (int(unit_match.group(1)), clean_text(unit_match.group(2)))
            continue
        if re.fullmatch(r"問\d{3}", line):
            current = {"label": line, "unit": unit, "question": "", "choices": {}, "verdicts": {}, "importance": "", "source": "", "correct": ""}
            questions.append(current)
            section = None
            continue
        if current is None:
            continue
        # ページ送りで「A：×。」の「A」と「×」だけが後ろへずれて「A ×」の行になることがある。
        displaced = re.fullmatch(r"([A-D])\s*([○×])", line)
        if displaced:
            current.setdefault("marks", {})[displaced.group(1)] = displaced.group(2)
            continue
        label = PDF_LABEL_RE.match(line)
        if label:
            name, rest = label.group(1), label.group(2).strip()
            section = {"問題文": "question", "選択肢": "choices", "選択肢の正誤": "verdicts",
                       "正解：": "correct", "重要度：": "importance", "出典：": "source"}[name]
            if section in {"correct", "importance", "source"}:
                current[section] = rest
            continue
        if section == "question":
            current["question"] += line
        elif section in {"choices", "verdicts"}:
            target = current[section]
            separator = "．" if section == "choices" else "："
            start = re.match(rf"^([A-D])?\s*{separator}\s*(.*)$", line)
            if start:
                # ページ送りで行頭の記号だけがちぎれたときは、次の記号として扱う。
                letter = start.group(1) or "ABCD"[len(target)]
                target[letter] = start.group(2)
            elif target:
                target[list(target)[-1]] += line
        elif section == "source":
            current["source"] += line
    for question in questions:
        for letter, mark in question.pop("marks", {}).items():
            text = question["verdicts"].get(letter, "")
            if not text.startswith(("○", "×")):
                question["verdicts"][letter] = mark + text
        for letter, text in question["verdicts"].items():
            if not re.match(r"^[○×]。", text):
                raise ValueError(f"{question['label']}: {letter} の正誤（○×）を読み取れませんでした")
        if sorted(question["choices"]) != list("ABCD") or question["correct"] not in "ABCD" or not question["correct"]:
            raise ValueError(f"{question['label']}: 選択肢か正解を読み取れませんでした")
        if not question["importance"] or not question["source"] or not question["unit"]:
            raise ValueError(f"{question['label']}: 重要度・出典・単元を読み取れませんでした")
    return questions


def convert_choice_pdf(pdf_path: Path, ranges_by_title: dict[str, str], start_number: int) -> list[dict[str, object]]:
    items = []
    for offset, question in enumerate(parse_choice_pdf(pdf_path)):
        number = start_number + offset
        unit_number, title = question["unit"]
        study_range = ranges_by_title[title]
        choices = {key: clean_text(value) for key, value in question["choices"].items()}
        correct = question["correct"]
        verdicts = [f"{key}：{clean_text(value)}" for key, value in sorted(question["verdicts"].items())]
        source = clean_text(question["source"])
        items.append({
            "id": f"public-20261111-{number:04d}",
            "subject": "public",
            "number": number,
            "importance": question["importance"],
            "english": question["question"],
            "japanese": choices[correct],
            "publicQuestion": question["question"],
            "publicAnswer": choices[correct],
            "type": "public-statement",
            "answerFormat": "statement",
            "kind": "正誤",
            "range": study_range,
            "lesson": study_range,
            "title": title,
            "source": source,
            "sourceDetail": source,
            "sources": [{"lesson": study_range, "title": title, "detail": source}],
            "tags": ["正誤", "四択"],
            "acceptedAnswers": [choices[correct]],
            "questionModes": ["public_choice"],
            "editorial": {
                "questionNumber": f"問{number:03d}",
                "chapter": title,
                "unit": unit_number,
                "choices": choices,
                "correctChoice": correct,
                "explanation": "\n".join(verdicts),
                "evidenceQuotes": [],
                "evidenceNote": "",
            },
        })
    return items


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path, help="一問一答の問題集（xlsx）")
    parser.add_argument("output", type=Path)
    parser.add_argument("--choice-pdf", type=Path, help="正誤を選ぶ四択問題集（PDF）")
    args = parser.parse_args()
    items = convert(args.workbook)
    if args.choice_pdf:
        ranges_by_title = {item["title"]: item["range"] for item in items}
        items += convert_choice_pdf(args.choice_pdf, ranges_by_title, len(items) + 1)
    args.output.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(items)}問を {args.output} に書き出しました")


if __name__ == "__main__":
    main()
