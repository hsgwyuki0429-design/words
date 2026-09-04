"""添付の活用表を、元のセルと監査差分を残した古文マスターへ変換する。"""
import argparse
import json
from pathlib import Path
import openpyxl

FORMS = ["未然形", "連用形", "終止形", "連体形", "已然形", "命令形"]
REFERENCE = "https://www.kotomana-plus.net/dic-appendix/dk5/data/03_%E4%B8%BB%E8%A6%81%E5%8A%A9%E5%8B%95%E8%A9%9E%E6%B4%BB%E7%94%A8%E8%A1%A8.pdf"
IDS = ["ru", "raru", "su", "sasu", "shimu", "zu", "mu", "muzu", "ji", "mashi", "mahoshi", "ki", "keri", "tsu", "nu", "tari-perfect", "ri", "beshi", "maji", "ramu", "kemu", "rashi", "meri", "nari-hearsay", "nari-copula", "tari-copula", "gotoshi", "tashi"]


def convert(path):
    sheet = openpyxl.load_workbook(path, data_only=True)["助動詞活用表"]
    rows = list(sheet.iter_rows(min_row=5, max_row=32, values_only=True))
    items = []
    for row_number, (key, row) in enumerate(zip(IDS, rows), 5):
        connection, label, meanings, kind, *values = row
        base = label.split("（")[0]
        connections = connection.replace("※", "").split("・")
        if "※" in connection:
            connections.append("ラ変型の連体形")
        item = {
            "id": f"kobun:aux:{key}", "subject": "kobun", "category": "auxiliary",
            "base": base, "label": label, "baseAliases": [],
            "connections": connections, "meanings": meanings.split("・"),
            "conjugationType": kind,
            "conjugation": {form: [] if value == "○" else value.split("／") for form, value in zip(FORMS, values)},
            "ranges": ["助動詞基礎"],
            "source": {"file": "古文助動詞_活用表.xlsx", "sheet": sheet.title, "range": f"A{row_number}:J{row_number}", "values": list(row)},
            "audit": [], "notes": [],
        }
        items.append(item)
    by_key = {item["id"].split(":")[-1]: item for item in items}

    def revise(key, field, value, reason, page):
        item = by_key[key]
        target = item
        parts = field.split(".")
        for part in parts[:-1]:
            target = target[part]
        old = target[parts[-1]]
        target[parts[-1]] = value
        item["audit"].append({"field": field, "before": old, "after": value, "reason": reason, "url": REFERENCE, "page": page})

    revise("kemu", "connections", ["連用形"], "過去推量「けむ」は連用形接続。", 2)
    revise("meri", "conjugation.未然形", [], "「めり」に未然形はない。", 2)
    revise("nari-hearsay", "conjugation.未然形", [], "伝聞・推定「なり」に未然形はない。", 2)
    revise("tari-copula", "connections", ["体言"], "断定「たり」は体言接続。", 2)
    revise("tashi", "conjugation.連用形", ["たく", "たかり"], "補助活用の誤記「たり」を「たかり」に訂正。", 1)
    revise("tashi", "conjugation.連体形", ["たき", "たかる"], "補助活用の誤記「たる」を「たかる」に訂正。", 1)
    revise("ki", "connections", ["連用形", "カ変・サ変の未然形"], "カ変・サ変では未然形にも接続する例外を明示。", 1)
    revise("muzu", "meanings", ["推量", "意志", "適当", "勧誘", "仮定", "婉曲"], "主な意味2つだけでなく、「む」と同様の暗記事項を保持。", 1)
    revise("ki", "meanings", ["過去"], "候補名は「過去」に統一し、直接経験の説明は注記へ分離。", 1)
    by_key["ki"]["notes"].append("過去は直接経験・確実な過去。カ変・サ変では未然形に接続する場合もある。")
    for key, alias in [("mu", "ん"), ("muzu", "んず")]:
        by_key[key]["baseAliases"] = [alias]
        by_key[key]["notes"].append(f"基本形「{by_key[key]['base']}」の別表記「{alias}」も基本形入力で受け付ける。活用表は主表記で覚える。")
    for item in items:
        if "ラ変型の連体形" in item["connections"]:
            item["notes"].append("原則は終止形接続。ラ変型の活用語には連体形接続。接続問題では両方選ぶ。")
    return {"schemaVersion": 1, "revision": "2026-09-04.1", "subject": "kobun", "items": items}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    args = parser.parse_args()
    Path(args.output).write_text(json.dumps(convert(args.source), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
