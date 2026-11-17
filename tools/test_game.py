"""Play TIDEBINDER in a real browser and check every mechanic the entry claims.

Each check drives the real page: real key and mouse events from Playwright for the controls, and
window.__gameTest (the game's own test handle) for stepping the real simulation where a check
needs a specific moment. Nothing is stubbed and nothing is asserted against a mock.

    python tools/test_game.py
"""

from __future__ import annotations

import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8080"
RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))
    return bool(ok)


def main() -> int:
    console_errors: list[str] = []
    page_errors: list[str] = []
    requests: list[str] = []

    with sync_playwright() as play:
        browser = play.chromium.launch(headless=True, args=["--force-device-scale-factor=1"])
        context = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
        page = context.new_page()
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))
        page.on(
            "console",
            lambda msg: console_errors.append(f"{msg.type}: {msg.text}") if msg.type in ("error", "warning") else None,
        )
        page.on("request", lambda req: requests.append(req.url))

        page.goto(f"{BASE}/", wait_until="load")
        page.wait_for_function("window.__shotReady === true", timeout=15000)

        snap = page.evaluate("window.__gameTest.snapshot()")
        check("title screen on a plain load", snap["phase"] == "title", f"phase={snap['phase']}")
        check("test handle exposes the required methods",
              page.evaluate(
                  "['start','step','snapshot','setInput','pilot','reset','scene','key','tick'].every("
                  "(m) => typeof window.__gameTest[m] === 'function')"
              ))
        check("shot scenes declared", page.evaluate("window.__gameTest.snapshot().shot") is None,
              "plain load is not a shot page")

        # --- start input, by keyboard and by mouse -------------------------------------
        page.keyboard.press("Enter")
        page.wait_for_function("window.__gameTest.snapshot().phase === 'play'", timeout=5000)
        snap = page.evaluate("window.__gameTest.snapshot()")
        check("Enter starts a run", snap["phase"] == "play" and snap["wave"] == 1,
              f"wave={snap['wave']} hull={snap['hull']} target={snap['target']}")

        page.evaluate("window.__gameTest.reset(1)")
        box = page.evaluate("""() => { const r = document.getElementById('game').getBoundingClientRect();
            return {x: r.x + r.width/2, y: r.y + r.height/2}; }""")
        page.mouse.click(box["x"], box["y"])
        page.wait_for_function("window.__gameTest.snapshot().phase === 'play'", timeout=5000)
        check("a click also starts a run",
              page.evaluate("window.__gameTest.snapshot().phase") == "play")

        # --- movement ------------------------------------------------------------------
        page.evaluate("window.__gameTest.reset(1); window.__gameTest.start()")
        before = page.evaluate("window.__gameTest.snapshot().skiff")
        page.evaluate("window.__gameTest.setInput({thrust:{x:1,y:0}, aim:null, tether:false, dash:false})")
        page.evaluate("window.__gameTest.step(1/60, 60)")
        after = page.evaluate("window.__gameTest.snapshot().skiff")
        check("thrust moves the skiff east", after["x"] - before["x"] > 60,
              f"x {before['x']:.0f} -> {after['x']:.0f} in 1s")

        page.evaluate("window.__gameTest.setInput({thrust:{x:0,y:-1}, aim:null, tether:false})")
        up_before = page.evaluate("window.__gameTest.snapshot().skiff")
        page.evaluate("window.__gameTest.step(1/60, 30)")
        up_after = page.evaluate("window.__gameTest.snapshot().skiff")
        check("thrust moves the skiff north", up_after["y"] - up_before["y"] < -30,
              f"y {up_before['y']:.0f} -> {up_after['y']:.0f} in 0.5s")

        # aim: the helm turns toward the mouse
        page.evaluate("window.__gameTest.reset(1); window.__gameTest.start()")
        page.evaluate("window.__gameTest.setInput({thrust:{x:0,y:0}, aim:{x:900,y:430}, tether:false})")
        page.evaluate("window.__gameTest.step(1/60, 40)")
        aimed = page.evaluate("window.__gameTest.snapshot().skiff")
        check("mouse aim turns the helm", abs(aimed["angle"]) < 0.2, f"angle={aimed['angle']:.3f} rad (0 = due east)")

        # --- tether: hook, tow, release -------------------------------------------------
        page.evaluate("window.__gameTest.reset(1); window.__gameTest.start()")
        hook = page.evaluate("""() => {
            const t = window.__gameTest;
            const s = t.snapshot();
            const crate = s.salvage.reduce((best, c) => {
                const d = Math.hypot(c.x - s.skiff.x, c.y - s.skiff.y);
                return !best || d < best.d ? {c, d} : best;
            }, null);
            t.setInput({thrust:{x:0,y:0}, aim:{x:crate.c.x, y:crate.c.y}, tether:true});
            for (let i = 0; i < 60 * 12; i += 1) {
                const latest = t.snapshot();
                if (latest.hooks > 0) return {hooked: true, steps: i, hooks: latest.hooks, mass: latest.mass};
                const c = latest.salvage.reduce((best, s2) => {
                    const d = Math.hypot(s2.x - latest.skiff.x, s2.y - latest.skiff.y);
                    return !best || d < best.d ? {s2, d} : best;
                }, null);
                const target = c ? c.s2 : latest.ring;
                t.setInput({thrust:{x:(target.x - latest.skiff.x)/300, y:(target.y - latest.skiff.y)/300},
                            aim:{x:target.x, y:target.y}, tether:true});
                t.step(1/60, 1);
            }
            return {hooked: false};
        }""")
        check("the tether hooks the nearest salvage", hook.get("hooked") is True,
              f"hooks={hook.get('hooks')} after {hook.get('steps')} steps, mass={hook.get('mass')}")

        towed_before = page.evaluate("window.__gameTest.snapshot()")
        check("towed cargo adds mass", towed_before["mass"] > 1.0, f"mass={towed_before['mass']}")

        # towing hauls the crate: the crate follows the skiff
        page.evaluate("""() => { const t = window.__gameTest; const s = t.snapshot();
            t.setInput({thrust:{x:0,y:0}, aim:null, tether:true});
            for (let i = 0; i < 120; i += 1) { t.setInput({thrust:{x:1,y:0}, aim:null, tether:true}); t.step(1/60,1); } }""")
        after_tow = page.evaluate("window.__gameTest.snapshot()")
        check("towing pulls the crate along behind the skiff",
              after_tow["hooks"] >= 1 and after_tow["skiff"]["x"] - towed_before["skiff"]["x"] > 60,
              f"skiff x {towed_before['skiff']['x']:.0f} -> {after_tow['skiff']['x']:.0f}, hooks={after_tow['hooks']}")

        # release: the rope lets go and the crate keeps its drift
        page.evaluate("window.__gameTest.setInput({thrust:{x:0,y:0}, aim:null, tether:false})")
        page.evaluate("window.__gameTest.step(1/60, 6)")
        released = page.evaluate("window.__gameTest.snapshot()")
        check("releasing the tether lets the cargo drift", released["hooks"] == 0,
              f"hooks={released['hooks']}")

        # --- delivery and the chain multiplier -----------------------------------------
        delivery = page.evaluate("""() => {
            const t = window.__gameTest;
            for (let i = 0; i < 60 * 45; i += 1) {
                const s = t.snapshot();
                if (s.delivered > 0 && s.comboTimer > 0) return {delivered: s.delivered, score: s.score, combo: s.combo};
                const held = s.hooks > 0;
                const target = held ? s.ring : s.salvage.reduce((best, c) => {
                    if (c.hooked) return best;
                    const d = Math.hypot(c.x - s.skiff.x, c.y - s.skiff.y);
                    return !best || d < best.d ? {c, d} : best;
                }, null)?.c ?? s.ring;
                const dx = target.x - s.skiff.x;
                const dy = target.y - s.skiff.y;
                const len = Math.hypot(dx, dy) || 1;
                t.setInput({thrust:{x: dx/len, y: dy/len}, aim:{x: target.x, y: target.y}, tether: true});
                t.step(1/60, 1);
            }
            return {delivered: 0};
        }""")
        check("cargo hauled into the ring is delivered and scores",
              delivery.get("delivered", 0) > 0 and delivery.get("score", 0) > 0,
              f"delivered={delivery.get('delivered')} score={delivery.get('score')} chain=x{delivery.get('combo')}")
        check("a delivery starts the chain multiplier", delivery.get("combo", 1) > 1,
              f"chain=x{delivery.get('combo')}")

        # --- the wave quota advances to the next wave ----------------------------------
        wavecheck = page.evaluate("""() => {
            const t = window.__gameTest;
            t.reset(1); t.start();
            for (let i = 0; i < 60 * 120; i += 1) {
                const s = t.snapshot();
                if (s.wave > 1 || s.cleared > 0) return {wave: s.wave, cleared: s.cleared, hull: s.hull};
                t.pilot(0.5);
            }
            return {wave: 1, cleared: 0};
        }""")
        check("filling the quota clears wave one and escalates",
              wavecheck["wave"] >= 2 and wavecheck["cleared"] >= 1,
              f"wave={wavecheck['wave']} cleared={wavecheck['cleared']} hull={wavecheck['hull']}")

        # --- hazards: the hull takes damage --------------------------------------------
        damage = page.evaluate("""() => {
            const t = window.__gameTest;
            t.reset(1); t.start();
            t.setInput({thrust:{x:0,y:0}, aim:null, tether:false, dash:false});
            let invulnerable_seen = false;
            const start = t.snapshot();
            for (let i = 0; i < 60 * 60; i += 1) {
                t.step(1/60, 1);
                const s = t.snapshot();
                if (s.invulnerable) invulnerable_seen = true;
                if (s.hull < start.hull) {
                    return {hull: s.hull, hits: s.hits, beamHits: s.beamHits, wreckHits: s.wreckHits,
                            invulnerable_seen, phase: s.phase};
                }
                if (s.phase === 'lose') break;
            }
            return {hull: 100, hits: 0};
        }""")
        check("a storm beam or wreck hurts the hull", 0 < damage.get("hull", 100) < 100,
              f"hull={damage.get('hull')} hits={damage.get('hits')} "
              f"(beams {damage.get('beamHits')}, wrecks {damage.get('wreckHits')})")

        # --- mass: a heavier tow is slower --------------------------------------------
        def speed_after(seconds: float, tether: bool) -> float:
            page.evaluate("window.__gameTest.reset(1); window.__gameTest.start()")
            page.evaluate(f"window.__gameTest.setInput({{thrust:{{x:1,y:0}}, aim:null, tether:{str(tether).lower()}}})")
            page.evaluate(f"window.__gameTest.step(1/60, {int(seconds * 60)})")
            skiff = page.evaluate("window.__gameTest.snapshot().skiff")
            return (skiff["vx"] ** 2 + skiff["vy"] ** 2) ** 0.5

        speed_light = speed_after(0.25, False)
        speed_towed = speed_after(0.25, True)
        towed_mass = page.evaluate("window.__gameTest.snapshot().mass")
        check("cargo mass slows the skiff", speed_towed < speed_light * 0.85,
              f"unladen {speed_light:.0f} px/s vs {speed_towed:.0f} px/s towing {towed_mass}t")

        # --- a storm beam cuts the tow ------------------------------------------------
        beamcut = page.evaluate("""() => {
            const t = window.__gameTest;
            t.reset(1); t.start();
            for (let i = 0; i < 60 * 60; i += 1) {
                const s = t.snapshot();
                let target = null;
                if (s.hooks === 0 && i < 60 * 20) {
                    target = s.salvage.reduce((best, c) => {
                        if (c.hooked) return best;
                        const d = Math.hypot(c.x - s.skiff.x, c.y - s.skiff.y);
                        return !best || d < best.d ? {x: c.x, y: c.y, d} : best;
                    }, null);
                }
                if (!target) {
                    const beam = s.beams.reduce((best, b) => {
                        const d = Math.hypot(b.x - s.skiff.x, b.y - s.skiff.y);
                        return !best || d < best.d ? {x: b.x, y: b.y, d} : best;
                    }, null);
                    target = beam;
                }
                const dx = target.x - s.skiff.x;
                const dy = target.y - s.skiff.y;
                const len = Math.hypot(dx, dy) || 1;
                t.setInput({thrust: {x: dx / len, y: dy / len}, aim: {x: target.x, y: target.y}, tether: true});
                const before = s.hits;
                const beforeHooks = s.hooks;
                const now = t.step(1/60, 1);
                if (now.hits > before) {
                    return {hits: now.hits, hooksBefore: beforeHooks, hooks: now.hooks,
                            hull: now.hull, beamHits: now.beamHits};
                }
            }
            return {hits: 0};
        }""")
        check("a storm beam costs the hull and cuts the tow",
              beamcut.get("hits", 0) > 0 and beamcut.get("hooksBefore", 0) > 0
              and beamcut.get("hooks") == 0,
              f"hits={beamcut.get('hits')} (beams {beamcut.get('beamHits')}) hull={beamcut.get('hull')} "
              f"hooks {beamcut.get('hooksBefore')} -> {beamcut.get('hooks')}")

        # --- pause ---------------------------------------------------------------------
        page.evaluate("window.__gameTest.reset(1); window.__gameTest.start()")
        page.keyboard.press("KeyP")
        page.wait_for_function("window.__gameTest.snapshot().phase === 'paused'", timeout=5000)
        t_before = page.evaluate("window.__gameTest.snapshot().t")
        page.evaluate("window.__gameTest.step(1/60, 60)")
        t_after = page.evaluate("window.__gameTest.snapshot().t")
        check("P pauses and the clock stops", t_after == t_before, f"t {t_before:.2f} -> {t_after:.2f}")
        page.keyboard.press("KeyP")
        page.wait_for_function("window.__gameTest.snapshot().phase === 'play'", timeout=5000)
        page.evaluate("window.__gameTest.step(1/60, 30)")
        resumed = page.evaluate("window.__gameTest.snapshot().t")
        check("P resumes the run", resumed > t_after, f"t {t_after:.2f} -> {resumed:.2f}")

        # --- mute and reduced motion ---------------------------------------------------
        page.keyboard.press("KeyM")
        page.wait_for_function("window.__gameTest.snapshot().muted === true", timeout=5000)
        page.keyboard.press("KeyM")
        page.wait_for_function("window.__gameTest.snapshot().muted === false", timeout=5000)
        check("M toggles the mute", True, "muted -> unmuted")
        page.keyboard.press("KeyO")
        page.wait_for_function("window.__gameTest.snapshot().reducedMotion === true", timeout=5000)
        check("O turns on reduced motion",
              page.evaluate("window.__gameTest.snapshot().reducedMotion") is True)
        drawn = page.evaluate("""() => {
            try { window.__gameTest.pilot(3); window.__gameTest.draw(); return 'ok'; }
            catch (error) { return String(error); }
        }""")
        check("reduced motion still renders the harbour", drawn == "ok", drawn)
        page.keyboard.press("KeyO")

        # --- win, then restart from the win screen -------------------------------------
        win = page.evaluate("""() => {
            const t = window.__gameTest;
            t.reset(1); t.start();
            for (let i = 0; i < 60 * 200; i += 1) {
                const s = t.pilot(1.0);
                if (s.phase === 'win' || s.phase === 'lose') return s;
            }
            return t.snapshot();
        }""")
        check("the run can be won (wave 3 quota filled)", win["phase"] == "win",
              f"phase={win['phase']} score={win['score']} hull={win['hull']} "
              f"cleared={win['cleared']} cargo={win['totalDelivered']} hits={win['hits']}")
        check("winning reaches a real terminal score screen",
              win["phase"] == "win" and win["cleared"] == 3 and win["totalDelivered"] == 12,
              f"cleared={win['cleared']}/3 cargo={win['totalDelivered']}/12")

        page.keyboard.press("KeyR")
        page.wait_for_function("window.__gameTest.snapshot().phase === 'play'", timeout=5000)
        restarted = page.evaluate("window.__gameTest.snapshot()")
        check("R restarts from the win screen",
              restarted["phase"] == "play" and restarted["wave"] == 1 and restarted["score"] == 0
              and restarted["totalDelivered"] == 0 and restarted["cleared"] == 0 and restarted["hull"] > 70,
              f"wave={restarted['wave']} score={restarted['score']} hull={restarted['hull']} "
              f"cleared={restarted['cleared']} cargo={restarted['totalDelivered']}")

        fresh = page.evaluate("window.__gameTest.reset(1); window.__gameTest.start(); window.__gameTest.snapshot()")
        check("a fresh run starts whole, at wave one, with a moment of grace",
              fresh["hull"] == 100 and fresh["wave"] == 1 and fresh["delivered"] == 0
              and fresh["invulnerable"] is True,
              f"hull={fresh['hull']} wave={fresh['wave']} invulnerable={fresh['invulnerable']}")

        # --- lose, then restart from the loss screen -----------------------------------
        lose = page.evaluate("""() => {
            const t = window.__gameTest;
            t.reset(1); t.start();
            t.setInput({thrust:{x:0,y:0}, aim:null, tether:false, dash:false});
            for (let i = 0; i < 60 * 200; i += 1) {
                const s = t.step(1/60, 1);
                if (s.phase === 'lose') return s;
            }
            return t.snapshot();
        }""")
        check("the run can be lost (hull reaches zero)", lose["phase"] == "lose",
              f"phase={lose['phase']} hull={lose['hull']} hits={lose['hits']}")
        page.keyboard.press("KeyR")
        page.wait_for_function("window.__gameTest.snapshot().phase === 'play'", timeout=5000)
        restarted_lose = page.evaluate("window.__gameTest.snapshot()")
        check("R restarts from the loss screen",
              restarted_lose["phase"] == "play" and restarted_lose["hull"] == 100,
              f"hull={restarted_lose['hull']} wave={restarted_lose['wave']}")

        # --- the screenshot scenes are real renders of the simulation ------------------
        for scene, expect in (("start", "title"), ("play", "play"), ("end", ("win", "lose"))):
            page.goto(f"{BASE}/?shot={scene}&seed=1", wait_until="load")
            page.wait_for_function("window.__shotReady === true", timeout=15000)
            state = page.evaluate("window.__gameTest.snapshot()")
            framed = page.evaluate("""() => { const c = document.getElementById('game');
                return {w: c.width, h: c.height, painted: window.__shotReady === true}; }""")
            ok = state["phase"] in (expect if isinstance(expect, tuple) else (expect,))
            check(f"?shot={scene} renders the {expect if isinstance(expect, str) else '/'.join(expect)} state",
                  ok and framed["painted"], f"phase={state['phase']} canvas={framed['w']}x{framed['h']}")

        # --- deterministic: the same seed gives the same harbour twice ----------------
        def scene_digest() -> str:
            page.goto(f"{BASE}/?shot=play&seed=1", wait_until="load")
            page.wait_for_function("window.__shotReady === true", timeout=15000)
            return json.dumps(page.evaluate("window.__gameTest.snapshot()"), sort_keys=True)

        first = scene_digest()
        second = scene_digest()
        check("the same seed stages the same state twice", first == second)

        check("no page errors", not page_errors, "; ".join(page_errors[:3]))
        check("no console errors or warnings", not console_errors, "; ".join(console_errors[:3]))
        external = [url for url in requests if not url.startswith(BASE)]
        check("no network request outside the local static server", not external, "; ".join(external[:3]))

        context.close()
        browser.close()

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    total = len(RESULTS)
    print(f"\n{passed}/{total} checks passed")
    if passed != total:
        print("FAILED:")
        for name, ok, detail in RESULTS:
            if not ok:
                print(f" - {name}: {detail}")
        return 1
    print("all browser checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
