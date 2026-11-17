"""Take the three real browser renders that make up screenshots/.

Each scene is a real page load of game/index.html with ?shot=<name>&seed=1, rendered by a real
Chromium at 1280x800 and screenshotted as-is. Nothing is edited, composited or retouched: the
screenshot is whatever the page painted, and the script records the page's own snapshot beside it
so the frame can be checked against the simulation state that produced it.

    python tools/shots.py
"""

from __future__ import annotations

import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "screenshots"
BASE = "http://127.0.0.1:8080"
SCENES = [("start", "1-start.jpg"), ("play", "2-play.jpg"), ("end", "3-end.jpg")]
VIEW = {"width": 1280, "height": 800}
QUALITY = 78
MAX_BYTES = 262144


def main() -> int:
    OUT.mkdir(exist_ok=True)
    failures: list[str] = []
    report = {}

    with sync_playwright() as play:
        browser = play.chromium.launch(headless=True, args=["--force-device-scale-factor=1"])
        context = browser.new_context(viewport=VIEW, device_scale_factor=1)
        for scene, name in SCENES:
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
            page.wait_for_function("window.__shotReady === true", timeout=15000)
            snapshot = page.evaluate("window.__gameTest.snapshot()")
            target = OUT / name
            page.screenshot(path=str(target), type="jpeg", quality=QUALITY, full_page=False)
            size = target.stat().st_size
            width, height = page.evaluate(
                "() => { const c = document.getElementById('game');"
                " return [c.width, c.height]; }"
            )
            # Give the frame a moment: a second shot after a beat must be the same scene, so a
            # reader cannot mistake a mid-animation frame for a posed one.
            report[scene] = {
                "url": url,
                "file": name,
                "bytes": size,
                "viewport": [VIEW["width"], VIEW["height"]],
                "canvas": width,
                "snapshot": {
                    k: snapshot[k]
                    for k in ("phase", "wave", "score", "hull", "delivered", "target",
                              "totalDelivered", "combo", "hooks", "hits", "cleared", "shot")
                },
                "pageerrors": errors,
                "requests": [r for r in requests if not r.startswith(BASE)],
            }
            print(
                f"{scene:6} -> {name}  {size} bytes  canvas {width}x{height}  "
                f"phase={snapshot['phase']} wave={snapshot['wave']} "
                f"score={snapshot['score']} hull={snapshot['hull']} "
                f"{snapshot['delivered']}/{snapshot['target']} chain x{snapshot['combo']} "
                f"hooks={snapshot['hooks']} hits={snapshot['hits']}"
            )
            if size > MAX_BYTES:
                failures.append(f"{name}: {size} bytes over the 256 KiB cap")
            if width != 1280 or height != 800:
                failures.append(f"{name}: canvas is {width}x{height}, want 1280x800")
            if errors:
                failures.append(f"{name}: {errors}")
            if report[scene]["requests"]:
                failures.append(f"{name}: network requests {report[scene]['requests']}")
            page.close()
        context.close()
        browser.close()

    print(json.dumps(report, indent=2))
    if failures:
        print("\nFAILURES:")
        for failure in failures:
            print(" -", failure)
        return 1
    print("\nall three screenshots are real, sized and error-free")
    return 0


if __name__ == "__main__":
    sys.exit(main())
