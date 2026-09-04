"""古文単語の重要語句一覧（Markdown）を、フラッシュカード用の教材JSONへ変換する。

表の「本文中の短い用例」を表面に、「本文中での意味」「覚えるべきポイント」「範囲」を
裏面に置く。用例のうち語句にあたる部分へ下線を引けるよう、あらかじめ本文を
「下線あり／なし」の区間へ切り分け、読みは漢字のかたまりごとに振り分けて保存する。
"""
import argparse
import json
import re
from pathlib import Path

# 見出しの並び順がそのまま範囲の並び順になる。範囲名は一覧に収まる短い表記を使い、
# 作品の正式な呼び名は work（カードの裏面に出す範囲）へ残す。
RANGE_LABELS = [
    "伊勢物語 芥川",
    "伊勢物語 東下り",
    "伊勢物語 筒井筒",
    "徒然草 丹波に出雲",
    "徒然草 花は盛りに",
    "羅生門",
    "今昔物語集 羅城門",
]

HIRAGANA = re.compile(r"^[ぁ-ゖー゛゜]$")
# 読点や鉤括弧は読みにもそのまま現れるので、ひらがなと同じ「手がかり」として扱う。
PUNCTUATION = set("、。，．・「」『』（）()〜～！？　 ")
SPLIT_MARK = re.compile(r"[／/]")
# 用例・語句の中で「省略」を表す記号。ここで区切ると本文と照合できる。
ELLIPSIS = re.compile(r"[…‥]+|\.\.\.")


def clean(value):
    """セルの強調記号と余分な空白を落とす。"""
    return value.replace("**", "").strip()


def parse_tables(text):
    """作品ごとの「重要語句一覧」表を読み取る。"""
    work = None
    section = None
    works = []
    for line in text.split("\n"):
        if re.match(r"^# \d+．", line):
            work = re.sub(r"^# \d+．", "", line).strip()
            section = None
            works.append({"work": work, "rows": []})
        elif line.startswith("## "):
            section = line[3:].strip()
        elif line.startswith("|") and works and section == "重要語句一覧":
            cells = [clean(cell) for cell in line.strip().strip("|").split("|")]
            if set("".join(cells)) <= set("-: ") or cells[0] == "重要度":
                continue
            if len(cells) != 7:
                raise ValueError(f"列数が7ではありません: {line}")
            works[-1]["rows"].append(cells)
    return [entry for entry in works if entry["rows"]]


def is_kana(character):
    """ふりがなの要らない文字（ひらがな・記号）かどうか。"""
    return bool(HIRAGANA.match(character)) or character in PUNCTUATION


def split_runs(term):
    """語句を「ひらがな」と「それ以外（漢字・カタカナ・欧字）」の連なりへ分ける。"""
    runs = []
    for character in term:
        kana = is_kana(character)
        if runs and runs[-1][0] == kana:
            runs[-1][1] += character
        else:
            runs.append([kana, character])
    return [(kana, text) for kana, text in runs]


def align_reading(term, reading):
    """読みを漢字のかたまりごとに割り当てる。割り当てられないときは None。

    ひらがなの部分を手がかりにして読みを切り出す。送り仮名の表記が読みと
    ずれている教材もあるため、少しでも合わなければ諦めて None を返す。
    """
    runs = split_runs(term)
    if not any(not kana for kana, _ in runs):
        return None
    parts = []
    cursor = 0
    for index, (kana, text) in enumerate(runs):
        if kana:
            if reading[cursor:cursor + len(text)] != text:
                return None
            parts.append({"text": text, "reading": None})
            cursor += len(text)
            continue
        following = runs[index + 1][1] if index + 1 < len(runs) else ""
        if not following:
            if cursor >= len(reading):
                return None
            parts.append({"text": text, "reading": reading[cursor:]})
            cursor = len(reading)
            continue
        found = reading.find(following, cursor + 1)
        if found < 0:
            return None
        parts.append({"text": text, "reading": reading[cursor:found]})
        cursor = found
    if cursor != len(reading):
        return None
    return parts


def reading_map(term, reading):
    """語句の文字位置ごとの読みを返す。ふりがなが不要・不能なら空の対応表。"""
    if not reading or reading == "—" or "〜" in reading or "～" in reading:
        return []
    # 語句が1つなのに読みが「／」で分かれている行は、語ごとの読みを並べた注記なので
    # ふりがなには使えない。
    if SPLIT_MARK.search(reading) and not SPLIT_MARK.search(term):
        return []
    normalized = reading.replace(" ", "").replace("　", "")
    if normalized == term:
        return []
    parts = align_reading(term, normalized)
    if parts is None:
        # 読みが末尾の句点などを省いている場合は、その分を外してもう一度合わせる。
        body = term.rstrip("。、．「」『』（）()")
        if body and body != term:
            parts = align_reading(body, normalized)
    if parts is None:
        # かたまりごとに割り当てられないときは、語句全体へまとめてふりがなを振る。
        # ただし漢字と送り仮名が混ざった語句は、読みが一部だけを指していることが
        # あるため（「三河の国」＝「みかは」）ふりがなを付けない。
        kinds = {kana for kana, _ in split_runs(term)}
        return [{"start": 0, "end": len(term), "reading": normalized}] if len(kinds) == 1 else []
    spans = []
    cursor = 0
    for part in parts:
        end = cursor + len(part["text"])
        spans.append({"start": cursor, "end": end, "reading": part["reading"]})
        cursor = end
    return spans


def term_alternatives(term):
    """「／」で並記された語句を1つずつに分ける。"""
    return [value.strip() for value in SPLIT_MARK.split(term) if value.strip()]


def reading_alternatives(term, reading):
    alternatives = term_alternatives(term)
    readings = [value.strip() for value in SPLIT_MARK.split(reading)] if reading else []
    if len(alternatives) == len(readings) > 1:
        return dict(zip(alternatives, readings))
    return {alternative: reading for alternative in alternatives}


def longest_common_substring(term, line, minimum=2):
    best = ""
    for start in range(len(term)):
        for end in range(len(term), start + len(best), -1):
            candidate = term[start:end]
            if len(candidate) >= max(minimum, len(best) + 1) and candidate in line:
                best = candidate
                break
    return best


def find_spans(line, alternative):
    """用例の中で下線を引く範囲を [(用例の開始, 終了, 語句側の開始)] で返す。"""
    position = line.find(alternative)
    if position >= 0:
        return [(position, position + len(alternative), 0)]

    # 「なむ〜ける」「衣と…髪とを奪ひ取りて」のように省略記号を挟む語句。
    fragments = [
        fragment for fragment in ELLIPSIS.split(re.sub(r"[〜～]", "…", alternative))
        if len(fragment.strip("（）()")) >= 2
    ]
    if len(fragments) > 1:
        spans = []
        cursor = 0
        offset = 0
        for fragment in fragments:
            body = fragment.strip("（）()")
            found = line.find(body, cursor)
            if found < 0:
                spans = []
                break
            spans.append((found, found + len(body), alternative.find(body)))
            cursor = found + len(body)
            offset = found
        if spans:
            return spans

    # 「この男を（思ふ）」「今は昔（今昔）」のような補足付きの語句。
    trimmed = re.sub(r"[（(][^）)]*[）)]", "", alternative).strip()
    if trimmed and trimmed != alternative:
        position = line.find(trimmed)
        if position >= 0:
            return [(position, position + len(trimmed), alternative.find(trimmed))]

    # 和歌のように用例が語句の一部だけを引いている場合は、用例側を丸ごと下線にする。
    body = ELLIPSIS.sub("", line).strip()
    if len(body) >= 4 and body in alternative:
        start = line.find(body)
        return [(start, start + len(body), alternative.find(body))]

    # 表記の差（丹塗り／丹塗、ある勇気／勇気）は、一致する最長の部分だけ下線にする。
    common = longest_common_substring(alternative, line)
    if common:
        position = line.find(common)
        return [(position, position + len(common), alternative.find(common))]
    return []


def build_parts(line, spans, alternative, readings):
    """用例を、下線とふりがなの情報を持った区間の並びへ変換する。"""
    parts = []
    cursor = 0
    for start, end, term_start in sorted(spans):
        if start > cursor:
            parts.append({"text": line[cursor:start], "mark": False})
        marked = line[start:end]
        if term_start < 0 or not readings:
            parts.append({"text": marked, "mark": True})
        else:
            inner = 0
            for span in readings:
                # 語句側の位置を、下線を引く範囲の中の位置へ読み替える。
                left = max(span["start"] - term_start, 0)
                right = min(span["end"] - term_start, len(marked))
                if right <= left:
                    continue
                partial = span["end"] - span["start"] != right - left
                if left > inner:
                    parts.append({"text": marked[inner:left], "mark": True})
                part = {"text": marked[left:right], "mark": True}
                if span["reading"] and not partial:
                    part["reading"] = span["reading"]
                parts.append(part)
                inner = right
            if inner < len(marked):
                parts.append({"text": marked[inner:], "mark": True})
        cursor = end
    if cursor < len(line):
        parts.append({"text": line[cursor:], "mark": False})
    return parts or [{"text": line, "mark": False}]


def build_lines(term, reading, example):
    """用例（「／」で並記されることがある）ごとに、下線付きの区間を作る。"""
    readings_by_alternative = reading_alternatives(term, reading)
    lines = []
    matched = False
    for line in [value.strip() for value in SPLIT_MARK.split(example) if value.strip()]:
        best = []
        for alternative, alternative_reading in readings_by_alternative.items():
            spans = find_spans(line, alternative)
            if not spans:
                continue
            candidate = build_parts(
                line, spans, alternative, reading_map(alternative, alternative_reading),
            )
            if not best or sum(len(part["text"]) for part in candidate if part["mark"]) > \
                    sum(len(part["text"]) for part in best if part["mark"]):
                best = candidate
        if best:
            matched = True
        lines.append({"parts": best or [{"text": line, "mark": False}]})
    return lines, matched


def convert(source):
    text = Path(source).read_text(encoding="utf-8")
    works = parse_tables(text)
    if len(works) != len(RANGE_LABELS):
        raise ValueError(f"作品数が想定と違います: {len(works)}")
    items = []
    number = 0
    for range_label, entry in zip(RANGE_LABELS, works):
        for importance, term, reading, meaning, point, example, formats in entry["rows"]:
            number += 1
            reading_value = "" if reading in {"—", "―", "-"} else reading
            lines, matched = build_lines(term, reading_value, example)
            format_list = [value.strip() for value in formats.replace("／", "・").split("・") if value.strip()]
            items.append({
                "id": f"kobun:vocab:{number:04d}",
                "subject": "kobun-vocab",
                "category": "vocabulary",
                "number": number,
                "importance": importance,
                # 教材に難易度の指定がないため、並び替えの難易度順からは外している。
                "difficulty": "—",
                "headword": term,
                "reading": reading_value,
                "meanings": [meaning],
                # 一覧の検索と自己採点カードは、既存教科と同じ項目名で読む。
                "english": example,
                "japanese": meaning,
                "recallQuestion": example,
                "recallAnswer": meaning,
                "term": term,
                "example": example,
                "exampleLines": lines,
                "termMarked": matched,
                "point": point,
                "formats": format_list,
                "work": entry["work"],
                "type": "kobun-vocab-term",
                "answerFormat": "term",
                "kind": "重要語句",
                "range": range_label,
                "lesson": range_label,
                "title": entry["work"],
                "source": entry["work"],
                "sourceDetail": f"{entry['work']}／{'・'.join(format_list)}" if format_list else entry["work"],
                "sources": [{"lesson": range_label, "title": entry["work"], "detail": "・".join(format_list)}],
                "tags": ["重要語句", *format_list],
                "acceptedAnswers": [meaning],
                "questionModes": ["kobun-vocab_recall"],
            })
    return items


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="重要語句一覧のMarkdown")
    parser.add_argument("output", help="書き出す教材JSON")
    arguments = parser.parse_args()
    items = convert(arguments.source)
    Path(arguments.output).write_text(
        json.dumps({
            "schemaVersion": 2,
            "subject": "kobun-vocab",
            "category": "vocabulary",
            "items": items,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    unmatched = [item["id"] for item in items if not item["termMarked"]]
    print(f"{len(items)}語句を書き出しました。下線を引けなかった語句: {len(unmatched)}")
    for item in items:
        if not item["termMarked"]:
            print(f"  {item['id']} {item['term']} / {item['example']}")


if __name__ == "__main__":
    main()
