/** Lightweight synthesized move/capture/check sounds — no audio assets needed. */
let audioCtx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

function tone(freq, duration, { type = 'sine', gain = 0.15, delay = 0 } = {}) {
  const ctx = getCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const start = ctx.currentTime + delay;
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration);
}

export function playMoveSound(kind = 'move') {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();

  if (kind === 'capture') {
    tone(220, 0.09, { type: 'triangle', gain: 0.18 });
    tone(160, 0.12, { type: 'triangle', gain: 0.14, delay: 0.03 });
  } else if (kind === 'check') {
    tone(660, 0.08, { type: 'square', gain: 0.12 });
    tone(880, 0.12, { type: 'square', gain: 0.12, delay: 0.06 });
  } else if (kind === 'wrong') {
    tone(180, 0.18, { type: 'sawtooth', gain: 0.12 });
  } else if (kind === 'success') {
    tone(523, 0.09, { type: 'sine', gain: 0.15 });
    tone(659, 0.09, { type: 'sine', gain: 0.15, delay: 0.09 });
    tone(784, 0.16, { type: 'sine', gain: 0.15, delay: 0.18 });
  } else {
    tone(392, 0.07, { type: 'sine', gain: 0.14 });
  }
}
