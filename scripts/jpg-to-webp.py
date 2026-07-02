#!/usr/bin/env python3
"""Convert video frame JPGs to WebP and remove originals."""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DIRS = [ROOT / 'video' / 'harry', ROOT / 'video' / 'harry02']
QUALITY = 82


def convert_dir(directory: Path) -> tuple[int, int, int]:
    converted = skipped = failed = 0

    for jpg in sorted(directory.glob('*.jpg')):
        webp = jpg.with_suffix('.webp')
        try:
            if webp.exists() and webp.stat().st_mtime >= jpg.stat().st_mtime:
                jpg.unlink()
                skipped += 1
                continue

            with Image.open(jpg) as img:
                img.save(webp, 'WEBP', quality=QUALITY, method=4)

            jpg.unlink()
            converted += 1
            if converted % 50 == 0:
                print(f'  {directory.name}: {converted} converted...')
        except Exception as exc:
            failed += 1
            print(f'  FAIL {jpg.name}: {exc}')

    return converted, skipped, failed


def main() -> None:
    total = {'converted': 0, 'skipped': 0, 'failed': 0}

    for directory in DIRS:
        if not directory.is_dir():
            print(f'Missing: {directory}')
            continue

        print(f'Converting {directory}...')
        c, s, f = convert_dir(directory)
        total['converted'] += c
        total['skipped'] += s
        total['failed'] += f
        print(f'  done — converted: {c}, skipped: {s}, failed: {f}')

    print(
        f"Total — converted: {total['converted']}, "
        f"skipped: {total['skipped']}, failed: {total['failed']}"
    )


if __name__ == '__main__':
    main()
