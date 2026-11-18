import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Lock,
  Radio,
  Sparkles,
  Users,
} from 'lucide-react';
import type { PlayerRole, PlayerStatus, ScreenId } from '../shared/gameData';
import type { RealtimeConnectionStatus } from '../hooks/useCampusGame';
import { playUiClick } from '../utils/feedback';

export type DevPresetId =
  | 'join'
  | 'lobby'
  | 'crewmate'
  | 'impostor'
  | 'eliminated'
  | 'ghost'
  | 'meeting'
  | 'print';

interface DevSwitcherBarProps {
  activeScreen: ScreenId;
  roleOverride: PlayerRole | null;
  statusOverride: PlayerStatus | null;
  hasActiveOverride?: boolean;
  roomCode?: string;
  wsConnected?: boolean;
  connectionStatus?: RealtimeConnectionStatus;
  reconnectAttempt?: number;
  wsLatencyMs?: number | null;
  isFloatingOnly?: boolean;
  isDebugMode?: boolean;
  onSelectPreset: (preset: DevPresetId) => void;
  onClearOverrides?: () => void;
  onTriggerSabotage: () => void;
  onSeedDemoPlayers: () => void;
  onRequestUnlock?: () => void;
  onOpenInsights?: () => void;
  onLockDevMode?: () => void;
}

export function DevSwitcherBar({
  activeScreen,
  roleOverride,
  statusOverride,
  hasActiveOverride = false,
  roomCode = 'SVCE',
  wsConnected = false,
  connectionStatus,
  reconnectAttempt = 0,
  wsLatencyMs = null,
  isFloatingOnly = false,
  isDebugMode = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === 'true',
  onSelectPreset,
  onClearOverrides,
  onTriggerSabotage,
  onSeedDemoPlayers,
  onRequestUnlock,
  onOpenInsights,
  onLockDevMode,
}: DevSwitcherBarProps) {
  const [open, setOpen] = useState(false);

  const effectiveStatus: RealtimeConnectionStatus =
    connectionStatus ?? (wsConnected ? 'connected' : 'disconnected');
  const isReconnecting = effectiveStatus === 'reconnecting';
  const isHighLatency =
    effectiveStatus === 'connected' &&
    wsLatencyMs !== null &&
    wsLatencyMs >= 450;
  const isUnhealthy = effectiveStatus === 'disconnected' || isHighLatency;

  if (isFloatingOnly && !isDebugMode) {
    return null;
  }

  const currentPreset: DevPresetId = (() => {
    if (activeScreen === 'join') return 'join';
    if (activeScreen === 'lobby') return 'lobby';
    if (activeScreen === 'meeting') return 'meeting';
    if (activeScreen === 'print') return 'print';
    if (statusOverride === 'eliminated') return 'eliminated';
    if (statusOverride === 'ghost') return 'ghost';
    if (roleOverride === 'impostor') return 'impostor';
    return 'crewmate';
  })();

  const presets: { id: DevPresetId; label: string; activeColor: string }[] = [
    { id: 'join', label: 'Join', activeColor: 'bg-cyan-500 text-slate-950' },
    { id: 'lobby', label: 'Lobby', activeColor: 'bg-emerald-500 text-slate-950' },
    { id: 'crewmate', label: 'Crewmate HUD', activeColor: 'bg-cyan-400 text-slate-950' },
    { id: 'impostor', label: 'Impostor HUD', activeColor: 'bg-rose-500 text-white' },
    { id: 'eliminated', label: 'Eliminated', activeColor: 'bg-violet-500 text-white' },
    { id: 'ghost', label: 'Ghost Mode', activeColor: 'bg-violet-400 text-slate-950' },
    { id: 'meeting', label: 'Meeting', activeColor: 'bg-amber-400 text-slate-950' },
    { id: 'print', label: 'Print Kit', activeColor: 'bg-white text-slate-950' },
  ];

  return (
    <div
      className={
        isFloatingOnly
          ? 'print:hidden fixed top-2.5 right-3 z-50 flex flex-col items-end'
          : 'print:hidden shrink-0 relative z-40 px-3.5 sm:px-5 pt-2 pb-1 flex items-center justify-between gap-2'
      }
    >
      {open && (
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40"
        />
      )}

      {!isFloatingOnly && (
        <div className="flex items-center gap-2 min-w-0">
          {/* Connection Health Heartbeat Indicator */}
          <div
            title={
              isReconnecting
                ? `Reconnecting to Supabase Realtime${
                    reconnectAttempt > 0 ? ` (attempt #${reconnectAttempt})` : ''
                  }...`
                : effectiveStatus === 'disconnected'
                ? 'Realtime Disconnected'
                : wsLatencyMs !== null
                ? `Heartbeat ${wsLatencyMs}ms`
                : 'Connected'
            }
            className={`h-8 px-2.5 rounded-full backdrop-blur-xl border flex items-center gap-1.5 text-[10px] font-mono font-bold tabular-nums transition-colors shrink-0 ${
              isReconnecting
                ? 'bg-amber-950/85 border-amber-500/60 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.35)]'
                : isUnhealthy
                ? 'bg-red-950/80 border-red-500/60 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.35)]'
                : 'bg-slate-900/85 border-emerald-500/35 text-emerald-400'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full animate-pulse ${
                isReconnecting
                  ? 'bg-amber-400'
                  : isUnhealthy
                  ? 'bg-red-500'
                  : 'bg-emerald-400'
              }`}
            />
            <Activity
              className={`w-3 h-3 ${isReconnecting ? 'animate-spin' : ''}`}
            />
            <span className="whitespace-nowrap">
              {isReconnecting
                ? 'reconnecting...'
                : effectiveStatus === 'disconnected'
                ? 'OFFLINE'
                : wsLatencyMs !== null
                ? `${wsLatencyMs}ms`
                : 'LIVE'}
            </span>
          </div>

          <span className="text-[11px] font-mono font-bold text-slate-400 truncate">
            {roomCode}
          </span>
        </div>
      )}

      {!isDebugMode && !isFloatingOnly && onRequestUnlock && (
        <button
          type="button"
          onClick={() => {
            playUiClick();
            onRequestUnlock();
          }}
          title="Unlock Developer Insights & Mode"
          className="h-8 px-2.5 rounded-full bg-slate-900/75 backdrop-blur-xl border border-white/10 text-[10px] font-mono font-bold text-slate-400 hover:text-cyan-300 hover:border-cyan-400/40 flex items-center gap-1 transition-all active:scale-95 shrink-0 whitespace-nowrap"
        >
          <Lock className="w-3 h-3" />
          <span>DEV</span>
        </button>
      )}

      {isDebugMode && (
        <div className="relative z-50 flex items-center gap-1.5 shrink-0">
          {hasActiveOverride && onClearOverrides && (
            <button
              type="button"
              onClick={() => {
                playUiClick();
                setOpen(false);
                onClearOverrides();
              }}
              title="Exit preview override and return to real live game"
              className="h-8 px-2.5 rounded-full bg-emerald-500/20 backdrop-blur-xl border border-emerald-400/50 shadow-lg text-[10px] font-bold tracking-wide text-emerald-200 flex items-center gap-1 hover:bg-emerald-500/30 transition-all active:scale-95 whitespace-nowrap shrink-0"
            >
              <Radio className="w-3 h-3 text-emerald-300" />
              <span>LIVE</span>
            </button>
          )}

          {onOpenInsights && !isFloatingOnly && (
            <button
              type="button"
              onClick={() => {
                playUiClick();
                setOpen(false);
                onOpenInsights();
              }}
              className="h-8 px-2.5 rounded-full bg-cyan-500/15 backdrop-blur-xl border border-cyan-400/40 shadow-lg text-[10px] font-bold tracking-wide text-cyan-200 flex items-center gap-1 hover:bg-cyan-500/25 transition-all active:scale-95 whitespace-nowrap shrink-0"
            >
              <BarChart3 className="w-3 h-3 text-cyan-300" />
              <span className="hidden sm:inline">DEV STUDIO</span>
              <span className="sm:hidden">STUDIO</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              playUiClick();
              setOpen((v) => !v);
            }}
            className="h-8 px-2.5 rounded-full bg-slate-900/90 backdrop-blur-xl border border-white/15 shadow-lg text-[10px] font-bold tracking-wide text-cyan-300 flex items-center gap-1.5 hover:border-cyan-400/50 transition-all active:scale-95 whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>DEV</span>
            {open ? (
              <ChevronUp className="w-3 h-3 text-slate-400" />
            ) : (
              <ChevronDown className="w-3 h-3 text-slate-400" />
            )}
          </button>

          {open && (
            <div className="absolute right-0 top-10 w-72 max-w-[calc(100vw-1.5rem)] glass-card rounded-2xl p-3 space-y-2.5 z-50 border-cyan-400/25 shadow-2xl">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Switch Screen / Role
                </span>
                {hasActiveOverride && (
                  <span className="text-[9px] font-mono font-bold text-amber-300 uppercase">
                    Preview Active
                  </span>
                )}
              </div>

              {hasActiveOverride && onClearOverrides && (
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    setOpen(false);
                    onClearOverrides();
                  }}
                  className="w-full min-h-[38px] px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold uppercase tracking-wide flex items-center justify-center gap-1.5 transition-all active:scale-95"
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>Return to Live Game</span>
                </button>
              )}

              <div className="grid grid-cols-2 gap-1.5">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      playUiClick();
                      onSelectPreset(preset.id);
                      setOpen(false);
                    }}
                    className={`min-h-[38px] px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-left transition-all ${
                      currentPreset === preset.id
                        ? preset.activeColor
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="pt-1.5 border-t border-white/10 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    onSeedDemoPlayers();
                    setOpen(false);
                  }}
                  className="min-h-[38px] px-2 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-bold text-emerald-300 flex items-center justify-center gap-1 hover:bg-emerald-500/25"
                >
                  <Users className="w-3 h-3" />
                  <span>+8 Crew</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    onTriggerSabotage();
                    setOpen(false);
                  }}
                  className="min-h-[38px] px-2 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-[11px] font-bold text-rose-300 flex items-center justify-center gap-1 hover:bg-rose-500/25"
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span>Sabotage</span>
                </button>
              </div>

              {onOpenInsights && (
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    setOpen(false);
                    onOpenInsights();
                  }}
                  className="w-full min-h-[38px] rounded-xl bg-cyan-500/15 border border-cyan-400/35 text-[11px] font-bold text-cyan-200 hover:bg-cyan-500/25 flex items-center justify-center gap-1.5"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>Open Developer Studio</span>
                </button>
              )}

              {onLockDevMode && (
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    setOpen(false);
                    onLockDevMode();
                  }}
                  className="w-full min-h-[38px] rounded-xl bg-slate-900/90 border border-white/10 text-[11px] font-bold text-slate-400 hover:text-rose-300 flex items-center justify-center gap-1.5"
                >
                  <Lock className="w-3 h-3" />
                  <span>Lock Developer Mode</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
