import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Crosshair,
  EyeOff,
  Fingerprint,
  Ghost,
  Lock,
  Megaphone,
  Radio,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Skull,
  Smartphone,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import {
  toTaskStation,
  type Player,
  type PlayerRole,
  type PlayerStatus,
  type SabotageState,
} from '../shared/gameData';
import { useCampusStations } from '../config/stationStore';
import { playUiClick } from '../utils/feedback';
import { vibratePattern } from '../utils/sound';

interface GameplayScreenProps {
  myPlayer: Player | null;
  players?: Player[];
  effectiveRole: PlayerRole;
  effectiveStatus: PlayerStatus;
  taskProgress: number;
  sabotage: SabotageState | null;
  isCommsSabotaged?: boolean;
  commsLabel?: string;
  assignedStationIds?: string[];
  killCooldownEnd: number;
  winner: 'crewmates' | 'impostors' | null;
  winReason: string | null;
  onScanStation: (preselectedStationId?: string) => void;
  onReportBody: () => void;
  onEliminateScan: () => void;
  onTriggerSabotage: (type?: 'REACTOR' | 'COMMS') => void;
  onDefuseSabotage: () => void;
  onCallMeeting: () => void;
  onEnterGhostMode: () => void;
  onResetMatch: () => void;
}

const LONG_PRESS_OPS_MS = 450;
const DOUBLE_TAP_WINDOW_MS = 600;
const TOUCH_SLIP_THRESHOLD_PX = 10;
const MAX_ROLL_GAMMA_DEG = 20;
const MIN_PITCH_BETA_DEG = -10;
const MAX_PITCH_BETA_DEG = 74;
const MAX_DELTA_GAMMA_DEG = 11;
const MAX_DELTA_BETA_DEG = 15;

interface OrientationReading {
  beta: number | null;
  gamma: number | null;
}

type DeviceOrientationPermissionConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

function isOrientationTilted(
  current: OrientationReading,
  baseline: OrientationReading | null
): boolean {
  const { beta, gamma } = current;
  if (beta === null && gamma === null) return false;

  if (gamma !== null && Math.abs(gamma) > MAX_ROLL_GAMMA_DEG) {
    return true;
  }
  if (
    beta !== null &&
    (beta < MIN_PITCH_BETA_DEG || beta > MAX_PITCH_BETA_DEG)
  ) {
    return true;
  }

  if (baseline) {
    if (
      gamma !== null &&
      baseline.gamma !== null &&
      Math.abs(gamma - baseline.gamma) > MAX_DELTA_GAMMA_DEG
    ) {
      return true;
    }
    if (
      beta !== null &&
      baseline.beta !== null &&
      Math.abs(beta - baseline.beta) > MAX_DELTA_BETA_DEG
    ) {
      return true;
    }
  }

  return false;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function GameplayScreen({
  myPlayer,
  players = [],
  effectiveRole,
  effectiveStatus,
  taskProgress,
  sabotage,
  isCommsSabotaged = false,
  commsLabel = 'Cyber Lab / Reception',
  assignedStationIds,
  killCooldownEnd,
  winner,
  winReason,
  onScanStation,
  onReportBody,
  onEliminateScan,
  onTriggerSabotage,
  onDefuseSabotage,
  onCallMeeting,
  onEnterGhostMode,
  onResetMatch,
}: GameplayScreenProps) {
  const [roleRevealed, setRoleRevealed] = useState(false);
  const [isPhoneTilted, setIsPhoneTilted] = useState(false);
  const [isWindowHidden, setIsWindowHidden] = useState(false);
  const [covertOpsOpen, setCovertOpsOpen] = useState(false);
  const [holdChargePct, setHoldChargePct] = useState(0);
  const [now, setNow] = useState(Date.now());
  const activeStations = useCampusStations().map(toTaskStation);

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chargeRafRef = useRef<number>(0);
  const holdStartRef = useRef<number>(0);
  const lastTapRef = useRef<number>(0);
  const covertOpenedAtRef = useRef<number>(0);
  const activePointersRef = useRef<Set<number>>(new Set());
  const holdOriginRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const orientationRef = useRef<OrientationReading>({
    beta: null,
    gamma: null,
  });
  const holdBaselineRef = useRef<OrientationReading | null>(null);
  const orientationPermissionRequestedRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  // Always auto-mask covert sheet & role peek if status changes, match ends, or Esc pressed
  useEffect(() => {
    if (winner || effectiveStatus !== 'alive') {
      setRoleRevealed(false);
      setIsPhoneTilted(false);
      setCovertOpsOpen(false);
    }
  }, [winner, effectiveStatus]);

  useEffect(() => {
    if (!covertOpsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCovertOpsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [covertOpsOpen]);

  const clearHoldTimers = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (chargeRafRef.current) {
      cancelAnimationFrame(chargeRafRef.current);
      chargeRafRef.current = 0;
    }
    setHoldChargePct(0);
  }, []);

  useEffect(() => clearHoldTimers, [clearHoldTimers]);

  const engagePrivacyLock = useCallback(
    (alsoMaskCovert = false) => {
      clearHoldTimers();
      activePointersRef.current.clear();
      holdOriginRef.current = null;
      holdBaselineRef.current = null;
      setRoleRevealed(false);
      if (alsoMaskCovert) {
        setCovertOpsOpen(false);
      }
    },
    [clearHoldTimers]
  );

  // Subtle Tilt Sensor Check + Window Focus / Visibility Privacy Guard
  useEffect(() => {
    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null && event.gamma === null) return;
      const reading: OrientationReading = {
        beta: typeof event.beta === 'number' ? event.beta : null,
        gamma: typeof event.gamma === 'number' ? event.gamma : null,
      };
      orientationRef.current = reading;
      const tilted = isOrientationTilted(reading, holdBaselineRef.current);
      setIsPhoneTilted(tilted);
      if (tilted) {
        clearHoldTimers();
      }
    };

    const handleVisibilityOrBlur = () => {
      const hidden = document.visibilityState === 'hidden';
      setIsWindowHidden(hidden || !document.hasFocus());
      engagePrivacyLock(true);
    };

    const handleFocus = () => {
      setIsWindowHidden(document.visibilityState === 'hidden');
    };

    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('blur', handleVisibilityOrBlur);
    window.addEventListener('pagehide', handleVisibilityOrBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrBlur);

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('blur', handleVisibilityOrBlur);
      window.removeEventListener('pagehide', handleVisibilityOrBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrBlur);
    };
  }, [clearHoldTimers, engagePrivacyLock]);

  const requestOrientationSensorIfNeeded = useCallback(() => {
    if (orientationPermissionRequestedRef.current) return;
    orientationPermissionRequestedRef.current = true;
    const ctor = window.DeviceOrientationEvent as
      | DeviceOrientationPermissionConstructor
      | undefined;
    if (ctor && typeof ctor.requestPermission === 'function') {
      void ctor.requestPermission().catch(() => {
        // Ignore denied/unsupported motion permission smoothly
      });
    }
  }, []);

  const openCovertOps = useCallback(() => {
    vibratePattern([25, 45, 25]);
    playUiClick();
    covertOpenedAtRef.current = Date.now();
    lastTapRef.current = 0;
    holdOriginRef.current = null;
    holdBaselineRef.current = null;
    setRoleRevealed(false);
    setCovertOpsOpen(true);
  }, []);

  const startShieldHold = useCallback(() => {
    playUiClick();
    holdBaselineRef.current =
      orientationRef.current.beta !== null ||
      orientationRef.current.gamma !== null
        ? { ...orientationRef.current }
        : null;

    const tiltedNow = isOrientationTilted(
      orientationRef.current,
      holdBaselineRef.current
    );
    setIsPhoneTilted(tiltedNow);
    setRoleRevealed(true);

    if (
      tiltedNow ||
      effectiveRole !== 'impostor' ||
      effectiveStatus !== 'alive'
    ) {
      return;
    }

    const nowMs = Date.now();
    if (nowMs - lastTapRef.current <= DOUBLE_TAP_WINDOW_MS) {
      clearHoldTimers();
      openCovertOps();
      return;
    }
    lastTapRef.current = nowMs;

    holdStartRef.current = performance.now();
    const animateCharge = (ts: number) => {
      if (
        isOrientationTilted(orientationRef.current, holdBaselineRef.current)
      ) {
        clearHoldTimers();
        return;
      }
      const elapsed = ts - holdStartRef.current;
      const pct = Math.min(100, (elapsed / LONG_PRESS_OPS_MS) * 100);
      setHoldChargePct(pct);
      if (pct < 100) {
        chargeRafRef.current = requestAnimationFrame(animateCharge);
      }
    };
    chargeRafRef.current = requestAnimationFrame(animateCharge);

    holdTimerRef.current = setTimeout(() => {
      clearHoldTimers();
      if (
        !isOrientationTilted(orientationRef.current, holdBaselineRef.current)
      ) {
        openCovertOps();
      }
    }, LONG_PRESS_OPS_MS);
  }, [effectiveRole, effectiveStatus, clearHoldTimers, openCovertOps]);

  const handleShieldPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    requestOrientationSensorIfNeeded();

    activePointersRef.current.add(e.pointerId);
    // Multi-touch guard: snap privacy blur shut if >1 finger touches the shield
    if (activePointersRef.current.size > 1) {
      engagePrivacyLock(false);
      return;
    }

    holdOriginRef.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore pointer capture unsupported
    }
    startShieldHold();
  };

  const handleShieldPointerMove = (
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    const origin = holdOriginRef.current;
    if (!origin || origin.pointerId !== e.pointerId) return;
    const distance = Math.hypot(e.clientX - origin.x, e.clientY - origin.y);
    if (distance > TOUCH_SLIP_THRESHOLD_PX) {
      // Very sensitive touch-hold threshold: any slip > 10px immediately engages blur
      engagePrivacyLock(false);
    }
  };

  const handleShieldPointerEnd = (
    e?: React.PointerEvent<HTMLButtonElement>
  ) => {
    if (e) {
      activePointersRef.current.delete(e.pointerId);
    }
    clearHoldTimers();
    holdOriginRef.current = null;
    holdBaselineRef.current = null;
    setRoleRevealed(false);
  };

  const handleShieldPointerLeave = (
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        return;
      }
    } catch {
      // ignore
    }
    handleShieldPointerEnd(e);
  };

  const handleShieldKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.repeat) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      startShieldHold();
    }
  };

  const handleShieldKeyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleShieldPointerEnd();
    }
  };

  const sabotageSecondsLeft = sabotage
    ? Math.max(0, Math.ceil((sabotage.expiresAt - now) / 1000))
    : 0;
  const killCooldownSeconds = Math.max(
    0,
    Math.ceil((killCooldownEnd - now) / 1000)
  );
  const cooldownRatio = Math.min(1, killCooldownSeconds / 30);
  const completedIds = myPlayer?.completedTaskIds || [];

  const fellowImpostors = useMemo(
    () =>
      players.filter(
        (p) => p.role === 'impostor' && p.id !== myPlayer?.id
      ),
    [players, myPlayer?.id]
  );

  const stationAccentByIndex = [
    'bg-cyan-400',
    'bg-emerald-400',
    'bg-amber-400',
    'bg-violet-400',
  ];

  // SCREEN 6A: ELIMINATED BEFORE MEETING
  if (effectiveStatus === 'eliminated' && !winner) {
    return (
      <div className="flex-1 min-h-0 flex flex-col justify-between px-4 pb-4 pt-2">
        <div className="my-auto space-y-4 text-center">
          <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
            <span className="animate-radar absolute inset-0 rounded-full border border-violet-400/50" />
            <div className="relative w-20 h-20 rounded-3xl bg-violet-500/20 border-2 border-violet-400/70 shadow-[0_0_40px_rgba(139,92,246,0.55)] flex items-center justify-center">
              <Skull className="w-10 h-10 text-violet-200" />
            </div>
          </div>

          <div className="glass-card rounded-3xl p-5 border-violet-400/35 space-y-2.5">
            <div className="text-[11px] font-mono font-bold tracking-widest uppercase text-violet-300">
              SIGNAL TERMINATED
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-wide uppercase text-white">
              YOU WERE ELIMINATED
            </h1>
            <p className="text-sm font-medium text-violet-100 leading-relaxed">
              Sit down at this exact spot so Crewmates can find and report your wristband.
            </p>
            <p className="text-xs text-violet-300/80">
              Remain silent and keep your badge visible until a meeting is called.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onEnterGhostMode}
          className="shrink-0 w-full h-14 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-display font-extrabold text-base tracking-wide uppercase flex items-center justify-center gap-2 shadow-[0_0_26px_rgba(139,92,246,0.45)] active:scale-95 transition-all"
        >
          <Ghost className="w-5 h-5" />
          <span>Enter Phantom Mode</span>
        </button>
      </div>
    );
  }

  // Note: Privacy Blur hides all classified role text completely unless the card
  // is actively held steady AND the phone is held flat (not tilted).
  const isCardUnblurred = roleRevealed && !isPhoneTilted && !isWindowHidden;
  const showingImpostorPeek =
    isCardUnblurred &&
    effectiveRole === 'impostor' &&
    effectiveStatus === 'alive';
  const showingCrewmatePeek = isCardUnblurred && !showingImpostorPeek;
  const tiltBlockedDuringHold = roleRevealed && isPhoneTilted;

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-between px-3.5 pb-3 pt-1 gap-2.5">
      {/* Top HUD Region */}
      <div className="shrink-0 space-y-2">
        <div className="glass-card rounded-2xl px-3.5 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-extrabold tracking-wider uppercase">
            <span className="text-slate-300">
              Team Tasks{' '}
              <span className="text-emerald-400 font-mono tabular-nums ml-1">
                {taskProgress}%
              </span>
            </span>
            {effectiveStatus === 'alive' && (
              <button
                type="button"
                onClick={onCallMeeting}
                className="min-h-[28px] px-1.5 -mr-1.5 rounded-lg text-[11px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors"
              >
                <Megaphone className="w-3.5 h-3.5" />
                <span>Call Meeting</span>
              </button>
            )}
          </div>

          <div className="h-3 w-full rounded-full bg-slate-950/90 border border-white/10 p-0.5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 shadow-[0_0_12px_rgba(16,185,129,0.7)] transition-all duration-500 ease-out"
              style={{ width: `${Math.min(100, Math.max(4, taskProgress))}%` }}
            />
          </div>
        </div>

        {/* Active Sabotage Banner (Identical for Crewmate & Impostor) */}
        {sabotage && (
          <div className="animate-siren rounded-2xl border-2 border-rose-500 px-3 py-2 flex items-center justify-between gap-2 shadow-[0_0_20px_rgba(244,63,94,0.45)]">
            <div className="flex items-center gap-1.5 min-w-0">
              <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0" />
              <div className="text-[11px] font-extrabold tracking-wide text-white truncate font-mono tabular-nums">
                {sabotage.type === 'reactor'
                  ? `MELTDOWN · ${formatClock(sabotageSecondsLeft)} · ${sabotage.label.replace(/^REACTOR MELTDOWN · /, '')}`
                  : sabotage.label}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onScanStation(sabotage.targetStationId)}
              className="shrink-0 min-h-[32px] px-2.5 rounded-lg bg-rose-500 text-white text-[10px] font-extrabold uppercase"
            >
              Defuse
            </button>
          </div>
        )}

        {/* Phantom Ghost Banner */}
        {effectiveStatus === 'ghost' && (
          <div className="rounded-2xl bg-violet-950/80 border border-violet-400/50 px-3 py-2 flex items-center gap-2">
            <Ghost className="w-4 h-4 text-violet-300 shrink-0" />
            <span className="text-[11px] font-bold text-violet-100 leading-tight">
              Phantom Mode · Stay silent and finish remaining objectives
            </span>
          </div>
        )}
      </div>

      {/* Middle Area: Privacy Shield + Campus Objectives */}
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        {/* TACTICAL PRIVACY SHIELD (Hardware Tilt + Sensitive Hold + Privacy Blur Overlay) */}
        <button
          type="button"
          onPointerDown={handleShieldPointerDown}
          onPointerMove={handleShieldPointerMove}
          onPointerUp={handleShieldPointerEnd}
          onPointerCancel={handleShieldPointerEnd}
          onPointerLeave={handleShieldPointerLeave}
          onKeyDown={handleShieldKeyDown}
          onKeyUp={handleShieldKeyUp}
          onBlur={() => handleShieldPointerEnd()}
          onDragStart={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Press and hold flat and steady to unblur your classified identity"
          className={`relative overflow-hidden w-full min-h-[66px] rounded-2xl p-3 text-left transition-colors duration-150 touch-callout-none touch-none select-none glass-card shrink-0 flex items-center ${
            !isCardUnblurred
              ? tiltBlockedDuringHold
                ? 'border-amber-400/45 bg-slate-950/90'
                : 'border-white/15 hover:border-white/25'
              : showingImpostorPeek
              ? 'bg-rose-950/85 border-rose-400/75 shadow-[0_0_26px_rgba(244,63,94,0.35)]'
              : 'bg-cyan-950/85 border-cyan-400/75 shadow-[0_0_26px_rgba(6,182,212,0.35)]'
          }`}
        >
          {/* Hold-charge indicator bar visible ONLY while Impostor is holding flat */}
          {showingImpostorPeek && holdChargePct > 0 && (
            <div
              className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-rose-400 transition-none z-20"
              style={{ width: `${holdChargePct}%` }}
            />
          )}

          {/* Layer 1: Classified Role Layer (Text unmounted & blurred unless held steady & flat) */}
          <div
            aria-hidden={!isCardUnblurred}
            className={`w-full transition-all duration-100 ${
              isCardUnblurred
                ? 'opacity-100 blur-0'
                : 'opacity-0 blur-xl scale-[0.98] pointer-events-none'
            }`}
          >
            {showingImpostorPeek ? (
              <div className="w-full flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-lg font-extrabold tracking-wider uppercase text-rose-400 leading-none">
                      IMPOSTOR
                    </span>
                    {fellowImpostors.length > 0 && (
                      <span className="text-[10px] font-mono font-bold text-rose-200 truncate">
                        Ally:{' '}
                        {fellowImpostors
                          .map((p) => `#${p.badgeNumber}`)
                          .join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] font-bold tracking-wide text-rose-100/90 mt-1">
                    Hold 0.5s or double-tap for Covert Ops
                  </div>
                </div>

                <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
                  <svg className="w-10 h-10 -rotate-90" viewBox="0 0 44 44">
                    <circle
                      cx="22"
                      cy="22"
                      r="18"
                      fill="none"
                      stroke="rgba(255,255,255,0.12)"
                      strokeWidth="3.5"
                    />
                    <circle
                      cx="22"
                      cy="22"
                      r="18"
                      fill="none"
                      stroke="#f43f5e"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 18}
                      strokeDashoffset={2 * Math.PI * 18 * (1 - cooldownRatio)}
                    />
                  </svg>
                  <span className="absolute font-mono text-[10px] font-extrabold text-white tabular-nums">
                    {killCooldownSeconds}s
                  </span>
                </div>
              </div>
            ) : showingCrewmatePeek ? (
              <div className="w-full flex items-center justify-between gap-2.5">
                <div>
                  <div className="font-display text-lg font-extrabold tracking-wider uppercase text-cyan-300 leading-none">
                    CREWMATE
                  </div>
                  <div className="text-[10px] font-bold tracking-wide uppercase text-cyan-100 mt-1">
                    Complete assigned objectives
                  </div>
                </div>
                <span className="text-[11px] font-mono font-bold text-cyan-200 tabular-nums shrink-0">
                  {completedIds.length}/
                  {assignedStationIds?.length || activeStations.length} Scans
                </span>
              </div>
            ) : (
              /* Redacted dummy bars while blurred so zero classified text exists in layout or DOM */
              <div className="w-full flex items-center justify-between gap-2.5">
                <div className="space-y-1.5">
                  <div className="h-4 w-28 rounded bg-slate-600/40" />
                  <div className="h-2.5 w-40 rounded bg-slate-700/40" />
                </div>
                <div className="h-6 w-12 rounded-lg bg-slate-700/40" />
              </div>
            )}
          </div>

          {/* Layer 2: Frosted Privacy Blur Overlay (100% Identical for Crewmate & Impostor) */}
          <div
            className={`absolute inset-0 z-10 px-3 flex items-center justify-between gap-2.5 backdrop-blur-2xl transition-opacity duration-100 ${
              isCardUnblurred
                ? 'opacity-0 pointer-events-none'
                : tiltBlockedDuringHold
                ? 'opacity-100 bg-slate-950/92'
                : 'opacity-100 bg-[#0b1222]/88'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                  tiltBlockedDuringHold
                    ? 'bg-amber-500/15 border-amber-400/45'
                    : 'bg-slate-800/90 border-white/15'
                }`}
              >
                {tiltBlockedDuringHold ? (
                  <Smartphone className="w-5 h-5 text-amber-300" />
                ) : (
                  <Fingerprint className="w-5 h-5 text-cyan-300" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-display text-xs font-extrabold tracking-wider uppercase text-white">
                  <Lock
                    className={`w-3 h-3 shrink-0 ${
                      tiltBlockedDuringHold
                        ? 'text-amber-300'
                        : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate">
                    {tiltBlockedDuringHold
                      ? 'Tilt Guard Locked'
                      : 'Identity Classified'}
                  </span>
                </div>
                <div
                  className={`text-[10px] font-semibold truncate ${
                    tiltBlockedDuringHold ? 'text-amber-200/85' : 'text-slate-400'
                  }`}
                >
                  {tiltBlockedDuringHold
                    ? 'Phone tilted · Hold flat to unblur'
                    : 'Hold flat & steady to peek'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-slate-400 shrink-0">
              {tiltBlockedDuringHold ? (
                <EyeOff className="w-3.5 h-3.5 text-amber-300" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400/80" />
              )}
              <span>{tiltBlockedDuringHold ? 'Tilted' : 'Privacy Blur'}</span>
            </div>
          </div>
        </button>

        {/* CAMPUS OBJECTIVES: Assigned Stations Grid (Identical for Crewmate & Impostor) */}
        <div className="space-y-1.5 min-h-0 flex-1 flex flex-col">
          {(() => {
            const visibleStations =
              assignedStationIds && assignedStationIds.length > 0
                ? activeStations.filter((s) => assignedStationIds.includes(s.id))
                : activeStations;

            const visibleIdSet = new Set(visibleStations.map((s) => s.id));
            const consumedIds = new Set<string>();

            interface ObjectiveCardItem {
              key: string;
              scanStationId: string;
              badgeLabel: string;
              isLongRelay: boolean;
              locationLabel: string;
              taskTitle: string;
              subHint?: string;
              isDone: boolean;
            }

            const objectiveCards: ObjectiveCardItem[] = [];

            for (const station of visibleStations) {
              if (consumedIds.has(station.id)) continue;

              if (
                station.taskCategory === 'LONG_TASK' &&
                station.relayPartnerId &&
                visibleIdSet.has(station.relayPartnerId)
              ) {
                const partner = visibleStations.find(
                  (s) => s.id === station.relayPartnerId
                );
                if (partner) {
                  const step1 = station.relayStage === 1 ? station : partner;
                  const step2 = station.relayStage === 2 ? station : partner;
                  consumedIds.add(step1.id);
                  consumedIds.add(step2.id);

                  const step1Done = completedIds.includes(step1.id);
                  const step2Done = completedIds.includes(step2.id);
                  const activeStep = step1Done ? step2 : step1;
                  const allDone = step1Done && step2Done;

                  objectiveCards.push({
                    key: `${step1.id}_${step2.id}`,
                    scanStationId: activeStep.id,
                    badgeLabel: allDone
                      ? '2-STEP RELAY · 2/2'
                      : step1Done
                      ? '2-STEP RELAY · 2/2'
                      : '2-STEP RELAY · 1/2',
                    isLongRelay: true,
                    locationLabel: activeStep.shortLabel,
                    taskTitle: activeStep.taskName,
                    subHint: allDone
                      ? 'Multi-floor relay complete'
                      : step1Done
                      ? 'Downloaded · Upload at server'
                      : `Then → ${step2.shortLabel}`,
                    isDone: allDone,
                  });
                  continue;
                }
              }

              consumedIds.add(station.id);
              objectiveCards.push({
                key: station.id,
                scanStationId: station.id,
                badgeLabel:
                  station.taskCategory === 'LONG_TASK'
                    ? `2-STEP RELAY · ${station.relayStage || 1}/2`
                    : 'SHORT TASK',
                isLongRelay: station.taskCategory === 'LONG_TASK',
                locationLabel: station.shortLabel,
                taskTitle: station.taskName,
                isDone: completedIds.includes(station.id),
              });
            }

            const completedObjectivesCount = objectiveCards.filter(
              (c) => c.isDone
            ).length;

            return (
              <>
                <div className="flex items-center justify-between px-0.5 shrink-0">
                  <h2 className="font-display text-[11px] font-extrabold tracking-widest uppercase text-slate-400">
                    Campus Objectives
                  </h2>
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                    {completedObjectivesCount}/{objectiveCards.length} Done
                  </span>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-0.5">
                  <div className="grid grid-cols-2 gap-2 pb-0.5">
                    {objectiveCards.map((obj, idx) => {
                      const isLastOdd =
                        objectiveCards.length % 2 === 1 &&
                        idx === objectiveCards.length - 1;
                      const barColor = obj.isDone
                        ? 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.7)]'
                        : obj.isLongRelay
                        ? 'bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.65)]'
                        : stationAccentByIndex[idx % stationAccentByIndex.length];

                      return (
                        <button
                          key={obj.key}
                          type="button"
                          onClick={() => onScanStation(obj.scanStationId)}
                          className={`glass-card rounded-2xl p-2.5 flex flex-col justify-between gap-1.5 text-left transition-all active:scale-95 ${
                            isLastOdd || obj.isLongRelay
                              ? 'col-span-2 min-h-[64px]'
                              : 'min-h-[76px]'
                          } ${
                            obj.isDone
                              ? 'border-emerald-500/45 bg-emerald-950/30'
                              : obj.isLongRelay
                              ? 'border-amber-400/35 hover:border-amber-400/60'
                              : 'hover:border-white/25'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5 w-full">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`w-3.5 h-1 rounded-full shrink-0 ${barColor}`} />
                              <span
                                className={`text-[9px] font-mono font-extrabold tracking-wide truncate ${
                                  obj.isDone
                                    ? 'text-emerald-300'
                                    : obj.isLongRelay
                                    ? 'text-amber-300'
                                    : 'text-cyan-300'
                                }`}
                              >
                                {obj.badgeLabel}
                              </span>
                            </div>
                            {obj.isDone ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : (
                              <span className="text-[9px] font-mono font-bold text-slate-400 shrink-0">
                                QR
                              </span>
                            )}
                          </div>

                          <div className="space-y-0.5">
                            <div className="text-[10px] font-mono font-bold tracking-wide text-slate-300 leading-tight line-clamp-1">
                              {isCommsSabotaged
                                ? 'SIGNAL JAMMED · OFFLINE'
                                : obj.locationLabel}
                            </div>
                            <div
                              className={`font-display text-xs font-extrabold leading-tight ${
                                obj.isDone
                                  ? 'text-emerald-300 line-through opacity-80'
                                  : 'text-white'
                              }`}
                            >
                              {isCommsSabotaged
                                ? `Restore Comms at ${commsLabel}`
                                : obj.taskTitle}
                            </div>
                            {!isCommsSabotaged && obj.subHint && (
                              <div className="text-[10px] font-mono text-amber-200/80 leading-tight">
                                {obj.subHint}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Unified Floating Bottom Action Dock (100% Identical for Crewmates & Impostors) */}
      <div className="shrink-0 glass-card rounded-2xl p-2">
        {effectiveStatus === 'ghost' ? (
          <button
            type="button"
            onClick={() => onScanStation()}
            className="w-full h-14 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-500 text-slate-950 font-display font-extrabold text-sm tracking-wide uppercase flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(139,92,246,0.45)] active:scale-95 transition-all"
          >
            <Camera className="w-5 h-5" />
            <span>Scan Task QR (Phantom)</span>
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onScanStation()}
              className="h-14 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-display font-extrabold text-xs tracking-wide uppercase flex items-center justify-center gap-1.5 px-2 shadow-[0_0_20px_rgba(6,182,212,0.4)] active:scale-95 transition-all whitespace-nowrap"
            >
              <Camera className="w-4 h-4 shrink-0" />
              <span>Scan Task QR</span>
            </button>
            <button
              type="button"
              onClick={onReportBody}
              className="h-14 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-display font-extrabold text-xs tracking-wide uppercase flex items-center justify-center gap-1.5 px-2 shadow-[0_0_20px_rgba(244,63,94,0.45)] active:scale-95 transition-all whitespace-nowrap"
            >
              <Megaphone className="w-4 h-4 shrink-0" />
              <span>Report Body</span>
            </button>
          </div>
        )}
      </div>

      {/* Spacious Covert Impostor Operations Bottom Sheet (Hidden behind Double-Tap / 0.45s Hold) */}
      {covertOpsOpen && effectiveRole === 'impostor' && effectiveStatus === 'alive' && (
        <div
          onClick={(e) => {
            if (
              e.target !== e.currentTarget ||
              Date.now() - covertOpenedAtRef.current < 450
            ) {
              return;
            }
            setCovertOpsOpen(false);
          }}
          className="fixed inset-0 z-50 bg-[#060913]/88 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md glass-card rounded-t-3xl sm:rounded-3xl p-5 space-y-4 border-rose-500/35"
          >
            <div className="w-10 h-1.5 bg-white/20 rounded-full mx-auto -mt-1 sm:hidden" />

            {/* Sheet Header */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-400/50 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5 text-rose-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display text-base font-extrabold tracking-wider uppercase text-white">
                    Covert Operations
                  </h3>
                  <p className="text-[11px] font-mono text-rose-200/80 truncate">
                    Tap Mask anytime to hide screen
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setCovertOpsOpen(false);
                }}
                className="min-h-[44px] px-3 rounded-xl bg-slate-900 border border-white/15 text-slate-200 hover:text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
              >
                <EyeOff className="w-4 h-4 text-cyan-300" />
                <span>Mask</span>
              </button>
            </div>

            {/* Cooldown + Fellow Impostor Status Card */}
            <div className="rounded-2xl bg-slate-950/85 border border-white/10 p-3.5 flex items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400">
                  Elimination Status
                </div>
                <div
                  className={`font-display text-sm font-extrabold uppercase ${
                    killCooldownSeconds > 0 ? 'text-amber-300' : 'text-rose-400'
                  }`}
                >
                  {killCooldownSeconds > 0
                    ? `Cooldown · ${killCooldownSeconds}s`
                    : 'Target Lock Ready'}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300">
                  <Users className="w-3.5 h-3.5 text-rose-300 shrink-0" />
                  <span className="truncate">
                    {fellowImpostors.length > 0
                      ? `Allies: ${fellowImpostors
                          .map((p) => `#${p.badgeNumber} ${p.name}`)
                          .join(', ')}`
                      : 'Solo Impostor'}
                  </span>
                </div>
              </div>

              <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
                <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
                  <circle
                    cx="22"
                    cy="22"
                    r="18"
                    fill="none"
                    stroke="rgba(255,255,255,0.12)"
                    strokeWidth="3.5"
                  />
                  <circle
                    cx="22"
                    cy="22"
                    r="18"
                    fill="none"
                    stroke={killCooldownSeconds > 0 ? '#f59e0b' : '#f43f5e'}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 18}
                    strokeDashoffset={2 * Math.PI * 18 * (1 - cooldownRatio)}
                  />
                </svg>
                <span className="absolute font-mono text-[11px] font-extrabold text-white tabular-nums">
                  {killCooldownSeconds}s
                </span>
              </div>
            </div>

            {/* Primary Action: Eliminate Wristband */}
            <button
              type="button"
              disabled={killCooldownSeconds > 0}
              onClick={() => {
                setCovertOpsOpen(false);
                onEliminateScan();
              }}
              className="w-full h-14 rounded-2xl bg-rose-600 hover:bg-rose-500 disabled:bg-rose-950/80 disabled:text-rose-300/60 disabled:border disabled:border-rose-500/30 text-white font-display font-extrabold text-sm tracking-wide uppercase flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(244,63,94,0.45)] active:scale-95 transition-all"
            >
              <Crosshair className="w-5 h-5 shrink-0" />
              <span>
                {killCooldownSeconds > 0
                  ? `Cooldown Active (${killCooldownSeconds}s)`
                  : 'Eliminate (Scan Wristband)'}
              </span>
            </button>

            {/* Sabotage Grid */}
            <div className="space-y-2">
              <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400">
                Sabotage Protocols
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    onTriggerSabotage('REACTOR');
                    setCovertOpsOpen(false);
                  }}
                  className="h-12 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/50 text-rose-200 font-display font-extrabold text-xs tracking-wide uppercase flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Reactor (45s)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onTriggerSabotage('COMMS');
                    setCovertOpsOpen(false);
                  }}
                  className="h-12 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-extrabold text-xs tracking-wide uppercase flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                >
                  <Radio className="w-4 h-4 shrink-0" />
                  <span>Jam Comms</span>
                </button>
              </div>

              {sabotage && (
                <button
                  type="button"
                  onClick={() => {
                    onDefuseSabotage();
                    setCovertOpsOpen(false);
                  }}
                  className="w-full h-11 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
                >
                  <Zap className="w-4 h-4 text-emerald-400" />
                  <span>Clear Active Sabotage</span>
                </button>
              )}
            </div>

            {/* Secondary Cover Actions */}
            <div className="grid grid-cols-2 gap-2.5 pt-1 border-t border-white/10">
              <button
                type="button"
                onClick={() => {
                  setCovertOpsOpen(false);
                  onScanStation();
                }}
                className="h-11 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5"
              >
                <Camera className="w-4 h-4 text-cyan-300" />
                <span>Fake Task Scan</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCovertOpsOpen(false);
                  onReportBody();
                }}
                className="h-11 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5"
              >
                <Megaphone className="w-4 h-4 text-rose-400" />
                <span>Report Body</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Match Victory Overlay */}
      {winner && (
        <div className="fixed inset-0 z-50 bg-[#060913]/92 backdrop-blur-xl flex items-center justify-center p-5">
          <div className="w-full max-w-md glass-card rounded-3xl p-6 text-center space-y-5">
            <div
              className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center ${
                winner === 'crewmates'
                  ? 'bg-cyan-500/20 border border-cyan-400/50 text-cyan-300 shadow-[0_0_30px_rgba(6,182,212,0.45)]'
                  : 'bg-rose-500/20 border border-rose-400/50 text-rose-300 shadow-[0_0_30px_rgba(244,63,94,0.45)]'
              }`}
            >
              <Trophy className="w-9 h-9" />
            </div>
            <div>
              <h2
                className={`font-display text-3xl font-extrabold tracking-wider uppercase ${
                  winner === 'crewmates' ? 'text-cyan-300' : 'text-rose-400'
                }`}
              >
                {winner === 'crewmates' ? 'Crewmates Win!' : 'Impostors Win!'}
              </h2>
              <p className="text-sm text-slate-300 mt-1.5">{winReason}</p>
            </div>
            <button
              type="button"
              onClick={onResetMatch}
              className="w-full h-14 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-display font-extrabold text-base tracking-wider uppercase flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <RotateCcw className="w-5 h-5" />
              <span>Return to Lobby</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
