import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Crosshair,
  Fingerprint,
  Ghost,
  Lock,
  Megaphone,
  RotateCcw,
  Skull,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import {
  TASK_STATIONS,
  type Player,
  type PlayerRole,
  type PlayerStatus,
  type SabotageState,
} from '../shared/gameData';
import { playUiClick } from '../utils/feedback';

interface GameplayScreenProps {
  myPlayer: Player | null;
  effectiveRole: PlayerRole;
  effectiveStatus: PlayerStatus;
  taskProgress: number;
  sabotage: SabotageState | null;
  isCommsSabotaged?: boolean;
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

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function GameplayScreen({
  myPlayer,
  effectiveRole,
  effectiveStatus,
  taskProgress,
  sabotage,
  isCommsSabotaged = false,
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
  const [sabotageMenuOpen, setSabotageMenuOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const sabotageSecondsLeft = sabotage
    ? Math.max(0, Math.ceil((sabotage.expiresAt - now) / 1000))
    : 0;
  const killCooldownSeconds = Math.max(
    0,
    Math.ceil((killCooldownEnd - now) / 1000)
  );
  const cooldownRatio = Math.min(1, killCooldownSeconds / 30);
  const completedIds = myPlayer?.completedTaskIds || [];

  const stationAccentByIndex = [
    'bg-cyan-400',
    'bg-emerald-400',
    'bg-amber-400',
    'bg-violet-400',
  ];

  // SCREEN 6A: ELIMINATED BEFORE MEETING
  if (effectiveStatus === 'eliminated' && !winner) {
    return (
      <div className="flex-1 min-h-0 flex flex-col justify-between px-3.5 pb-3 pt-1 bg-[radial-gradient(circle_at_50%_20%,rgba(139,92,246,0.28),transparent_60%)]">
        <div className="my-auto space-y-4 text-center">
          <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
            <span className="animate-radar absolute inset-0 rounded-full border border-violet-400/50" />
            <div className="relative w-20 h-20 rounded-3xl bg-violet-500/20 border-2 border-violet-400/70 shadow-[0_0_40px_rgba(139,92,246,0.55)] flex items-center justify-center">
              <Skull className="w-10 h-10 text-violet-200" />
            </div>
          </div>

          <div className="glass-card rounded-3xl p-5 border-violet-400/35 space-y-2.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-violet-500/20 border border-violet-400/40 text-[10px] font-bold tracking-widest uppercase text-violet-200">
              SIGNAL TERMINATED
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-wide uppercase text-white">
              YOU WERE ELIMINATED!
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
          <span>ENTER PHANTOM MODE</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex-1 min-h-0 flex flex-col justify-between px-3.5 pb-3 pt-1 gap-2.5 ${
        effectiveStatus === 'ghost'
          ? 'bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,0.2),transparent_55%)]'
          : ''
      }`}
    >
      {/* Top HUD Region */}
      <div className="shrink-0 space-y-2">
        <div className="glass-card rounded-2xl px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-extrabold tracking-wider uppercase">
            <span className="text-slate-300">
              TEAM TASKS:{' '}
              <span className="text-emerald-400 font-mono tabular-nums">
                {taskProgress}%
              </span>
            </span>
            {effectiveStatus === 'alive' && (
              <button
                type="button"
                onClick={onCallMeeting}
                className="text-[11px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1"
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

        {/* Active Sabotage Banner */}
        {sabotage && (
          <div className="animate-siren rounded-2xl border-2 border-rose-500 px-3 py-2 flex items-center justify-between gap-2 shadow-[0_0_20px_rgba(244,63,94,0.45)]">
            <div className="flex items-center gap-1.5 min-w-0">
              <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0" />
              <div className="text-[11px] font-extrabold tracking-wide text-white truncate font-mono tabular-nums">
                {sabotage.type === 'reactor'
                  ? `⚠️ REACTOR MELTDOWN — ${formatClock(sabotageSecondsLeft)} — CYBER LAB`
                  : '⚠️ COMMS JAMMED — SCAN CYBER LAB OR RECEPTION'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onScanStation(sabotage.targetStationId)}
              className="shrink-0 px-2 py-1 rounded-lg bg-rose-500 text-white text-[10px] font-extrabold uppercase"
            >
              DEFUSE
            </button>
          </div>
        )}

        {/* Phantom Ghost Banner */}
        {effectiveStatus === 'ghost' && (
          <div className="rounded-2xl bg-violet-950/80 border border-violet-400/50 px-3 py-1.5 flex items-center gap-2">
            <Ghost className="w-4 h-4 text-violet-300 shrink-0" />
            <span className="text-[11px] font-bold text-violet-100 leading-tight">
              👻 PHANTOM MODE — Stay silent &amp; finish tasks!
            </span>
          </div>
        )}
      </div>

      {/* Middle Area: Privacy Shield + 5 Campus Objectives (Fits 100% Without Scroll) */}
      <div className="flex-1 min-h-0 flex flex-col justify-center gap-2">
        {/* TACTICAL PRIVACY SHIELD */}
        <button
          type="button"
          onClick={() => {
            playUiClick();
            setRoleRevealed((prev) => !prev);
          }}
          onPointerDown={() => setRoleRevealed(true)}
          onPointerUp={() => setRoleRevealed(false)}
          onPointerLeave={() => setRoleRevealed(false)}
          className={`w-full rounded-2xl p-2.5 text-left transition-all duration-200 select-none glass-card shrink-0 ${
            !roleRevealed
              ? 'border-white/15 hover:border-white/25'
              : effectiveRole === 'impostor'
              ? 'bg-rose-950/80 border-rose-400/70 shadow-[0_0_26px_rgba(244,63,94,0.35)]'
              : 'bg-cyan-950/80 border-cyan-400/70 shadow-[0_0_26px_rgba(6,182,212,0.35)]'
          }`}
        >
          {!roleRevealed ? (
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-slate-800/90 border border-white/15 flex items-center justify-center shrink-0">
                  <Fingerprint className="w-5 h-5 text-cyan-300" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 font-display text-xs font-extrabold tracking-wider uppercase text-white">
                    <Lock className="w-3 h-3 text-slate-400" />
                    <span>IDENTITY CLASSIFIED</span>
                  </div>
                  <div className="text-[10px] font-semibold text-slate-400">
                    PRESS &amp; HOLD TO PEEK
                  </div>
                </div>
              </div>
              <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-300">
                SHIELDED
              </span>
            </div>
          ) : effectiveRole === 'impostor' ? (
            <div className="flex items-center justify-between gap-2.5">
              <div>
                <div className="font-display text-lg font-extrabold tracking-wider uppercase text-rose-400 leading-none">
                  IMPOSTOR
                </div>
                <div className="text-[10px] font-bold tracking-wide uppercase text-rose-100 mt-1">
                  ELIMINATE &amp; SABOTAGE
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
            <div className="flex items-center justify-between gap-2.5">
              <div>
                <div className="font-display text-lg font-extrabold tracking-wider uppercase text-cyan-300 leading-none">
                  CREWMATE
                </div>
                <div className="text-[10px] font-bold tracking-wide uppercase text-cyan-100 mt-1">
                  COMPLETE OBJECTIVES
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-cyan-500/20 border border-cyan-400/40 text-[10px] font-mono font-bold text-cyan-200">
                {completedIds.length}/{TASK_STATIONS.length} DONE
              </span>
            </div>
          )}
        </button>

        {/* CAMPUS OBJECTIVES: Assigned Stations Grid */}
        <div className="space-y-1.5">
          {(() => {
            const visibleStations =
              assignedStationIds && assignedStationIds.length > 0
                ? TASK_STATIONS.filter((s) => assignedStationIds.includes(s.id))
                : TASK_STATIONS;
            return (
              <>
                <div className="flex items-center justify-between px-0.5">
                  <h2 className="font-display text-[11px] font-extrabold tracking-widest uppercase text-slate-400">
                    CAMPUS OBJECTIVES
                  </h2>
                  <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                    {completedIds.length}/{visibleStations.length} DONE
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {visibleStations.map((station, idx) => {
                    const isDone = completedIds.includes(station.id);
                    const isLastOdd =
                      visibleStations.length % 2 === 1 &&
                      idx === visibleStations.length - 1;
                    const barColor = isDone
                      ? 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.7)]'
                      : stationAccentByIndex[idx % stationAccentByIndex.length];

                    return (
                      <button
                        key={station.id}
                        type="button"
                        onClick={() => onScanStation(station.id)}
                        className={`glass-card rounded-2xl p-2 flex flex-col justify-between gap-1 text-left transition-all active:scale-95 ${
                          isLastOdd ? 'col-span-2 min-h-[54px]' : 'min-h-[72px]'
                        } ${
                          isDone
                            ? 'border-emerald-500/45 bg-emerald-950/30'
                            : 'hover:border-white/25'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 w-full">
                          <span className={`w-6 h-1 rounded-full ${barColor}`} />
                          {isDone ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <span className="text-[9px] font-mono font-bold text-cyan-300">
                              QR
                            </span>
                          )}
                        </div>

                        <div className="space-y-0.5">
                          <div className="text-[8.5px] font-mono font-bold tracking-wide text-slate-400 leading-tight line-clamp-1">
                            {isCommsSabotaged
                              ? 'SIGNAL JAMMED • OFFLINE'
                              : station.location}
                          </div>
                          <div
                            className={`font-display text-[11px] font-extrabold leading-tight ${
                              isDone
                                ? 'text-emerald-300 line-through opacity-80'
                                : 'text-white'
                            }`}
                          >
                            {isCommsSabotaged
                              ? 'Restore Comms at Cyber Lab / Reception'
                              : station.taskName}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Floating Bottom Action Dock (Thumb Zone) */}
      <div className="shrink-0 glass-card rounded-2xl p-2">
        {effectiveStatus === 'ghost' ? (
          <button
            type="button"
            onClick={() => onScanStation()}
            className="w-full h-14 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-500 text-slate-950 font-display font-extrabold text-sm tracking-wide uppercase flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(139,92,246,0.45)] active:scale-95 transition-all"
          >
            <Camera className="w-5 h-5" />
            <span>SCAN TASK QR (PHANTOM)</span>
          </button>
        ) : effectiveRole === 'crewmate' ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onScanStation()}
              className="h-14 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-display font-extrabold text-xs tracking-wide uppercase flex items-center justify-center gap-1.5 px-2 shadow-[0_0_20px_rgba(6,182,212,0.4)] active:scale-95 transition-all"
            >
              <Camera className="w-4 h-4 shrink-0" />
              <span className="truncate">SCAN TASK QR</span>
            </button>
            <button
              type="button"
              onClick={onReportBody}
              className="h-14 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-display font-extrabold text-xs tracking-wide uppercase flex items-center justify-center gap-1.5 px-2 shadow-[0_0_20px_rgba(244,63,94,0.45)] active:scale-95 transition-all"
            >
              <Megaphone className="w-4 h-4 shrink-0" />
              <span className="truncate">REPORT BODY</span>
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onScanStation()}
                className="h-11 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-white/10 text-white font-display font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-1.5 px-2 active:scale-95 transition-all"
              >
                <Camera className="w-4 h-4 text-cyan-300 shrink-0" />
                <span className="truncate">FAKE SCAN</span>
              </button>
              <button
                type="button"
                onClick={() => setSabotageMenuOpen(true)}
                className="h-11 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-extrabold text-xs tracking-wider uppercase flex items-center justify-center gap-1.5 px-2 shadow-[0_0_16px_rgba(245,158,11,0.4)] active:scale-95 transition-all"
              >
                <Zap className="w-4 h-4 shrink-0" />
                <span className="truncate">SABOTAGE</span>
              </button>
            </div>
            <button
              type="button"
              disabled={killCooldownSeconds > 0}
              onClick={onEliminateScan}
              className="w-full h-14 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:bg-rose-950/80 disabled:text-rose-300/60 disabled:border disabled:border-rose-500/30 text-white font-display font-extrabold text-sm tracking-wide uppercase flex items-center justify-center gap-2 shadow-[0_0_22px_rgba(244,63,94,0.5)] active:scale-95 transition-all"
            >
              <Crosshair className="w-5 h-5 shrink-0" />
              <span>
                {killCooldownSeconds > 0
                  ? `COOLDOWN (${killCooldownSeconds}s)`
                  : 'ELIMINATE (SCAN WRIST)'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Sabotage Menu Modal */}
      {sabotageMenuOpen && (
        <div className="fixed inset-0 z-50 bg-[#060913]/85 backdrop-blur-md flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md glass-card rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-extrabold tracking-wider uppercase text-white">
                SABOTAGE PROTOCOLS
              </h3>
              <button
                type="button"
                onClick={() => setSabotageMenuOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-2xl bg-white/10 text-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                onTriggerSabotage('REACTOR');
                setSabotageMenuOpen(false);
              }}
              className="w-full h-14 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-display font-extrabold text-sm tracking-wider uppercase flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(244,63,94,0.45)] active:scale-95 transition-all"
            >
              <AlertTriangle className="w-5 h-5" />
              <span>TRIGGER REACTOR MELTDOWN (45s)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onTriggerSabotage('COMMS');
                setSabotageMenuOpen(false);
              }}
              className="w-full h-12 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-extrabold text-xs tracking-wider uppercase flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(245,158,11,0.4)] active:scale-95 transition-all"
            >
              <Zap className="w-4 h-4" />
              <span>JAM CREWMATE COMMS</span>
            </button>

            {sabotage && (
              <button
                type="button"
                onClick={() => {
                  onDefuseSabotage();
                  setSabotageMenuOpen(false);
                }}
                className="w-full h-12 rounded-2xl bg-white/10 hover:bg-white/15 text-slate-200 font-bold text-xs uppercase tracking-wider"
              >
                Clear Active Sabotage
              </button>
            )}
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
                {winner === 'crewmates' ? 'CREWMATES WIN!' : 'IMPOSTORS WIN!'}
              </h2>
              <p className="text-sm text-slate-300 mt-1.5">{winReason}</p>
            </div>
            <button
              type="button"
              onClick={onResetMatch}
              className="w-full h-14 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-display font-extrabold text-base tracking-wider uppercase flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <RotateCcw className="w-5 h-5" />
              <span>RETURN TO MISSION LOBBY</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
