// The harbour's voice: every sound is a WebAudio oscillator made here, so the game ships no audio
// file at all. Nothing is created until the player first touches a key or the mouse (a browser
// allows no sound before that), and M mutes the master gain without stopping the game.

const SCALE = {
  // Simple, warm intervals: a fifth for the tether, an octave-based climb for the chain.
  attach: 392,
  deliver: 523,
};

export function createAudio() {
  let context = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (context) return context;
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      // No audio device, or the browser refused: play the game in silence.
      context = null;
      return null;
    }
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(context.destination);
    return context;
  }

  /** One oscillator note: `slide` bends the pitch as it plays. */
  function tone({ frequency, duration = 0.12, type = 'sine', gain = 0.12, delay = 0, slide = 0, when = 0 }) {
    const ctx = ensure();
    if (!ctx || muted) return;
    const start = ctx.currentTime + Math.max(0, when) + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    if (slide !== 0) osc.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + slide), start + duration);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp);
    amp.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /** A swept-noise splash, made from a very short buffer so no file is needed. */
  function noise({ duration = 0.18, gain = 0.1, when = 0 }) {
    const ctx = ensure();
    if (!ctx || muted) return;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < frames; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const envelope = 1 - i / frames;
      data[i] = ((seed / 0x7fffffff) * 2 - 1) * envelope * envelope;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    source.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    source.start(ctx.currentTime + Math.max(0, when));
  }

  const play = {
    attach() {
      tone({ frequency: SCALE.attach, duration: 0.09, type: 'triangle', gain: 0.1, slide: 160 });
      noise({ duration: 0.08, gain: 0.05 });
    },
    release() {
      tone({ frequency: 300, duration: 0.07, type: 'sine', gain: 0.05, slide: -60 });
    },
    snap() {
      tone({ frequency: 220, duration: 0.14, type: 'sawtooth', gain: 0.07, slide: -140 });
    },
    cut() {
      tone({ frequency: 260, duration: 0.16, type: 'square', gain: 0.06, slide: -180 });
      noise({ duration: 0.1, gain: 0.05 });
    },
    deliver(chain = 1) {
      const step = Math.min(4, Math.max(0, chain - 1));
      const base = SCALE.deliver * Math.pow(1.12, step);
      tone({ frequency: base, duration: 0.13, type: 'triangle', gain: 0.12 });
      tone({ frequency: base * 1.5, duration: 0.16, type: 'sine', gain: 0.09, delay: 0.06 });
      noise({ duration: 0.12, gain: 0.04 });
    },
    beamHit() {
      tone({ frequency: 150, duration: 0.34, type: 'sawtooth', gain: 0.14, slide: -90 });
      noise({ duration: 0.3, gain: 0.1 });
    },
    wreckHit() {
      tone({ frequency: 180, duration: 0.24, type: 'square', gain: 0.1, slide: -70 });
      noise({ duration: 0.18, gain: 0.08 });
    },
    dash() {
      tone({ frequency: 880, duration: 0.2, type: 'sine', gain: 0.09, slide: -640 });
      noise({ duration: 0.16, gain: 0.05 });
    },
    waveStart(wave = 1) {
      const root = 262 * Math.pow(1.12, wave - 1);
      tone({ frequency: root, duration: 0.5, type: 'triangle', gain: 0.1 });
      tone({ frequency: root * 1.26, duration: 0.5, type: 'sine', gain: 0.08, delay: 0.05 });
      tone({ frequency: root * 1.5, duration: 0.6, type: 'sine', gain: 0.07, delay: 0.1 });
    },
    waveClear() {
      [523, 659, 784].forEach((frequency, index) => {
        tone({ frequency, duration: 0.3, type: 'triangle', gain: 0.11, delay: index * 0.09 });
      });
    },
    win() {
      [523, 659, 784, 1046, 1318].forEach((frequency, index) => {
        tone({ frequency, duration: 0.42, type: 'triangle', gain: 0.12, delay: index * 0.13 });
      });
      tone({ frequency: 262, duration: 1.4, type: 'sine', gain: 0.08, delay: 0.1 });
    },
    lose() {
      [392, 330, 262, 196].forEach((frequency, index) => {
        tone({ frequency, duration: 0.4, type: 'sawtooth', gain: 0.1, delay: index * 0.16 });
      });
      noise({ duration: 0.6, gain: 0.08, when: 0.2 });
    },
    ui() {
      tone({ frequency: 880, duration: 0.05, type: 'square', gain: 0.05 });
    },
  };

  return {
    /** Called on the first real gesture; safe to call any number of times. */
    unlock() {
      try {
        const ctx = ensure();
        if (ctx && ctx.state === 'suspended') ctx.resume();
      } catch {
        /* a browser that will not make sound still plays the game */
      }
    },

    get muted() {
      return muted;
    },

    setMuted(value) {
      muted = value === true;
      if (master) master.gain.value = muted ? 0 : 0.5;
    },

    toggleMute() {
      this.setMuted(!muted);
      return muted;
    },

    /** Play one simulation event. Unknown types are ignored, so the sim can add freely. */
    event(type, value = 0) {
      const fn = play[type];
      if (!fn) return;
      try {
        fn(value);
      } catch {
        // A closed or blocked audio context must never break the game.
      }
    },
  };
}
