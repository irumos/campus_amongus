import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bug,
  Building2,
  CheckCircle2,
  CreditCard,
  Fingerprint,
  Radio,
  RotateCcw,
  Server,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { useCampusStations } from '../config/stationStore';
import type { TaskStation } from '../shared/gameData';
import {
  playErrorSound,
  playSuccessSound,
  playTapSound,
  playTone,
  vibratePattern,
} from '../utils/sound';

interface MiniGameModalProps {
  station: TaskStation;
  isFakeTask: boolean;
  onTaskCompleteHaptic?: () => void;
  onComplete: (stationId: string) => void;
  onClose: () => void;
}

const CONDUIT_NODES = [
  { id: 'cyan', label: 'CY-01', hex: '#06b6d4', row: 0 },
  { id: 'emerald', label: 'EM-02', hex: '#10b981', row: 1 },
  { id: 'amber', label: 'AM-03', hex: '#f59e0b', row: 2 },
  { id: 'rose', label: 'CR-04', hex: '#f43f5e', row: 3 },
];

interface GlitchTarget {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  destroyed: boolean;
}

function hapticPulse25() {
  vibratePattern(25);
}

function shuffleArray<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createSimonSequence(): number[] {
  const seq: number[] = [];
  for (let i = 0; i < 4; i++) {
    let next = Math.floor(Math.random() * 9);
    while (i > 0 && next === seq[i - 1]) {
      next = Math.floor(Math.random() * 9);
    }
    seq.push(next);
  }
  return seq;
}

function createGlitchTargets(): GlitchTarget[] {
  return Array.from({ length: 6 }, (_, idx) => {
    const fromLeft = idx % 2 === 0;
    const x = fromLeft ? 10 + Math.random() * 24 : 66 + Math.random() * 24;
    const y = 14 + ((idx * 15) % 68);
    const speedX = 11 + Math.random() * 9;
    const speedY = (Math.random() - 0.5) * 14;
    return {
      id: idx,
      x,
      y,
      vx: fromLeft ? speedX : -speedX,
      vy: speedY,
      destroyed: false,
    };
  });
}

function buildWavePath(
  freq: number,
  amp: number,
  phase: number,
  jaggedness: number
): string {
  const width = 320;
  const centerY = 55;
  const points: string[] = [];
  for (let x = 0; x <= width; x += 6) {
    const t = (x / width) * Math.PI * 2;
    const jitter =
      jaggedness > 0.04
        ? Math.sin(x * 0.45 + phase * 3.1) * jaggedness * 14
        : 0;
    const y = centerY + Math.sin(t * freq + phase) * amp + jitter;
    points.push(`${x === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(' ');
}

export function MiniGameModal({
  station,
  isFakeTask,
  onTaskCompleteHaptic,
  onComplete,
  onClose,
}: MiniGameModalProps) {
  const allStations = useCampusStations();
  const partnerStation = useMemo(
    () =>
      station.relayPartnerId
        ? allStations.find((s) => s.id === station.relayPartnerId)
        : undefined,
    [allStations, station.relayPartnerId]
  );

  const [completed, setCompleted] = useState(false);
  const completedRef = useRef(false);
  const isMountedRef = useRef(true);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extraTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      if (!isMountedRef.current) return;
      fn();
    }, ms);
    extraTimersRef.current.push(id);
    return id;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const extraTimers = extraTimersRef.current;
    return () => {
      isMountedRef.current = false;
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
      extraTimers.forEach(clearTimeout);
    };
  }, []);

  const triggerSuccess = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setCompleted(true);
    if (onTaskCompleteHaptic) {
      onTaskCompleteHaptic();
    } else {
      vibratePattern(65);
    }
    playSuccessSound();
    successTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        onComplete(station.id);
      }
    }, 900);
  }, [onComplete, onTaskCompleteHaptic, station.id]);

  // ── 1. Security Manifold (1-6) ──────────────────────────────────────────────
  const shuffledNumbers = useMemo(
    () => shuffleArray([1, 2, 3, 4, 5, 6]),
    []
  );
  const [nextNumber, setNextNumber] = useState(1);
  const [wrongNum, setWrongNum] = useState<number | null>(null);

  function handleManifoldTap(num: number) {
    if (completed) return;
    if (num === nextNumber) {
      hapticPulse25();
      playTapSound();
      if (num === 6) {
        setNextNumber(7);
        triggerSuccess();
      } else {
        setNextNumber(num + 1);
      }
    } else {
      playErrorSound();
      setWrongNum(num);
      setNextNumber(1);
      scheduleTimeout(() => setWrongNum(null), 350);
    }
  }

  // ── 2. Power Conduits (Wiring) ──────────────────────────────────────────────
  const rightOrder = useMemo(() => shuffleArray(CONDUIT_NODES), []);
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);

  function handleRightConduitTap(rightId: string) {
    if (completed || !selectedLeft) return;
    if (selectedLeft === rightId) {
      hapticPulse25();
      playTapSound();
      const updated = [...connectedIds, rightId];
      setConnectedIds(updated);
      setSelectedLeft(null);
      if (updated.length === CONDUIT_NODES.length) {
        triggerSuccess();
      }
    } else {
      playErrorSound();
      setSelectedLeft(null);
    }
  }

  // ── 3. Hex Firewall Nodes (Shields) ─────────────────────────────────────────
  const [lockedHexes, setLockedHexes] = useState<boolean[]>([
    false,
    true,
    false,
    false,
    true,
    false,
    false,
  ]);

  function handleHexTap(index: number) {
    if (completed || lockedHexes[index]) return;
    hapticPulse25();
    playTapSound();
    const updated = [...lockedHexes];
    updated[index] = true;
    setLockedHexes(updated);
    if (updated.every(Boolean)) {
      triggerSuccess();
    }
  }

  // ── 4. Student ID Swipe ─────────────────────────────────────────────────────
  const [swipeProgress, setSwipeProgress] = useState(0);

  function handleSwipeChange(val: number) {
    if (completed) return;
    setSwipeProgress(val);
    if (val >= 95) {
      hapticPulse25();
      triggerSuccess();
    }
  }

  // ── 5. SIMON_SAYS: Reactor Memory Sequence (3x3 glowing cyan pads) ─────────
  const [simonSequence] = useState<number[]>(() => createSimonSequence());
  const [simonPhase, setSimonPhase] = useState<'showing' | 'input' | 'error'>(
    'showing'
  );
  const [litPad, setLitPad] = useState<number | null>(null);
  const [simonStep, setSimonStep] = useState(0);
  const [simonPlayNonce, setSimonPlayNonce] = useState(0);

  useEffect(() => {
    if (station.miniGame !== 'simon_says' || completed) return;
    let cancelled = false;
    setSimonPhase('showing');
    setSimonStep(0);
    setLitPad(null);

    const timers: ReturnType<typeof setTimeout>[] = [];
    const padNotes = [440, 493, 523, 587, 659, 698, 784, 880, 987];

    simonSequence.forEach((padIdx, i) => {
      const startAt = 350 + i * 560;
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setLitPad(padIdx);
          hapticPulse25();
          playTone(padNotes[padIdx] || 660, 140, 'sine', 0.08);
        }, startAt)
      );
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setLitPad(null);
        }, startAt + 380)
      );
    });

    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        setLitPad(null);
        setSimonPhase('input');
      }, 350 + simonSequence.length * 560 + 80)
    );

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [station.miniGame, simonSequence, simonPlayNonce, completed]);

  function handleSimonPadTap(padIdx: number) {
    if (completed || simonPhase !== 'input') return;
    const expected = simonSequence[simonStep];
    setLitPad(padIdx);
    scheduleTimeout(() => {
      setLitPad((cur) => (cur === padIdx ? null : cur));
    }, 210);

    if (padIdx === expected) {
      hapticPulse25();
      playTone(540 + simonStep * 110, 120, 'triangle', 0.08);
      const next = simonStep + 1;
      setSimonStep(next);
      if (next >= simonSequence.length) {
        triggerSuccess();
      }
    } else {
      playErrorSound();
      setSimonPhase('error');
      setSimonStep(0);
      scheduleTimeout(() => {
        setSimonPlayNonce((n) => n + 1);
      }, 700);
    }
  }

  // ── 6. FREQUENCY_TUNE: Calibrate Comms Antenna ─────────────────────────────
  const [targetWave] = useState(() => ({
    freq: Number((2.2 + Math.random() * 2.8).toFixed(1)),
    amp: Math.round(22 + Math.random() * 18),
  }));
  const [playerFreq, setPlayerFreq] = useState(() =>
    targetWave.freq > 3.5 ? 1.8 : 4.9
  );
  const [playerAmp, setPlayerAmp] = useState(() =>
    targetWave.amp > 30 ? 12 : 38
  );
  const [wavePhase, setWavePhase] = useState(0);

  const freqError = Math.abs(playerFreq - targetWave.freq) / 3.6;
  const ampError = Math.abs(playerAmp - targetWave.amp) / 28;
  const alignmentPct = Math.max(
    0,
    Math.min(100, Math.round((1 - (freqError * 0.55 + ampError * 0.45)) * 100))
  );
  const isWaveLocked = alignmentPct >= 93;

  useEffect(() => {
    if (station.miniGame !== 'frequency_tune' || completed) return;
    let raf = 0;
    let last = performance.now();
    let lastCommit = last;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (now - lastCommit >= 33) {
        const stepDt = (now - lastCommit) / 1000;
        lastCommit = now;
        setWavePhase((p) => p + Math.max(dt, stepDt) * 3.8);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [station.miniGame, completed]);

  useEffect(() => {
    if (station.miniGame !== 'frequency_tune' || completed || !isWaveLocked) {
      return;
    }
    hapticPulse25();
    const timer = setTimeout(() => {
      triggerSuccess();
    }, 420);
    return () => clearTimeout(timer);
  }, [station.miniGame, isWaveLocked, completed, triggerSuccess]);

  // ── 7. ASTEROID_DEFENSE: Clear Campus Firewall (6 red glitch targets) ──────
  const [glitches, setGlitches] = useState<GlitchTarget[]>(() =>
    createGlitchTargets()
  );
  const [radarMissedNote, setRadarMissedNote] = useState(false);

  const wrapNoticeRef = useRef(false);

  useEffect(() => {
    if (station.miniGame !== 'asteroid_defense' || completed) return;
    let raf = 0;
    let last = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let wrapped = false;

      setGlitches((prev) =>
        prev.map((g) => {
          if (g.destroyed) return g;
          let nx = g.x + g.vx * dt;
          let ny = g.y + g.vy * dt;
          const nvx = g.vx;
          let nvy = g.vy;

          if (ny < 12) {
            ny = 12;
            nvy = Math.abs(nvy);
          } else if (ny > 86) {
            ny = 86;
            nvy = -Math.abs(nvy);
          }

          if (nx < 6) {
            nx = 92;
            wrapped = true;
          } else if (nx > 94) {
            nx = 8;
            wrapped = true;
          }

          return { ...g, x: nx, y: ny, vx: nvx, vy: nvy };
        })
      );

      if (wrapped && !wrapNoticeRef.current) {
        wrapNoticeRef.current = true;
        setRadarMissedNote(true);
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [station.miniGame, completed]);

  useEffect(() => {
    if (!radarMissedNote) return;
    const t = setTimeout(() => {
      wrapNoticeRef.current = false;
      setRadarMissedNote(false);
    }, 750);
    return () => clearTimeout(t);
  }, [radarMissedNote]);

  const destroyedCount = glitches.filter((g) => g.destroyed).length;

  function handleDestroyGlitch(id: number) {
    if (completed) return;
    hapticPulse25();
    playTone(760, 80, 'square', 0.06);
    setGlitches((prev) => {
      const next = prev.map((g) =>
        g.id === id ? { ...g, destroyed: true } : g
      );
      if (next.every((g) => g.destroyed)) {
        scheduleTimeout(() => triggerSuccess(), 120);
      }
      return next;
    });
  }

  // ── 8 & 9. BIOMETRIC_HOLD (4s) & DATA_TRANSFER (6s Step1 / 5s Step2) ───────
  const isHoldGame =
    station.miniGame === 'biometric_hold' ||
    station.miniGame === 'data_transfer';
  const holdDurationMs =
    station.miniGame === 'biometric_hold'
      ? 4000
      : station.relayStage === 1
      ? 6000
      : 5000;

  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0); // 0..1
  const [holdInterrupted, setHoldInterrupted] = useState(false);
  const holdStartedAtRef = useRef<number | null>(null);
  const lastPulseBucketRef = useRef<number>(-1);

  useEffect(() => {
    if (!isHoldGame || !isHolding || completed) {
      return;
    }

    holdStartedAtRef.current = performance.now();
    lastPulseBucketRef.current = 0;
    hapticPulse25();

    let raf = 0;
    const tick = (now: number) => {
      const startedAt = holdStartedAtRef.current;
      if (!startedAt) return;
      const elapsed = now - startedAt;
      const ratio = Math.min(1, elapsed / holdDurationMs);
      setHoldProgress(ratio);

      const bucket = Math.floor(elapsed / 800);
      if (bucket > lastPulseBucketRef.current) {
        lastPulseBucketRef.current = bucket;
        hapticPulse25();
        playTone(460 + bucket * 55, 65, 'sine', 0.045);
      }

      if (ratio >= 1) {
        setIsHolding(false);
        triggerSuccess();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isHoldGame, isHolding, holdDurationMs, completed, triggerSuccess]);

  function startHold() {
    if (completed) return;
    setHoldInterrupted(false);
    setIsHolding(true);
  }

  function releaseHold() {
    if (!isHolding || completed) return;
    setIsHolding(false);
    if (holdProgress < 1) {
      playErrorSound();
      setHoldProgress(0);
      setHoldInterrupted(true);
    }
  }

  const isRelayStep1 =
    station.taskCategory === 'LONG_TASK' && station.relayStage === 1;
  const totalHoldSeconds = (holdDurationMs / 1000).toFixed(0);
  const remainingHoldSeconds = Math.max(
    0,
    ((1 - holdProgress) * holdDurationMs) / 1000
  ).toFixed(1);

  const ringRadius = 64;
  const ringCircumference = 2 * Math.PI * ringRadius;

  return (
    <div className="fixed inset-0 z-[60] bg-[#060913]/92 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md glass-card rounded-t-3xl sm:rounded-3xl p-5 relative overflow-hidden max-h-[94dvh] overflow-y-auto">
        {/* Celebratory Full-Screen Emerald Pulse (Identical for Crewmate & Impostor so shoulder-surfers see zero tell) */}
        {completed && (
          <div className="absolute inset-0 z-20 bg-emerald-500/95 flex flex-col items-center justify-center text-center p-6 animate-in fade-in duration-150">
            <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-12 h-12 text-white" />
            </div>
            <h3 className="font-display text-2xl font-extrabold tracking-wider uppercase text-white">
              {isRelayStep1 ? 'RELAY STEP 1/2 DOWNLOADED' : 'OBJECTIVE COMPLETE'}
            </h3>
            <p className="text-xs font-bold text-emerald-50 mt-1.5 max-w-xs">
              {isRelayStep1
                ? `Proceed to ${
                    partnerStation?.roomName || 'Basement • Server Room'
                  } and scan QR to upload logs!`
                : 'Campus Team Task Progress Synchronized'}
            </p>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`px-2 py-0.5 rounded text-[9px] font-mono font-extrabold uppercase ${
                  station.taskCategory === 'LONG_TASK'
                    ? 'bg-amber-500/20 border border-amber-400/50 text-amber-300'
                    : 'bg-cyan-500/15 border border-cyan-400/40 text-cyan-300'
                }`}
              >
                {station.taskCategory === 'LONG_TASK'
                  ? `2-STEP RELAY: ${station.relayStage || 1}/2`
                  : 'SHORT TASK'}
              </span>
              <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-slate-400 truncate">
                {station.shortLabel}
              </span>
            </div>
            <h2 className="font-display text-xl font-extrabold tracking-wide uppercase text-white mt-1">
              {station.taskName}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close mini-game"
            className="min-h-[44px] min-w-[44px] shrink-0 flex items-center justify-center rounded-2xl bg-white/10 text-slate-300 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mini-Game 1: Security Manifold (2x3 neon cyan keypad 1-6) */}
        {station.miniGame === 'manifold' && (
          <div>
            <p className="text-xs text-slate-400 mb-3">
              Tap keypad tiles{' '}
              <span className="text-cyan-300 font-bold">1 → 6</span> in exact
              order.
            </p>
            <div className="grid grid-cols-3 gap-3">
              {shuffledNumbers.map((num) => {
                const isDone = num < nextNumber;
                const isWrong = wrongNum === num;
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleManifoldTap(num)}
                    className={`h-20 rounded-2xl font-display text-2xl font-extrabold tabular-nums border-2 transition-all active:scale-95 ${
                      isDone
                        ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-[0_0_20px_rgba(6,182,212,0.45)]'
                        : isWrong
                        ? 'bg-rose-600/80 border-rose-400 text-white'
                        : 'bg-slate-950/80 border-white/10 text-white hover:border-cyan-400/40'
                    }`}
                  >
                    {num}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Mini-Game 2: Power Conduits (Wiring) */}
        {station.miniGame === 'wiring' && (
          <div>
            <p className="text-xs text-slate-400 mb-4">
              Tap a left terminal, then tap its matching color terminal on the
              right.
            </p>
            <div className="relative">
              <svg
                className="pointer-events-none absolute inset-0 w-full h-full z-10"
                viewBox="0 0 320 254"
                preserveAspectRatio="none"
              >
                {connectedIds.map((id) => {
                  const leftIdx = CONDUIT_NODES.findIndex((n) => n.id === id);
                  const rightIdx = rightOrder.findIndex((n) => n.id === id);
                  const node = CONDUIT_NODES[leftIdx];
                  if (!node || leftIdx < 0 || rightIdx < 0) return null;
                  const y1 = leftIdx * 66 + 28;
                  const y2 = rightIdx * 66 + 28;
                  return (
                    <line
                      key={id}
                      x1="118"
                      y1={y1}
                      x2="202"
                      y2={y2}
                      stroke={node.hex}
                      strokeWidth="5"
                      strokeLinecap="round"
                      style={{ filter: `drop-shadow(0 0 8px ${node.hex})` }}
                    />
                  );
                })}
              </svg>

              <div className="grid grid-cols-2 gap-16">
                <div className="space-y-2.5">
                  {CONDUIT_NODES.map((node) => {
                    const isDone = connectedIds.includes(node.id);
                    const isSelected = selectedLeft === node.id;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        disabled={isDone}
                        onClick={() => {
                          hapticPulse25();
                          playTapSound();
                          setSelectedLeft(node.id);
                        }}
                        className={`h-14 w-full rounded-2xl px-3 flex items-center justify-between font-mono text-xs font-bold border-2 transition-all active:scale-95 ${
                          isSelected
                            ? 'bg-slate-800 border-white text-white scale-[1.03]'
                            : 'bg-slate-950/85 border-white/10 text-slate-200'
                        }`}
                      >
                        <span>{node.label}</span>
                        <span
                          className="w-4 h-4 rounded-full"
                          style={{
                            backgroundColor: node.hex,
                            boxShadow: `0 0 12px ${node.hex}`,
                          }}
                        />
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2.5">
                  {rightOrder.map((node) => {
                    const isDone = connectedIds.includes(node.id);
                    return (
                      <button
                        key={node.id}
                        type="button"
                        disabled={isDone}
                        onClick={() => handleRightConduitTap(node.id)}
                        className={`h-14 w-full rounded-2xl px-3 flex items-center justify-between font-mono text-xs font-bold border-2 transition-all active:scale-95 ${
                          isDone
                            ? 'bg-emerald-950/50 border-emerald-400/60 text-emerald-300'
                            : 'bg-slate-950/85 border-white/10 text-slate-200 hover:border-white/30'
                        }`}
                      >
                        <span
                          className="w-4 h-4 rounded-full"
                          style={{
                            backgroundColor: node.hex,
                            boxShadow: `0 0 12px ${node.hex}`,
                          }}
                        />
                        <span>{isDone ? 'OK' : node.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mini-Game 3: Firewall Nodes (Hex Shields) */}
        {station.miniGame === 'shields' && (
          <div>
            <p className="text-xs text-slate-400 mb-4">
              Tap all red unstable hex nodes to lock them into glowing emerald.
            </p>
            <div className="flex flex-col items-center gap-2 py-1">
              <div className="flex gap-3">
                {[0, 1].map((idx) => (
                  <HexTile
                    key={idx}
                    locked={lockedHexes[idx]}
                    label={`H${idx + 1}`}
                    onTap={() => handleHexTap(idx)}
                  />
                ))}
              </div>
              <div className="flex gap-3 -mt-2">
                {[2, 3, 4].map((idx) => (
                  <HexTile
                    key={idx}
                    locked={lockedHexes[idx]}
                    label={`H${idx + 1}`}
                    onTap={() => handleHexTap(idx)}
                  />
                ))}
              </div>
              <div className="flex gap-3 -mt-2">
                {[5, 6].map((idx) => (
                  <HexTile
                    key={idx}
                    locked={lockedHexes[idx]}
                    label={`H${idx + 1}`}
                    onTap={() => handleHexTap(idx)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Mini-Game 4: Verify Student ID Swipe */}
        {station.miniGame === 'swipe' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              Slide the Student ID badge smoothly across the magnetic terminal.
            </p>
            <div className="rounded-2xl bg-slate-950/85 border border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="flex items-center gap-1.5 text-cyan-300">
                  <CreditCard className="w-4 h-4" />
                  <span>CAMPUS ID READER</span>
                </span>
                <span className="font-mono tabular-nums text-emerald-400">
                  {swipeProgress}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={swipeProgress}
                onChange={(e) => handleSwipeChange(Number(e.target.value))}
                className="w-full h-12 accent-cyan-400 cursor-pointer"
              />
            </div>
            <button
              type="button"
              onClick={() => handleSwipeChange(100)}
              className="h-14 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-display font-extrabold text-sm tracking-wider uppercase active:scale-95 transition-all"
            >
              TAP TO VERIFY ID SWIPE
            </button>
          </div>
        )}

        {/* Mini-Game 5: SIMON_SAYS — Reactor Memory Sequence (3x3 Cyan Pads) */}
        {station.miniGame === 'simon_says' && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-950/80 border border-white/10 px-3 py-2">
              <span className="text-xs font-mono font-bold text-cyan-300">
                {simonPhase === 'showing'
                  ? 'WATCH 4-STEP REACTOR PULSE...'
                  : simonPhase === 'error'
                  ? 'MISMATCH — REPLAYING SEQUENCE...'
                  : `REPEAT SEQUENCE (${simonStep}/4)`}
              </span>
              <button
                type="button"
                disabled={simonPhase === 'showing'}
                onClick={() => {
                  hapticPulse25();
                  setSimonPlayNonce((n) => n + 1);
                }}
                className="px-2.5 py-1 rounded-lg bg-white/10 text-[10px] font-mono font-bold text-slate-200 disabled:opacity-35 flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Replay</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 9 }, (_, idx) => {
                const isLit = litPad === idx;
                const isError = simonPhase === 'error';
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={simonPhase !== 'input'}
                    onClick={() => handleSimonPadTap(idx)}
                    className={`h-20 rounded-2xl border-2 flex flex-col items-center justify-center transition-all active:scale-90 ${
                      isError
                        ? 'bg-rose-950/70 border-rose-500/70'
                        : isLit
                        ? 'bg-cyan-400 border-white shadow-[0_0_28px_rgba(34,211,238,0.95)] scale-[1.03]'
                        : 'bg-slate-950/85 border-cyan-500/25 hover:border-cyan-400/55'
                    }`}
                  >
                    <Sparkles
                      className={`w-6 h-6 ${
                        isLit ? 'text-slate-950' : 'text-cyan-400/50'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Mini-Game 6: FREQUENCY_TUNE — Calibrate Comms Antenna */}
        {station.miniGame === 'frequency_tune' && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300 flex items-center gap-1.5">
                <Radio className="w-4 h-4 text-emerald-400" />
                <span>ALIGN AMBER WAVE → EMERALD TARGET</span>
              </span>
              <span
                className={`font-extrabold tabular-nums px-2 py-0.5 rounded ${
                  isWaveLocked
                    ? 'bg-emerald-500/25 text-emerald-300'
                    : 'bg-amber-500/20 text-amber-300'
                }`}
              >
                {isWaveLocked ? 'LOCKED 100%' : `${alignmentPct}%`}
              </span>
            </div>

            {/* Oscilloscope Display */}
            <div className="rounded-2xl bg-slate-950 border border-white/15 p-2.5 overflow-hidden relative">
              <svg
                viewBox="0 0 320 110"
                className="w-full h-28"
                preserveAspectRatio="none"
              >
                <line
                  x1="0"
                  y1="55"
                  x2="320"
                  y2="55"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="1"
                />
                {/* Target Emerald Wave */}
                <path
                  d={buildWavePath(targetWave.freq, targetWave.amp, wavePhase, 0)}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="3"
                  strokeDasharray="6 4"
                  style={{ filter: 'drop-shadow(0 0 8px rgba(16,185,129,0.75))' }}
                />
                {/* Player Amber Wave */}
                <path
                  d={buildWavePath(
                    playerFreq,
                    playerAmp,
                    wavePhase,
                    isWaveLocked ? 0 : 1 - alignmentPct / 100
                  )}
                  fill="none"
                  stroke={isWaveLocked ? '#34d399' : '#f59e0b'}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  style={{
                    filter: isWaveLocked
                      ? 'drop-shadow(0 0 10px rgba(52,211,153,0.9))'
                      : 'drop-shadow(0 0 8px rgba(245,158,11,0.75))',
                  }}
                />
              </svg>
            </div>

            {/* Two Touch Sliders */}
            <div className="space-y-3 rounded-2xl bg-slate-950/75 border border-white/10 p-3.5">
              <div>
                <div className="flex justify-between text-[11px] font-mono mb-1">
                  <span className="text-cyan-300 font-bold">FREQUENCY</span>
                  <span className="text-white tabular-nums">
                    {playerFreq.toFixed(1)} MHz
                  </span>
                </div>
                <input
                  type="range"
                  min={1.5}
                  max={5.6}
                  step={0.1}
                  value={playerFreq}
                  onChange={(e) => {
                    hapticPulse25();
                    setPlayerFreq(Number(e.target.value));
                  }}
                  className="w-full h-10 accent-amber-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-mono mb-1">
                  <span className="text-cyan-300 font-bold">AMPLITUDE</span>
                  <span className="text-white tabular-nums">{playerAmp} dB</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={42}
                  step={1}
                  value={playerAmp}
                  onChange={(e) => {
                    hapticPulse25();
                    setPlayerAmp(Number(e.target.value));
                  }}
                  className="w-full h-10 accent-emerald-400 cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}

        {/* Mini-Game 7: ASTEROID_DEFENSE — Clear Campus Firewall (6 drifting targets) */}
        {station.miniGame === 'asteroid_defense' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300">
                TAP ALL 6 RED GLITCH TARGETS ON RADAR
              </span>
              <span className="px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 font-extrabold tabular-nums">
                {destroyedCount}/6 CLEARED
              </span>
            </div>

            <div className="relative h-64 w-full rounded-2xl bg-[#040914] border-2 border-cyan-500/35 overflow-hidden touch-none select-none">
              {/* Radar Rings & Crosshair */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-48 rounded-full border border-emerald-500/20" />
                <div className="absolute w-28 h-28 rounded-full border border-emerald-500/25" />
                <div className="absolute inset-x-0 h-px bg-emerald-500/15" />
                <div className="absolute inset-y-0 w-px bg-emerald-500/15" />
              </div>

              {radarMissedNote && (
                <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-[9px] font-mono font-bold text-amber-300">
                  TARGET RE-ROUTING ACROSS RADAR
                </div>
              )}

              {glitches.map((g) => {
                if (g.destroyed) return null;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      handleDestroyGlitch(g.id);
                    }}
                    style={{
                      left: `${g.x}%`,
                      top: `${g.y}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    aria-label={`Destroy glitch ${g.id + 1}`}
                    className="absolute w-14 h-14 rounded-2xl bg-rose-600/90 hover:bg-rose-500 border-2 border-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.85)] flex items-center justify-center active:scale-75 transition-transform"
                  >
                    <Bug className="w-6 h-6 text-white" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Mini-Game 8: BIOMETRIC_HOLD — Verify Lab Access (4s Continuous Hold) */}
        {station.miniGame === 'biometric_hold' && (
          <div className="space-y-4 text-center">
            <p className="text-xs text-slate-300">
              Press &amp; hold the glowing scanner pad continuously for{' '}
              <span className="text-cyan-300 font-bold">4.0 seconds</span>.
            </p>

            <div className="flex flex-col items-center justify-center py-2">
              <div className="relative w-44 h-44 flex items-center justify-center">
                <svg className="w-44 h-44 -rotate-90" viewBox="0 0 150 150">
                  <circle
                    cx="75"
                    cy="75"
                    r={ringRadius}
                    fill="none"
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth="10"
                  />
                  <circle
                    cx="75"
                    cy="75"
                    r={ringRadius}
                    fill="none"
                    stroke={isHolding ? '#22d3ee' : '#10b981'}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringCircumference * (1 - holdProgress)}
                    style={{
                      filter: 'drop-shadow(0 0 12px rgba(34,211,238,0.85))',
                    }}
                  />
                </svg>

                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    try {
                      e.currentTarget.setPointerCapture(e.pointerId);
                    } catch {
                      // ignore pointer capture unsupported
                    }
                    startHold();
                  }}
                  onPointerUp={releaseHold}
                  onPointerCancel={releaseHold}
                  onContextMenu={(e) => e.preventDefault()}
                  className={`absolute w-32 h-32 rounded-full border-2 flex flex-col items-center justify-center gap-1 touch-none select-none transition-all ${
                    isHolding
                      ? 'bg-cyan-500/30 border-cyan-300 scale-95 shadow-[0_0_36px_rgba(34,211,238,0.75)]'
                      : 'bg-slate-950/90 border-cyan-500/45 shadow-[0_0_20px_rgba(6,182,212,0.3)]'
                  }`}
                >
                  <Fingerprint
                    className={`w-12 h-12 ${
                      isHolding ? 'text-cyan-200 animate-pulse' : 'text-cyan-400'
                    }`}
                  />
                  <span className="font-mono text-xs font-extrabold text-white tabular-nums">
                    {isHolding
                      ? `${remainingHoldSeconds}s`
                      : 'HOLD 4s'}
                  </span>
                </button>
              </div>

              {holdInterrupted && (
                <p className="text-[11px] font-mono font-bold text-rose-400 mt-1">
                  Released early! Keep holding continuously for 4 full seconds.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Mini-Game 9: DATA_TRANSFER — Relay Packet Transfer (2-Step Long Task) */}
        {station.miniGame === 'data_transfer' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-300">
              {isRelayStep1
                ? 'Hold the relay terminal for 6 seconds to download Campus Logs before running to the next floor.'
                : 'Hold the server uplink for 5 seconds to upload the Campus Logs.'}
            </p>

            {/* Retro Two-Building Packet Visualizer */}
            <div className="rounded-2xl bg-slate-950/90 border border-cyan-500/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col items-center text-center w-24">
                  <div className="w-11 h-11 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-cyan-300" />
                  </div>
                  <span className="text-[9px] font-mono font-bold text-cyan-200 mt-1 line-clamp-1">
                    {isRelayStep1
                      ? station.shortLabel.split('•').pop()?.trim()
                      : partnerStation?.roomName.split('•').pop()?.trim() ||
                        'Library'}
                  </span>
                </div>

                {/* Animated Data Packet Bus */}
                <div className="flex-1 px-1 space-y-1.5">
                  <div className="relative h-6 rounded-lg bg-slate-900 border border-white/10 overflow-hidden flex items-center px-1 gap-1">
                    {Array.from({ length: 8 }, (_, idx) => {
                      const threshold = (idx + 1) / 8;
                      const active = holdProgress >= threshold;
                      const transferring =
                        isHolding && Math.abs(holdProgress - threshold) < 0.16;
                      return (
                        <div
                          key={idx}
                          className={`flex-1 h-3.5 rounded-sm transition-all duration-150 ${
                            active
                              ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.85)]'
                              : transferring
                              ? 'bg-amber-400 animate-pulse'
                              : 'bg-slate-800'
                          }`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] font-mono font-bold text-slate-400 tabular-nums">
                    <span>
                      PKT {Math.round(holdProgress * 24)}/24
                    </span>
                    <span className="text-emerald-400">
                      {Math.round(holdProgress * 100)}%
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-center text-center w-24">
                  <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center">
                    <Server className="w-5 h-5 text-emerald-300" />
                  </div>
                  <span className="text-[9px] font-mono font-bold text-emerald-200 mt-1 line-clamp-1">
                    {isRelayStep1
                      ? partnerStation?.roomName.split('•').pop()?.trim() ||
                        'Server Room'
                      : station.shortLabel.split('•').pop()?.trim()}
                  </span>
                </div>
              </div>
            </div>

            {holdInterrupted && (
              <div className="text-center text-[11px] font-mono font-bold text-rose-400">
                Connection interrupted! Hold continuously until 100%.
              </div>
            )}

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  // ignore pointer capture unsupported
                }
                startHold();
              }}
              onPointerUp={releaseHold}
              onPointerCancel={releaseHold}
              onContextMenu={(e) => e.preventDefault()}
              className={`w-full h-16 rounded-2xl font-display font-extrabold text-sm tracking-wider uppercase flex items-center justify-center gap-2 touch-none select-none transition-all ${
                isHolding
                  ? 'bg-emerald-500 text-slate-950 scale-[0.98] shadow-[0_0_28px_rgba(16,185,129,0.65)]'
                  : 'bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.4)]'
              }`}
            >
              <span>
                {isHolding
                  ? `TRANSFERRING (${remainingHoldSeconds}s)...`
                  : isRelayStep1
                  ? `HOLD ${totalHoldSeconds}s TO DOWNLOAD LOGS`
                  : `HOLD ${totalHoldSeconds}s TO UPLOAD LOGS`}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function HexTile({
  locked,
  label,
  onTap,
}: {
  locked: boolean;
  label: string;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      style={{
        clipPath: 'polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%)',
      }}
      className={`w-20 h-20 flex flex-col items-center justify-center font-mono text-xs font-extrabold transition-all active:scale-90 ${
        locked
          ? 'bg-emerald-500/85 text-slate-950 shadow-[0_0_24px_rgba(16,185,129,0.7)]'
          : 'bg-rose-600/80 text-white hover:bg-rose-500'
      }`}
    >
      <ShieldAlert className="w-5 h-5 mb-0.5" />
      <span>{locked ? 'LOCKED' : label}</span>
    </button>
  );
}
