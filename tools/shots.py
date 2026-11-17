"""Take the four real browser renders that make up screenshots/.

Each scene is a real page load of game/index.html with ?shot=<name>&seed=1, rendered by a real
Chromium at 1280x720 and screenshotted as-is. Nothing is edited, composited or retouched: the
screenshot is whatever the page painted. The order below is the order the contact sheet reads,
and the file names carry the same order, so 1-play.jpg is the cover — live gameplay, not the
title card.

Beside each frame the script records the page's own snapshot (the simulation state that produced
the frame) and then checks the pixels against that state: the amber cargo the snapshot says is in
tow must be amber in the image, and the rope to each hooked crate must be a bright line where the
renderer draws it. Those checks do not judge composition; they only catch a blank, broken or
mis-staged render.

    python tools/shots.py
"""

from __future__ import annotations

import json
import math
import pathlib
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "screenshots"
SHOTS_FILE = ROOT / "shots.json"
BASE = "http://127.0.0.1:8080"

# The capture order lives in shots.json alone: the list order is the contact-sheet order and the
# first entry is the cover, so the two files can never drift apart. Every entry must name the
# scene its query stages and carry the query itself.
VIEW = {"width": 1280, "height": 720}
QUALITY = 82
MAX_BYTES = 262144
MAX_SIDE = 1280
MIN_SIDE = 480

# Share-of-pixels floors for the live gameplay frames: the tether work has to be on screen.
CENSUS_FLOORS = {
    "play": {"amber": 0.0025, "teal": 0.015, "coral": 0.002},
    "storm": {"amber": 0.0025, "teal": 0.015, "coral": 0.002},
}

# The phase each file name promises: 3-win.jpg may not ship a loss screen, 1-play.jpg may not ship
# a title card.
SCENE_PHASES = {"play": "play", "storm": "play", "start": "title", "end": "win"}


def census(image: Image.Image) -> dict[str, float]:
    """The share of the frame in the game's own colour families (sampled, not eyeballed)."""
    raw = image.convert("RGB").resize((320, 180), Image.BOX).tobytes()
    total = len(raw) // 3

    def share(predicate) -> float:
        hits = 0
        for i in range(0, len(raw), 3):
            if predicate(raw[i], raw[i + 1], raw[i + 2]):
                hits += 1
        return round(hits / total, 4)

    return {
        "amber": share(lambda r, g, b: r > 150 and g > 90 and r > b + 40 and b < 200),
        "teal": share(lambda r, g, b: g > 140 and b > 130 and r < g - 30),
        "coral": share(lambda r, g, b: r > 110 and r > g + 45 and r > b + 45),
        "dark": share(lambda r, g, b: r + g + b < 150),
    }


def amber_pixels(image: Image.Image, x: float, y: float, radius: int = 9) -> int:
    """How many amber-family pixels sit in the box where the crate's top face is drawn."""
    xx = max(0, min(image.width - 1, int(round(x))))
    yy = max(0, min(image.height - 1, int(round(y))))
    box = image.crop((max(0, xx - radius), max(0, yy - radius),
                      min(image.width, xx + radius + 1), min(image.height, yy + radius + 1)))
    raw = box.convert("RGB").tobytes()
    count = 0
    for i in range(0, len(raw), 3):
        r, g, b = raw[i], raw[i + 1], raw[i + 2]
        if r > 140 and g > 80 and r > b + 35 and b < 205:
            count += 1
    return count


def rope_band(image: Image.Image, skiff: dict, crate: dict, half_width: int = 9,
              end_margin: int = 30) -> tuple[int, int]:
    """Bright pixels inside a corridor between the skiff and the crate, away from both hulls.

    drawTethers draws a sagging rope between the two, so every pixel of the rope lies within a
    few pixels of the straight segment. Counting bright pixels in that corridor (skipping the
    ends, where the skiff and the crate themselves are painted) says whether the tow connection
    is really on screen — and says nothing about where exactly the curve sags.
    """
    ax, ay = float(skiff["x"]), float(skiff["y"])
    bx, by = float(crate["x"]), float(crate["y"])
    length = math.hypot(bx - ax, by - ay)
    if length < 1:
        return 0, 0
    ux, uy = (bx - ax) / length, (by - ay) / length
    left = max(0, int(min(ax, bx) - half_width - 1))
    right = min(image.width, int(max(ax, bx) + half_width + 2))
    top = max(0, int(min(ay, by) - half_width - 1))
    bottom = min(image.height, int(max(ay, by) + half_width + 2))
    box = image.crop((left, top, right, bottom))
    raw = box.convert("RGB").tobytes()
    width = box.width
    bright = 0
    peak = 0
    for index in range(0, len(raw), 3):
        pixel = index // 3
        x = left + pixel % width + 0.5
        y = top + pixel // width + 0.5
        along = (x - ax) * ux + (y - ay) * uy
        if along < end_margin or along > length - end_margin:
            continue
        across = abs((x - ax) * uy - (y - ay) * ux)
        if across > half_width:
            continue
        r, g, b = raw[index], raw[index + 1], raw[index + 2]
        lum = int(0.2126 * r + 0.7152 * g + 0.0722 * b)
        if lum > peak:
            peak = lum
        if lum > 150:
            bright += 1
    return bright, peak


def frame_checks(scene: str, image: Image.Image, snapshot: dict) -> tuple[list[str], dict]:
    """Check the painted frame against the state the page reports for it."""
    failures: list[str] = []
    detail: dict = {}
    counts = census(image)
    detail["census"] = counts
    floors = CENSUS_FLOORS.get(scene)
    if floors:
        for family, floor in floors.items():
            detail[f"{family}_floor"] = floor
            if counts[family] < floor:
                failures.append(f"{scene}: only {counts[family]:.4f} {family} pixels, floor {floor}")

    skiff = snapshot["skiff"]
    hooked = [crate for crate in snapshot["salvage"] if crate["hooked"]]
    detail["hooked"] = len(hooked)
    if scene in ("play", "storm") and not hooked:
        failures.append(f"{scene}: no cargo in tow, so the tether cannot be checked")

    ropes = []
    for crate in hooked:
        bright, peak = rope_band(image, skiff, crate)
        crate_amber = amber_pixels(image, crate["x"], crate["y"] - 16, 12)
        ropes.append({
            "rope_bright_pixels": bright,
            "rope_peak_luminance": peak,
            "crate_amber_pixels": crate_amber,
            "at": [round(crate["x"]), round(crate["y"])],
        })
        if bright < 40:
            failures.append(f"{scene}: the rope to the crate at {round(crate['x'])},{round(crate['y'])} "
                            f"has only {bright} bright pixels along its corridor (peak {peak})")
        if crate_amber < 12:
            failures.append(f"{scene}: crate at {round(crate['x'])},{round(crate['y'])} has only "
                            f"{crate_amber} amber pixels where it is drawn")
    detail["ropes"] = ropes
    return failures, detail


def load_scenes() -> list[tuple[str, str]]:
    """The (scene, file) pairs in shots.json, in the order the contact sheet reads them."""
    entries = json.loads(SHOTS_FILE.read_text(encoding="utf-8"))
    if not 3 <= len(entries) <= 4:
        raise SystemExit(f"shots.json lists {len(entries)} screenshots; the kit allows 3 or 4")
    scenes = []
    for entry in entries:
        name = entry["name"]
        scene = entry["scene"]
        query = entry["query"]
        if not query.startswith(f"?shot={scene}"):
            raise SystemExit(f"shots.json: {name} says scene {scene!r} but its query is {query!r}")
        if not name.lower().endswith((".jpg", ".jpeg", ".png")):
            raise SystemExit(f"shots.json: {name} is not a JPEG or PNG")
        scenes.append((scene, name))
    return scenes


def main() -> int:
    scenes = load_scenes()
    OUT.mkdir(exist_ok=True)
    for stale in OUT.iterdir():
        if stale.is_file():
            stale.unlink()
    failures: list[str] = []
    report = {}

    with sync_playwright() as play:
        browser = play.chromium.launch(headless=True, args=["--force-device-scale-factor=1"])
        context = browser.new_context(viewport=VIEW, device_scale_factor=1)
        for scene, name in scenes:
            page = context.new_page()
            errors: list[str] = []
            requests: list[str] = []
            page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
            page.on(
                "console",
                lambda msg: errors.append(f"console.{msg.type}: {msg.text}")
                if msg.type == "error"
                else None,
            )
            page.on("request", lambda req: requests.append(req.url))

            url = f"{BASE}/?shot={scene}&seed=1"
            page.goto(url, wait_until="load")
            page.wait_for_function("window.__shotReady === true", timeout=30000)
            snapshot = page.evaluate("window.__gameTest.snapshot()")
            target = OUT / name
            page.screenshot(path=str(target), type="jpeg", quality=QUALITY, full_page=False)
            size = target.stat().st_size
            width, height = page.evaluate(
                "() => { const c = document.getElementById('game');"
                " return [c.width, c.height]; }"
            )
            image = Image.open(target)
            image.load()
            check_failures, check_detail = frame_checks(scene, image, snapshot)
            failures.extend(check_failures)
            report[scene] = {
                "url": url,
                "file": name,
                "bytes": size,
                "image": [image.width, image.height],
                "canvas": [width, height],
                "stage": snapshot.get("stage"),
                "snapshot": {
                    k: snapshot[k]
                    for k in ("phase", "wave", "score", "hull", "delivered", "target",
                              "totalDelivered", "combo", "hooks", "hits", "cleared", "shot")
                },
                "checks": check_detail,
                "pageerrors": errors,
                "requests": [r for r in requests if not r.startswith(BASE)],
            }
            print(
                f"{name:13} <- shot={scene:5}  {size:6} bytes  {image.width}x{image.height}  "
                f"phase={snapshot['phase']} wave={snapshot['wave']} "
                f"score={snapshot['score']} hull={snapshot['hull']} "
                f"{snapshot['delivered']}/{snapshot['target']} chain x{snapshot['combo']} "
                f"hooks={snapshot['hooks']} hits={snapshot['hits']}  "
                f"amber={check_detail['census']['amber']:.4f} teal={check_detail['census']['teal']:.4f} "
                f"coral={check_detail['census']['coral']:.4f} dark={check_detail['census']['dark']:.4f}"
            )
            if expected_phase := SCENE_PHASES.get(scene):
                if snapshot["phase"] != expected_phase:
                    failures.append(f"{name}: shot={scene} staged phase={snapshot['phase']}, "
                                    f"but the file name promises {expected_phase}")
            if size > MAX_BYTES:
                failures.append(f"{name}: {size} bytes over the 256 KiB cap")
            if max(image.width, image.height) > MAX_SIDE:
                failures.append(f"{name}: long side {max(image.width, image.height)} over {MAX_SIDE}")
            if min(image.width, image.height) < MIN_SIDE:
                failures.append(f"{name}: short side {min(image.width, image.height)} under {MIN_SIDE}")
            if (width, height) != (VIEW["width"], VIEW["height"]):
                failures.append(f"{name}: canvas is {width}x{height}, want {VIEW['width']}x{VIEW['height']}")
            if errors:
                failures.append(f"{name}: {errors}")
            if report[scene]["requests"]:
                failures.append(f"{name}: network requests {report[scene]['requests']}")
            page.close()
        context.close()
        browser.close()

    (ROOT / "tools" / "shots-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({scene: report[scene]["checks"] for scene in report}, indent=2))
    if failures:
        print("\nFAILURES:")
        for failure in failures:
            print(" -", failure)
        return 1
    print(f"\nall {len(scenes)} screenshots are real, sized, error-free, and paint the tow they report")
    return 0


if __name__ == "__main__":
    sys.exit(main())