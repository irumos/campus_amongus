let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (Ctx) {
      audioCtx = new Ctx();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function vibratePattern(pattern: number | number[]): void {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.navigator !== 'undefined' &&
      typeof window.navigator.vibrate === 'function'
    ) {
      window.navigator.vibrate(pattern);
    }
  } catch {
    // Ignore vibration errors on unsupported browsers
  }
}

export function playTone(
  freq: number,
  durationMs = 110,
  type: OscillatorType = 'sine',
  gainVal = 0.08,
  delaySec = 0
): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const startTime = ctx.currentTime + delaySec;
    const endTime = startTime + durationMs / 1000;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(gainVal, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, endTime);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(endTime);
  } catch {
    // Ignore audio errors if blocked by browser autoplay policy
  }
}

/** Crisp UI click + 30ms haptic pulse on button taps */
export function playUiClick(): void {
  vibratePattern(30);
  playTone(720, 35, 'triangle', 0.055);
}

/** Crisp QR scan confirmation chime + double haptic tap */
export function playQrScanSuccess(): void {
  vibratePattern([35, 35, 55]);
  playTone(680, 65, 'sine', 0.08, 0);
  playTone(960, 110, 'sine', 0.09, 0.06);
}

/** Celebratory task completion triad + haptic pulse */
export function playTaskSuccessFeedback(): void {
  vibratePattern([40, 30, 80]);
  playTone(523.25, 90, 'sine', 0.09, 0);
  playTone(659.25, 90, 'sine', 0.09, 0.08);
  playTone(783.99, 180, 'sine', 0.1, 0.16);
}

/** Tactile error feedback for invalid QR scans or wrong taps */
export function playErrorFeedback(): void {
  vibratePattern([65, 40, 65]);
  playTone(210, 140, 'sawtooth', 0.075, 0);
}

/**
 * Dramatic emergency siren tone + [400, 150, 400, 150, 600] vibration pattern
 * triggered when entering MEETING or when REACTOR sabotage starts.
 */
export function playEmergencySiren(): void {
  vibratePattern([400, 150, 400, 150, 600]);
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const pulses = [0, 0.55, 1.1];
    for (const offset of pulses) {
      const start = ctx.currentTime + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(520, start);
      osc.frequency.linearRampToValueAtTime(880, start + 0.22);
      osc.frequency.linearRampToValueAtTime(480, start + 0.42);

      gain.gain.setValueAtTime(0.085, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.44);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.45);
    }
  } catch {
    // Fallback discrete tones
    playTone(660, 180, 'square', 0.08, 0);
    playTone(440, 220, 'square', 0.08, 0.2);
  }
}

/**
 * Low flatline tone + 800ms vibration when local player's isAlive changes from true to false.
 */
export function playFlatlineEliminated(): void {
  vibratePattern(800);
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const start = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, start);
    osc.frequency.exponentialRampToValueAtTime(115, start + 0.78);

    gain.gain.setValueAtTime(0.11, start);
    gain.gain.setValueAtTime(0.09, start + 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.85);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.86);
  } catch {
    playTone(130, 750, 'sine', 0.1);
  }
}
