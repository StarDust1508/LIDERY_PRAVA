#!/usr/bin/env python3
"""Разбивает единый PDF Приложений на 14 файлов — по одному на приложение.

Зачем: на странице «Документы» у каждого приложения своя строка. Раньше все
14 строк открывали один общий файл — человек искал своё приложение вручную.
Скрипт находит страницу-заголовок «Приложение № N к Положению…» и режет PDF по
границам приложений, проверяя, что все страницы вошли ровно в одну часть.

Запуск: python3 platform/scripts/split-appendices.py [путь к общему PDF]
Результат: platform/public/docs/prilozhenie-01.pdf … prilozhenie-14.pdf
"""

import re
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "platform/public/docs/prilozheniya-lidery-prava-2027.pdf"
OUT_DIR = SOURCE.parent

HEADER = re.compile(r"Приложение\s*№\s*(\d+)\s*к\s*Положению", re.IGNORECASE)


def main() -> None:
    reader = PdfReader(str(SOURCE))
    total = len(reader.pages)
    starts: dict[int, int] = {}
    for index, page in enumerate(reader.pages):
        text = (page.extract_text() or "").replace("\n", " ")
        match = HEADER.search(text)
        if match:
            number = int(match.group(1))
            if 1 <= number <= 14 and number not in starts:
                starts[number] = index

    if sorted(starts) != list(range(1, 15)):
        raise SystemExit(f"не найдены заголовки всех приложений: {sorted(starts)}")

    ordered = sorted(starts.items())
    covered = 0
    for position, (number, start) in enumerate(ordered):
        end = ordered[position + 1][1] if position + 1 < len(ordered) else total
        writer = PdfWriter()
        for page_index in range(start, end):
            writer.add_page(reader.pages[page_index])
        target = OUT_DIR / f"prilozhenie-{number:02d}.pdf"
        with target.open("wb") as handle:
            writer.write(handle)
        covered += end - start
        print(f"  № {number}: страницы {start + 1}–{end} → {target.name} ({target.stat().st_size} байт)")

    if covered != total:
        raise SystemExit(f"страницы потеряны: покрыто {covered} из {total}")
    print(f"готово: {len(ordered)} файлов, {total} страниц")


if __name__ == "__main__":
    main()
