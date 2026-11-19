let audioCtx: AudioContext | null = null;
let masterCompressor: DynamicsCompressorNode | null = null;
let masterGainNode: GainNode | null = null;

// Single-channel priority SFX voice arbiter to prevent sound effects from overlapping/clashing
interface ActiveSfxVoice {
  id: number;
  key: string;
  priority: number;
  endsAtMs: number;
  bus: GainNode;
  nodes: AudioScheduledSourceNode[];
}

let sfxVoiceSeq = 0;
let activeSfxVoice: ActiveSfxVoice | null = null;
const lastPlayedByKey = new Map<string, number>();

// Ambient Home Screen soundscape (space-wind movement + subtle atmospheric sci-fi pad)
const AMBIENCE_MUTE_STORAGE_KEY = 'cairl_ambience_muted';

interface AmbienceEngine {
  masterGain: GainNode;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  running: boolean;
}

let ambienceEngine: AmbienceEngine | null = null;
let ambienceDesired = false;
let ambienceUnlockBound = false;
let ambienceMuted = readStoredAmbienceMuted();
const ambienceListeners = new Set<() => void>();

function readStoredAmbienceMuted(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      localStorage.getItem(AMBIENCE_MUTE_STORAGE_KEY) === '1'
    );
  } catch {
    return false;
  }
}

function notifyAmbienceListeners(): void {
  for (const listener of ambienceListeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (Ctx) {
      audioCtx = new Ctx();
      masterCompressor = audioCtx.createDynamicsCompressor();
      masterCompressor.threshold.setValueAtTime(-16, audioCtx.currentTime);
      masterCompressor.knee.setValueAtTime(18, audioCtx.currentTime);
      masterCompressor.ratio.setValueAtTime(6, audioCtx.currentTime);
      masterCompressor.attack.setValueAtTime(0.005, audioCtx.currentTime);
      masterCompressor.release.setValueAtTime(0.14, audioCtx.currentTime);

      masterGainNode = audioCtx.createGain();
      masterGainNode.gain.setValueAtTime(0.92, audioCtx.currentTime);

      masterCompressor.connect(masterGainNode);
      masterGainNode.connect(audioCtx.destination);
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function getMasterInput(ctx: AudioContext): AudioNode {
  return masterCompressor || masterGainNode || ctx.destination;
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

function duckAmbience(durationMs: number): void {
  if (!ambienceEngine || !ambienceEngine.running || !audioCtx || ambienceMuted) {
    return;
  }
  try {
    const now = audioCtx.currentTime;
    const g = ambienceEngine.masterGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(0.035, now + 0.06);
    g.setValueAtTime(0.035, now + Math.max(0.18, durationMs / 1000));
    g.linearRampToValueAtTime(
      ambienceDesired && !ambienceMuted ? 0.16 : 0.0001,
      now + Math.max(0.18, durationMs / 1000) + 0.45
    );
  } catch {
    // Ignore ducking scheduling errors
  }
}

function stopVoiceGracefully(voice: ActiveSfxVoice, ctx: AudioContext): void {
  try {
    const now = ctx.currentTime;
    voice.bus.gain.cancelScheduledValues(now);
    voice.bus.gain.setValueAtTime(Math.max(0.0001, voice.bus.gain.value), now);
    voice.bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    for (const node of voice.nodes) {
      try {
        node.stop(now + 0.045);
      } catch {
        // Node may already have stopped
      }
    }
    setTimeout(() => {
      try {
        voice.bus.disconnect();
      } catch {
        // ignore
      }
    }, 80);
  } catch {
    // ignore
  }
}

/**
 * Reserves the single SFX channel for a sound effect.
 * - Deduplicates identical triggers within `cooldownMs`.
 * - Suppresses lower-priority sounds while a higher-priority alert is active.
 * - Cleanly fades out and replaces equal/lower-priority active voices so sounds NEVER clash.
 */
function runExclusiveSfx(options: {
  key: string;
  priority: 1 | 2 | 3 | 4;
  durationMs: number;
  cooldownMs?: number;
  vibrate?: number | number[];
  render: (ctx: AudioContext, bus: GainNode, register: (n: AudioScheduledSourceNode) => void) => void;
}): boolean {
  const nowMs = Date.now();
  const cooldown = options.cooldownMs ?? (options.priority >= 3 ? 750 : 120);
  const lastAt = lastPlayedByKey.get(options.key) ?? 0;
  if (nowMs - lastAt < cooldown) {
    return false;
  }

  // If another higher-priority SFX is currently playing, do not interrupt or clash with it
  if (
    activeSfxVoice &&
    nowMs < activeSfxVoice.endsAtMs &&
    options.priority < activeSfxVoice.priority
  ) {
    return false;
  }

  lastPlayedByKey.set(options.key, nowMs);
  if (options.vibrate !== undefined) {
    vibratePattern(options.vibrate);
  }

  try {
    const ctx = getAudioContext();
    if (!ctx) return false;

    if (activeSfxVoice) {
      stopVoiceGracefully(activeSfxVoice, ctx);
      activeSfxVoice = null;
    }

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(1, ctx.currentTime);
    bus.connect(getMasterInput(ctx));

    const nodes: AudioScheduledSourceNode[] = [];
    const voiceId = ++sfxVoiceSeq;
    const voice: ActiveSfxVoice = {
      id: voiceId,
      key: options.key,
      priority: options.priority,
      endsAtMs: nowMs + options.durationMs,
      bus,
      nodes,
    };
    activeSfxVoice = voice;

    if (options.priority >= 2) {
      duckAmbience(options.durationMs);
    }

    options.render(ctx, bus, (n) => {
      nodes.push(n);
    });

    setTimeout(() => {
      if (activeSfxVoice?.id === voiceId) {
        activeSfxVoice = null;
      }
      try {
        bus.disconnect();
      } catch {
        // ignore
      }
    }, options.durationMs + 140);

    return true;
  } catch {
    return false;
  }
}

function scheduleToneOnBus(
  ctx: AudioContext,
  bus: GainNode,
  register: (n: AudioScheduledSourceNode) => void,
  freq: number,
  durationMs = 110,
  type: OscillatorType = 'sine',
  gainVal = 0.08,
  delaySec = 0
): void {
  const startTime = ctx.currentTime + delaySec;
  const endTime = startTime + durationMs / 1000;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(gainVal, startTime + Math.min(0.012, durationMs / 4000));
  gain.gain.exponentialRampToValueAtTime(0.0008, endTime);

  osc.connect(gain);
  gain.connect(bus);
  osc.start(startTime);
  osc.stop(endTime + 0.01);
  register(osc);
}

export function playTone(
  freq: number,
  durationMs = 110,
  type: OscillatorType = 'sine',
  gainVal = 0.08,
  delaySec = 0
): void {
  runExclusiveSfx({
    key: `tone_${Math.round(freq)}`,
    priority: 1,
    durationMs: Math.round(durationMs + delaySec * 1000),
    cooldownMs: 45,
    render: (ctx, bus, register) => {
      scheduleToneOnBus(ctx, bus, register, freq, durationMs, type, gainVal, delaySec);
    },
  });
}

/** Crisp UI click + 28ms haptic pulse on button taps (never interrupts alerts) */
export function playUiClick(): void {
  runExclusiveSfx({
    key: 'ui_click',
    priority: 1,
    durationMs: 65,
    cooldownMs: 55,
    vibrate: 22,
    render: (ctx, bus, register) => {
      scheduleToneOnBus(ctx, bus, register, 720, 38, 'triangle', 0.055, 0);
    },
  });
}

/** Crisp QR / ID Card scan confirmation chime + distinct double haptic pulse */
export function playQrScanSuccess(): void {
  runExclusiveSfx({
    key: 'qr_scan',
    priority: 2,
    durationMs: 280,
    cooldownMs: 250,
    vibrate: [38, 32, 80],
    render: (ctx, bus, register) => {
      scheduleToneOnBus(ctx, bus, register, 680, 65, 'sine', 0.08, 0);
      scheduleToneOnBus(ctx, bus, register, 960, 105, 'sine', 0.09, 0.06);
      scheduleToneOnBus(ctx, bus, register, 1240, 95, 'triangle', 0.055, 0.13);
    },
  });
}

/** Futuristic ID Card sync chime + tactile lock-in haptic pulse */
export function playIdCardScanSound(): void {
  runExclusiveSfx({
    key: 'id_card_scan',
    priority: 2,
    durationMs: 300,
    cooldownMs: 280,
    vibrate: [35, 30, 85],
    render: (ctx, bus, register) => {
      scheduleToneOnBus(ctx, bus, register, 587.33, 60, 'triangle', 0.075, 0);
      scheduleToneOnBus(ctx, bus, register, 880, 75, 'sine', 0.085, 0.065);
      scheduleToneOnBus(ctx, bus, register, 1174.66, 135, 'sine', 0.08, 0.13);
    },
  });
}

/** Celebratory task completion triad + haptic pulse */
export function playTaskSuccessFeedback(): void {
  runExclusiveSfx({
    key: 'task_success',
    priority: 2,
    durationMs: 490,
    cooldownMs: 320,
    vibrate: [40, 30, 80],
    render: (ctx, bus, register) => {
      scheduleToneOnBus(ctx, bus, register, 523.25, 90, 'sine', 0.09, 0);
      scheduleToneOnBus(ctx, bus, register, 659.25, 90, 'sine', 0.09, 0.08);
      scheduleToneOnBus(ctx, bus, register, 783.99, 150, 'sine', 0.1, 0.16);
      scheduleToneOnBus(ctx, bus, register, 1046.5, 220, 'triangle', 0.075, 0.24);
    },
  });
}

/** Tactile error feedback for invalid QR scans or blocked actions */
export function playErrorFeedback(): void {
  runExclusiveSfx({
    key: 'error_feedback',
    priority: 2,
    durationMs: 290,
    cooldownMs: 260,
    vibrate: [65, 40, 65],
    render: (ctx, bus, register) => {
      scheduleToneOnBus(ctx, bus, register, 220, 110, 'sawtooth', 0.07, 0);
      scheduleToneOnBus(ctx, bus, register, 165, 160, 'sawtooth', 0.065, 0.11);
    },
  });
}

/** Ballot-lock chime when casting or skipping a vote */
export function playVoteCastSound(): void {
  runExclusiveSfx({
    key: 'vote_cast',
    priority: 2,
    durationMs: 230,
    cooldownMs: 240,
    vibrate: [35, 25, 45],
    render: (ctx, bus, register) => {
      scheduleToneOnBus(ctx, bus, register, 440, 70, 'triangle', 0.075, 0);
      scheduleToneOnBus(ctx, bus, register, 659.25, 130, 'sine', 0.085, 0.07);
    },
  });
}

/** Ethereal harmonic shimmer when entering Phantom Mode */
export function playPhantomChime(): void {
  runExclusiveSfx({
    key: 'phantom_chime',
    priority: 2,
    durationMs: 560,
    cooldownMs: 500,
    vibrate: [60, 40, 100],
    render: (ctx, bus, register) => {
      scheduleToneOnBus(ctx, bus, register, 392, 220, 'sine', 0.065, 0);
      scheduleToneOnBus(ctx, bus, register, 493.88, 260, 'sine', 0.06, 0.09);
      scheduleToneOnBus(ctx, bus, register, 783.99, 360, 'triangle', 0.055, 0.18);
    },
  });
}

/** Subtle countdown pulse for final 10 seconds of sabotage or discussion */
export function playCountdownTick(urgent = false): void {
  runExclusiveSfx({
    key: 'countdown_tick',
    priority: 1,
    durationMs: 75,
    cooldownMs: 650,
    render: (ctx, bus, register) => {
      scheduleToneOnBus(
        ctx,
        bus,
        register,
        urgent ? 940 : 620,
        urgent ? 55 : 42,
        'triangle',
        urgent ? 0.06 : 0.038,
        0
      );
    },
  });
}

/** Cinematic sweep when a suspect is Ejected */
export function playEjectionSound(): void {
  runExclusiveSfx({
    key: 'ejection_reveal',
    priority: 3,
    durationMs: 920,
    cooldownMs: 1200,
    vibrate: [180, 80, 260],
    render: (ctx, bus, register) => {
      const start = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(480, start);
      osc.frequency.exponentialRampToValueAtTime(105, start + 0.78);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.095, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.84);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(start);
      osc.stop(start + 0.86);
      register(osc);

      scheduleToneOnBus(ctx, bus, register, 146.83, 360, 'sine', 0.075, 0.36);
    },
  });
}

/** Calm tactical resolution chord when the vote is Skipped */
export function playSkipVoteRevealSound(): void {
  runExclusiveSfx({
    key: 'vote_skip_reveal',
    priority: 3,
    durationMs: 650,
    cooldownMs: 1200,
    vibrate: [60, 40, 90],
    render: (ctx, bus, register) => {
      scheduleToneOnBus(ctx, bus, register, 440, 160, 'sine', 0.075, 0);
      scheduleToneOnBus(ctx, bus, register, 554.37, 190, 'triangle', 0.07, 0.13);
      scheduleToneOnBus(ctx, bus, register, 659.25, 290, 'sine', 0.08, 0.27);
    },
  });
}

/** Tense dual-tone cadence when the vote ends in a Tie */
export function playTieVoteRevealSound(): void {
  runExclusiveSfx({
    key: 'vote_tie_reveal',
    priority: 3,
    durationMs: 680,
    cooldownMs: 1200,
    vibrate: [90, 60, 90],
    render: (ctx, bus, register) => {
      scheduleToneOnBus(ctx, bus, register, 369.99, 170, 'triangle', 0.075, 0);
      scheduleToneOnBus(ctx, bus, register, 349.23, 190, 'triangle', 0.075, 0.19);
      scheduleToneOnBus(ctx, bus, register, 369.99, 250, 'sine', 0.07, 0.39);
    },
  });
}

/** Match victory fanfare differentiated for Crewmates vs Impostors */
export function playVictoryFanfare(winner: 'crewmates' | 'impostors'): void {
  runExclusiveSfx({
    key: `victory_${winner}`,
    priority: 4,
    durationMs: winner === 'crewmates' ? 760 : 1080,
    cooldownMs: 1500,
    vibrate:
      winner === 'crewmates' ? [60, 40, 60, 40, 180] : [220, 90, 320],
    render: (ctx, bus, register) => {
      if (winner === 'crewmates') {
        scheduleToneOnBus(ctx, bus, register, 523.25, 110, 'triangle', 0.085, 0);
        scheduleToneOnBus(ctx, bus, register, 659.25, 110, 'triangle', 0.085, 0.11);
        scheduleToneOnBus(ctx, bus, register, 783.99, 130, 'triangle', 0.09, 0.22);
        scheduleToneOnBus(ctx, bus, register, 1046.5, 360, 'sine', 0.1, 0.34);
      } else {
        scheduleToneOnBus(ctx, bus, register, 293.66, 180, 'sawtooth', 0.068, 0);
        scheduleToneOnBus(ctx, bus, register, 261.63, 180, 'sawtooth', 0.068, 0.19);
        scheduleToneOnBus(ctx, bus, register, 220, 220, 'sawtooth', 0.072, 0.38);
        scheduleToneOnBus(ctx, bus, register, 174.61, 460, 'sawtooth', 0.076, 0.58);
      }
    },
  });
}

/**
 * Dramatic emergency siren tone + [400, 150, 400, 150, 600] vibration pattern
 * triggered when entering MEETING.
 */
export function playEmergencySiren(): void {
  runExclusiveSfx({
    key: 'emergency_siren',
    priority: 3,
    durationMs: 1600,
    cooldownMs: 1500,
    vibrate: [400, 150, 400, 150, 600],
    render: (ctx, bus, register) => {
      const pulses = [0, 0.52, 1.04];
      for (const offset of pulses) {
        const start = ctx.currentTime + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(520, start);
        osc.frequency.linearRampToValueAtTime(880, start + 0.21);
        osc.frequency.linearRampToValueAtTime(480, start + 0.41);

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.08, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.43);

        osc.connect(gain);
        gain.connect(bus);
        osc.start(start);
        osc.stop(start + 0.44);
        register(osc);
      }
    },
  });
}

/**
 * Low flatline tone + 800ms vibration when local player's isAlive changes from true to false.
 */
export function playFlatlineEliminated(): void {
  runExclusiveSfx({
    key: 'flatline_eliminated',
    priority: 3,
    durationMs: 900,
    cooldownMs: 1200,
    vibrate: 800,
    render: (ctx, bus, register) => {
      const start = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, start);
      osc.frequency.exponentialRampToValueAtTime(115, start + 0.78);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.105, start + 0.03);
      gain.gain.setValueAtTime(0.09, start + 0.6);
      gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.85);

      osc.connect(gain);
      gain.connect(bus);
      osc.start(start);
      osc.stop(start + 0.86);
      register(osc);
    },
  });
}

// ---------------------------------------------------------------------------
// Home Screen Ambient Soundscape: Space-Wind Movement + Soft Tactical Pad BGM
// ---------------------------------------------------------------------------

function createWindNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * 4;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const output = buffer.getChannelData(0);

  // Smooth pink/brown hybrid noise for silky, realistic wind gusts (no harsh hiss)
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const sample = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
    b6 = white * 0.115926;
    output[i] = Math.max(-0.9, Math.min(0.9, sample));
  }
  return buffer;
}

function tearDownAmbienceEngine(fadeSec = 0.5): void {
  const engine = ambienceEngine;
  if (!engine) return;
  ambienceEngine = null;
  engine.running = false;

  try {
    const ctx = audioCtx;
    if (ctx) {
      const now = ctx.currentTime;
      engine.masterGain.gain.cancelScheduledValues(now);
      engine.masterGain.gain.setValueAtTime(
        Math.max(0.0001, engine.masterGain.gain.value),
        now
      );
      engine.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSec);
      const stopAt = now + fadeSec + 0.05;
      for (const src of engine.sources) {
        try {
          src.stop(stopAt);
        } catch {
          // already stopped
        }
      }
      setTimeout(() => {
        for (const node of engine.nodes) {
          try {
            node.disconnect();
          } catch {
            // ignore
          }
        }
      }, Math.round((fadeSec + 0.15) * 1000));
    }
  } catch {
    // ignore cleanup errors
  }
}

function bootAmbienceEngineIfAllowed(): void {
  if (!ambienceDesired || ambienceMuted) return;
  if (ambienceEngine?.running) return;

  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx
      .resume()
      .then(() => {
        if (ambienceDesired && !ambienceMuted && !ambienceEngine?.running) {
          bootAmbienceEngineIfAllowed();
        }
      })
      .catch(() => {});
    return;
  }

  try {
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.linearRampToValueAtTime(0.16, now + 1.4);
    masterGain.connect(getMasterInput(ctx));

    const sources: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [masterGain];

    // Layer 1: Sweeping Space-Wind Movement (filtered pink/brown noise + dual slow LFOs)
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = createWindNoiseBuffer(ctx);
    noiseSrc.loop = true;

    const windBandpass = ctx.createBiquadFilter();
    windBandpass.type = 'bandpass';
    windBandpass.frequency.setValueAtTime(340, now);
    windBandpass.Q.setValueAtTime(1.4, now);

    const windLowpass = ctx.createBiquadFilter();
    windLowpass.type = 'lowpass';
    windLowpass.frequency.setValueAtTime(680, now);

    const windGain = ctx.createGain();
    windGain.gain.setValueAtTime(0.55, now);

    // Slow wind-gust pitch sweep LFO
    const windFreqLfo = ctx.createOscillator();
    windFreqLfo.type = 'sine';
    windFreqLfo.frequency.setValueAtTime(0.095, now);
    const windFreqLfoGain = ctx.createGain();
    windFreqLfoGain.gain.setValueAtTime(195, now);
    windFreqLfo.connect(windFreqLfoGain);
    windFreqLfoGain.connect(windBandpass.frequency);

    // Slow wind-gust swell amplitude LFO
    const windAmpLfo = ctx.createOscillator();
    windAmpLfo.type = 'sine';
    windAmpLfo.frequency.setValueAtTime(0.065, now);
    const windAmpLfoGain = ctx.createGain();
    windAmpLfoGain.gain.setValueAtTime(0.22, now);
    windAmpLfo.connect(windAmpLfoGain);
    windAmpLfoGain.connect(windGain.gain);

    noiseSrc.connect(windBandpass);
    windBandpass.connect(windLowpass);
    windLowpass.connect(windGain);
    windGain.connect(masterGain);

    noiseSrc.start(now);
    windFreqLfo.start(now);
    windAmpLfo.start(now);
    sources.push(noiseSrc, windFreqLfo, windAmpLfo);
    nodes.push(
      noiseSrc,
      windBandpass,
      windLowpass,
      windGain,
      windFreqLfo,
      windFreqLfoGain,
      windAmpLfo,
      windAmpLfoGain
    );

    // Layer 2: Atmospheric Deep-Space BGM Pad (soft A-minor-9 cosmic chord)
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.setValueAtTime(420, now);
    padFilter.Q.setValueAtTime(0.7, now);

    const padGain = ctx.createGain();
    padGain.gain.setValueAtTime(0.26, now);
    padFilter.connect(padGain);
    padGain.connect(masterGain);
    nodes.push(padFilter, padGain);

    const padBreathLfo = ctx.createOscillator();
    padBreathLfo.type = 'sine';
    padBreathLfo.frequency.setValueAtTime(0.08, now);
    const padBreathGain = ctx.createGain();
    padBreathGain.gain.setValueAtTime(120, now);
    padBreathLfo.connect(padBreathGain);
    padBreathGain.connect(padFilter.frequency);
    padBreathLfo.start(now);
    sources.push(padBreathLfo);
    nodes.push(padBreathLfo, padBreathGain);

    const chordNotes: { freq: number; type: OscillatorType; gain: number }[] = [
      { freq: 110.0, type: 'sine', gain: 0.22 }, // A2 root
      { freq: 164.81, type: 'triangle', gain: 0.1 }, // E3 fifth
      { freq: 246.94, type: 'sine', gain: 0.08 }, // B3 ninth (spacey mystery)
      { freq: 261.63, type: 'sine', gain: 0.065 }, // C4 minor third
    ];

    for (const note of chordNotes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = note.type;
      osc.frequency.setValueAtTime(note.freq, now);
      g.gain.setValueAtTime(note.gain, now);
      osc.connect(g);
      g.connect(padFilter);
      osc.start(now);
      sources.push(osc);
      nodes.push(osc, g);
    }

    ambienceEngine = {
      masterGain,
      sources,
      nodes,
      running: true,
    };
    notifyAmbienceListeners();
  } catch {
    // Ignore Web Audio errors on locked browsers
  }
}

function handleFirstUserGestureUnlock(): void {
  if (!ambienceDesired || ambienceMuted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  ctx
    .resume()
    .then(() => {
      bootAmbienceEngineIfAllowed();
    })
    .catch(() => {});
}

function ensureGestureUnlockBound(): void {
  if (typeof window === 'undefined' || ambienceUnlockBound) return;
  ambienceUnlockBound = true;
  window.addEventListener('pointerdown', handleFirstUserGestureUnlock, {
    passive: true,
  });
  window.addEventListener('keydown', handleFirstUserGestureUnlock, {
    passive: true,
  });
}

function unbindGestureUnlock(): void {
  if (typeof window === 'undefined' || !ambienceUnlockBound) return;
  ambienceUnlockBound = false;
  window.removeEventListener('pointerdown', handleFirstUserGestureUnlock);
  window.removeEventListener('keydown', handleFirstUserGestureUnlock);
}

export function startHomeAmbience(): void {
  ambienceDesired = true;
  if (ambienceMuted) {
    notifyAmbienceListeners();
    return;
  }
  ensureGestureUnlockBound();
  bootAmbienceEngineIfAllowed();
  notifyAmbienceListeners();
}

export function stopHomeAmbience(): void {
  ambienceDesired = false;
  unbindGestureUnlock();
  tearDownAmbienceEngine(0.55);
  notifyAmbienceListeners();
}

export function isAmbienceMuted(): boolean {
  return ambienceMuted;
}

export function isAmbiencePlaying(): boolean {
  return Boolean(ambienceEngine?.running && !ambienceMuted);
}

export function setAmbienceMuted(muted: boolean): void {
  ambienceMuted = muted;
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(AMBIENCE_MUTE_STORAGE_KEY, muted ? '1' : '0');
    }
  } catch {
    // ignore storage errors
  }

  if (muted) {
    tearDownAmbienceEngine(0.35);
  } else if (ambienceDesired) {
    ensureGestureUnlockBound();
    bootAmbienceEngineIfAllowed();
  }
  notifyAmbienceListeners();
}

export function toggleAmbienceMuted(): boolean {
  setAmbienceMuted(!ambienceMuted);
  return ambienceMuted;
}

export function subscribeAmbienceState(listener: () => void): () => void {
  ambienceListeners.add(listener);
  return () => {
    ambienceListeners.delete(listener);
  };
}
