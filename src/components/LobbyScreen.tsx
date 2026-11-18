import { useState } from 'react';
import {
  Check,
  Copy,
  LogOut,
  Play,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { getBadgeInfo, type Player } from '../shared/gameData';
import { playUiClick } from '../utils/feedback';

interface LobbyScreenProps {
  roomCode: string;
  myPlayer: Player | null;
  players: Player[];
  impostorCount: 1 | 2;
  isDebugMode?: boolean;
  onSetImpostorCount: (count: 1 | 2) => void;
  onStartMatch: () => void;
  onSeedDemoPlayers: () => void;
  onLeaveLobby?: () => void;
}

export function LobbyScreen({
  roomCode,
  myPlayer,
  players,
  impostorCount,
  isDebugMode = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === 'true',
  onSetImpostorCount,
  onStartMatch,
  onSeedDemoPlayers,
  onLeaveLobby,
}: LobbyScreenProps) {
  const [copiedRoom, setCopiedRoom] = useState(false);
  const myBadge = myPlayer ? getBadgeInfo(myPlayer.badgeNumber) : null;

  const handleCopyRoomCode = async () => {
    playUiClick();
    try {
      await navigator.clipboard?.writeText(roomCode);
      setCopiedRoom(true);
      setTimeout(() => setCopiedRoom(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-between px-3.5 sm:px-5 pb-3 sm:pb-4 pt-1 gap-2.5 sm:gap-3">
      {/* Top Banner: Compact Glass Card */}
      <div className="shrink-0 glass-card rounded-2xl p-3 sm:p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void handleCopyRoomCode()}
            title="Tap to copy room code"
            className="min-h-[40px] flex items-center gap-2 text-left group min-w-0"
          >
            <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 shrink-0">
              ROOM
            </span>
            <span className="font-mono text-xl sm:text-2xl font-extrabold tracking-[0.16em] text-white group-hover:text-cyan-200 transition-colors truncate">
              {roomCode}
            </span>
            {copiedRoom ? (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-slate-400 group-hover:text-cyan-300 shrink-0" />
            )}
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <div className="text-[11px] font-mono font-bold text-cyan-300 tabular-nums whitespace-nowrap">
              {players.length}/16 Joined
            </div>
            {onLeaveLobby && (
              <button
                type="button"
                onClick={onLeaveLobby}
                title="Exit Lobby"
                className="min-h-[38px] px-3 rounded-xl bg-slate-900/90 hover:bg-rose-950/80 border border-white/15 hover:border-rose-500/40 text-[10px] font-bold uppercase tracking-wider text-slate-200 hover:text-rose-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap active:scale-95"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span>Exit</span>
              </button>
            )}
          </div>
        </div>

        {myPlayer && myBadge && (
          <div className="rounded-xl bg-slate-950/75 border border-white/10 px-3 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center font-mono text-xs font-extrabold text-white shrink-0"
                style={{
                  backgroundColor: `${myBadge.hex}33`,
                  border: `2px solid ${myBadge.hex}`,
                }}
              >
                #{myPlayer.badgeNumber}
              </div>
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-extrabold text-white truncate">
                  {myPlayer.name} · {myBadge.colorName}
                </div>
              </div>
            </div>
            <span className="text-[10px] font-mono font-bold text-emerald-400 shrink-0">
              SYNCED
            </span>
          </div>
        )}
      </div>

      {/* Player Roster Section */}
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        <div className="shrink-0 flex items-center justify-between px-0.5">
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-cyan-400" />
            <h2 className="font-display text-[11px] font-extrabold tracking-widest uppercase text-slate-300">
              OPERATIVE ROSTER
            </h2>
          </div>

          {isDebugMode && players.length < 8 && (
            <button
              type="button"
              onClick={() => {
                playUiClick();
                onSeedDemoPlayers();
              }}
              className="min-h-[30px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-[10px] font-bold text-emerald-300 flex items-center gap-1 hover:bg-emerald-500/25 whitespace-nowrap"
            >
              <UserPlus className="w-3 h-3" />
              <span>+ Demo Crew</span>
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-0.5">
          {players.length === 0 ? (
            <div className="glass-card rounded-2xl p-5 text-center space-y-2.5">
              <p className="text-xs text-slate-400">
                Waiting for operatives in room {roomCode}...
              </p>
              {isDebugMode && (
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    onSeedDemoPlayers();
                  }}
                  className="h-10 px-4 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-xs font-bold text-cyan-200 inline-flex items-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Add Demo Classmates</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {players.map((player) => {
                const badge = getBadgeInfo(player.badgeNumber);
                const isMe = myPlayer?.id === player.id;
                return (
                  <div
                    key={player.id}
                    className={`min-h-[54px] sm:min-h-[58px] rounded-xl px-2.5 sm:px-3 py-2 backdrop-blur-xl border flex items-center gap-2 ${
                      isMe
                        ? 'bg-cyan-950/40 border-cyan-400/50'
                        : 'bg-slate-900/70 border-white/10'
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center font-mono text-[10px] font-extrabold text-white shrink-0"
                      style={{
                        backgroundColor: `${badge.hex}28`,
                        border: `1.5px solid ${badge.hex}`,
                      }}
                    >
                      #{player.badgeNumber}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate leading-tight">
                        {player.name}
                      </div>
                      <div className="text-[10px] font-mono font-bold tracking-wider text-emerald-400">
                        READY
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Host Dock */}
      <div className="shrink-0 glass-card rounded-2xl p-2.5 sm:p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>Impostors</span>
            </div>
            {impostorCount === 2 && players.length < 4 && (
              <div className="text-[10px] font-mono text-amber-300 truncate">
                Recommended: 5+ players
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950/80 border border-white/10 shrink-0">
            <button
              type="button"
              onClick={() => {
                playUiClick();
                onSetImpostorCount(1);
              }}
              className={`min-h-[40px] px-3 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap ${
                impostorCount === 1
                  ? 'bg-rose-500 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              1 Impostor
            </button>
            <button
              type="button"
              onClick={() => {
                playUiClick();
                onSetImpostorCount(2);
              }}
              className={`min-h-[40px] px-3 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap ${
                impostorCount === 2
                  ? 'bg-rose-500 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              2 Impostors
            </button>
          </div>
        </div>

        <button
          type="button"
          disabled={players.length === 0}
          onClick={() => {
            playUiClick();
            onStartMatch();
          }}
          className="w-full h-13 sm:h-14 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-display font-extrabold text-sm sm:text-base tracking-wider uppercase flex items-center justify-center gap-2 shadow-[0_0_26px_rgba(16,185,129,0.45)] disabled:opacity-35 active:scale-95 transition-all"
        >
          <Play className="w-5 h-5 fill-current" />
          <span>LAUNCH MATCH</span>
        </button>
      </div>
    </div>
  );
}
