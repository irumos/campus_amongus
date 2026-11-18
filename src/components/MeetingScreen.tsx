import { useEffect, useState } from 'react';
import { ArrowRight, Check, Megaphone, SkipForward, Skull } from 'lucide-react';
import { getBadgeInfo, type MeetingState, type Player } from '../shared/gameData';
import { playUiClick } from '../utils/feedback';

interface MeetingScreenProps {
  meeting: MeetingState | null;
  players: Player[];
  myPlayer: Player | null;
  isDead: boolean;
  onCastVote: (targetPlayerId: string | 'skip') => void;
  onFinalizeNow: () => void;
  onDismissEjection: () => void;
}

export function MeetingScreen({
  meeting,
  players,
  myPlayer,
  isDead,
  onCastVote,
  onFinalizeNow,
  onDismissEjection,
}: MeetingScreenProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [typedLength, setTypedLength] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft = meeting
    ? Math.max(0, Math.ceil((meeting.endsAt - now) / 1000))
    : 45;
  const timerRatio = Math.min(1, secondsLeft / 60);
  const formattedTime =
    secondsLeft === 0 ? 'TALLY' : `00:${String(secondsLeft).padStart(2, '0')}`;

  const livingCount = players.filter((p) => p.status === 'alive').length;
  const votedCount = meeting ? Object.keys(meeting.votes).length : 0;
  const myVote = myPlayer && meeting ? meeting.votes[myPlayer.id] : undefined;
  const hasVoted = Boolean(myVote);

  const selectedPlayer = selectedId
    ? players.find((p) => p.id === selectedId && p.status === 'alive') || null
    : null;

  useEffect(() => {
    setSelectedId(null);
  }, [meeting?.endsAt, hasVoted]);

  const ejectionFullText = meeting?.ejectionResult
    ? meeting.ejectionResult.ejectedBadgeNumber
      ? `Badge #${meeting.ejectionResult.ejectedBadgeNumber} was ejected... Confirm Ejects: OFF (Role Unknown)`
      : `${meeting.ejectionResult.message}`
    : '';

  useEffect(() => {
    if (!ejectionFullText) {
      setTypedLength(0);
      return;
    }
    setTypedLength(0);
    const interval = setInterval(() => {
      setTypedLength((prev) => {
        if (prev >= ejectionFullText.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 28);
    return () => clearInterval(interval);
  }, [ejectionFullText]);

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-between px-3.5 pb-3 pt-1 gap-2.5">
      {/* Top Siren Header */}
      <div className="shrink-0 animate-siren rounded-2xl border-2 px-3.5 py-2.5 flex items-center justify-between gap-3 shadow-[0_0_26px_rgba(245,158,11,0.3)]">
        <div className="space-y-0.5 min-w-0">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-mono font-extrabold tracking-widest uppercase text-amber-300">
            <Megaphone className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{meeting?.reason || 'EMERGENCY PROTOCOL'}</span>
          </div>
          <h1 className="font-display text-sm font-extrabold tracking-wide uppercase text-white leading-tight">
            EMERGENCY MEETING — MAIN LOBBY
          </h1>
        </div>

        <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
          <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
            <circle
              cx="24"
              cy="24"
              r="20"
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="4"
            />
            <circle
              cx="24"
              cy="24"
              r="20"
              fill="none"
              stroke="#f59e0b"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 20}
              strokeDashoffset={2 * Math.PI * 20 * (1 - timerRatio)}
            />
          </svg>
          <span className="absolute font-mono text-[10px] font-extrabold text-amber-200 tabular-nums">
            {formattedTime}
          </span>
        </div>
      </div>

      {/* Suspect Grid (Compact 2-column grid fits up to 12 players without scroll) */}
      <div className="flex-1 min-h-0 flex flex-col justify-between gap-1.5">
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-2 gap-1.5">
            {players.map((player) => {
              const badge = getBadgeInfo(player.badgeNumber);
              const playerIsDead = player.status !== 'alive';
              const isSelected = selectedId === player.id;
              const votedBadge = Boolean(meeting?.votes[player.id]);
              const isMyTarget = myVote === player.id;

              return (
                <button
                  key={player.id}
                  type="button"
                  disabled={playerIsDead || hasVoted || isDead}
                  onClick={() => {
                    playUiClick();
                    setSelectedId(player.id);
                  }}
                  className={`min-h-[58px] rounded-xl px-2.5 py-2 border-2 transition-all flex items-center gap-2 text-left ${
                    playerIsDead
                      ? 'bg-slate-900/40 border-violet-500/20 opacity-45 cursor-not-allowed'
                      : isSelected || isMyTarget
                      ? 'bg-rose-950/65 border-rose-500 shadow-[0_0_18px_rgba(244,63,94,0.35)]'
                      : 'glass-card border-white/10 hover:border-white/25 active:scale-95'
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-mono text-[10px] font-extrabold text-white shrink-0"
                    style={{
                      backgroundColor: playerIsDead
                        ? 'rgba(139,92,246,0.2)'
                        : `${badge.hex}33`,
                      border: `1.5px solid ${playerIsDead ? '#8b5cf6' : badge.hex}`,
                    }}
                  >
                    {playerIsDead ? (
                      <Skull className="w-3.5 h-3.5 text-violet-300" />
                    ) : (
                      `#${player.badgeNumber}`
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white truncate leading-tight">
                      {player.name}
                    </div>
                    {playerIsDead ? (
                      <span className="text-[9px] font-mono font-extrabold tracking-wider uppercase text-violet-300">
                        ELIMINATED
                      </span>
                    ) : isSelected ? (
                      <span className="text-[9px] font-mono font-extrabold text-rose-300">
                        TARGETED
                      </span>
                    ) : votedBadge ? (
                      <span className="text-[9px] font-mono font-bold text-emerald-400">
                        VOTED
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono text-slate-400">
                        ALIVE
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 text-center">
          <button
            type="button"
            onClick={onFinalizeNow}
            className="text-[11px] font-semibold text-slate-400 hover:text-amber-300 underline underline-offset-4 py-0.5"
          >
            End Discussion &amp; Tally Votes Now
          </button>
        </div>
      </div>

      {/* Bottom Voting Dock */}
      <div className="shrink-0 glass-card rounded-2xl p-2.5 space-y-2">
        <div className="flex items-center justify-between px-1 text-[11px] font-mono font-bold text-slate-300 tabular-nums">
          <span>VOTING STATUS</span>
          <span className="text-cyan-300">
            {votedCount}/{livingCount} Players Voted
          </span>
        </div>

        {isDead ? (
          <div className="h-12 rounded-xl bg-violet-950/70 border border-violet-500/40 flex items-center justify-center text-xs font-bold text-violet-200 px-3 text-center">
            Phantom Ghosts cannot cast votes.
          </div>
        ) : hasVoted ? (
          <div className="h-12 rounded-xl bg-emerald-950/60 border border-emerald-400/50 flex items-center justify-center text-xs font-mono font-bold text-emerald-300 uppercase">
            Vote Locked · Waiting on others
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!selectedPlayer}
              onClick={() => selectedPlayer && onCastVote(selectedPlayer.id)}
              className="h-14 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800/70 disabled:text-slate-500 text-white font-display font-extrabold text-xs tracking-wider uppercase flex items-center justify-center gap-1.5 px-2 active:scale-95 transition-all"
            >
              <Check className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {selectedPlayer
                  ? `VOTE #${selectedPlayer.badgeNumber}`
                  : 'CONFIRM VOTE'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onCastVote('skip')}
              className="h-14 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/15 text-white font-display font-extrabold text-xs tracking-wider uppercase flex items-center justify-center gap-1.5 px-2 active:scale-95 transition-all"
            >
              <SkipForward className="w-4 h-4 shrink-0" />
              <span>Skip Vote</span>
            </button>
          </div>
        )}
      </div>

      {/* Cinematic Ejection Reveal Modal */}
      {meeting?.ejectionResult && (
        <div className="fixed inset-0 z-50 bg-[#060913]/95 backdrop-blur-xl flex items-center justify-center p-5">
          <div className="w-full max-w-md glass-card rounded-3xl p-6 text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-rose-500/15 border border-rose-400/50 shadow-[0_0_32px_rgba(244,63,94,0.4)] flex items-center justify-center mx-auto">
              <Skull className="w-10 h-10 text-rose-400" />
            </div>

            <div className="min-h-[72px] flex items-center justify-center">
              <p className="font-mono text-base font-bold text-white leading-relaxed">
                {ejectionFullText.slice(0, typedLength)}
                <span className="inline-block w-2 h-4 bg-cyan-400 ml-1 animate-pulse align-middle" />
              </p>
            </div>

            <button
              type="button"
              onClick={onDismissEjection}
              className="w-full h-14 rounded-2xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-display font-extrabold text-base tracking-wider uppercase flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <span>RESUME MISSION</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
