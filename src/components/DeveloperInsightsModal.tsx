import { useState } from 'react';
import {
  Activity,
  Check,
  Copy,
  Database,
  Lock,
  Radio,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type {
  PrivateRoleRow,
  PublicPlayerRow,
  RoomRow,
} from '../config/supabase';
import type {
  CampusLocalIdentity,
  RealtimeConnectionStatus,
} from '../hooks/useCampusGame';
import { playTaskSuccessFeedback, playUiClick } from '../utils/feedback';

export interface DeveloperInsightEvent {
  id: string;
  ts: number;
  type: string;
  detail: string;
}

interface DeveloperInsightsModalProps {
  isSupabaseConfigured: boolean;
  connectionStatus: RealtimeConnectionStatus;
  reconnectAttempt: number;
  latencyMs: number | null;
  syncError: string | null;
  identity: CampusLocalIdentity | null;
  room: RoomRow | null;
  publicPlayers: PublicPlayerRow[];
  privateRole: PrivateRoleRow | null;
  votes: Record<string, string>;
  events: DeveloperInsightEvent[];
  onClearEvents: () => void;
  onLockDevMode: () => void;
  onClose: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function DeveloperInsightsModal({
  isSupabaseConfigured,
  connectionStatus,
  reconnectAttempt,
  latencyMs,
  syncError,
  identity,
  room,
  publicPlayers,
  privateRole,
  votes,
  events,
  onClearEvents,
  onLockDevMode,
  onClose,
}: DeveloperInsightsModalProps) {
  const [activeTab, setActiveTab] = useState<'sync' | 'state' | 'logs'>('sync');
  const [copied, setCopied] = useState(false);

  const handleCopySnapshot = async () => {
    playUiClick();
    const snapshot = {
      capturedAt: new Date().toISOString(),
      supabaseConfigured: isSupabaseConfigured,
      connectionStatus,
      reconnectAttempt,
      latencyMs,
      syncError,
      identity: identity
        ? {
            roomCode: identity.roomCode,
            badgeId: identity.badgeId,
            name: identity.name,
            secretPrefix: identity.wristbandSecret.slice(0, 6) + '***',
          }
        : null,
      room,
      publicPlayersCount: publicPlayers.length,
      publicPlayers,
      privateRole,
      votes,
      recentEvents: events.slice(0, 15),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      playTaskSuccessFeedback();
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors on restricted browsers
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#060913]/92 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md glass-card rounded-t-3xl sm:rounded-3xl p-4 flex flex-col gap-3 max-h-[88dvh] border-cyan-400/25">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4 text-cyan-300" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-sm font-extrabold tracking-wider uppercase text-white truncate">
                DEVELOPER INSIGHTS
              </h2>
              <div className="text-[10px] font-mono text-emerald-400">
                PASSCODE VERIFIED · REALTIME DIAGNOSTICS
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              playUiClick();
              onClose();
            }}
            aria-label="Close Developer Insights"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-white/10 text-slate-300 hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Segment Tabs */}
        <div className="shrink-0 grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-950/85 border border-white/10">
          <button
            type="button"
            onClick={() => {
              playUiClick();
              setActiveTab('sync');
            }}
            className={`h-8 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
              activeTab === 'sync'
                ? 'bg-cyan-500 text-slate-950'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Telemetry</span>
          </button>
          <button
            type="button"
            onClick={() => {
              playUiClick();
              setActiveTab('state');
            }}
            className={`h-8 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
              activeTab === 'state'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Live State</span>
          </button>
          <button
            type="button"
            onClick={() => {
              playUiClick();
              setActiveTab('logs');
            }}
            className={`h-8 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
              activeTab === 'logs'
                ? 'bg-amber-400 text-slate-950'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Events ({events.length})</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-2.5 pr-0.5">
          {activeTab === 'sync' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 space-y-1">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    BACKEND MODE
                  </div>
                  <div
                    className={`font-mono text-xs font-extrabold ${
                      isSupabaseConfigured ? 'text-emerald-400' : 'text-amber-300'
                    }`}
                  >
                    {isSupabaseConfigured ? 'SUPABASE LIVE' : 'LOCAL FALLBACK'}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 space-y-1">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    CHANNEL STATUS
                  </div>
                  <div
                    className={`font-mono text-xs font-extrabold uppercase ${
                      connectionStatus === 'connected'
                        ? 'text-emerald-400'
                        : connectionStatus === 'reconnecting'
                        ? 'text-amber-300'
                        : 'text-rose-400'
                    }`}
                  >
                    {connectionStatus}
                    {connectionStatus === 'reconnecting' && reconnectAttempt > 0
                      ? ` (#${reconnectAttempt})`
                      : ''}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 space-y-1">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    HEARTBEAT RTT
                  </div>
                  <div className="font-mono text-sm font-extrabold text-cyan-300 tabular-nums">
                    {latencyMs !== null ? `${latencyMs} ms` : '—'}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 space-y-1">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    ACTIVE CHANNEL
                  </div>
                  <div className="font-mono text-xs font-extrabold text-white truncate">
                    {identity?.roomCode ? `room-${identity.roomCode}` : 'NONE'}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 space-y-1.5">
                <div className="text-[9px] font-bold uppercase tracking-widest text-cyan-400">
                  MATCH SNAPSHOT
                </div>
                <div className="grid grid-cols-2 gap-y-1 text-[11px] font-mono">
                  <span className="text-slate-400">Phase:</span>
                  <span className="text-white font-bold text-right">
                    {room?.status || 'NOT IN ROOM'}
                  </span>
                  <span className="text-slate-400">Task Progress:</span>
                  <span className="text-emerald-400 font-bold text-right tabular-nums">
                    {room?.task_progress ?? 0}%
                  </span>
                  <span className="text-slate-400">Sabotage:</span>
                  <span className="text-rose-300 font-bold text-right">
                    {room?.active_sabotage || 'NONE'}
                  </span>
                  <span className="text-slate-400">Impostors:</span>
                  <span className="text-white font-bold text-right tabular-nums">
                    {room?.impostor_count ?? 1}
                  </span>
                  <span className="text-slate-400">Players Alive:</span>
                  <span className="text-white font-bold text-right tabular-nums">
                    {publicPlayers.filter((p) => p.is_alive).length}/
                    {publicPlayers.length}
                  </span>
                </div>
              </div>

              {syncError && (
                <div className="rounded-2xl bg-rose-950/60 border border-rose-500/40 p-3 text-[11px] font-mono text-rose-200 break-words">
                  Last Sync Error: {syncError}
                </div>
              )}
            </>
          )}

          {activeTab === 'state' && (
            <>
              <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 space-y-1.5">
                <div className="text-[9px] font-bold uppercase tracking-widest text-cyan-400">
                  LOCAL OPERATIVE &amp; PRIVATE ROLE
                </div>
                <div className="text-[11px] font-mono space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Badge / Name:</span>
                    <span className="text-white font-bold">
                      {identity ? `${identity.badgeId} (${identity.name})` : 'Unregistered'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Assigned Role:</span>
                    <span
                      className={`font-bold ${
                        privateRole?.role === 'IMPOSTOR'
                          ? 'text-rose-400'
                          : 'text-cyan-300'
                      }`}
                    >
                      {privateRole?.role || 'NONE'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400 shrink-0">Assigned Stations:</span>
                    <span className="text-slate-200 text-right truncate">
                      {privateRole?.assigned_stations?.join(', ') || 'ALL'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400 shrink-0">Completed:</span>
                    <span className="text-emerald-400 text-right truncate">
                      {privateRole?.completed_stations?.join(', ') || 'NONE'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 space-y-2">
                <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-400">
                  PUBLIC PLAYERS ({publicPlayers.length})
                </div>
                {publicPlayers.length === 0 ? (
                  <div className="text-[11px] text-slate-500 font-mono">
                    No players synced in current room.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {publicPlayers.map((p) => (
                      <div
                        key={p.badge_id}
                        className="flex items-center justify-between text-[11px] font-mono bg-slate-900/70 px-2.5 py-1.5 rounded-xl border border-white/5"
                      >
                        <span className="text-white font-bold truncate">
                          {p.badge_id} · {p.name}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          {room?.status === 'MEETING' && (
                            <span
                              className={
                                p.has_voted ? 'text-emerald-400' : 'text-slate-500'
                              }
                            >
                              {p.has_voted ? 'VOTED' : 'WAIT'}
                            </span>
                          )}
                          <span
                            className={
                              p.is_alive ? 'text-cyan-300' : 'text-violet-400'
                            }
                          >
                            {p.is_alive ? 'ALIVE' : 'DEAD'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {Object.keys(votes).length > 0 && (
                <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 space-y-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-amber-300">
                    LIVE VOTE LEDGER ({Object.keys(votes).length})
                  </div>
                  <div className="space-y-1 text-[11px] font-mono">
                    {Object.entries(votes).map(([voter, target]) => (
                      <div key={voter} className="flex justify-between text-slate-300">
                        <span>{voter}</span>
                        <span className="text-amber-300 font-bold">→ {target}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  REALTIME EVENT STREAM
                </span>
                {events.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      playUiClick();
                      onClearEvents();
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-rose-300"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                )}
              </div>

              {events.length === 0 ? (
                <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-4 text-center text-[11px] font-mono text-slate-500">
                  No Realtime events captured yet.
                </div>
              ) : (
                events.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-xl bg-slate-950/80 border border-white/10 px-2.5 py-2 space-y-0.5"
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="font-extrabold text-cyan-300">
                        {ev.type}
                      </span>
                      <span className="text-slate-500 tabular-nums">
                        {formatTime(ev.ts)}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-300 break-words">
                      {ev.detail}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="shrink-0 grid grid-cols-2 gap-2 pt-1 border-t border-white/10">
          <button
            type="button"
            onClick={() => void handleCopySnapshot()}
            className="h-11 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-cyan-300 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-300">Copied JSON</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copy JSON</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              playUiClick();
              onLockDevMode();
            }}
            className="h-11 rounded-xl bg-rose-950/70 hover:bg-rose-900/70 border border-rose-500/40 text-rose-200 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Lock Dev Mode</span>
          </button>
        </div>
      </div>
    </div>
  );
}
