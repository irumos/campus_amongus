import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Clock,
  Eye,
  Gavel,
  LogOut,
  MapPin,
  Megaphone,
  Scale,
  ShieldCheck,
  SkipForward,
  Skull,
  Sparkles,
  Users,
} from 'lucide-react';
import { getBadgeInfo, type MeetingState, type Player } from '../shared/gameData';
import {
  EJECTION_REVEAL_MS,
  MEETING_DISCUSSION_MS,
  MEETING_DURATION_MS,
} from '../hooks/useCampusGame';
import {
  playCountdownTick,
  playEjectionSound,
  playSkipVoteRevealSound,
  playTieVoteRevealSound,
  playUiClick,
  playVoteCastSound,
} from '../utils/feedback';
import {
  CrewmateRoleIcon,
  ImpostorRoleIcon,
  PlayerRoleAvatar,
} from './RoleBadgeIcon';

interface MeetingScreenProps {
  meeting: MeetingState | null;
  players: Player[];
  myPlayer: Player | null;
  isDead: boolean;
  observingPlayer?: {
    name: string;
    badgeNumber: string;
  } | null;
  onExitPov?: () => void;
  onCastVote: (targetPlayerId: string | 'skip') => void;
  onFinalizeNow: () => void;
  onDismissEjection: () => void;
  onExtendTime?: () => void;
  onBeginDiscussion?: () => void;
  onExitMatch?: () => void;
}

const DISCUSSION_SECONDS = Math.round(MEETING_DISCUSSION_MS / 1000);
const TOTAL_MEETING_SECONDS = Math.round(MEETING_DURATION_MS / 1000);

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function MeetingScreen({
  meeting,
  players,
  myPlayer,
  isDead,
  observingPlayer = null,
  onExitPov,
  onCastVote,
  onFinalizeNow,
  onDismissEjection,
  onExtendTime,
  onBeginDiscussion,
  onExitMatch,
}: MeetingScreenProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [discussionUnlocked, setDiscussionUnlocked] = useState(false);
  const [isTallying, setIsTallying] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [typedLength, setTypedLength] = useState(0);
  const hadMeetingRef = useRef(false);
  const hadEjectionRef = useRef(false);
  const lastTickSecRef = useRef<number>(-1);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft = meeting
    ? Math.max(0, Math.ceil((meeting.endsAt - now) / 1000))
    : TOTAL_MEETING_SECONDS;

  // Reset phase latch only when entering a brand-new meeting
  useEffect(() => {
    const hasMeeting = Boolean(meeting && !meeting.ejectionResult);
    if (hasMeeting && !hadMeetingRef.current) {
      setDiscussionUnlocked(secondsLeft <= DISCUSSION_SECONDS);
      setIsTallying(false);
    }
    if (!hasMeeting) {
      setIsTallying(false);
    }
    hadMeetingRef.current = hasMeeting;
  }, [meeting, secondsLeft]);

  // Automatically unlock voting once assembly countdown finishes
  useEffect(() => {
    if (!discussionUnlocked && secondsLeft <= DISCUSSION_SECONDS) {
      setDiscussionUnlocked(true);
    }
  }, [discussionUnlocked, secondsLeft]);

  const isAssembling =
    !meeting?.ejectionResult &&
    !discussionUnlocked &&
    secondsLeft > DISCUSSION_SECONDS;
  const assembleSecondsLeft = isAssembling
    ? Math.max(0, secondsLeft - DISCUSSION_SECONDS)
    : 0;

  const timerDenominator = isAssembling
    ? Math.max(1, TOTAL_MEETING_SECONDS - DISCUSSION_SECONDS)
    : Math.max(1, DISCUSSION_SECONDS);
  const activePhaseSeconds = isAssembling ? assembleSecondsLeft : secondsLeft;
  const timerRatio = Math.min(1, activePhaseSeconds / timerDenominator);
  const formattedTime =
    secondsLeft === 0 ? 'TALLY' : formatClock(activePhaseSeconds);

  const livingCount = players.filter((p) => p.status === 'alive').length;
  const hasVisibleImpostor = players.some((p) => p.role === 'impostor');
  const votedCount = meeting ? Object.keys(meeting.votes).length : 0;
  const myVote = myPlayer && meeting ? meeting.votes[myPlayer.id] : undefined;
  const hasVoted = Boolean(myVote);

  const selectedPlayer = selectedId
    ? players.find((p) => p.id === selectedId && p.status === 'alive') || null
    : null;

  useEffect(() => {
    setSelectedId(null);
  }, [hasVoted, isAssembling]);

  const voteBreakdown = useMemo(() => {
    const votesMap = meeting?.votes || {};
    const tallyByTarget = new Map<string, string[]>();

    for (const [voterId, target] of Object.entries(votesMap)) {
      const normalizedTarget = target === 'skip' ? 'SKIP' : target;
      const existing = tallyByTarget.get(normalizedTarget) || [];
      existing.push(voterId);
      tallyByTarget.set(normalizedTarget, existing);
    }

    const rows = Array.from(tallyByTarget.entries())
      .map(([targetId, voterIds]) => {
        const isSkip = targetId === 'SKIP';
        const targetPlayer = isSkip
          ? null
          : players.find((p) => p.id === targetId) || null;
        return {
          targetId,
          isSkip,
          label: isSkip
            ? 'Skip Vote'
            : targetPlayer
            ? `#${targetPlayer.badgeNumber} ${targetPlayer.name}`
            : targetId,
          badgeHex: isSkip
            ? '#38bdf8'
            : targetPlayer
            ? getBadgeInfo(targetPlayer.badgeNumber).hex
            : '#f43f5e',
          voterIds,
          count: voterIds.length,
        };
      })
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (a.isSkip) return 1;
        if (b.isSkip) return -1;
        return a.label.localeCompare(b.label);
      });

    const totalVotes = rows.reduce((sum, r) => sum + r.count, 0);
    const maxCount = rows.length > 0 ? rows[0].count : 0;
    const topRows = rows.filter((r) => r.count === maxCount && maxCount > 0);
    return { rows, totalVotes, maxCount, topRows };
  }, [meeting?.votes, players]);

  const voteOutcomeKind: 'ejected' | 'skipped' | 'tied' = useMemo(() => {
    const res = meeting?.ejectionResult;
    if (!res) return 'skipped';
    if (res.ejectedBadgeNumber || res.ejectedPlayerId) return 'ejected';
    const msg = (res.message || '').toLowerCase();
    if (!msg.includes('no one was ejected') && msg.includes('was ejected')) {
      return 'ejected';
    }
    if (voteBreakdown.topRows.length > 1) return 'tied';
    if (
      voteBreakdown.topRows.length === 1 &&
      voteBreakdown.topRows[0].isSkip
    ) {
      return 'skipped';
    }
    if (voteBreakdown.totalVotes === 0) return 'tied';
    return 'skipped';
  }, [meeting?.ejectionResult, voteBreakdown]);

  const ejectedBadgeInfo = useMemo(() => {
    const num = meeting?.ejectionResult?.ejectedBadgeNumber;
    return num ? getBadgeInfo(num) : null;
  }, [meeting?.ejectionResult?.ejectedBadgeNumber]);

  const wasLocalPlayerEjected = Boolean(
    voteOutcomeKind === 'ejected' &&
      myPlayer &&
      (meeting?.ejectionResult?.ejectedPlayerId === myPlayer.id ||
        meeting?.ejectionResult?.ejectedBadgeNumber === myPlayer.badgeNumber)
  );

  const ejectionFullText = meeting?.ejectionResult
    ? meeting.ejectionResult.ejectedBadgeNumber
      ? `ID Card #${meeting.ejectionResult.ejectedBadgeNumber}${
          meeting.ejectionResult.ejectedName
            ? ` (${meeting.ejectionResult.ejectedName})`
            : ''
        } was ejected into deep space... Confirm Ejects: OFF (Role Unknown)`
      : voteOutcomeKind === 'skipped'
      ? 'No one was ejected. (Majority Skipped) · Confirm Ejects: OFF'
      : voteOutcomeKind === 'tied' && voteBreakdown.totalVotes > 0
      ? 'No one was ejected. (Vote Tied — Deadlock) · Confirm Ejects: OFF'
      : `${meeting.ejectionResult.message}`
    : '';

  const revealStartedAtRef = useRef<number>(0);

  // Outcome-matched dramatic sound effect when vote results appear
  useEffect(() => {
    const hasEjection = Boolean(meeting?.ejectionResult);
    if (hasEjection && !hadEjectionRef.current) {
      revealStartedAtRef.current = Date.now();
      if (voteOutcomeKind === 'ejected') {
        playEjectionSound();
      } else if (voteOutcomeKind === 'skipped') {
        playSkipVoteRevealSound();
      } else {
        playTieVoteRevealSound();
      }
    } else if (!hasEjection) {
      revealStartedAtRef.current = 0;
    }
    hadEjectionRef.current = hasEjection;
  }, [meeting?.ejectionResult, voteOutcomeKind]);

  const revealTotalSec = Math.round(EJECTION_REVEAL_MS / 1000);
  const revealElapsedMs =
    meeting?.ejectionResult && revealStartedAtRef.current > 0
      ? Math.max(0, now - revealStartedAtRef.current)
      : 0;
  const revealSecondsLeft = meeting?.ejectionResult
    ? Math.max(
        0,
        Math.ceil(
          Math.max(
            EJECTION_REVEAL_MS - revealElapsedMs,
            (meeting.endsAt || 0) - now
          ) / 1000
        )
      )
    : revealTotalSec;
  const revealProgressPct = Math.max(
    0,
    Math.min(100, (revealSecondsLeft / Math.max(1, revealTotalSec)) * 100)
  );

  // Subtle final-10s countdown tick during voting phase
  useEffect(() => {
    if (
      !isAssembling &&
      !meeting?.ejectionResult &&
      secondsLeft > 0 &&
      secondsLeft <= 10 &&
      lastTickSecRef.current !== secondsLeft
    ) {
      lastTickSecRef.current = secondsLeft;
      playCountdownTick(secondsLeft <= 5);
    } else if (secondsLeft > 10 || meeting?.ejectionResult) {
      lastTickSecRef.current = -1;
    }
  }, [isAssembling, meeting?.ejectionResult, secondsLeft]);

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
    }, 30);
    return () => clearInterval(interval);
  }, [ejectionFullText]);

  const handleFinalizeClick = () => {
    if (isTallying) return;
    playUiClick();
    setIsTallying(true);
    onFinalizeNow();
    setTimeout(() => setIsTallying(false), 2000);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-between px-3.5 sm:px-5 pb-3 sm:pb-4 pt-1 gap-2 sm:gap-2.5">
      {observingPlayer && (
        <div className="shrink-0 rounded-xl bg-amber-500/15 border border-amber-400/50 px-3 py-1.5 flex items-center justify-between gap-2 text-[11px] font-mono">
          <div className="flex items-center gap-1.5 text-amber-200 min-w-0">
            <Eye className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span className="truncate font-bold">
              DEV POV · #{observingPlayer.badgeNumber} {observingPlayer.name}
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

      {/* Top Siren Header */}
      <div className="shrink-0 animate-siren rounded-2xl border-2 px-3.5 py-2.5 flex items-center justify-between gap-2.5 shadow-[0_0_26px_rgba(245,158,11,0.3)]">
        <div className="space-y-0.5 min-w-0">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-mono font-extrabold tracking-widest uppercase text-amber-300">
            <Megaphone className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {meeting?.reason || 'EMERGENCY PROTOCOL'}
            </span>
          </div>
          <h1 className="font-display text-sm sm:text-base font-extrabold tracking-wide uppercase text-white leading-tight">
            {isAssembling
              ? 'ASSEMBLE AT MAIN LOBBY'
              : 'DISCUSSION & VOTING — MAIN LOBBY'}
          </h1>
          <p className="text-[10px] font-mono text-amber-100/80 tabular-nums">
            {isAssembling
              ? `Gather in ${formatClock(assembleSecondsLeft)} · Discussion ${formatClock(DISCUSSION_SECONDS)} after`
              : `Total remaining · ${formatClock(secondsLeft)}`}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
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
                stroke={isAssembling ? '#22d3ee' : '#f59e0b'}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 20}
                strokeDashoffset={2 * Math.PI * 20 * (1 - timerRatio)}
              />
            </svg>
            <span className="absolute font-mono text-[10px] font-extrabold text-amber-100 tabular-nums">
              {formattedTime}
            </span>
          </div>

          {onExitMatch && (
            <button
              type="button"
              onClick={() => {
                playUiClick();
                setConfirmExitOpen(true);
              }}
              title="Exit Active Match"
              className="min-h-[40px] px-2.5 rounded-xl bg-slate-950/75 hover:bg-rose-950/85 border border-white/15 hover:border-rose-500/40 text-[10px] font-bold uppercase tracking-wider text-slate-200 hover:text-rose-200 flex items-center gap-1 transition-colors whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Exit</span>
            </button>
          )}
        </div>
      </div>

      {/* Phase 1 Assembly Arrangement Banner */}
      {isAssembling && (
        <div className="shrink-0 glass-card rounded-2xl border-cyan-400/50 bg-cyan-950/35 px-3.5 py-2.5 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-mono font-extrabold tracking-wider uppercase text-cyan-300">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span>Phase 1 · Campus Rally Point</span>
              </div>
              <p className="text-xs text-slate-200 leading-snug">
                Pause all tasks and walk to <strong className="text-white">Main Lobby</strong>. Voting unlocks once everyone gathers.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {onExtendTime && (
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  onExtendTime();
                }}
                className="min-h-[44px] rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-white/15 text-cyan-200 font-display font-bold text-xs flex items-center justify-center gap-1.5 px-2.5 active:scale-95 transition-all whitespace-nowrap"
              >
                <Clock className="w-4 h-4 shrink-0" />
                <span>+60s Wait Time</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                playUiClick();
                setDiscussionUnlocked(true);
                onBeginDiscussion?.();
              }}
              className={`min-h-[44px] rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-display font-extrabold text-xs flex items-center justify-center gap-1.5 px-2.5 shadow-[0_0_18px_rgba(34,211,238,0.35)] active:scale-95 transition-all whitespace-nowrap ${
                !onExtendTime ? 'col-span-2' : ''
              }`}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span>Everyone Here · Vote</span>
            </button>
          </div>
        </div>
      )}

      {/* Suspect Grid */}
      <div className="flex-1 min-h-0 flex flex-col justify-between gap-2">
        <div className="shrink-0 flex items-center justify-between gap-2 px-0.5 text-[10px] font-mono">
          <span className="font-bold uppercase tracking-wider text-slate-300 tabular-nums">
            Operatives · {livingCount}/{players.length} Alive
          </span>
          <div className="flex items-center gap-2 text-slate-300">
            <span className="inline-flex items-center gap-1 text-cyan-300">
              <CrewmateRoleIcon className="w-3.5 h-3.5" />
              <span>Crew</span>
            </span>
            {hasVisibleImpostor && (
              <>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="inline-flex items-center gap-1 text-rose-400">
                  <ImpostorRoleIcon className="w-3.5 h-3.5" />
                  <span>Impostor</span>
                </span>
              </>
            )}
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="inline-flex items-center gap-1 text-violet-300">
              <Skull className="w-3 h-3" />
              <span>Out</span>
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-0.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {players.map((player) => {
              const badge = getBadgeInfo(player.badgeNumber);
              const playerIsDead = player.status !== 'alive';
              const isImpostor = player.role === 'impostor';
              const isMe = myPlayer?.id === player.id;
              const isSelected = selectedId === player.id;
              const votedBadge = Boolean(meeting?.votes[player.id]);
              const isMyTarget = myVote === player.id;

              return (
                <button
                  key={player.id}
                  type="button"
                  disabled={playerIsDead || hasVoted || isDead || isAssembling}
                  onClick={() => {
                    playUiClick();
                    setSelectedId(player.id);
                  }}
                  className={`min-h-[62px] rounded-xl px-2.5 py-2 border-2 transition-all flex items-center gap-2.5 text-left ${
                    playerIsDead
                      ? 'bg-slate-900/45 border-violet-500/25 opacity-55 cursor-not-allowed'
                      : isSelected || isMyTarget
                      ? 'bg-rose-950/65 border-rose-500 shadow-[0_0_18px_rgba(244,63,94,0.35)]'
                      : isAssembling
                      ? isImpostor
                        ? 'bg-rose-950/35 border-rose-500/40 opacity-85 cursor-default'
                        : 'glass-card border-white/10 opacity-75 cursor-default'
                      : isImpostor
                      ? 'bg-rose-950/40 border-rose-500/45 hover:border-rose-400/75 shadow-[0_0_14px_rgba(244,63,94,0.16)] active:scale-95'
                      : 'glass-card border-white/10 hover:border-cyan-400/40 active:scale-95'
                  }`}
                >
                  <PlayerRoleAvatar
                    badgeNumber={player.badgeNumber}
                    hex={badge.hex}
                    role={player.role}
                    isDead={playerIsDead}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 min-w-0">
                      <span
                        className={`text-xs font-bold truncate leading-tight ${
                          playerIsDead
                            ? 'text-slate-300'
                            : isImpostor
                            ? 'text-rose-200'
                            : 'text-white'
                        }`}
                      >
                        {player.name}
                      </span>
                      {!playerIsDead &&
                        (isImpostor ? (
                          <ImpostorRoleIcon className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        ) : (
                          <CrewmateRoleIcon className="w-3.5 h-3.5 text-cyan-300/90 shrink-0" />
                        ))}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 truncate">
                      {playerIsDead ? (
                        <span className="text-[9px] font-mono font-extrabold tracking-wider uppercase text-violet-300">
                          {isImpostor ? 'IMPOSTOR · OUT' : 'ELIMINATED'}
                        </span>
                      ) : isAssembling ? (
                        <span className="text-[9px] font-mono font-semibold text-cyan-300/85">
                          {isImpostor ? (isMe ? 'YOU · IMPOSTOR' : 'ALLY · GATHER') : 'GATHERING'}
                        </span>
                      ) : isSelected ? (
                        <span className="text-[9px] font-mono font-extrabold text-rose-300">
                          TARGETED
                        </span>
                      ) : votedBadge ? (
                        <span className="text-[9px] font-mono font-bold text-emerald-400">
                          {isImpostor ? 'IMPOSTOR · VOTED' : 'VOTED'}
                        </span>
                      ) : isImpostor ? (
                        <span className="text-[9px] font-mono font-extrabold text-rose-300">
                          {isMe ? 'IMPOSTOR (YOU)' : 'IMPOSTOR ALLY'}
                        </span>
                      ) : (
                        <span className="text-[9px] font-mono text-slate-400">
                          ALIVE
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Group Discussion Controls (Extend Time + End Discussion & Tally Votes) */}
        <div className="shrink-0 grid grid-cols-12 gap-2">
          {!isAssembling && onExtendTime && (
            <button
              type="button"
              onClick={() => {
                playUiClick();
                onExtendTime();
              }}
              className="col-span-4 min-h-[44px] rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-white/15 text-cyan-200 font-display font-bold text-xs flex items-center justify-center gap-1 px-2 active:scale-95 transition-all whitespace-nowrap"
            >
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>+60s</span>
            </button>
          )}
          <button
            type="button"
            disabled={isTallying}
            onClick={handleFinalizeClick}
            className={`${
              !isAssembling && onExtendTime ? 'col-span-8' : 'col-span-12'
            } min-h-[44px] rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/55 text-amber-200 font-display font-extrabold text-xs tracking-wide flex items-center justify-center gap-1.5 px-3 active:scale-95 transition-all whitespace-nowrap disabled:opacity-60`}
          >
            <Gavel className="w-4 h-4 shrink-0" />
            <span>
              {isTallying
                ? 'Tallying Votes...'
                : 'End Discussion & Tally Votes'}
            </span>
          </button>
        </div>
      </div>

      {/* Bottom Voting Dock */}
      <div className="shrink-0 glass-card rounded-2xl p-2.5 space-y-2">
        <div className="flex items-center justify-between px-1 text-[11px] font-mono font-bold text-slate-300 tabular-nums">
          <span>{isAssembling ? 'ASSEMBLY STATUS' : 'VOTING STATUS'}</span>
          <span className="text-cyan-300">
            {isAssembling
              ? `Opens in ${formatClock(assembleSecondsLeft)}`
              : `${votedCount}/${livingCount} Players Voted`}
          </span>
        </div>

        {isDead ? (
          <div className="h-12 rounded-xl bg-violet-950/70 border border-violet-500/40 flex items-center justify-center text-xs font-bold text-violet-200 px-3 text-center">
            Phantom Ghosts cannot cast votes.
          </div>
        ) : isAssembling ? (
          <div className="h-12 rounded-xl bg-cyan-950/60 border border-cyan-400/40 flex items-center justify-center text-xs font-semibold text-cyan-100 px-3 text-center">
            Gathering at Main Lobby · Tap “Everyone Here · Vote” once ready
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
              onClick={() => {
                if (!selectedPlayer) return;
                playVoteCastSound();
                onCastVote(selectedPlayer.id);
              }}
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
              onClick={() => {
                playVoteCastSound();
                onCastVote('skip');
              }}
              className="h-14 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/15 text-white font-display font-extrabold text-xs tracking-wider uppercase flex items-center justify-center gap-1.5 px-2 active:scale-95 transition-all"
            >
              <SkipForward className="w-4 h-4 shrink-0" />
              <span>Skip Vote</span>
            </button>
          </div>
        )}
      </div>

      {/* Cinematic Outcome-Driven Vote Tally & Ejection Reveal Modal */}
      {meeting?.ejectionResult && (
        <div className="fixed inset-0 z-50 bg-[#040711]/96 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto">
          {/* Drifting Deep-Space Starfield Backdrop */}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 overflow-hidden opacity-55"
          >
            <div
              className="animate-starfield absolute -inset-16"
              style={{
                backgroundImage:
                  'radial-gradient(1.5px 1.5px at 14% 22%, rgba(255,255,255,0.85), transparent), radial-gradient(1px 1px at 36% 72%, rgba(148,163,184,0.8), transparent), radial-gradient(2px 2px at 58% 31%, rgba(34,211,238,0.8), transparent), radial-gradient(1.5px 1.5px at 78% 64%, rgba(255,255,255,0.9), transparent), radial-gradient(1px 1px at 88% 18%, rgba(244,63,94,0.75), transparent), radial-gradient(1.5px 1.5px at 25% 85%, rgba(251,191,36,0.7), transparent)',
                backgroundSize: '260px 260px',
              }}
            />
          </div>

          <div
            className={`relative w-full max-w-md glass-card rounded-3xl p-5 sm:p-6 text-center space-y-4 border-2 overflow-hidden ${
              voteOutcomeKind === 'ejected'
                ? 'border-rose-500/60 shadow-[0_0_50px_rgba(244,63,94,0.3)]'
                : voteOutcomeKind === 'skipped'
                ? 'border-cyan-400/55 shadow-[0_0_46px_rgba(34,211,238,0.25)]'
                : 'border-amber-400/55 shadow-[0_0_46px_rgba(245,158,11,0.25)]'
            }`}
          >
            {/* Outcome Header Badge */}
            <div className="flex items-center justify-between text-[10px] font-mono font-extrabold tracking-widest uppercase">
              <span
                className={
                  voteOutcomeKind === 'ejected'
                    ? 'text-rose-300'
                    : voteOutcomeKind === 'skipped'
                    ? 'text-cyan-300'
                    : 'text-amber-300'
                }
              >
                {voteOutcomeKind === 'ejected'
                  ? 'AIRLOCK PROTOCOL · EJECTED'
                  : voteOutcomeKind === 'skipped'
                  ? 'COUNCIL VERDICT · SKIPPED'
                  : 'COUNCIL VERDICT · DEADLOCK TIE'}
              </span>
              <span className="text-slate-400 tabular-nums">
                {revealSecondsLeft}s
              </span>
            </div>

            {/* Outcome-Specific Animated Visual Stage */}
            <div className="relative h-32 rounded-2xl bg-[#050814]/90 border border-white/10 overflow-hidden flex items-center justify-center">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-60"
                style={{
                  background:
                    voteOutcomeKind === 'ejected'
                      ? `radial-gradient(circle at 50% 50%, ${
                          ejectedBadgeInfo?.hex || '#f43f5e'
                        }33, transparent 70%)`
                      : voteOutcomeKind === 'skipped'
                      ? 'radial-gradient(circle at 50% 50%, rgba(34,211,238,0.24), transparent 70%)'
                      : 'radial-gradient(circle at 50% 50%, rgba(245,158,11,0.24), transparent 70%)',
                }}
              />

              {voteOutcomeKind === 'ejected' ? (
                <div className="relative flex flex-col items-center justify-center">
                  <div
                    className="animate-eject-drift flex flex-col items-center justify-center w-20 h-20 rounded-2xl border-2 border-white/55 text-white shadow-2xl"
                    style={{
                      backgroundColor: ejectedBadgeInfo?.hex || '#e11d48',
                      boxShadow: `0 0 34px ${
                        ejectedBadgeInfo?.hex || '#f43f5e'
                      }88`,
                    }}
                  >
                    <Skull className="w-7 h-7 text-white drop-shadow" />
                    <span className="font-mono text-xs font-extrabold tracking-wider mt-0.5">
                      #{meeting.ejectionResult.ejectedBadgeNumber || '??'}
                    </span>
                  </div>
                </div>
              ) : voteOutcomeKind === 'skipped' ? (
                <div className="relative flex items-center justify-center">
                  <span className="animate-radar absolute w-24 h-24 rounded-full border border-cyan-400/45" />
                  <div className="animate-vote-shield relative w-20 h-20 rounded-full bg-cyan-500/15 border-2 border-cyan-400/70 flex flex-col items-center justify-center">
                    <ShieldCheck className="w-8 h-8 text-cyan-300" />
                    <span className="text-[9px] font-mono font-extrabold text-cyan-200 uppercase mt-0.5">
                      SAFE
                    </span>
                  </div>
                </div>
              ) : (
                <div className="relative flex items-center justify-center">
                  <span className="animate-radar absolute w-24 h-24 rounded-full border border-amber-400/45" />
                  <div className="animate-tie-pulse relative w-20 h-20 rounded-2xl bg-amber-500/15 border-2 border-amber-400/70 flex flex-col items-center justify-center">
                    <Scale className="w-8 h-8 text-amber-300" />
                    <span className="text-[9px] font-mono font-extrabold text-amber-200 uppercase mt-0.5">
                      TIED
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Typewriter Verdict Text */}
            <div className="min-h-[58px] flex items-center justify-center px-1">
              <p className="font-mono text-sm sm:text-base font-bold text-white leading-relaxed">
                {ejectionFullText.slice(0, typedLength)}
                <span className="inline-block w-2 h-4 bg-cyan-400 ml-1 animate-pulse align-middle" />
              </p>
            </div>

            {/* Special Red Headband Callout if Local Player Was Ejected */}
            {wasLocalPlayerEjected && (
              <div className="rounded-xl bg-rose-950/75 border border-rose-400/55 px-3 py-2 text-[11px] font-semibold text-rose-100 leading-snug">
                You were voted out. Put on your{' '}
                <strong className="text-rose-300">Red Headband</strong> now and
                enter <strong className="text-violet-300">Phantom Mode</strong>{' '}
                to finish remaining missions silently.
              </div>
            )}

            {/* Live Vote Breakdown Bars */}
            {voteBreakdown.rows.length > 0 ? (
              <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 space-y-2 text-left max-h-40 overflow-y-auto">
                <div className="flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-cyan-300" />
                    <span>Ballot Tally</span>
                  </span>
                  <span>
                    {voteBreakdown.totalVotes} Vote
                    {voteBreakdown.totalVotes === 1 ? '' : 's'} Cast
                  </span>
                </div>

                {voteBreakdown.rows.map((row) => {
                  const pct =
                    voteBreakdown.totalVotes > 0
                      ? Math.round((row.count / voteBreakdown.totalVotes) * 100)
                      : 0;
                  const isTop =
                    row.count === voteBreakdown.maxCount && row.count > 0;
                  const targetPlayer = row.isSkip
                    ? null
                    : players.find((p) => p.id === row.targetId) || null;
                  return (
                    <div key={row.targetId} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {row.isSkip ? (
                            <SkipForward className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                          ) : targetPlayer?.role === 'impostor' ? (
                            <ImpostorRoleIcon className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          ) : (
                            <CrewmateRoleIcon className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                          )}
                          <span
                            className={`truncate font-bold ${
                              isTop ? 'text-white' : 'text-slate-300'
                            }`}
                          >
                            {row.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="flex items-center -space-x-1">
                            {row.voterIds.slice(0, 6).map((voterId) => {
                              const voter = players.find((p) => p.id === voterId);
                              const vHex = voter
                                ? getBadgeInfo(voter.badgeNumber).hex
                                : '#94a3b8';
                              return (
                                <span
                                  key={voterId}
                                  title={
                                    voter
                                      ? `#${voter.badgeNumber} ${voter.name}`
                                      : voterId
                                  }
                                  className="w-3.5 h-3.5 rounded-full border border-slate-950"
                                  style={{ backgroundColor: vHex }}
                                />
                              );
                            })}
                          </div>
                          <span className="font-mono text-[11px] font-extrabold text-cyan-200 tabular-nums">
                            {row.count}
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-900 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700 ease-out"
                          style={{
                            width: `${Math.max(8, pct)}%`,
                            backgroundColor: row.badgeHex,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl bg-slate-950/65 border border-white/10 px-3 py-2 text-[11px] font-mono text-slate-400">
                No ballots were submitted before tally closed.
              </div>
            )}

            {/* Smooth Countdown Bar + Manual Resume Button */}
            <div className="space-y-2 pt-1">
              <div className="h-1.5 w-full rounded-full bg-slate-900 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-linear ${
                    voteOutcomeKind === 'ejected'
                      ? 'bg-gradient-to-r from-rose-500 to-amber-400'
                      : voteOutcomeKind === 'skipped'
                      ? 'bg-gradient-to-r from-cyan-400 to-emerald-400'
                      : 'bg-gradient-to-r from-amber-400 to-orange-400'
                  }`}
                  style={{ width: `${revealProgressPct}%` }}
                />
              </div>
              <button
                type="button"
                onClick={onDismissEjection}
                className="w-full h-13 rounded-2xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-display font-extrabold text-sm sm:text-base tracking-wider uppercase flex items-center justify-center gap-2 active:scale-95 transition-all"
              >
                <span>RESUME MISSION ({revealSecondsLeft}s)</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmExitOpen && onExitMatch && (
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
                You will leave the meeting and room immediately. Remaining operatives will be notified live.
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
      )}
    </div>
  );
}
