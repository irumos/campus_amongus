import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Crosshair,
  Eye,
  EyeOff,
  Fingerprint,
  Ghost,
  History,
  Lock,
  LogOut,
  MapPin,
  Megaphone,
  Pin,
  Radio,
  ShieldAlert,
  Skull,
  Star,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import {
  getBadgeInfo,
  toTaskStation,
  type Player,
  type PlayerRole,
  type PlayerStatus,
  type SabotageState,
} from '../shared/gameData';
import type { ImpostorOpsLogEntry } from '../hooks/useCampusGame';
import { useCampusStations } from '../config/stationStore';
import { TOURNAMENT_SCORING_RULES } from '../config/tournamentStore';
import {
  playPhantomChime,
  playUiClick,
  playVictoryFanfare,
} from '../utils/feedback';
import { vibratePattern } from '../utils/sound';
import { CampusMinimap } from './CampusMinimap';

interface GameplayScreenProps {
  myPlayer: Player | null;
  players?: Player[];
  effectiveRole: PlayerRole;
  effectiveStatus: PlayerStatus;
  taskProgress: number;
  sabotage: SabotageState | null;
  sabotageStationIds?: string[];
  isCommsSabotaged?: boolean;
  commsLabel?: string;
  assignedStationIds?: string[];
  killCooldownEnd: number;
  isMeetingLocked?: boolean;
  impostorOpsLog?: ImpostorOpsLogEntry[];
  observingPlayer?: {
    name: string;
    badgeNumber: string;
    role: PlayerRole;
  } | null;
  onExitPov?: () => void;
  winner: 'crewmates' | 'impostors' | null;
  winReason: string | null;
  hostBadgeId?: string | null;
  isHost?: boolean;
  onScanStation: (preselectedStationId?: string) => void;
  onReportBody: () => void;
  onEliminateScan: () => void;
  onBlockedKillAttempt?: (cooldownSeconds: number) => void;
  onTriggerSabotage: (type?: 'REACTOR' | 'COMMS') => void;
  onDefuseSabotage: () => void;
  onCallMeeting: () => void;
  onEnterGhostMode: () => void;
  onResetMatch: () => void | Promise<void>;
  onExitMatch?: () => void;
  onOpenLeaderboard?: () => void;
}

const LONG_PRESS_OPS_MS = 450;
const DOUBLE_TAP_WINDOW_MS = 600;

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatLogTimestamp(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '--:--:--';
  }
}

function formatRelativeElapsed(ts: number, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${mins}m ${String(secs).padStart(2, '0')}s ago`;
}

export function GameplayScreen({
  myPlayer,
  players = [],
  effectiveRole,
  effectiveStatus,
  taskProgress,
  sabotage,
  sabotageStationIds,
  isCommsSabotaged = false,
  commsLabel = 'Cyber Lab / Reception',
  assignedStationIds,
  killCooldownEnd,
  isMeetingLocked = false,
  impostorOpsLog = [],
  observingPlayer = null,
  onExitPov,
  winner,
  winReason,
  hostBadgeId = null,
  isHost: isHostProp,
  onScanStation,
  onReportBody,
  onEliminateScan,
  onBlockedKillAttempt,
  onTriggerSabotage,
  onDefuseSabotage,
  onCallMeeting,
  onEnterGhostMode,
  onResetMatch,
  onExitMatch,
  onOpenLeaderboard,
}: GameplayScreenProps) {
  const [roleRevealed, setRoleRevealed] = useState(false);
  const [covertOpsOpen, setCovertOpsOpen] = useState(false);
  const [covertTab, setCovertTab] = useState<'ops' | 'log'>('ops');
  const [logFilter, setLogFilter] = useState<'all' | 'kills' | 'sabotages'>('all');
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [rematchBusy, setRematchBusy] = useState(false);
  const [holdChargePct, setHoldChargePct] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [progressDelta, setProgressDelta] = useState<number | null>(null);
  const [progressPulse, setProgressPulse] = useState(false);
  const [manualCurrentStationId, setManualCurrentStationId] = useState<
    string | null
  >(null);
  const pinStorageKey = `cairl_pinned_station_v1_${myPlayer?.id || 'local'}`;
  const [pinnedStationId, setPinnedStationId] = useState<string | null>(() => {
    try {
      return typeof window !== 'undefined'
        ? localStorage.getItem(`cairl_pinned_station_v1_${myPlayer?.id || 'local'}`)
        : null;
    } catch {
      return null;
    }
  });
  const activeStations = useCampusStations().map(toTaskStation);

  // Keep personal pinned station synced if player identity / Dev POV switches
  useEffect(() => {
    try {
      const saved = localStorage.getItem(pinStorageKey);
      setPinnedStationId(saved || null);
    } catch {
      setPinnedStationId(null);
    }
  }, [pinStorageKey]);

  const handleTogglePinStation = useCallback(
    (stationId: string) => {
      setPinnedStationId((prev) => {
        const next = prev === stationId ? null : stationId;
        try {
          if (next) {
            localStorage.setItem(pinStorageKey, next);
          } else {
            localStorage.removeItem(pinStorageKey);
          }
        } catch {
          // ignore storage errors
        }
        return next;
      });
    },
    [pinStorageKey]
  );

  // Validated pinned station ID (ignores stale IDs if stations were edited/deleted)
  const effectivePinnedStationId = useMemo(() => {
    if (!pinnedStationId) return null;
    return activeStations.some((s) => s.id === pinnedStationId)
      ? pinnedStationId
      : null;
  }, [pinnedStationId, activeStations]);

  const clampedTaskProgress = Math.max(
    0,
    Math.min(100, Math.round(Number.isFinite(taskProgress) ? taskProgress : 0))
  );

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chargeRafRef = useRef<number>(0);
  const holdStartRef = useRef<number>(0);
  const lastTapRef = useRef<number>(0);
  const covertOpenedAtRef = useRef<number>(0);
  const prevWinnerRef = useRef<'crewmates' | 'impostors' | null>(null);
  const prevTaskProgressRef = useRef<number>(clampedTaskProgress);
  const progressPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevTaskProgressRef.current;
    if (clampedTaskProgress > prev) {
      const diff = clampedTaskProgress - prev;
      setProgressDelta(diff);
      setProgressPulse(true);
      if (progressPulseTimerRef.current) {
        clearTimeout(progressPulseTimerRef.current);
      }
      progressPulseTimerRef.current = setTimeout(() => {
        setProgressPulse(false);
        setProgressDelta(null);
      }, 2800);
    } else if (clampedTaskProgress < prev) {
      setProgressDelta(null);
      setProgressPulse(false);
    }
    prevTaskProgressRef.current = clampedTaskProgress;
  }, [clampedTaskProgress]);

  useEffect(() => {
    return () => {
      if (progressPulseTimerRef.current) {
        clearTimeout(progressPulseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  // Auto-hide covert sheet & role peek if status changes or match ends
  useEffect(() => {
    if (winner || effectiveStatus !== 'alive') {
      setRoleRevealed(false);
      setCovertOpsOpen(false);
    }
    if (winner) {
      setConfirmExitOpen(false);
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

  const openCovertOps = useCallback(() => {
    vibratePattern([25, 45, 25]);
    playUiClick();
    covertOpenedAtRef.current = Date.now();
    lastTapRef.current = 0;
    setRoleRevealed(false);
    setCovertOpsOpen(true);
  }, []);

  const startShieldHold = useCallback(() => {
    playUiClick();
    setRoleRevealed(true);

    if (effectiveRole !== 'impostor' || effectiveStatus === 'eliminated') {
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
      openCovertOps();
    }, LONG_PRESS_OPS_MS);
  }, [effectiveRole, effectiveStatus, clearHoldTimers, openCovertOps]);

  const handleShieldPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore pointer capture unsupported
    }
    startShieldHold();
  };

  const handleShieldPointerEnd = () => {
    clearHoldTimers();
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
    handleShieldPointerEnd();
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

  // Victory fanfare SFX when winner transitions from null
  useEffect(() => {
    if (winner && prevWinnerRef.current !== winner) {
      playVictoryFanfare(winner);
    }
    prevWinnerRef.current = winner;
  }, [winner]);

  const killCooldownSeconds = Math.max(
    0,
    Math.ceil((killCooldownEnd - now) / 1000)
  );
  const cooldownRatio = Math.min(1, killCooldownSeconds / 30);
  const completedIds = myPlayer?.completedTaskIds || [];

  // Resolve the player's current task station for relative minimap sabotage navigation
  const resolvedCurrentStationId = useMemo(() => {
    if (
      manualCurrentStationId &&
      activeStations.some((s) => s.id === manualCurrentStationId)
    ) {
      return manualCurrentStationId;
    }
    const assignedPool =
      assignedStationIds && assignedStationIds.length > 0
        ? activeStations.filter((s) => assignedStationIds.includes(s.id))
        : activeStations;
    const nextIncomplete = assignedPool.find(
      (s) => !completedIds.includes(s.id)
    );
    if (nextIncomplete) return nextIncomplete.id;
    const lastCompleted = completedIds[completedIds.length - 1];
    if (lastCompleted && activeStations.some((s) => s.id === lastCompleted)) {
      return lastCompleted;
    }
    return assignedPool[0]?.id || activeStations[0]?.id || null;
  }, [
    manualCurrentStationId,
    activeStations,
    assignedStationIds,
    completedIds,
  ]);

  const activeSabotageIdsForMap = useMemo(() => {
    if (!sabotage) return [];
    if (sabotageStationIds && sabotageStationIds.length > 0) {
      return sabotageStationIds;
    }
    return sabotage.targetStationId ? [sabotage.targetStationId] : [];
  }, [sabotage, sabotageStationIds]);

  const handleScanStationWithTracking = useCallback(
    (stationId?: string) => {
      if (stationId) {
        setManualCurrentStationId(stationId);
      }
      onScanStation(stationId);
    },
    [onScanStation]
  );

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

  const exitConfirmationModal = confirmExitOpen && onExitMatch && (
    <div
      onClick={() => setConfirmExitOpen(false)}
      className="fixed inset-0 z-50 bg-[#060913]/90 backdrop-blur-md flex items-center justify-center p-5"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm glass-card rounded-3xl p-5 space-y-4 border-rose-500/35 text-center"
      >
        <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-400/40 flex items-center justify-center mx-auto">
          <LogOut className="w-6 h-6 text-rose-400" />
        </div>
        <div className="space-y-1.5">
          <h3 className="font-display text-lg font-extrabold tracking-wide uppercase text-white">
            Exit Active Match?
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            You will leave this room immediately and all remaining operatives will receive a live exit update.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => {
              playUiClick();
              setConfirmExitOpen(false);
            }}
            className="min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/15 text-xs font-bold uppercase tracking-wider text-slate-200 active:scale-95 transition-all"
          >
            Stay
          </button>
          <button
            type="button"
            onClick={() => {
              playUiClick();
              setConfirmExitOpen(false);
              onExitMatch();
            }}
            className="min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-extrabold uppercase tracking-wider text-white shadow-[0_0_20px_rgba(244,63,94,0.35)] active:scale-95 transition-all"
          >
            Exit Match
          </button>
        </div>
      </div>
    </div>
  );

  // SCREEN 6A: ELIMINATED BEFORE ENTERING PHANTOM MODE
  if (effectiveStatus === 'eliminated' && !winner) {
    return (
      <div className="flex-1 min-h-0 flex flex-col justify-between px-4 sm:px-5 pb-4 pt-2 gap-3">
        <div className="flex items-center justify-between gap-2 shrink-0">
          {observingPlayer ? (
            <div className="flex items-center gap-2 rounded-xl bg-amber-500/15 border border-amber-400/45 px-2.5 py-1.5 text-[10px] font-mono font-bold text-amber-200">
              <Eye className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span>
                POV: #{observingPlayer.badgeNumber} {observingPlayer.name}
              </span>
              {onExitPov && (
                <button
                  type="button"
                  onClick={onExitPov}
                  className="ml-1 px-1.5 py-0.5 rounded bg-amber-400/20 text-white hover:bg-amber-400/35"
                >
                  Exit
                </button>
              )}
            </div>
          ) : (
            <div />
          )}

          {onExitMatch && (
            <button
              type="button"
              onClick={() => {
                playUiClick();
                setConfirmExitOpen(true);
              }}
              className="min-h-[38px] px-3 rounded-xl bg-slate-900/85 hover:bg-rose-950/80 border border-white/15 hover:border-rose-500/40 text-[11px] font-bold uppercase tracking-wider text-slate-200 hover:text-rose-200 inline-flex items-center gap-1.5 transition-colors active:scale-95"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Exit Match</span>
            </button>
          )}
        </div>

        {/* Live Global Team Task Progress Bar (visible even while entering Phantom Mode) */}
        <div className="shrink-0 glass-card rounded-2xl px-3.5 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px] font-extrabold tracking-wider uppercase">
            <span className="inline-flex items-center gap-1.5 text-slate-200">
              <span
                className={`w-2 h-2 rounded-full ${
                  isCommsSabotaged
                    ? 'bg-amber-400 animate-pulse'
                    : progressPulse
                    ? 'bg-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.95)]'
                    : 'bg-emerald-400'
                }`}
              />
              <span>Team Task Progress</span>
            </span>
            <span className="font-mono tabular-nums text-emerald-400 flex items-center gap-1.5">
              {!isCommsSabotaged && progressDelta !== null && (
                <span className="text-[10px] font-extrabold text-cyan-300 animate-pulse">
                  +{progressDelta}%
                </span>
              )}
              <span>{isCommsSabotaged ? 'OFFLINE' : `${clampedTaskProgress}%`}</span>
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Global Team Task Progress"
            aria-valuenow={isCommsSabotaged ? undefined : clampedTaskProgress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="relative h-3 w-full rounded-full bg-slate-950/90 border border-white/12 p-0.5 overflow-hidden"
          >
            {isCommsSabotaged ? (
              <div className="h-full w-full rounded-full bg-amber-500/20 flex items-center justify-center text-[8px] font-mono font-bold tracking-widest uppercase text-amber-300">
                COMMS JAMMED
              </div>
            ) : (
              <>
                <div
                  className="relative h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 shadow-[0_0_12px_rgba(16,185,129,0.7)] transition-[width] duration-700 ease-out overflow-hidden"
                  style={{ width: `${clampedTaskProgress}%` }}
                >
                  {progressPulse && (
                    <span
                      aria-hidden="true"
                      className="animate-progress-sweep pointer-events-none absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent"
                    />
                  )}
                </div>
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/4 w-px bg-slate-950/70" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2/4 w-px bg-slate-950/70" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3/4 w-px bg-slate-950/70" />
              </>
            )}
          </div>
        </div>

        <div className="my-auto space-y-4 text-center">
          <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
            <span className="animate-radar absolute inset-0 rounded-full border border-rose-500/55" />
            <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-rose-600/30 to-violet-600/30 border-2 border-rose-400/75 shadow-[0_0_40px_rgba(244,63,94,0.45)] flex items-center justify-center">
              <Skull className="w-10 h-10 text-rose-200" />
            </div>
          </div>

          <div className="glass-card rounded-3xl p-5 border-rose-400/40 space-y-3">
            <div className="text-[11px] font-mono font-bold tracking-widest uppercase text-rose-300">
              OPERATIVE ELIMINATED · RED HEADBAND PROTOCOL
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-wide uppercase text-white">
              YOU WERE ELIMINATED
            </h1>
            <div className="rounded-2xl bg-rose-500/15 border border-rose-400/40 px-3.5 py-2.5 text-left space-y-1.5">
              <p className="text-xs sm:text-sm font-bold text-rose-100 leading-relaxed">
                1. Put on the <span className="text-rose-300 underline decoration-rose-400/70">Red Headband</span> given to you immediately so other players can identify that you are eliminated and scan your ID Card to report.
              </p>
              <p className="text-xs sm:text-sm font-semibold text-violet-100 leading-relaxed">
                2. Do not sit idle — enter <span className="text-violet-300 font-extrabold">Phantom Mode</span> now and keep moving silently to complete your remaining campus missions!
              </p>
            </div>
            <p className="text-[11px] text-slate-300">
              Remain completely silent during gameplay and meetings. Keep your ID Card visible.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            playPhantomChime();
            onEnterGhostMode();
          }}
          className="shrink-0 w-full h-14 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-display font-extrabold text-base tracking-wide uppercase flex items-center justify-center gap-2 shadow-[0_0_26px_rgba(139,92,246,0.45)] active:scale-95 transition-all"
        >
          <Ghost className="w-5 h-5" />
          <span>Enter Phantom Mode &amp; Resume Missions</span>
        </button>

        {exitConfirmationModal}
      </div>
    );
  }

  const showingImpostorPeek =
    roleRevealed &&
    effectiveRole === 'impostor' &&
    effectiveStatus === 'alive';

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-between px-3.5 sm:px-5 pb-3 sm:pb-4 pt-1 gap-2 sm:gap-2.5">
      {/* Top HUD Region */}
      <div className="shrink-0 space-y-2">
        {observingPlayer && (
          <div className="rounded-xl bg-amber-500/15 border border-amber-400/50 px-3 py-1.5 flex items-center justify-between gap-2 text-[11px] font-mono">
            <div className="flex items-center gap-1.5 text-amber-200 min-w-0">
              <Eye className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span className="truncate font-bold">
                DEV POV · #{observingPlayer.badgeNumber} {observingPlayer.name}{' '}
                ({observingPlayer.role.toUpperCase()})
              </span>
            </div>
            {onExitPov && (
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  onExitPov();
                }}
                className="shrink-0 px-2 py-0.5 rounded-lg bg-amber-400/25 hover:bg-amber-400/40 text-amber-100 font-bold text-[10px] uppercase"
              >
                My POV
              </button>
            )}
          </div>
        )}

        <div
          className={`glass-card rounded-2xl px-3.5 py-2.5 space-y-2 transition-colors duration-300 ${
            progressPulse && !isCommsSabotaged
              ? 'border-emerald-400/55 shadow-[0_0_24px_rgba(16,185,129,0.22)]'
              : isCommsSabotaged
              ? 'border-amber-400/50'
              : ''
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-[11px] font-extrabold tracking-wider uppercase">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-slate-200 truncate">
                <span
                  aria-hidden="true"
                  className={`w-2 h-2 rounded-full shrink-0 transition-all ${
                    isCommsSabotaged
                      ? 'bg-amber-400 animate-pulse'
                      : progressPulse
                      ? 'bg-emerald-300 scale-125 shadow-[0_0_12px_rgba(52,211,153,0.95)]'
                      : 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)]'
                  }`}
                />
                <span className="truncate">Total Tasks</span>
                <span
                  className={`font-mono tabular-nums ml-0.5 ${
                    isCommsSabotaged ? 'text-amber-300' : 'text-emerald-400'
                  }`}
                >
                  {isCommsSabotaged ? 'JAMMED' : `${clampedTaskProgress}%`}
                </span>
                {!isCommsSabotaged && progressDelta !== null && (
                  <span className="font-mono text-[10px] font-extrabold text-cyan-300 tabular-nums animate-pulse">
                    +{progressDelta}%
                  </span>
                )}
              </div>
              {myPlayer && (
                <div className="text-[10px] font-mono font-semibold text-slate-400 normal-case tracking-normal truncate mt-0.5">
                  #{myPlayer.badgeNumber} · {myPlayer.name}
                  <span aria-hidden="true" className="mx-1 text-slate-600">·</span>
                  <span className="text-cyan-300">
                    {getBadgeInfo(myPlayer.badgeNumber).callsign}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {effectiveStatus === 'alive' && (
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    onCallMeeting();
                  }}
                  className="min-h-[42px] px-3 rounded-xl bg-amber-500/18 hover:bg-amber-500/28 active:scale-95 border border-amber-400/50 text-[11px] font-extrabold text-amber-200 flex items-center gap-1.5 transition-all whitespace-nowrap shadow-[0_0_16px_rgba(245,158,11,0.18)]"
                >
                  <Megaphone className="w-3.5 h-3.5 shrink-0" />
                  <span>Call Meeting</span>
                </button>
              )}
              {onExitMatch && (
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    setConfirmExitOpen(true);
                  }}
                  title="Exit Active Match"
                  className="min-h-[42px] px-2.5 rounded-xl bg-slate-900/85 hover:bg-rose-950/80 active:scale-95 border border-white/12 hover:border-rose-500/45 text-[11px] font-bold text-slate-300 hover:text-rose-200 flex items-center gap-1 transition-all whitespace-nowrap"
                >
                  <LogOut className="w-3.5 h-3.5 shrink-0" />
                  <span>Exit</span>
                </button>
              )}
            </div>
          </div>

          <div
            role="progressbar"
            aria-label="Global Team Task Progress"
            aria-valuenow={isCommsSabotaged ? undefined : clampedTaskProgress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="relative h-4 w-full rounded-full bg-slate-950/90 border border-white/12 p-0.5 overflow-hidden"
          >
            {isCommsSabotaged ? (
              <div className="h-full w-full rounded-full bg-amber-500/20 flex items-center justify-center text-[9px] font-mono font-extrabold tracking-widest uppercase text-amber-300">
                COMMS SABOTAGED · PROGRESS OFFLINE
              </div>
            ) : (
              <>
                <div
                  className="relative h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 shadow-[0_0_16px_rgba(16,185,129,0.75)] transition-[width] duration-700 ease-out overflow-hidden"
                  style={{ width: `${clampedTaskProgress}%` }}
                >
                  {progressPulse && (
                    <span
                      aria-hidden="true"
                      className="animate-progress-sweep pointer-events-none absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/75 to-transparent"
                    />
                  )}
                  {clampedTaskProgress > 0 && clampedTaskProgress < 100 && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute right-0 inset-y-0 w-1.5 bg-white/80 blur-[1px]"
                    />
                  )}
                </div>
                {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((mark) => (
                  <span
                    key={mark}
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-y-0 w-px ${
                      mark === 50 ? 'bg-slate-950/85' : 'bg-slate-950/55'
                    }`}
                    style={{ left: `${mark}%` }}
                  />
                ))}
              </>
            )}
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
              className="shrink-0 min-h-[36px] px-3 rounded-lg bg-rose-500 text-white text-[10px] font-extrabold uppercase active:scale-95"
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
              Phantom Mode · Wear your Red Headband · Stay silent &amp; finish remaining missions
            </span>
          </div>
        )}
      </div>

      {/* Middle Area: Role Card + Campus Objectives */}
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        {/* Clean Hold-to-Reveal Role Card (Identical Resting State for Crewmate & Impostor) */}
        <button
          type="button"
          onPointerDown={handleShieldPointerDown}
          onPointerUp={handleShieldPointerEnd}
          onPointerCancel={handleShieldPointerEnd}
          onPointerLeave={handleShieldPointerLeave}
          onKeyDown={handleShieldKeyDown}
          onKeyUp={handleShieldKeyUp}
          onBlur={handleShieldPointerEnd}
          onDragStart={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Press and hold to view your role"
          className={`relative overflow-hidden w-full min-h-[64px] rounded-2xl p-3 text-left transition-colors duration-150 touch-callout-none touch-none select-none glass-card shrink-0 flex items-center ${
            !roleRevealed
              ? 'border-white/15 hover:border-white/25'
              : showingImpostorPeek
              ? 'bg-rose-950/85 border-rose-400/75 shadow-[0_0_24px_rgba(244,63,94,0.3)]'
              : 'bg-cyan-950/85 border-cyan-400/75 shadow-[0_0_24px_rgba(6,182,212,0.3)]'
          }`}
        >
          {/* Hold-charge indicator bar visible only while Impostor is holding */}
          {showingImpostorPeek && holdChargePct > 0 && (
            <div
              className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-rose-400 transition-none z-10"
              style={{ width: `${holdChargePct}%` }}
            />
          )}

          {!roleRevealed ? (
            <div className="w-full flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-slate-900/90 border border-cyan-400/30 flex items-center justify-center shrink-0 shadow-[0_0_14px_rgba(6,182,212,0.18)]">
                  <Fingerprint className="w-5 h-5 text-cyan-300" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-display text-xs font-extrabold tracking-wider uppercase text-white">
                    <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="truncate">Role Shield Locked</span>
                  </div>
                  <div className="text-[11px] font-medium text-slate-300 truncate">
                    Press &amp; hold to privately inspect role
                  </div>
                </div>
              </div>
              <span className="text-[11px] font-mono font-bold text-cyan-300 shrink-0">
                HOLD
              </span>
            </div>
          ) : showingImpostorPeek ? (
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
          ) : (
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
          )}
        </button>

        {/* Tactical Campus Minimap (auto-expands on active sabotage with relative route guidance) */}
        <CampusMinimap
          stations={activeStations}
          assignedStationIds={
            assignedStationIds && assignedStationIds.length > 0
              ? assignedStationIds
              : activeStations.map((s) => s.id)
          }
          completedStationIds={completedIds}
          currentStationId={resolvedCurrentStationId}
          pinnedStationId={effectivePinnedStationId}
          sabotage={sabotage}
          sabotageStationIds={activeSabotageIdsForMap}
          isCommsSabotaged={isCommsSabotaged}
          onSelectCurrentStation={(id) => setManualCurrentStationId(id)}
          onTogglePinStation={handleTogglePinStation}
          onScanStation={handleScanStationWithTracking}
        />

        {/* CAMPUS OBJECTIVES: Assigned Stations Grid (Identical for Crewmate & Impostor) */}
        <div className="space-y-1.5 min-h-0 flex-1 flex flex-col">
          {(() => {
            const visibleStations =
              assignedStationIds && assignedStationIds.length > 0
                ? activeStations.filter((s) => assignedStationIds.includes(s.id))
                : activeStations;

            const sabotageStationIdSet = new Set<string>(
              sabotage
                ? sabotageStationIds && sabotageStationIds.length > 0
                  ? sabotageStationIds
                  : sabotage.targetStationId
                  ? [sabotage.targetStationId]
                  : []
                : []
            );

            const visibleIdSet = new Set(visibleStations.map((s) => s.id));
            const consumedIds = new Set<string>();
            const matchedSabotageIds = new Set<string>();

            interface ObjectiveCardItem {
              key: string;
              scanStationId: string;
              badgeLabel: string;
              isLongRelay: boolean;
              locationLabel: string;
              taskTitle: string;
              subHint?: string;
              isDone: boolean;
              sabotageMatchId: string | null;
              isSabotageOnly?: boolean;
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

                  const sabotageMatchId = sabotageStationIdSet.has(step1.id)
                    ? step1.id
                    : sabotageStationIdSet.has(step2.id)
                    ? step2.id
                    : null;
                  if (sabotageMatchId) {
                    matchedSabotageIds.add(sabotageMatchId);
                  }
                  const sabotageStation =
                    sabotageMatchId === step1.id
                      ? step1
                      : sabotageMatchId === step2.id
                      ? step2
                      : null;

                  objectiveCards.push({
                    key: `${step1.id}_${step2.id}`,
                    scanStationId: sabotageMatchId || activeStep.id,
                    badgeLabel: allDone
                      ? '2-STEP RELAY · 2/2'
                      : step1Done
                      ? '2-STEP RELAY · 2/2'
                      : '2-STEP RELAY · 1/2',
                    isLongRelay: true,
                    locationLabel: sabotageStation
                      ? sabotageStation.shortLabel
                      : activeStep.shortLabel,
                    taskTitle: activeStep.taskName,
                    subHint: allDone
                      ? 'Multi-floor relay complete'
                      : step1Done
                      ? 'Downloaded · Upload at server'
                      : `Then → ${step2.shortLabel}`,
                    isDone: allDone,
                    sabotageMatchId,
                  });
                  continue;
                }
              }

              consumedIds.add(station.id);
              const sabotageMatchId = sabotageStationIdSet.has(station.id)
                ? station.id
                : null;
              if (sabotageMatchId) {
                matchedSabotageIds.add(sabotageMatchId);
              }

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
                sabotageMatchId,
              });
            }

            // If an active sabotage station is outside the player's assigned subset, pin it to the list
            if (sabotage && sabotageStationIdSet.size > 0) {
              const extraSabotageCards: ObjectiveCardItem[] = [];
              for (const sabId of sabotageStationIdSet) {
                if (matchedSabotageIds.has(sabId)) continue;
                const sabStation = activeStations.find((s) => s.id === sabId);
                if (!sabStation) continue;
                extraSabotageCards.push({
                  key: `sabotage_${sabStation.id}`,
                  scanStationId: sabStation.id,
                  badgeLabel:
                    sabotage.type === 'reactor'
                      ? 'EMERGENCY LOCATION'
                      : 'COMMS RELAY',
                  isLongRelay: true,
                  locationLabel: sabStation.shortLabel,
                  taskTitle:
                    sabotage.type === 'reactor'
                      ? 'Defuse Reactor Meltdown'
                      : 'Restore Campus Comms',
                  subHint: 'Scan station QR here to clear alert',
                  isDone: false,
                  sabotageMatchId: sabStation.id,
                  isSabotageOnly: true,
                });
              }
              if (extraSabotageCards.length > 0) {
                objectiveCards.unshift(...extraSabotageCards);
              }
            }

            const assignedCards = objectiveCards.filter(
              (c) => !c.isSabotageOnly
            );
            const completedObjectivesCount = assignedCards.filter(
              (c) => c.isDone
            ).length;

            const pinnedStationObj = effectivePinnedStationId
              ? activeStations.find((s) => s.id === effectivePinnedStationId) ||
                null
              : null;

            return (
              <>
                <div className="flex items-center justify-between gap-2 px-0.5 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="font-display text-[11px] font-extrabold tracking-widest uppercase text-slate-400 shrink-0">
                      Campus Objectives
                    </h2>
                    {pinnedStationObj && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-yellow-300 truncate">
                        <Star className="w-3 h-3 fill-yellow-300 shrink-0" />
                        <span className="truncate">
                          {pinnedStationObj.shortLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            playUiClick();
                            handleTogglePinStation(pinnedStationObj.id);
                          }}
                          className="text-slate-400 hover:text-white underline ml-0.5 shrink-0"
                        >
                          Clear
                        </button>
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                    {completedObjectivesCount}/{assignedCards.length} Done
                  </span>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-0.5">
                  <div className="grid grid-cols-2 gap-2 sm:gap-2.5 pb-0.5">
                    {objectiveCards.map((obj, idx) => {
                      const isLastOdd =
                        objectiveCards.length % 2 === 1 &&
                        idx === objectiveCards.length - 1;
                      const isSabotageTarget = Boolean(
                        sabotage && obj.sabotageMatchId
                      );
                      const isReactorTarget =
                        isSabotageTarget && sabotage?.type === 'reactor';
                      const targetStationIdForCard =
                        obj.sabotageMatchId || obj.scanStationId;
                      const isPinnedTarget =
                        effectivePinnedStationId === targetStationIdForCard;
                      const barColor = obj.isDone
                        ? 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.7)]'
                        : isPinnedTarget
                        ? 'bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.75)]'
                        : obj.isLongRelay
                        ? 'bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.65)]'
                        : stationAccentByIndex[idx % stationAccentByIndex.length];

                      return (
                        <div
                          key={obj.key}
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            handleScanStationWithTracking(targetStationIdForCard)
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleScanStationWithTracking(
                                targetStationIdForCard
                              );
                            }
                          }}
                          className={`relative overflow-hidden glass-card rounded-2xl p-2.5 sm:p-3.5 flex flex-col justify-between gap-1.5 text-left transition-all active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                            isLastOdd || obj.isLongRelay
                              ? 'col-span-2 min-h-[clamp(60px,8.5dvh,78px)]'
                              : 'min-h-[clamp(68px,10dvh,88px)]'
                          } ${
                            isReactorTarget
                              ? 'border-2 border-rose-400/80 bg-rose-950/40 hover:border-rose-300 ring-1 ring-rose-500/40 animate-sabotage-glow-reactor'
                              : isSabotageTarget
                              ? 'border-2 border-amber-400/80 bg-amber-950/38 hover:border-amber-300 ring-1 ring-amber-400/40 animate-sabotage-glow-comms'
                              : isPinnedTarget
                              ? 'border-yellow-400/70 bg-yellow-950/20 shadow-[0_0_18px_rgba(250,204,21,0.16)]'
                              : obj.isDone
                              ? 'border-emerald-500/45 bg-emerald-950/30'
                              : obj.isLongRelay
                              ? 'border-amber-400/35 hover:border-amber-400/60'
                              : 'hover:border-white/25'
                          }`}
                        >
                          {isSabotageTarget && (
                            <span
                              aria-hidden="true"
                              className={`pointer-events-none absolute inset-y-0 -left-1/3 w-1/2 animate-sabotage-sweep bg-gradient-to-r from-transparent ${
                                isReactorTarget
                                  ? 'via-rose-400/22'
                                  : 'via-amber-300/22'
                              } to-transparent`}
                            />
                          )}
                          <div className="relative z-10 flex items-center justify-between gap-1.5 w-full">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isSabotageTarget ? (
                                <span
                                  aria-hidden="true"
                                  className="relative flex h-2.5 w-2.5 shrink-0"
                                >
                                  <span
                                    className={`animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full opacity-80 ${
                                      isReactorTarget
                                        ? 'bg-rose-400'
                                        : 'bg-amber-400'
                                    }`}
                                  />
                                  <span
                                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                                      isReactorTarget
                                        ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)]'
                                        : 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.9)]'
                                    }`}
                                  />
                                </span>
                              ) : (
                                <span
                                  className={`w-3.5 h-1 rounded-full shrink-0 ${barColor}`}
                                />
                              )}
                              <span
                                className={`text-[9px] font-mono font-extrabold tracking-wide truncate ${
                                  isReactorTarget
                                    ? 'text-rose-300'
                                    : isSabotageTarget
                                    ? 'text-amber-300'
                                    : isPinnedTarget
                                    ? 'text-yellow-300'
                                    : obj.isDone
                                    ? 'text-emerald-300'
                                    : obj.isLongRelay
                                    ? 'text-amber-300'
                                    : 'text-cyan-300'
                                }`}
                              >
                                {isReactorTarget
                                  ? 'SABOTAGE · DEFUSE HERE'
                                  : isSabotageTarget
                                  ? 'COMMS · RESTORE HERE'
                                  : isPinnedTarget
                                  ? `★ TARGET · ${obj.badgeLabel}`
                                  : obj.badgeLabel}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  playUiClick();
                                  handleTogglePinStation(targetStationIdForCard);
                                }}
                                aria-label={
                                  isPinnedTarget
                                    ? `Unpin ${obj.locationLabel} from minimap`
                                    : `Pin ${obj.locationLabel} as target on minimap`
                                }
                                title={
                                  isPinnedTarget
                                    ? 'Unpin Target from Minimap'
                                    : 'Pin as Target on Minimap'
                                }
                                className={`min-h-[28px] min-w-[28px] rounded-lg flex items-center justify-center border transition-colors ${
                                  isPinnedTarget
                                    ? 'bg-yellow-400/20 border-yellow-400/60 text-yellow-300'
                                    : 'bg-slate-900/70 border-white/10 text-slate-400 hover:text-yellow-200 hover:border-yellow-400/40'
                                }`}
                              >
                                {isPinnedTarget ? (
                                  <Star className="w-3.5 h-3.5 fill-yellow-300" />
                                ) : (
                                  <Pin className="w-3.5 h-3.5" />
                                )}
                              </button>
                              {isSabotageTarget ? (
                                <span
                                  className={`inline-flex items-center gap-1 text-[9px] font-mono font-extrabold uppercase shrink-0 ${
                                    isReactorTarget
                                      ? 'text-rose-300'
                                      : 'text-amber-300'
                                  }`}
                                >
                                  {isReactorTarget ? (
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                  ) : (
                                    <Radio className="w-3.5 h-3.5 shrink-0" />
                                  )}
                                  <span>{isReactorTarget ? 'Defuse' : 'Fix'}</span>
                                </span>
                              ) : obj.isDone ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                              ) : (
                                <span className="text-[9px] font-mono font-bold text-slate-400 shrink-0">
                                  QR
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="space-y-0.5">
                            <div
                              className={`text-[10px] font-mono font-bold tracking-wide leading-tight flex items-center gap-1 ${
                                isReactorTarget
                                  ? 'text-rose-200'
                                  : isSabotageTarget
                                  ? 'text-amber-200'
                                  : 'text-slate-300'
                              }`}
                            >
                              {isSabotageTarget && (
                                <MapPin className="w-3 h-3 shrink-0" />
                              )}
                              <span className="line-clamp-1">
                                {isCommsSabotaged && !isSabotageTarget
                                  ? 'SIGNAL JAMMED · OFFLINE'
                                  : obj.locationLabel}
                              </span>
                            </div>
                            <div
                              className={`font-display text-xs font-extrabold leading-tight ${
                                obj.isDone && !isSabotageTarget
                                  ? 'text-emerald-300 line-through opacity-80'
                                  : 'text-white'
                              }`}
                            >
                              {isCommsSabotaged && !isSabotageTarget
                                ? `Restore Comms at ${commsLabel}`
                                : obj.taskTitle}
                            </div>
                            {isSabotageTarget ? (
                              <div
                                className={`text-[10px] font-mono leading-tight ${
                                  isReactorTarget
                                    ? 'text-rose-200/85'
                                    : 'text-amber-200/85'
                                }`}
                              >
                                {isReactorTarget
                                  ? 'Active sabotage location · Scan QR to defuse'
                                  : 'Active sabotage location · Scan QR to restore'}
                              </div>
                            ) : (
                              !isCommsSabotaged &&
                              obj.subHint && (
                                <div className="text-[10px] font-mono text-amber-200/80 leading-tight">
                                  {obj.subHint}
                                </div>
                              )
                            )}
                          </div>
                        </div>
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
            className="tactical-btn-primary w-full h-14 rounded-xl bg-gradient-to-r from-violet-400 to-cyan-400 text-slate-950 font-display font-extrabold text-sm tracking-wide uppercase flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(139,92,246,0.45)]"
          >
            <Camera className="w-5 h-5" />
            <span>Scan Task QR (Phantom)</span>
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onScanStation()}
              className="tactical-btn-primary h-14 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-display font-extrabold text-xs sm:text-sm tracking-wide uppercase flex items-center justify-center gap-1.5 px-2.5 shadow-[0_0_22px_rgba(6,182,212,0.4)] whitespace-nowrap"
            >
              <Camera className="w-4 h-4 shrink-0" />
              <span>Scan Task QR</span>
            </button>
            <button
              type="button"
              onClick={onReportBody}
              className="tactical-btn-primary h-14 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 text-white font-display font-extrabold text-xs sm:text-sm tracking-wide uppercase flex items-center justify-center gap-1.5 px-2.5 shadow-[0_0_22px_rgba(244,63,94,0.45)] whitespace-nowrap"
            >
              <Megaphone className="w-4 h-4 shrink-0" />
              <span>Report Body</span>
            </button>
          </div>
        )}
      </div>

      {/* Spacious Covert Impostor Operations Bottom Sheet (Hidden behind Double-Tap / 0.45s Hold) */}
      {covertOpsOpen &&
        effectiveRole === 'impostor' &&
        effectiveStatus !== 'eliminated' && (() => {
          const killLogs = impostorOpsLog.filter((e) => e.kind === 'KILL');
          const sabotageLogs = impostorOpsLog.filter(
            (e) => e.kind === 'SABOTAGE_TRIGGERED'
          );
          const filteredLogs = impostorOpsLog.filter((e) => {
            if (logFilter === 'kills') return e.kind === 'KILL';
            if (logFilter === 'sabotages') return e.kind !== 'KILL';
            return true;
          });
          const latestKill = killLogs[0] || null;
          const impostorIdSet = new Set<string>([
            ...(myPlayer ? [myPlayer.id] : []),
            ...fellowImpostors.map((p) => p.id),
          ]);
          const livingCrewTargets = players.filter(
            (p) => p.status === 'alive' && !impostorIdSet.has(p.id)
          ).length;
          const isGhostImpostor = effectiveStatus === 'ghost';

          return (
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
                className="w-full max-w-md max-h-[88dvh] flex flex-col glass-card rounded-t-3xl sm:rounded-3xl p-5 gap-3.5 border-rose-500/35 overflow-hidden"
              >
                <div className="w-10 h-1.5 bg-white/20 rounded-full mx-auto -mt-1 sm:hidden shrink-0" />

                {/* Sheet Header */}
                <div className="flex items-center justify-between gap-3 shrink-0">
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
                    className="min-h-[42px] px-3 rounded-xl bg-slate-900 border border-white/15 text-slate-200 hover:text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
                  >
                    <EyeOff className="w-4 h-4 text-cyan-300" />
                    <span>Mask</span>
                  </button>
                </div>

                {/* Covert Sheet Tab Switcher: Ops Controls vs Sabotage & Kill Log */}
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-slate-950/90 border border-white/10 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      playUiClick();
                      setCovertTab('ops');
                    }}
                    className={`min-h-[38px] rounded-xl text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                      covertTab === 'ops'
                        ? 'bg-rose-600/90 text-white shadow-[0_0_16px_rgba(244,63,94,0.35)]'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Crosshair className="w-3.5 h-3.5 shrink-0" />
                    <span>Covert Ops</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      playUiClick();
                      setCovertTab('log');
                    }}
                    className={`min-h-[38px] rounded-xl text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                      covertTab === 'log'
                        ? 'bg-rose-600/90 text-white shadow-[0_0_16px_rgba(244,63,94,0.35)]'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <History className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Sabotage &amp; Kill Log</span>
                    {impostorOpsLog.length > 0 && (
                      <span
                        className={`px-1.5 py-0.5 rounded-md font-mono text-[10px] leading-none tabular-nums ${
                          covertTab === 'log'
                            ? 'bg-slate-950/45 text-white'
                            : 'bg-rose-500/25 text-rose-200'
                        }`}
                      >
                        {impostorOpsLog.length}
                      </span>
                    )}
                  </button>
                </div>

                {covertTab === 'ops' ? (
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-3.5 pr-0.5">
                    {/* Cooldown + Fellow Impostor Status Card */}
                    <div className="rounded-2xl bg-slate-950/85 border border-white/10 p-3.5 flex items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400">
                          {isGhostImpostor
                            ? 'Phantom Impostor Status'
                            : 'Elimination Status'}
                        </div>
                        <div
                          className={`font-display text-sm font-extrabold uppercase ${
                            isGhostImpostor
                              ? 'text-violet-300'
                              : killCooldownSeconds > 0
                              ? 'text-amber-300'
                              : 'text-rose-400'
                          }`}
                        >
                          {isGhostImpostor
                            ? 'Sabotage Support Only'
                            : killCooldownSeconds > 0
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
                            stroke={
                              isGhostImpostor
                                ? '#a78bfa'
                                : killCooldownSeconds > 0
                                ? '#f59e0b'
                                : '#f43f5e'
                            }
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            strokeDasharray={2 * Math.PI * 18}
                            strokeDashoffset={
                              2 * Math.PI * 18 * (1 - cooldownRatio)
                            }
                          />
                        </svg>
                        <span className="absolute font-mono text-[11px] font-extrabold text-white tabular-nums">
                          {isGhostImpostor ? 'GHOST' : `${killCooldownSeconds}s`}
                        </span>
                      </div>
                    </div>

                    {/* Primary Action: Eliminate ID Card */}
                    {!isGhostImpostor && (
                      <button
                        type="button"
                        onClick={() => {
                          if (isMeetingLocked) {
                            setCovertOpsOpen(false);
                            onEliminateScan();
                            return;
                          }
                          if (killCooldownSeconds > 0) {
                            onBlockedKillAttempt?.(killCooldownSeconds);
                            return;
                          }
                          setCovertOpsOpen(false);
                          onEliminateScan();
                        }}
                        className={`w-full h-14 rounded-2xl font-display font-extrabold text-sm tracking-wide uppercase flex items-center justify-center gap-2 active:scale-95 transition-all ${
                          isMeetingLocked
                            ? 'bg-slate-800/90 border border-amber-500/40 text-amber-200'
                            : killCooldownSeconds > 0
                            ? 'bg-amber-950/75 border border-amber-500/45 text-amber-200'
                            : 'bg-rose-600 hover:bg-rose-500 text-white shadow-[0_0_24px_rgba(244,63,94,0.45)]'
                        }`}
                      >
                        <Crosshair className="w-5 h-5 shrink-0" />
                        <span>
                          {isMeetingLocked
                            ? 'Locked During Meeting / Report'
                            : killCooldownSeconds > 0
                            ? `Cooldown Active (${killCooldownSeconds}s)`
                            : 'Eliminate (Scan ID Card)'}
                        </span>
                      </button>
                    )}

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
                          <span>Reactor (2:00)</span>
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

                      {!isGhostImpostor ? (
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
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            playUiClick();
                            setCovertTab('log');
                          }}
                          className="h-11 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5"
                        >
                          <History className="w-4 h-4 text-rose-300" />
                          <span>Open Kill Log</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Dedicated Sabotage & Kill Log View */
                  <div className="flex-1 min-h-0 flex flex-col gap-3">
                    {/* Tactical Coordination KPIs */}
                    <div className="grid grid-cols-4 gap-1.5 shrink-0">
                      <div className="rounded-xl bg-rose-950/50 border border-rose-500/30 p-2 text-center">
                        <div className="font-mono text-base font-extrabold text-rose-300 tabular-nums leading-none">
                          {killLogs.length}
                        </div>
                        <div className="text-[9px] font-mono uppercase tracking-wider text-rose-200/75 mt-1">
                          Kills
                        </div>
                      </div>
                      <div className="rounded-xl bg-amber-950/45 border border-amber-500/30 p-2 text-center">
                        <div className="font-mono text-base font-extrabold text-amber-300 tabular-nums leading-none">
                          {sabotageLogs.length}
                        </div>
                        <div className="text-[9px] font-mono uppercase tracking-wider text-amber-200/75 mt-1">
                          Sabotages
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-950/80 border border-white/10 p-2 text-center">
                        <div className="font-mono text-base font-extrabold text-cyan-300 tabular-nums leading-none">
                          {livingCrewTargets}
                        </div>
                        <div className="text-[9px] font-mono uppercase tracking-wider text-slate-400 mt-1">
                          Crew Left
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-950/80 border border-white/10 p-2 text-center">
                        <div className="font-mono text-[11px] font-extrabold text-white tabular-nums leading-tight truncate">
                          {latestKill
                            ? formatRelativeElapsed(latestKill.timestamp, now).replace(
                                ' ago',
                                ''
                              )
                            : '--'}
                        </div>
                        <div className="text-[9px] font-mono uppercase tracking-wider text-slate-400 mt-1">
                          Last Kill
                        </div>
                      </div>
                    </div>

                    {/* Filter Pills */}
                    <div className="flex items-center justify-between gap-2 shrink-0">
                      <div className="flex items-center gap-1.5">
                        {(
                          [
                            { id: 'all', label: `All (${impostorOpsLog.length})` },
                            { id: 'kills', label: `Kills (${killLogs.length})` },
                            {
                              id: 'sabotages',
                              label: `Sabotage (${
                                impostorOpsLog.length - killLogs.length
                              })`,
                            },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => {
                              playUiClick();
                              setLogFilter(tab.id);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider border transition-colors ${
                              logFilter === tab.id
                                ? 'bg-rose-500/25 border-rose-400/60 text-rose-100'
                                : 'bg-slate-950/75 border-white/10 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                        LIVE SYNC
                      </span>
                    </div>

                    {/* Chronological Event Timeline */}
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-2 pr-0.5">
                      {filteredLogs.length === 0 ? (
                        <div className="rounded-2xl bg-slate-950/75 border border-dashed border-white/15 px-4 py-8 text-center space-y-1.5">
                          <History className="w-6 h-6 text-slate-500 mx-auto" />
                          <div className="text-xs font-bold text-slate-300">
                            No {logFilter === 'kills' ? 'kills' : logFilter === 'sabotages' ? 'sabotage events' : 'covert activity'} recorded yet
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            Successful eliminations (with exact timestamp &amp;
                            victim badge ID) and sabotage events appear here
                            automatically for Impostor coordination.
                          </p>
                        </div>
                      ) : (
                        filteredLogs.map((entry) => {
                          if (entry.kind === 'KILL') {
                            const badgeNum = entry.victimBadgeNumber || '01';
                            const badgeInfo = getBadgeInfo(badgeNum);
                            return (
                              <div
                                key={entry.id}
                                className="rounded-2xl bg-rose-950/35 border border-rose-500/35 px-3 py-2.5 flex items-center justify-between gap-2.5"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div
                                    className="w-9 h-9 rounded-xl flex flex-col items-center justify-center font-mono text-[10px] font-extrabold text-white border border-white/35 shrink-0"
                                    style={{
                                      backgroundColor: `${badgeInfo.hex}CC`,
                                      boxShadow: `0 0 14px ${badgeInfo.hex}55`,
                                    }}
                                  >
                                    <Skull className="w-3.5 h-3.5" />
                                    <span className="leading-none mt-0.5">
                                      #{badgeNum}
                                    </span>
                                  </div>
                                  <div className="min-w-0 space-y-0.5">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-mono text-[11px] font-extrabold text-rose-200 bg-rose-500/25 border border-rose-400/40 px-1.5 py-0.5 rounded">
                                        {entry.victimBadgeId || `P${badgeNum}`}
                                      </span>
                                      <span className="text-xs font-bold text-white truncate">
                                        {entry.victimName || `Operative #${badgeNum}`}
                                      </span>
                                      <span
                                        className={`text-[9px] font-mono font-extrabold uppercase px-1.5 py-0.5 rounded ${
                                          entry.actorSource === 'YOU'
                                            ? 'bg-rose-500/30 text-rose-200'
                                            : 'bg-amber-500/25 text-amber-200'
                                        }`}
                                      >
                                        {entry.actorSource === 'YOU'
                                          ? 'YOU'
                                          : 'ALLY'}
                                      </span>
                                    </div>
                                    <div className="text-[10px] font-mono text-rose-200/75">
                                      Elimination Confirmed · {badgeInfo.colorName}
                                    </div>
                                  </div>
                                </div>

                                <div className="text-right shrink-0 space-y-0.5">
                                  <div className="inline-flex items-center gap-1 font-mono text-[11px] font-extrabold text-white tabular-nums">
                                    <Clock className="w-3 h-3 text-rose-300" />
                                    <span>{formatLogTimestamp(entry.timestamp)}</span>
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-400 tabular-nums">
                                    {formatRelativeElapsed(entry.timestamp, now)}
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          const isDefused = entry.kind === 'SABOTAGE_DEFUSED';
                          const isReactor = entry.sabotageType === 'REACTOR';
                          return (
                            <div
                              key={entry.id}
                              className={`rounded-2xl px-3 py-2.5 border flex items-center justify-between gap-2.5 ${
                                isDefused
                                  ? 'bg-emerald-950/30 border-emerald-500/30'
                                  : isReactor
                                  ? 'bg-rose-950/25 border-rose-400/30'
                                  : 'bg-amber-950/30 border-amber-400/30'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div
                                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                                    isDefused
                                      ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                                      : isReactor
                                      ? 'bg-rose-500/15 border-rose-400/40 text-rose-300'
                                      : 'bg-amber-500/15 border-amber-400/40 text-amber-300'
                                  }`}
                                >
                                  {isDefused ? (
                                    <CheckCircle2 className="w-4 h-4" />
                                  ) : isReactor ? (
                                    <AlertTriangle className="w-4 h-4" />
                                  ) : (
                                    <Radio className="w-4 h-4" />
                                  )}
                                </div>
                                <div className="min-w-0 space-y-0.5">
                                  <div className="text-xs font-bold text-white truncate">
                                    {isDefused
                                      ? `${
                                          isReactor ? 'Reactor' : 'Comms'
                                        } Sabotage Defused`
                                      : isReactor
                                      ? 'Reactor Meltdown Triggered'
                                      : 'Comms Jammed'}
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-300 truncate">
                                    {entry.targetLabel
                                      ? `Target: ${entry.targetLabel}`
                                      : 'Campus Station Alert'}
                                  </div>
                                </div>
                              </div>

                              <div className="text-right shrink-0 space-y-0.5">
                                <div className="inline-flex items-center gap-1 font-mono text-[11px] font-extrabold text-slate-100 tabular-nums">
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  <span>{formatLogTimestamp(entry.timestamp)}</span>
                                </div>
                                <div className="text-[10px] font-mono text-slate-400 tabular-nums">
                                  {formatRelativeElapsed(entry.timestamp, now)}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Quick Action Bar back to Covert Ops */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/10 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          playUiClick();
                          setCovertTab('ops');
                        }}
                        className="h-11 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5"
                      >
                        <Crosshair className="w-3.5 h-3.5 text-rose-400" />
                        <span>Back to Ops</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onTriggerSabotage('REACTOR');
                          setCovertOpsOpen(false);
                        }}
                        className="h-11 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/50 text-rose-200 font-display font-extrabold text-xs uppercase tracking-wide flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Trigger Reactor</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* Match Victory Overlay */}
      {winner && (() => {
        const normalizedHostId = hostBadgeId
          ? hostBadgeId.trim().toUpperCase()
          : null;
        const normalizedMyId = myPlayer?.id
          ? myPlayer.id.trim().toUpperCase()
          : null;
        const isCurrentUserHost =
          typeof isHostProp === 'boolean'
            ? isHostProp
            : Boolean(
                normalizedHostId &&
                  normalizedMyId &&
                  normalizedHostId === normalizedMyId
              );
        const hostPlayer = normalizedHostId
          ? players.find(
              (p) => p.id.trim().toUpperCase() === normalizedHostId
            ) || null
          : null;
        const hostLabel = hostPlayer
          ? `${hostPlayer.name} (#${hostPlayer.badgeNumber})`
          : normalizedHostId
          ? `Badge #${normalizedHostId.replace(/^P/i, '').padStart(2, '0')}`
          : 'Room Host';

        // Compute personal round tournament points breakdown
        const isImpostorRole = effectiveRole === 'impostor';
        const myTeamWon =
          (winner === 'crewmates' && !isImpostorRole) ||
          (winner === 'impostors' && isImpostorRole);
        const isAliveAtEnd = effectiveStatus === 'alive';
        const myTasksCount = isImpostorRole
          ? 0
          : myPlayer?.completedTaskIds.length || 0;
        const myElimsCount = isImpostorRole
          ? impostorOpsLog.filter((entry) => entry.kind === 'KILL').length
          : 0;

        const breakdownItems: { label: string; pts: number }[] = [];
        if (isImpostorRole) {
          if (myTeamWon) {
            breakdownItems.push({
              label: 'Impostor Team Victory',
              pts: TOURNAMENT_SCORING_RULES.IMPOSTOR_WIN,
            });
          }
          if (myElimsCount > 0) {
            breakdownItems.push({
              label: `Eliminations (${myElimsCount} × ${TOURNAMENT_SCORING_RULES.ELIMINATION})`,
              pts: myElimsCount * TOURNAMENT_SCORING_RULES.ELIMINATION,
            });
          }
        } else {
          if (myTeamWon) {
            breakdownItems.push({
              label: 'Crewmate Team Victory',
              pts: TOURNAMENT_SCORING_RULES.CREWMATE_WIN,
            });
            if (isAliveAtEnd) {
              breakdownItems.push({
                label: 'Survival Bonus',
                pts: TOURNAMENT_SCORING_RULES.CREWMATE_SURVIVAL,
              });
            }
          }
          if (myTasksCount > 0) {
            breakdownItems.push({
              label: `Tasks Completed (${myTasksCount} × ${TOURNAMENT_SCORING_RULES.TASK_COMPLETED})`,
              pts: myTasksCount * TOURNAMENT_SCORING_RULES.TASK_COMPLETED,
            });
          }
        }
        const totalRoundPts = breakdownItems.reduce(
          (sum, item) => sum + item.pts,
          0
        );

        const handleHostPlayAgain = () => {
          if (rematchBusy) return;
          playUiClick();
          setRematchBusy(true);
          void Promise.resolve(onResetMatch()).finally(() => {
            setRematchBusy(false);
          });
        };

        return (
          <div className="fixed inset-0 z-50 bg-[#060913]/92 backdrop-blur-xl flex items-center justify-center p-4 sm:p-5 overflow-y-auto">
            <div className="w-full max-w-md glass-card rounded-3xl p-5 sm:p-6 text-center space-y-4 my-auto border border-white/15">
              {/* Winner Banner */}
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
                <p className="text-sm text-slate-300 mt-1">{winReason}</p>
              </div>

              {/* Round Tournament Points Breakdown */}
              <div className="rounded-2xl bg-slate-950/80 border border-white/10 p-3.5 text-left space-y-2">
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-white/10">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">
                    Your Round Points
                  </span>
                  <span className="font-mono text-sm font-extrabold text-amber-300 tabular-nums">
                    +{totalRoundPts} PTS
                  </span>
                </div>
                {breakdownItems.length === 0 ? (
                  <div className="text-xs text-slate-400 flex items-center justify-between">
                    <span>No points earned this round</span>
                    <span className="font-mono tabular-nums text-slate-500">+0</span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {breakdownItems.map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="text-slate-300">{item.label}</span>
                        <span className="font-mono font-bold text-emerald-300 tabular-nums shrink-0">
                          +{item.pts}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Host vs Non-Host Rematch Controls */}
              <div className="space-y-2.5 pt-1">
                {isCurrentUserHost ? (
                  <button
                    type="button"
                    disabled={rematchBusy}
                    onClick={handleHostPlayAgain}
                    className="w-full min-h-[56px] px-4 rounded-2xl bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-400 hover:brightness-110 disabled:opacity-60 text-slate-950 font-display font-extrabold text-sm sm:text-base tracking-wider uppercase flex items-center justify-center gap-2 shadow-[0_0_28px_rgba(16,185,129,0.45)] active:scale-[0.98] transition-all"
                  >
                    <span aria-hidden="true" className={rematchBusy ? 'animate-spin' : ''}>
                      🔄
                    </span>
                    <span>
                      {rematchBusy
                        ? 'Resetting Squad to Lobby...'
                        : 'PLAY AGAIN (SAME SQUAD)'}
                    </span>
                  </button>
                ) : (
                  <div className="w-full rounded-2xl bg-slate-900/90 border border-amber-400/35 px-4 py-3.5 text-center space-y-1 shadow-[0_0_20px_rgba(245,158,11,0.12)]">
                    <div className="text-xs sm:text-sm font-display font-extrabold tracking-wider uppercase text-amber-200 flex items-center justify-center gap-2">
                      <span className="inline-block animate-pulse">⏳</span>
                      <span>WAITING FOR HOST TO START NEXT ROUND...</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      👑 Host: {hostLabel} · Your wristband stays linked
                    </div>
                  </div>
                )}

                {onOpenLeaderboard && (
                  <button
                    type="button"
                    onClick={() => {
                      playUiClick();
                      onOpenLeaderboard();
                    }}
                    className="w-full h-12 rounded-2xl bg-amber-500/15 hover:bg-amber-500/24 border border-amber-400/45 text-amber-200 font-display font-extrabold text-xs sm:text-sm tracking-wider uppercase flex items-center justify-center gap-2 shadow-[0_0_18px_rgba(245,158,11,0.16)] active:scale-95 transition-all"
                  >
                    <Trophy className="w-4 h-4 text-amber-300" />
                    <span>🏆 Leaderboard</span>
                  </button>
                )}

                {onExitMatch &&
                  (isCurrentUserHost ? (
                    <button
                      type="button"
                      onClick={() => {
                        playUiClick();
                        onExitMatch();
                      }}
                      className="w-full py-2.5 text-xs font-mono font-bold tracking-widest uppercase text-slate-400 hover:text-rose-300 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>LEAVE ROOM</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        playUiClick();
                        onExitMatch();
                      }}
                      className="w-full h-12 rounded-2xl bg-slate-900/85 hover:bg-rose-500/15 border border-white/15 hover:border-rose-400/45 text-slate-200 hover:text-rose-200 font-display font-bold text-xs sm:text-sm tracking-wider uppercase flex items-center justify-center gap-2 active:scale-95 transition-all"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>LEAVE ROOM</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        );
      })()}

      {exitConfirmationModal}
    </div>
  );
}
