import { useState } from 'react';
import {
  Check,
  Copy,
  Crown,
  Hourglass,
  Lock,
  LogOut,
  Minus,
  Play,
  Plus,
  UserPlus,
  Users,
} from 'lucide-react';
import { getBadgeInfo, type Player } from '../shared/gameData';
import { playUiClick } from '../utils/feedback';
import {
  CrewmateRoleIcon,
  ImpostorRoleIcon,
  PlayerRoleAvatar,
} from './RoleBadgeIcon';

interface LobbyScreenProps {
  roomCode: string;
  myPlayer: Player | null;
  players: Player[];
  hostBadgeId: string | null;
  impostorCount: 1 | 2 | 3;
  isDebugMode?: boolean;
  onSetImpostorCount: (count: 1 | 2 | 3) => void;
  onStartMatch: () => void;
  onSeedDemoPlayers: () => void;
  onLeaveLobby?: () => void;
}

export function LobbyScreen({
  roomCode,
  myPlayer,
  players,
  hostBadgeId,
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
  const crewmateEstimate = Math.max(0, players.length - impostorCount);
  const hasVisibleImpostor = players.some((p) => p.role === 'impostor');

  const myBadgeId = myPlayer?.id ?? null;
  const isHost = Boolean(myBadgeId && hostBadgeId && myBadgeId === hostBadgeId);
  const hostPlayer = hostBadgeId
    ? players.find((p) => p.id === hostBadgeId) ?? null
    : null;
  const hostDisplayLabel = hostPlayer
    ? `${hostPlayer.name} / #${hostPlayer.badgeNumber}`
    : hostBadgeId
    ? `Badge #${hostBadgeId.slice(1)}`
    : 'Room Host';

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

  const handleStepImpostors = (delta: -1 | 1) => {
    if (!isHost) return;
    const next = Math.min(3, Math.max(1, impostorCount + delta)) as 1 | 2 | 3;
    if (next === impostorCount) return;
    playUiClick();
    onSetImpostorCount(next);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-between px-3.5 sm:px-5 pb-3 sm:pb-4 pt-1 gap-2.5 sm:gap-3">
      {/* Top Banner: Room Command Header */}
      <div className="shrink-0 glass-card rounded-2xl p-3 sm:p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void handleCopyRoomCode()}
            title="Tap to copy room code"
            className="min-h-[44px] flex items-center gap-2.5 text-left group min-w-0 active:scale-[0.98] transition-transform"
          >
            <div className="min-w-0">
              <div className="text-[10px] font-bold tracking-widest uppercase text-slate-400 leading-none mb-1">
                {copiedRoom ? 'Code Copied' : 'Mission Room'}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xl sm:text-2xl font-extrabold tracking-[0.16em] text-white group-hover:text-cyan-200 transition-colors truncate leading-none">
                  {roomCode}
                </span>
                {copiedRoom ? (
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-400 group-hover:text-cyan-300 shrink-0" />
                )}
              </div>
            </div>
          </button>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="text-right">
              <div className="text-xs font-mono font-extrabold text-cyan-300 tabular-nums whitespace-nowrap leading-none">
                {players.length}/16
              </div>
              <div className="text-[10px] font-semibold text-slate-400 mt-0.5 whitespace-nowrap">
                Joined
              </div>
            </div>
            {onLeaveLobby && (
              <button
                type="button"
                onClick={onLeaveLobby}
                title="Exit Lobby"
                className="min-h-[40px] px-3 rounded-xl bg-slate-900/90 hover:bg-rose-950/80 border border-white/15 hover:border-rose-500/45 text-[11px] font-bold uppercase tracking-wider text-slate-200 hover:text-rose-200 inline-flex items-center gap-1.5 transition-all whitespace-nowrap active:scale-95"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span>Exit</span>
              </button>
            )}
          </div>
        </div>

        {myPlayer && myBadge && (
          <div
            className={`rounded-xl bg-slate-950/80 border px-3 py-2.5 flex items-center justify-between gap-2.5 ${
              isHost
                ? 'border-amber-400/60'
                : myPlayer.role === 'impostor'
                ? 'border-rose-500/55'
                : ''
            }`}
            style={
              isHost
                ? {
                    boxShadow: 'inset 0 0 24px rgba(251, 191, 36, 0.14)',
                  }
                : myPlayer.role === 'impostor'
                ? {
                    boxShadow: 'inset 0 0 24px rgba(244, 63, 94, 0.16)',
                  }
                : {
                    borderColor: `${myBadge.hex}55`,
                    boxShadow: `inset 0 0 24px ${myBadge.hex}1a`,
                  }
            }
          >
            <div className="flex items-center gap-3 min-w-0">
              <PlayerRoleAvatar
                badgeNumber={myPlayer.badgeNumber}
                hex={myBadge.hex}
                role={myPlayer.role}
                isDead={myPlayer.status !== 'alive'}
                size="lg"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-extrabold text-white truncate leading-tight">
                    {myPlayer.name}
                  </span>
                  {isHost && (
                    <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/65 text-[9px] font-mono font-extrabold uppercase tracking-wider text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.28)]">
                      <span aria-hidden="true">👑</span>
                      <span>HOST</span>
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-300 font-medium truncate mt-0.5">
                  {myBadge.colorName}
                  <span aria-hidden="true" className="mx-1.5 text-slate-500">·</span>
                  Callsign {myBadge.callsign}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {myPlayer.role === 'impostor' ? (
                <>
                  <ImpostorRoleIcon className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="text-[11px] font-mono font-extrabold uppercase text-rose-300">
                    Impostor
                  </span>
                </>
              ) : (
                <>
                  <CrewmateRoleIcon className="w-4 h-4 text-cyan-300 shrink-0" />
                  <span className="text-[11px] font-mono font-bold text-emerald-400">
                    Crewmate
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Player Roster Section */}
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        <div className="shrink-0 flex items-center justify-between gap-2 px-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <h2 className="font-display text-xs font-extrabold tracking-widest uppercase text-slate-200 truncate">
              Operative Roster
            </h2>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono font-semibold text-slate-300">
              <span className="inline-flex items-center gap-1 text-cyan-300">
                <CrewmateRoleIcon className="w-3.5 h-3.5" />
                <span>Crew</span>
              </span>
              {(hasVisibleImpostor || isDebugMode) && (
                <>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="inline-flex items-center gap-1 text-rose-400">
                    <ImpostorRoleIcon className="w-3.5 h-3.5" />
                    <span>Impostor</span>
                  </span>
                </>
              )}
            </div>

            {isDebugMode && players.length < 8 && (
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  onSeedDemoPlayers();
                }}
                className="min-h-[34px] px-3 py-1 rounded-xl bg-emerald-500/15 border border-emerald-400/35 text-[11px] font-bold text-emerald-200 flex items-center gap-1.5 hover:bg-emerald-500/25 active:scale-95 transition-all whitespace-nowrap"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add Demo Crew</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-0.5">
          {players.length === 0 ? (
            <div className="glass-card rounded-2xl p-6 text-center space-y-3">
              <p className="text-xs text-slate-300">
                Waiting for operatives to scan their ID cards in room{' '}
                <span className="font-mono font-bold text-cyan-300">{roomCode}</span>...
              </p>
              {isDebugMode && (
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    onSeedDemoPlayers();
                  }}
                  className="min-h-[44px] px-4 rounded-xl bg-cyan-500/20 border border-cyan-400/45 text-xs font-bold text-cyan-200 inline-flex items-center gap-2 hover:bg-cyan-500/30 transition-colors"
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
                const isImpostor = player.role === 'impostor';
                const isDead = player.status !== 'alive';
                const isPlayerHost = Boolean(hostBadgeId && player.id === hostBadgeId);

                return (
                  <div
                    key={player.id}
                    className={`min-h-[66px] rounded-xl px-2.5 sm:px-3 py-2 backdrop-blur-xl border flex items-center gap-2.5 transition-colors ${
                      isPlayerHost
                        ? 'bg-amber-950/30 border-amber-400/60 shadow-[0_0_18px_rgba(251,191,36,0.2)]'
                        : isImpostor
                        ? 'bg-rose-950/38 border-rose-500/50 shadow-[0_0_16px_rgba(244,63,94,0.18)]'
                        : isMe
                        ? 'bg-cyan-950/45 border-cyan-400/55 shadow-[0_0_16px_rgba(6,182,212,0.16)]'
                        : 'bg-slate-900/72 border-white/10'
                    }`}
                  >
                    <PlayerRoleAvatar
                      badgeNumber={player.badgeNumber}
                      hex={badge.hex}
                      role={player.role}
                      isDead={isDead}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 min-w-0">
                        <span
                          className={`text-xs font-bold truncate leading-tight ${
                            isImpostor ? 'text-rose-200' : 'text-white'
                          }`}
                        >
                          {player.name}
                        </span>
                        {isImpostor ? (
                          <ImpostorRoleIcon className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        ) : (
                          <CrewmateRoleIcon className="w-3.5 h-3.5 text-cyan-300/90 shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {isPlayerHost && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/60 text-[9px] font-mono font-extrabold uppercase tracking-wider text-amber-200 leading-none">
                            <span aria-hidden="true">👑</span>
                            <span>HOST</span>
                          </span>
                        )}
                        <span className="text-[10px] font-medium text-slate-300 truncate">
                          {isImpostor ? (
                            <span className="text-rose-300 font-mono font-extrabold uppercase">
                              Impostor
                            </span>
                          ) : (
                            <span className="text-emerald-400 font-mono font-bold">
                              {isMe ? 'You' : badge.callsign}
                            </span>
                          )}
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

      {/* Bottom Host-Only Thumb Dock */}
      <div
        className={`shrink-0 glass-card rounded-2xl p-3 space-y-2.5 ${
          isHost ? 'border-emerald-400/35' : 'border-white/12'
        }`}
      >
        {isHost ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-200">
                  <Crown className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span>Host Controls · Impostors</span>
                </div>
                <div className="text-[11px] font-mono text-slate-300 truncate tabular-nums flex items-center gap-1.5">
                  {impostorCount >= 2 && players.length < impostorCount * 2 + 1 ? (
                    <span className="text-amber-300">
                      Recommended: {impostorCount * 2 + 1}+ operatives
                    </span>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1 text-cyan-200">
                        <CrewmateRoleIcon className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                        <span>{crewmateEstimate} Crew</span>
                      </span>
                      <span aria-hidden="true" className="text-slate-500">·</span>
                      <span className="inline-flex items-center gap-1 text-rose-200">
                        <ImpostorRoleIcon className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span>
                          {impostorCount} Impostor{impostorCount > 1 ? 's' : ''}
                        </span>
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Interactive Host-Only Impostor Count Stepper (- N +) */}
              <div
                className="flex items-center gap-1 p-1 rounded-xl bg-slate-950/90 border border-white/15 shrink-0"
                role="group"
                aria-label="Impostor Count Stepper"
              >
                <button
                  type="button"
                  disabled={impostorCount <= 1}
                  onClick={() => handleStepImpostors(-1)}
                  aria-label="Decrease Impostor Count"
                  className="w-10 h-10 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-white flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed active:scale-95 transition-all"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div className="min-w-[44px] px-2 text-center font-mono text-base font-extrabold text-rose-300 tabular-nums select-none">
                  {impostorCount}
                </div>
                <button
                  type="button"
                  disabled={impostorCount >= 3}
                  onClick={() => handleStepImpostors(1)}
                  aria-label="Increase Impostor Count"
                  className="w-10 h-10 rounded-lg bg-rose-500/25 hover:bg-rose-500/40 border border-rose-400/50 text-rose-100 flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed active:scale-95 transition-all"
                >
                  <Plus className="w-4 h-4" />
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
              className="tactical-btn-primary w-full h-14 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 font-display font-extrabold text-sm sm:text-base tracking-wider uppercase flex items-center justify-center gap-2 shadow-[0_0_28px_rgba(16,185,129,0.48)] disabled:opacity-35 disabled:cursor-not-allowed disabled:shadow-none disabled:transform-none"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>LAUNCH MATCH</span>
            </button>
          </>
        ) : (
          <>
            {/* Locked Read-Only Impostor Status Pill for Non-Hosts */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-950/55 border border-rose-400/40 text-[11px] font-mono font-extrabold uppercase tracking-wider text-rose-200 tabular-nums">
                <ImpostorRoleIcon className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>IMPOSTORS: {impostorCount} • SET BY HOST</span>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase text-slate-400">
                <Lock className="w-3 h-3 text-amber-300 shrink-0" />
                <span>Host Locked</span>
              </span>
            </div>

            {/* Sleek Waiting Status Bar Replacing Launch Button */}
            <div className="w-full min-h-[54px] rounded-2xl bg-slate-950/85 border border-amber-400/35 px-4 py-3 flex items-center justify-center gap-2 text-center shadow-[inset_0_0_20px_rgba(251,191,36,0.08)]">
              <Hourglass className="w-4 h-4 text-amber-300 animate-pulse shrink-0" />
              <span className="font-mono text-xs font-extrabold uppercase tracking-wider text-amber-100 leading-snug">
                ⏳ WAITING FOR HOST ({hostDisplayLabel}) TO LAUNCH MATCH...
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
