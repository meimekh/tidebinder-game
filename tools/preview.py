"""Print a coarse text preview of an image so composition can be checked without a viewer.

    python tools/preview.py screenshots/1-play.jpg [cols rows]
"""

from __future__ import annotations

import sys

from PIL import Image

RAMP = " .:-=+*#%@"


def main() -> int:
    path = sys.argv[1]
    cols = int(sys.argv[2]) if len(sys.argv) > 2 else 96
    rows = int(sys.argv[3]) if len(sys.argv) > 3 else 30
    image = Image.open(path).convert("RGB")
    width, height = image.size
    small = image.resize((cols, rows), Image.BOX)

    print(f"{path}  {width}x{height}")
    for y in range(rows):
        line = []
        for x in range(cols):
            r, g, b = small.getpixel((x, y))
            lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
            line.append(RAMP[min(len(RAMP) - 1, int(lum * len(RAMP)))])
        print("".join(line))

    # Palette census: which of the game's own colours are actually on screen.
    pixels = list(image.resize((320, 200), Image.BOX).getdata())

    def share(pred) -> float:
        return round(sum(1 for p in pixels if pred(*p)) / len(pixels), 4)

    print(
        "amber(cargo) ",
        share(lambda r, g, b: r > 150 and g > 90 and b < 110 and r > b + 60),
        "| teal(beams/ring)",
        share(lambda r, g, b: g > 140 and b > 130 and r < g - 30),
        "| coral(wreck/damage)",
        share(lambda r, g, b: r > 120 and r > g + 45 and r > b + 45),
        "| dark(sea)",
        share(lambda r, g, b: r + g + b < 150),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
