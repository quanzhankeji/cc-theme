#!/usr/bin/env python3
"""Generate the CC Theme cross-platform app icon master.

The artwork is rendered at 4x resolution before downsampling so the transparent
rounded corners remain clean at small Dock, Finder, and shortcut sizes.
"""

from pathlib import Path

from PIL import Image, ImageDraw


APP_ROOT = Path(__file__).resolve().parents[1]
ICONS_DIR = APP_ROOT / "src-tauri" / "icons"
SOURCE = ICONS_DIR / "app-icon-source.png"
OUTPUT = ICONS_DIR / "app-icon-master.png"

SIZE = 1024
SCALE = 4
CANVAS_SIZE = SIZE * SCALE


def render_background() -> Image.Image:
    top = (255, 255, 255, 255)
    bottom = (238, 242, 248, 255)
    strip = Image.new("RGBA", (1, CANVAS_SIZE))
    pixels = strip.load()
    for y in range(CANVAS_SIZE):
        ratio = y / (CANVAS_SIZE - 1)
        pixels[0, y] = tuple(
            round(start + (end - start) * ratio)
            for start, end in zip(top, bottom)
        )

    background = strip.resize((CANVAS_SIZE, CANVAS_SIZE))
    mask = Image.new("L", (CANVAS_SIZE, CANVAS_SIZE), 0)
    draw = ImageDraw.Draw(mask)
    inset = 24 * SCALE
    draw.rounded_rectangle(
        (inset, inset, CANVAS_SIZE - inset - 1, CANVAS_SIZE - inset - 1),
        radius=224 * SCALE,
        fill=255,
    )
    background.putalpha(mask)
    return background


def render_logo() -> Image.Image:
    source = Image.open(SOURCE).convert("RGBA")
    alpha_box = source.getchannel("A").getbbox()
    if alpha_box is None:
        raise ValueError(f"Source artwork has no visible pixels: {SOURCE}")

    logo = source.crop(alpha_box)
    target_extent = 820 * SCALE
    ratio = min(target_extent / logo.width, target_extent / logo.height)
    logo = logo.resize(
        (round(logo.width * ratio), round(logo.height * ratio)),
        Image.Resampling.LANCZOS,
    )
    return logo


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"Missing source artwork: {SOURCE}")

    canvas = render_background()
    logo = render_logo()
    x = (CANVAS_SIZE - logo.width) // 2
    y = (CANVAS_SIZE - logo.height) // 2 - (4 * SCALE)
    canvas.alpha_composite(logo, (x, y))

    master = canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    master.save(OUTPUT, format="PNG", optimize=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
