#!/usr/bin/env python3
"""Сборка фирменных ассетов из официального логотипа конкурса.

Источник: platform/design/logo-2027-source.jpg — официальный знак Десятого
конкурса (эмблема «10» с Кремлёвской башней, надпись «ЛИДЕРЫ ПРАВА»,
подзаголовок и годы). Скрипт обрезает белые поля, отделяет эмблему от надписи
по пустой строке, делает квадратный знак для шапки и подвала, набор иконок и
картинку для соцсетей 1200×630.

Запуск: python3 platform/scripts/build-logo-assets.py
Кладёт файлы в platform/public/ (каталог публичных ассетов сборки).
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "platform/design/logo-2027-source.jpg"
OUT = ROOT / "platform/public"
ASSETS = OUT / "assets"
WHITE = (255, 255, 255)


def ink_rows(image: Image.Image) -> list[tuple[int, int]]:
    """Для каждой строки — число «чернильных» пикселей."""
    gray = image.convert("L")
    px = gray.load()
    width, height = gray.size
    rows = []
    for y in range(height):
        rows.append(sum(1 for x in range(width) if px[x, y] < 245))
    return rows


def main() -> None:
    image = Image.open(SOURCE).convert("RGB")
    width, height = image.size

    # 1. Белые поля: обрезаем по границам краски.
    gray = image.convert("L")
    bbox = gray.point(lambda value: 255 if value < 245 else 0).getbbox()
    if bbox is None:
        raise SystemExit("на исходнике нет изображения")
    left, top, right, bottom = bbox
    trimmed = image.crop(bbox)

    # 2. Эмблема и надпись: ищем первый пустой разрыв ниже 40 % высоты.
    rows = ink_rows(trimmed)
    gap_start = None
    emblem_bottom = len(rows)
    for index, count in enumerate(rows):
        if index < len(rows) * 0.4:
            continue
        if count == 0 and gap_start is None:
            gap_start = index
        elif gap_start is not None and count > 3:
            # Верх эмблемы — от начала до gap_start; низ надписи — ниже.
            emblem_bottom = gap_start
            break

    emblem = trimmed.crop((0, 0, trimmed.width, emblem_bottom))
    lockup = trimmed

    # 3. Квадратный знак: эмблема по центру на белом поле.
    side = max(emblem.width, emblem.height)
    square = Image.new("RGB", (side, side), WHITE)
    square.paste(emblem, ((side - emblem.width) // 2, (side - emblem.height) // 2))
    square = square.resize((512, 512), Image.LANCZOS)
    ASSETS.mkdir(parents=True, exist_ok=True)
    square.save(ASSETS / "logo.jpg", quality=92, optimize=True)
    square.save(ASSETS / "favicon-512.png", optimize=True)
    square.resize((192, 192), Image.LANCZOS).save(ASSETS / "favicon-192.png", optimize=True)
    square.resize((180, 180), Image.LANCZOS).save(ASSETS / "apple-touch-icon.png", optimize=True)
    square.resize((48, 48), Image.LANCZOS).save(ASSETS / "favicon-48x48.png", optimize=True)
    square.resize((32, 32), Image.LANCZOS).save(ASSETS / "favicon-32x32.png", optimize=True)
    square.resize((16, 16), Image.LANCZOS).save(ASSETS / "favicon-16x16.png", optimize=True)

    # Прозрачная версия для шапки и подвала: страница кремовая, белый квадрат
    # вокруг знака был бы виден как светлое пятно.
    mark = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    emblem_rgba = emblem.convert("RGBA")
    mask = emblem_rgba.convert("L").point(lambda value: 255 if value < 245 else 0)
    emblem_rgba.putalpha(mask)
    mark.paste(emblem_rgba, ((side - emblem.width) // 2, (side - emblem.height) // 2), emblem_rgba)
    mark.resize((256, 256), Image.LANCZOS).save(ASSETS / "logo-mark.png", optimize=True)
    square.resize((48, 48), Image.LANCZOS).save(
        OUT / "favicon.ico",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )

    # 4. Полная композиция: для карточки в соцсетях и крупных блоков.
    lockup_scaled = lockup.copy()
    if lockup_scaled.width > 1200:
        ratio = 1200 / lockup_scaled.width
        lockup_scaled = lockup_scaled.resize((1200, round(lockup_scaled.height * ratio)), Image.LANCZOS)
    lockup_scaled.save(ASSETS / "logo-full.png", optimize=True)

    og = Image.new("RGB", (1200, 630), WHITE)
    target_height = 520
    ratio = target_height / lockup_scaled.height
    og_logo = lockup_scaled.resize((round(lockup_scaled.width * ratio), target_height), Image.LANCZOS)
    og.paste(og_logo, ((1200 - og_logo.width) // 2, (630 - og_logo.height) // 2))
    og.save(OUT / "assets/og-image.png", optimize=True)
    og.save(OUT / "assets/og-image.jpg", quality=90, optimize=True)

    # 5. Иконка в SVG: PNG внутри — браузеры понимают, а векторного исходника нет.
    import base64

    data = base64.b64encode((ASSETS / "favicon-512.png").read_bytes()).decode("ascii")
    (OUT / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">'
        f'<image width="512" height="512" href="data:image/png;base64,{data}"/></svg>',
        encoding="utf-8",
    )

    print("готово:")
    for name in ("assets/logo.jpg", "assets/favicon-512.png", "assets/favicon-192.png", "assets/apple-touch-icon.png", "assets/favicon-32x32.png", "assets/favicon-16x16.png", "assets/logo-full.png", "assets/og-image.png", "favicon.ico", "favicon.svg"):
        path = OUT / name
        print(f"  {name}: {path.stat().st_size} байт")


if __name__ == "__main__":
    main()
