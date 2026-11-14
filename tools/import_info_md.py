#!/usr/bin/env python3
"""3定（2026.3）情報Ⅰの一問一答問題集（Markdown）を、アプリの情報データ（JSON）へ変換する。

使い方:
    python3 tools/import_info_md.py 第1章.md 第2章3章.md data/info-2026-3.json

問題集の書き方（1問ぶん）:
    ## 01 情報とその特性（教科書p.4〜5）
    ### Q001【S】
    **問題**：……を何というか。
    A. データ　B. 情報　C. メディア　D. コンテンツ   ← 無い問題はフラッシュカード専用
    **正解**：B. 情報
    **解説**：……
    **根拠原文〈抜粋〉**：「……」「……」
    **出典**：教科書p.4、本文上部「情報とは何か」

3定の公共（data/public-2026-3.json）と同じ形にそろえる。
- 範囲は章ごとにまとめる（Theory 01〜11＝第1章、21〜25＝第2章、40〜52＝第3章）。
  複数のファイルに分かれていても、章でまとめて1つにする。
- 一問一答（info_recall）と、問題集の選択肢をそのまま使う4択（info_choice）で出題する。
  選択肢の無い問題（フラッシュカード専用）は一問一答だけで出す。
- 解説・選択肢・正解の記号・根拠の抜粋は editorial に入れる（公共と同じ項目名）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Theory の番号から章を決める。題名は問題集の「収録Theory」の書き方に合わせる。
CHAPTERS = (
    (range(1, 21), "第1章 情報社会"),
    (range(21, 40), "第2章 メディアとデザイン"),
    (range(40, 60), "第3章 ネットワークとデータの活用"),
)

THEORY_RE = re.compile(r"^## (\d{2}) (.+?)（教科書(p\.[\d〜]+)）\s*$")
QUESTION_RE = re.compile(r"^### Q(\d{3})【([SABCD])】\s*$")
FIELD_RE = re.compile(r"^\*\*(問題|正解|解説|根拠原文〈抜粋〉|出典)\*\*：(.*)$")
CHOICE_RE = re.compile(r"([A-D])\. (.*?)(?=　+[A-D]\. |$)")
ANSWER_RE = re.compile(r"^([A-D])\. (.+)$")


def chapter_for(theory: int) -> str:
    for numbers, title in CHAPTERS:
        if theory in numbers:
            return title
    raise ValueError(f"章が決まっていない Theory です: {theory}")


def plain(text: str) -> str:
    """Markdown の太字の印を外し、前後の空白を落とす。"""
    return re.sub(r"\*\*", "", text).strip()


def split_quotes(text: str) -> list[str]:
    """「…」「…」のように並んだ抜粋を、いちばん外側のかぎかっこごとに分ける。"""
    quotes: list[str] = []
    depth = 0
    current = ""
    for char in text:
        if char == "「":
            if depth:
                current += char
            depth += 1
        elif char == "」" and depth:
            depth -= 1
            if depth:
                current += char
            else:
                quotes.append(current.strip())
                current = ""
        elif depth:
            current += char
    if depth or not quotes:
        return [plain(text)]
    return [quote for quote in (plain(q) for q in quotes) if quote]


def parse(path: Path) -> list[dict[str, object]]:
    questions: list[dict[str, object]] = []
    theory: tuple[int, str, str] | None = None
    current: dict[str, object] | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.rstrip()
        if line.startswith("## "):
            match = THEORY_RE.match(line)
            # 「網羅確認メモ」などの見出しから先は問題ではない。
            theory = (int(match.group(1)), match.group(2), match.group(3)) if match else None
            current = None
            continue
        match = QUESTION_RE.match(line)
        if match:
            if theory is None:
                raise ValueError(f"{path.name}: Theory の外に問題があります: {line}")
            current = {"number": int(match.group(1)), "importance": match.group(2), "theory": theory}
            questions.append(current)
            continue
        if current is None:
            continue
        match = FIELD_RE.match(line)
        if match:
            current[match.group(1)] = match.group(2).strip()
            continue
        if line.startswith("A. ") and "問題" in current and "正解" not in current:
            choices = dict(CHOICE_RE.findall(line))
            if sorted(choices) != ["A", "B", "C", "D"]:
                raise ValueError(f"{path.name}: Q{current['number']:03d} の選択肢が読めません: {line}")
            current["choices"] = {key: plain(value) for key, value in sorted(choices.items())}
    return questions


def convert(paths: list[Path]) -> list[dict[str, object]]:
    questions = [question for path in paths for question in parse(path)]
    questions.sort(key=lambda question: question["number"])
    numbers = [question["number"] for question in questions]
    if len(set(numbers)) != len(numbers):
        raise ValueError("問題番号が重なっています")
    items: list[dict[str, object]] = []
    for question in questions:
        number = question["number"]
        label = f"Q{number:03d}"
        for field in ("問題", "正解", "解説", "根拠原文〈抜粋〉", "出典"):
            if not question.get(field):
                raise ValueError(f"{label}: {field}がありません")
        theory_number, theory_title, theory_pages = question["theory"]
        chapter = chapter_for(theory_number)
        choices = question.get("choices")
        answer_text = plain(str(question["正解"]))
        correct_choice = ""
        if choices:
            match = ANSWER_RE.match(answer_text)
            if not match or choices.get(match.group(1)) != plain(match.group(2)):
                raise ValueError(f"{label}: 正解が選択肢と合いません: {answer_text}")
            correct_choice = match.group(1)
            answer = choices[correct_choice]
        else:
            answer = answer_text
        prompt = plain(str(question["問題"]))
        source = f"{plain(str(question['出典']))}（Theory {theory_number:02d} {theory_title}）"
        editorial: dict[str, object] = {
            "questionNumber": label,
            "chapter": chapter,
            "theory": theory_number,
            "theoryTitle": theory_title,
            "theoryPages": theory_pages.replace("〜", "–"),
            "explanation": plain(str(question["解説"])),
            "evidenceQuotes": split_quotes(str(question["根拠原文〈抜粋〉"])),
            "evidenceNote": "",
        }
        if choices:
            editorial = {**editorial, "choices": choices, "correctChoice": correct_choice}
        items.append({
            "id": f"info-20261114-{number:04d}",
            "subject": "info",
            "number": number,
            "importance": question["importance"],
            "english": prompt,
            "japanese": answer,
            "infoQuestion": prompt,
            "infoAnswer": answer,
            "type": "info-term",
            "answerFormat": "term",
            "kind": "用語",
            "range": chapter,
            "lesson": chapter,
            "title": chapter,
            "source": source,
            "sourceDetail": source,
            "sources": [{"lesson": chapter, "title": chapter, "detail": source}],
            "tags": ["用語", "語句"],
            "acceptedAnswers": [answer],
            "questionModes": ["info_recall", "info_choice"] if choices else ["info_recall"],
            "editorial": editorial,
        })
    return items


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("sources", nargs="+", type=Path, help="問題集のMarkdown（いくつでも）")
    parser.add_argument("output", type=Path, help="書き出すJSON")
    args = parser.parse_args()
    items = convert(args.sources)
    args.output.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    counts: dict[str, int] = {}
    for item in items:
        counts[item["range"]] = counts.get(item["range"], 0) + 1
    print(f"{len(items)}問を書き出しました", file=sys.stderr)
    for chapter, count in counts.items():
        print(f"  {chapter}: {count}問", file=sys.stderr)


if __name__ == "__main__":
    main()
