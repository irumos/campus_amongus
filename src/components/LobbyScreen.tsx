import { Play, ShieldAlert, UserPlus, Users } from 'lucide-react';
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
}: LobbyScreenProps) {
  const myBadge = myPlayer ? getBadgeInfo(myPlayer.badgeNumber) : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-between px-3.5 pb-3 pt-1 gap-2.5">
      {/* Top Banner: Compact Glass Card */}
      <div className="shrink-0 glass-card rounded-2xl p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400">
              ROOM
            </span>
            <span className="font-mono text-2xl font-extrabold tracking-[0.2em] text-white">
              {roomCode}
            </span>
          </div>

          <div className="px-2.5 py-1 rounded-full bg-cyan-500/15 border border-cyan-400/35 text-[11px] font-mono font-bold text-cyan-300 tabular-nums">
            {players.length}/16 Joined
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
                <div className="text-xs font-extrabold text-white truncate">
                  {myPlayer.name} · {myBadge.colorName}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>SYNCED</span>
            </div>
          </div>
        )}
      </div>

      {/* Player Roster Section (Compact 2-Column Grid fits up to 12 without scroll) */}
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
              className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-[10px] font-bold text-emerald-300 flex items-center gap-1 hover:bg-emerald-500/25"
            >
              <UserPlus className="w-3 h-3" />
              <span>+ Demo Crew</span>
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
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
            <div className="grid grid-cols-2 gap-1.5">
              {players.map((player) => {
                const badge = getBadgeInfo(player.badgeNumber);
                const isMe = myPlayer?.id === player.id;
                return (
                  <div
                    key={player.id}
                    className={`rounded-xl px-2.5 py-1.5 backdrop-blur-xl border flex items-center gap-2 ${
                      isMe
                        ? 'bg-cyan-950/40 border-cyan-400/50'
                        : 'bg-slate-900/70 border-white/10'
                    }`}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center font-mono text-[10px] font-extrabold text-white shrink-0"
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
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[9px] font-bold tracking-wider text-emerald-400">
                          READY
                        </span>
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
      <div className="shrink-0 glass-card rounded-2xl p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>Impostors</span>
          </div>

          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-950/80 border border-white/10">
            <button
              type="button"
              onClick={() => {
                playUiClick();
                onSetImpostorCount(1);
              }}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
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
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
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
          className="w-full h-14 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-display font-extrabold text-base tracking-wider uppercase flex items-center justify-center gap-2 shadow-[0_0_26px_rgba(16,185,129,0.45)] disabled:opacity-35 active:scale-95 transition-all"
        >
          <Play className="w-5 h-5 fill-current" />
          <span>LAUNCH MATCH</span>
        </button>
      </div>
    </div>
  );
}
