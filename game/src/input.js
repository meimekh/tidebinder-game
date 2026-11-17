// What the harbour hears from the player: keyboard, mouse and the small overlay keys. It holds
// only state, never the rules. The simulation takes a fresh intent object from here every step,
// and the screenshot pilot and the tests can override any part of it without touching the real
// devices.

import { FIELD, WATER } from './config.js';

/** The movement keys, as code: a US layout, read by physical position rather than letter. */
const MOVE_CODES = {
  KeyW: { x: 0, y: -1 },
  ArrowUp: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

const TETHER_CODES = ['Space'];
const DASH_CODES = ['ShiftLeft', 'ShiftRight'];

/** Keys whose press is a one-shot event the loop consumes, rather than a held state. */
const EDGE_CODES = ['Space', 'ShiftLeft', 'ShiftRight', 'KeyP', 'Escape', 'KeyM', 'KeyR', 'KeyO', 'Enter'];

export function createInput(canvas) {
  const held = new Set();
  const edges = [];
  let pointer = null; // { x, y } in logical coordinates, or null before the first move
  let pointerHeld = false;
  let override = null; // test/pilot intent, merged over whatever the devices report
  let pointerKnown = false;

  const intent = {
    thrust: { x: 0, y: 0 },
    aim: null,
    tether: false,
  };

  function recordEdge(code) {
    if (EDGE_CODES.includes(code) && !edges.includes(code)) edges.push(code);
  }

  function onKeyDown(event) {
    if (event.repeat) {
      // Still swallow the browser's own scrolling for the keys we own.
      if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
      return;
    }
    held.add(event.code);
    recordEdge(event.code);
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
  }

  function onKeyUp(event) {
    held.delete(event.code);
  }

  function onBlur() {
    held.clear();
    pointerHeld = false;
  }

  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((clientX - rect.left) / rect.width) * FIELD.width;
    const y = ((clientY - rect.top) / rect.height) * FIELD.height;
    return { x, y };
  }

  function onPointerMove(event) {
    const point = toLogical(event.clientX, event.clientY);
    if (!point) return;
    pointer = point;
    pointerKnown = true;
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    pointerHeld = true;
    onPointerMove(event);
    edges.push('PointerDown');
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (event.button !== 0) return;
    pointerHeld = false;
    edges.push('PointerUp');
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  function bind() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('contextmenu', onContextMenu);
  }

  function unbind() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('contextmenu', onContextMenu);
  }

  return {
    bind,
    unbind,
    /** The raw held set, for the on-screen key hints. */
    held,

    /** One-shot keys this frame. `take(code)` consumes it. */
    take(code) {
      const index = edges.indexOf(code);
      if (index === -1) return false;
      edges.splice(index, 1);
      return true;
    },

    /** Keys pressed this frame that nothing claimed, cleared at the end of the frame. */
    clearEdges() {
      edges.length = 0;
    },

    /** Pointer in logical coordinates, or null before the player has aimed. */
    pointer() {
      return pointer;
    },

    pointerKnown() {
      return pointerKnown;
    },

    pointerHeld() {
      return pointerHeld;
    },

    /**
     * The movement direction as a unit-ish vector. Arrow keys and WASD both drive it, and a
     * diagonal is normalised so it never out-accelerates a straight line.
     */
    moveVector() {
      let x = 0;
      let y = 0;
      for (const code in MOVE_CODES) {
        if (held.has(code)) {
          x += MOVE_CODES[code].x;
          y += MOVE_CODES[code].y;
        }
      }
      const length = Math.hypot(x, y);
      if (length > 1) return { x: x / length, y: y / length };
      return { x, y };
    },

    tetherHeld() {
      return TETHER_CODES.some((code) => held.has(code)) || pointerHeld;
    },

    dashHeld() {
      return DASH_CODES.some((code) => held.has(code));
    },

    /**
     * The intent for one simulation step: where to thrust, where to aim, whether the tether is
     * taut. A test or the scripted pilot sets `override` and the real devices fall silent, which
     * is what makes a scripted run exactly reproducible.
     */
    intent() {
      const source = override ?? {};
      // `'thrust' in source` matters: an override that says `thrust: {x:0, y:0}` or `aim: null`
      // means exactly that, and must not fall back to the devices that are still being held.
      const move = 'thrust' in source ? source.thrust ?? { x: 0, y: 0 } : this.moveVector();
      const length = Math.hypot(move.x, move.y);
      intent.thrust.x = length > 1 ? move.x / length : move.x;
      intent.thrust.y = length > 1 ? move.y / length : move.y;
      intent.aim = 'aim' in source ? source.aim : pointer ? { x: pointer.x, y: pointer.y } : null;
      intent.tether = 'tether' in source ? Boolean(source.tether) : this.tetherHeld();
      return intent;
    },

    /** Aim away from the cursor, for the pilot: the skiff points where it is told. */
    setPointer(point) {
      pointer = point;
      if (point) pointerKnown = true;
    },

    setInput(patch) {
      if (patch === null || patch === undefined) {
        override = null;
        return;
      }
      override = { ...(override ?? {}), ...patch };
    },

    clearInput() {
      override = null;
    },

    /** A key press the loop did not consume, reported for the HUD's help line. */
    wantDash() {
      return this.dashHeld();
    },
  };
}

/** The water box shrunk to where a skiff may legally be, so the hull never clips the quay. */
export function skiffBounds() {
  return {
    x0: WATER.x0 + 6,
    y0: WATER.y0 + 24,
    x1: WATER.x1 - 6,
    y1: WATER.y1 - 6,
  };
}
