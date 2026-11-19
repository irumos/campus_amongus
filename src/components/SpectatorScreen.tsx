import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Check,
  Clock,
  Crown,
  Maximize2,
  Megaphone,
  Minimize2,
  Radio,
  ShieldCheck,
  Trophy,
  Users,
} from 'lucide-react';
import { useCampusStations } from '../config/stationStore';
import { useTournamentLeaderboard } from '../config/tournamentStore';
import {
  badgeIdToNumber,
  normalizeRoomCode,
  resolveSabotageTargets,
} from '../hooks/useCampusGame';
import { useSpectatorRoom } from '../hooks/useSpectatorRoom';
import { getBadgeInfo } from '../shared/gameData';
import { playUiClick } from '../utils/feedback';
const APP_LOGO_SRC = '/assets/aistudio/image_612f43df.png';

interface SpectatorScreenProps {
  initialRoomCode: string;
  onExitSpectator: () => void;
  onOpenFullLeaderboard: () => void;
}

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function FlatlineIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M2 13h4l2-5 3 10 2-5h9" />
    </svg>
  );
}

/**
 * STRICTLY SPOILER-FREE Lobby Spectator / Projector HQ View (`/spectator` or `?mode=spectator`).
 * Never fetches, imports, or renders `private_roles`.
 */
export function SpectatorScreen({
  initialRoomCode,
  onExitSpectator,
  onOpenFullLeaderboard,
}: SpectatorScreenProps) {
  const [activeRoomCode, setActiveRoomCode] = useState<string>(() =>
    normalizeRoomCode(initialRoomCode || 'SVCE')
  );
  const [roomDraft, setRoomDraft] = useState<string>(() =>
    normalizeRoomCode(initialRoomCode || 'SVCE')
  );
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [now, setNow] = useState<number>(() => Date.now());
  const [progressPulse, setProgressPulse] = useState<boolean>(false);

  const prevProgressRef = useRef<number>(0);

  const campusStations = useCampusStations();
  const sabotageTargets = useMemo(
    () => resolveSabotageTargets(campusStations),
    [campusStations]
  );

  const {
    room,
    publicPlayers,
    votes,
    loading,
    connected,
    matchStartedAt,
    matchEndedAt,
  } = useSpectatorRoom(activeRoomCode);

  const { entries: leaderboardEntries, loading: leaderboardLoading } =
    useTournamentLeaderboard();

  const topFive = useMemo(
    () => leaderboardEntries.slice(0, 5),
    [leaderboardEntries]
  );

  // 500ms clock for smooth countdowns and elapsed match timer
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  // Track browser fullscreen state
  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    syncFullscreen();
    return () =>
      document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const taskProgress = Math.max(
    0,
    Math.min(100, Math.round(room?.task_progress ?? 0))
  );

  // Liquid shimmer pulse when team task progress jumps
  useEffect(() => {
    if (taskProgress > prevProgressRef.current) {
      setProgressPulse(true);
      const timer = window.setTimeout(() => setProgressPulse(false), 2200);
      prevProgressRef.current = taskProgress;
      return () => window.clearTimeout(timer);
    }
    prevProgressRef.current = taskProgress;
  }, [taskProgress]);

  const handleToggleFullscreen = async () => {
    playUiClick();
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen API restrictions in embedded iframes
    }
  };

  const handleApplyRoom = (e: React.FormEvent) => {
    e.preventDefault();
    playUiClick();
    const cleaned = normalizeRoomCode(roomDraft);
    setRoomDraft(cleaned);
    setActiveRoomCode(cleaned);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('room', cleaned);
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore history errors
    }
  };

  const isCommsSabotaged = room?.active_sabotage === 'COMMS';
  const isReactorSabotaged = room?.active_sabotage === 'REACTOR';
  const isMeeting = room?.status === 'MEETING';
  const isEnded = room?.status === 'ENDED';
  const isPlaying = room?.status === 'PLAYING';

  const sabotageSecondsLeft =
    isReactorSabotaged && room?.sabotage_ends_at
      ? Math.max(0, Math.ceil((room.sabotage_ends_at - now) / 1000))
      : 0;

  const meetingSecondsLeft =
    isMeeting && room?.meeting_ends_at
      ? Math.max(0, Math.ceil((room.meeting_ends_at - now) / 1000))
      : 0;

  const elapsedSeconds = useMemo(() => {
    if (!matchStartedAt || room?.status === 'LOBBY') return 0;
    const endRef =
      room?.status === 'ENDED' && matchEndedAt ? matchEndedAt : now;
    return Math.max(0, Math.floor((endRef - matchStartedAt) / 1000));
  }, [matchStartedAt, matchEndedAt, now, room?.status]);

  const alivePlayers = useMemo(
    () => publicPlayers.filter((p) => p.is_alive),
    [publicPlayers]
  );

  const eliminatedPlayers = useMemo(
    () => publicPlayers.filter((p) => !p.is_alive),
    [publicPlayers]
  );

  const voteEntries = useMemo(() => Object.entries(votes), [votes]);
  const lockedVotesCount = useMemo(() => {
    const voterSet = new Set<string>();
    for (const p of alivePlayers) {
      if (p.has_voted || votes[p.badge_id]) {
        voterSet.add(p.badge_id);
      }
    }
    return voterSet.size;
  }, [alivePlayers, votes]);

  const allLivingVoted =
    alivePlayers.length > 0 && lockedVotesCount >= alivePlayers.length;

  const votingFinished =
    Boolean(room?.ejection_result) ||
    (isMeeting &&
      voteEntries.length > 0 &&
      (allLivingVoted || (room?.meeting_ends_at ? meetingSecondsLeft === 0 : false)));

  // Spoiler-free Vote Tally Bar Chart rows (only counts & public names/colors)
  const voteBarRows = useMemo(() => {
    if (!votingFinished || voteEntries.length === 0) return [];
    const counts = new Map<string, number>();
    for (const [, target] of voteEntries) {
      counts.set(target, (counts.get(target) || 0) + 1);
    }
    const total = voteEntries.length;

    const rows = Array.from(counts.entries()).map(([targetId, count]) => {
      if (targetId === 'SKIP') {
        return {
          id: 'SKIP',
          label: 'Skip Vote',
          badgeNumber: 'SKIP',
          color: '#64748b',
          count,
          pct: Math.round((count / total) * 100),
        };
      }
      const player = publicPlayers.find((p) => p.badge_id === targetId);
      const badgeNum = badgeIdToNumber(targetId);
      const badgeInfo = getBadgeInfo(badgeNum);
      return {
        id: targetId,
        label: player?.name || `Operative #${badgeNum}`,
        badgeNumber: `#${badgeNum}`,
        color: player?.color || badgeInfo.hex,
        count,
        pct: Math.round((count / total) * 100),
      };
    });

    rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return rows;
  }, [votingFinished, voteEntries, publicPlayers]);

  const phaseLabel = !room
    ? 'Awaiting Room'
    : room.status === 'LOBBY'
    ? 'Waiting Lobby'
    : room.status === 'PLAYING'
    ? 'Mission Live'
    : room.status === 'MEETING'
    ? 'Emergency Meeting'
    : 'Round Concluded';

  const meetingCallerName = useMemo(() => {
    if (!room?.meeting_caller_badge_id) return null;
    const found = publicPlayers.find(
      (p) => p.badge_id === room.meeting_caller_badge_id
    );
    return (
      found?.name || `Badge #${badgeIdToNumber(room.meeting_caller_badge_id)}`
    );
  }, [room?.meeting_caller_badge_id, publicPlayers]);

  const meetingBodyName = useMemo(() => {
    if (!room?.meeting_body_badge_id) return null;
    const found = publicPlayers.find(
      (p) => p.badge_id === room.meeting_body_badge_id
    );
    return (
      found?.name || `Badge #${badgeIdToNumber(room.meeting_body_badge_id)}`
    );
  }, [room?.meeting_body_badge_id, publicPlayers]);

  return (
    <div className="w-full min-h-screen bg-[#060913] text-white p-5 sm:p-6 xl:p-8 flex flex-col justify-between gap-5 xl:gap-6 relative overflow-x-hidden">
      {/* Ambient subtle grid glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,rgba(6,182,212,0.12),transparent_65%),radial-gradient(ellipse_60%_40%_at_90%_100%,rgba(16,185,129,0.08),transparent_65%)]"
      />

      {/* TOP COMMAND BAR */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div className="flex items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={() => {
              playUiClick();
              onExitSpectator();
            }}
            className="h-10 px-3.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-white/12 text-xs font-bold text-slate-200 hover:text-white inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-cyan-300" />
            <span>Exit Spectator</span>
          </button>

          <img
            src={APP_LOGO_SRC}
            alt="Campus Among Us Logo"
            className="w-11 h-11 rounded-2xl object-cover border border-cyan-400/45 shadow-[0_0_18px_rgba(6,182,212,0.3)] shrink-0 hidden sm:block"
          />

          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-2xl xl:text-3xl font-extrabold tracking-wide text-white whitespace-nowrap truncate">
              Campus Among Us · Projector HQ
            </h1>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
              <span className="inline-flex items-center gap-1.5 text-cyan-300 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                Spoiler-Free Broadcast
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-slate-200">{phaseLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5 font-mono">
                <span
                  aria-hidden="true"
                  className={`w-2 h-2 rounded-full ${
                    connected
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                      : 'bg-amber-400'
                  }`}
                />
                <span>{connected ? 'Realtime Live' : 'Local Sync'}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Room Code Selector + Fullscreen Toggle */}
        <div className="flex items-center gap-3 shrink-0">
          <form
            onSubmit={handleApplyRoom}
            className="flex items-center gap-2 bg-slate-950/90 border border-white/15 rounded-xl p-1.5"
          >
            <label
              htmlFor="spectator-room-input"
              className="pl-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap"
            >
              Room Code
            </label>
            <input
              id="spectator-room-input"
              type="text"
              maxLength={12}
              value={roomDraft}
              onChange={(e) =>
                setRoomDraft(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, 12)
                )
              }
              placeholder="SVCE"
              className="w-28 sm:w-32 h-9 px-3 rounded-lg bg-slate-900 border border-white/12 text-cyan-300 font-mono text-sm font-extrabold tracking-widest uppercase text-center focus:outline-none focus:border-cyan-400"
            />
            <button
              type="submit"
              className="h-9 px-3.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-extrabold uppercase tracking-wide transition-colors whitespace-nowrap shrink-0"
            >
              Tune In
            </button>
          </form>

          <button
            type="button"
            onClick={() => void handleToggleFullscreen()}
            className="h-12 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 hover:border-cyan-400/50 text-slate-100 text-xs font-bold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-4 h-4 text-cyan-300" />
                <span>Exit Fullscreen</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-4 h-4 text-cyan-300" />
                <span>Fullscreen</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* MAIN PROJECTOR STAGE */}
      <div className="relative z-10 flex-1 flex flex-col gap-5 xl:gap-6 min-h-0">
        {/* MODULE 1: GIANT TEAM TASK PROGRESS METER + MATCH ELAPSED TIMER */}
        <section
          aria-label="Team Task Progress"
          className={`rounded-3xl bg-[#0c1326]/95 border p-5 xl:p-6 space-y-3.5 transition-colors ${
            isCommsSabotaged
              ? 'border-amber-400/55 shadow-[0_0_32px_rgba(245,158,11,0.16)]'
              : progressPulse
              ? 'border-emerald-400/60 shadow-[0_0_36px_rgba(16,185,129,0.22)]'
              : 'border-white/12'
          }`}
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs sm:text-sm font-bold uppercase tracking-widest text-slate-400">
                Room {activeRoomCode} · Campus Crew Task Progress
              </div>
              <div className="flex items-baseline gap-4">
                <span
                  className={`font-mono text-5xl sm:text-6xl xl:text-7xl font-black tracking-tight tabular-nums leading-none ${
                    isCommsSabotaged
                      ? 'text-amber-300'
                      : 'text-emerald-400 drop-shadow-[0_0_24px_rgba(16,185,129,0.45)]'
                  }`}
                >
                  {isCommsSabotaged ? 'JAMMED' : `${taskProgress}%`}
                </span>
                <span className="text-sm sm:text-base font-medium text-slate-300">
                  {isCommsSabotaged
                    ? 'Communications offline — restore signal to resume progress feed'
                    : taskProgress >= 100
                    ? 'All crew objectives verified'
                    : 'Shared global task completion across all crewmates'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-6 shrink-0">
              <div className="text-right">
                <div className="text-xs font-semibold text-slate-400">
                  Operatives
                </div>
                <div className="font-mono text-2xl xl:text-3xl font-extrabold text-white tabular-nums">
                  <span className="text-cyan-300">{alivePlayers.length}</span>
                  <span className="text-slate-500"> / {publicPlayers.length}</span>
                </div>
              </div>

              <div className="h-10 w-px bg-white/10" aria-hidden="true" />

              <div className="text-right">
                <div className="text-xs font-semibold text-slate-400 inline-flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-cyan-300" />
                  <span>Match Elapsed</span>
                </div>
                <div className="font-mono text-3xl xl:text-4xl font-black text-cyan-200 tabular-nums leading-tight">
                  {formatClock(elapsedSeconds)}
                </div>
              </div>
            </div>
          </div>

          {/* Giant Liquid-Emerald Progress Bar */}
          <div
            role="progressbar"
            aria-label="Global Team Task Progress"
            aria-valuenow={isCommsSabotaged ? undefined : taskProgress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="relative h-10 xl:h-12 w-full rounded-2xl bg-slate-950 border border-white/15 p-1.5 overflow-hidden"
          >
            {isCommsSabotaged ? (
              <div className="h-full w-full rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center gap-2 font-mono text-sm sm:text-base font-extrabold tracking-widest uppercase text-amber-200 animate-pulse">
                <Radio className="w-5 h-5" />
                <span>COMMS SIGNAL JAMMED · PROGRESS FEED OFFLINE</span>
              </div>
            ) : (
              <>
                <div
                  className="relative h-full rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-400 to-teal-300 shadow-[0_0_28px_rgba(16,185,129,0.75)] transition-[width] duration-700 ease-out overflow-hidden"
                  style={{ width: `${taskProgress}%` }}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent"
                  />
                  {progressPulse && (
                    <span
                      aria-hidden="true"
                      className="animate-progress-sweep pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/75 to-transparent"
                    />
                  )}
                  {taskProgress > 0 && taskProgress < 100 && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute right-0 inset-y-0 w-2 bg-white/90 blur-[2px]"
                    />
                  )}
                </div>
                {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((mark) => (
                  <span
                    key={mark}
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-y-1.5 w-px ${
                      mark === 50 ? 'bg-slate-950/85' : 'bg-slate-950/55'
                    }`}
                    style={{ left: `${mark}%` }}
                  />
                ))}
              </>
            )}
          </div>
        </section>

        {/* MODULE 2: ACTIVE ALERT BANNER (SABOTAGE / EMERGENCY MEETING / MATCH END) */}
        {(isReactorSabotaged || isCommsSabotaged) && !isEnded && (
          <section
            role="alert"
            className="animate-siren rounded-3xl border-2 border-rose-500 px-6 py-4 xl:py-5 flex flex-wrap items-center justify-between gap-4 shadow-[0_0_40px_rgba(244,63,94,0.45)]"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/25 border border-rose-300/60 flex items-center justify-center text-rose-100 shrink-0">
                {isReactorSabotaged ? (
                  <AlertTriangle className="w-7 h-7" />
                ) : (
                  <Radio className="w-7 h-7" />
                )}
              </div>
              <div className="min-w-0">
                <div className="font-mono text-xs font-extrabold uppercase tracking-widest text-rose-200">
                  Critical Campus Sabotage Active
                </div>
                <div className="font-display text-2xl xl:text-3xl font-black uppercase tracking-wide text-white truncate">
                  {isReactorSabotaged
                    ? `REACTOR MELTDOWN · DEFUSE AT ${sabotageTargets.reactorLabel.toUpperCase()}`
                    : `COMMS JAMMED · RESTORE AT ${sabotageTargets.commsLabel.toUpperCase()}`}
                </div>
              </div>
            </div>

            {isReactorSabotaged && (
              <div className="text-right shrink-0">
                <div className="text-xs font-mono font-bold uppercase tracking-wider text-rose-200">
                  Time Remaining
                </div>
                <div className="font-mono text-4xl xl:text-5xl font-black text-white tabular-nums leading-none">
                  {formatClock(sabotageSecondsLeft)}
                </div>
              </div>
            )}
          </section>
        )}

        {isMeeting && (
          <section
            role="alert"
            className="rounded-3xl bg-gradient-to-r from-amber-950/90 via-amber-900/70 to-amber-950/90 border-2 border-amber-400 px-6 py-4 xl:py-5 flex flex-wrap items-center justify-between gap-4 shadow-[0_0_36px_rgba(245,158,11,0.35)]"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-amber-400/20 border border-amber-300/60 flex items-center justify-center text-amber-200 shrink-0">
                <Megaphone className="w-7 h-7" />
              </div>
              <div className="min-w-0">
                <div className="font-mono text-xs font-extrabold uppercase tracking-widest text-amber-200">
                  {meetingBodyName
                    ? `Body Reported: ${meetingBodyName}${meetingCallerName ? ` · Reported by ${meetingCallerName}` : ''}`
                    : meetingCallerName
                    ? `Called by ${meetingCallerName}`
                    : 'All Operatives Report to Central Lobby'}
                </div>
                <div className="font-display text-2xl xl:text-3xl font-black uppercase tracking-wide text-white truncate">
                  EMERGENCY MEETING IN PROGRESS
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 shrink-0">
              <div className="text-right">
                <div className="text-xs font-mono font-bold uppercase tracking-wider text-amber-200">
                  Ballots Cast
                </div>
                <div className="font-mono text-3xl xl:text-4xl font-black text-white tabular-nums leading-none">
                  {lockedVotesCount} / {alivePlayers.length}
                </div>
              </div>
              {room?.meeting_ends_at && (
                <>
                  <div className="h-10 w-px bg-amber-300/30" aria-hidden="true" />
                  <div className="text-right">
                    <div className="text-xs font-mono font-bold uppercase tracking-wider text-amber-200">
                      Timer
                    </div>
                    <div className="font-mono text-3xl xl:text-4xl font-black text-amber-200 tabular-nums leading-none">
                      {formatClock(meetingSecondsLeft)}
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {isEnded && room?.winner && (
          <section
            role="status"
            className={`rounded-3xl border-2 px-6 py-4 xl:py-5 flex flex-wrap items-center justify-between gap-4 ${
              room.winner === 'CREWMATES'
                ? 'bg-gradient-to-r from-cyan-950/90 via-emerald-950/80 to-cyan-950/90 border-cyan-400 shadow-[0_0_36px_rgba(6,182,212,0.3)]'
                : 'bg-gradient-to-r from-rose-950/90 via-rose-900/75 to-rose-950/90 border-rose-500 shadow-[0_0_36px_rgba(244,63,94,0.35)]'
            }`}
          >
            <div className="flex items-center gap-4 min-w-0">
              <div
                className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${
                  room.winner === 'CREWMATES'
                    ? 'bg-cyan-400/20 border-cyan-300/60 text-cyan-200'
                    : 'bg-rose-500/25 border-rose-300/60 text-rose-200'
                }`}
              >
                <Trophy className="w-7 h-7" />
              </div>
              <div>
                <div className="font-mono text-xs font-extrabold uppercase tracking-widest text-slate-200">
                  Match Concluded · Tournament Standings Updated
                </div>
                <div
                  className={`font-display text-2xl xl:text-3xl font-black uppercase tracking-wide ${
                    room.winner === 'CREWMATES'
                      ? 'text-cyan-200'
                      : 'text-rose-200'
                  }`}
                >
                  {room.winner === 'CREWMATES'
                    ? 'CREWMATES VICTORY'
                    : 'IMPOSTORS VICTORY'}
                </div>
              </div>
            </div>
            <div className="font-mono text-sm font-bold text-slate-200 tabular-nums">
              Final Time {formatClock(elapsedSeconds)} · Tasks {taskProgress}%
            </div>
          </section>
        )}

        {/* LOWER 2-COLUMN SPLIT: CREW ROSTER + VOTE CHART (LEFT ~70%) | TOP 5 TOURNAMENT SIDEBAR (RIGHT ~30%) */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-5 xl:gap-6 items-stretch">
          {/* MODULE 3: LIVE CAMPUS CREW ROSTER GRID + VOTE RESULTS BAR CHART */}
          <section
            aria-label="Live Campus Crew Roster"
            className="lg:col-span-8 xl:col-span-9 rounded-3xl bg-[#0c1326]/90 border border-white/12 p-5 xl:p-6 flex flex-col gap-4 min-h-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Users className="w-5 h-5 text-cyan-300 shrink-0" />
                <h2 className="font-display text-lg xl:text-xl font-extrabold tracking-wide text-white">
                  Live Campus Crew Roster
                </h2>
              </div>

              <div className="flex items-center gap-3 text-xs sm:text-sm font-mono tabular-nums text-slate-300">
                <span className="text-cyan-300 font-bold">
                  {alivePlayers.length} Active
                </span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-violet-300 font-bold">
                  {eliminatedPlayers.length} Eliminated
                </span>
                {room && (
                  <>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="text-slate-400">
                      {room.impostor_count}{' '}
                      {room.impostor_count === 1 ? 'Impostor' : 'Impostors'} in field
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Live Meeting Vote Results Bar Chart (appears once voting finishes) */}
            {votingFinished && (
              <div className="rounded-2xl bg-slate-950/85 border border-amber-400/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-amber-200 font-display text-base font-extrabold">
                    <BarChart3 className="w-4 h-4 text-amber-300" />
                    <span>Emergency Meeting Vote Results</span>
                  </div>
                  {room?.ejection_result && (
                    <span className="font-mono text-xs sm:text-sm font-extrabold text-white">
                      {room.ejection_result}
                    </span>
                  )}
                </div>

                {voteBarRows.length > 0 && (
                  <div className="space-y-2.5">
                    {voteBarRows.map((bar) => (
                      <div key={bar.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs sm:text-sm font-mono">
                          <span className="font-bold text-white flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-sm shrink-0"
                              style={{ backgroundColor: bar.color }}
                            />
                            <span>{bar.label}</span>
                            <span className="text-slate-400 text-xs">
                              {bar.badgeNumber}
                            </span>
                          </span>
                          <span className="font-extrabold text-amber-200 tabular-nums">
                            {bar.count} {bar.count === 1 ? 'vote' : 'votes'} ({bar.pct}%)
                          </span>
                        </div>
                        <div className="h-3.5 w-full rounded-lg bg-slate-900 overflow-hidden border border-white/10">
                          <div
                            className="h-full rounded-lg transition-[width] duration-700 ease-out"
                            style={{
                              width: `${Math.max(4, bar.pct)}%`,
                              backgroundColor: bar.color,
                              boxShadow: `0 0 16px ${bar.color}66`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Roster Cards Grid */}
            {loading ? (
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <div
                    key={n}
                    className="h-28 rounded-2xl bg-slate-900/60 border border-white/8 animate-pulse"
                  />
                ))}
              </div>
            ) : publicPlayers.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center rounded-2xl bg-slate-950/65 border border-white/10 p-10 text-center space-y-2">
                <Users className="w-10 h-10 text-slate-500" />
                <div className="font-display text-xl font-bold text-white">
                  {room
                    ? `Room ${activeRoomCode} is Waiting for Operatives`
                    : `No Active Room Found for "${activeRoomCode}"`}
                </div>
                <p className="text-sm text-slate-400 max-w-md">
                  Have players scan their ID Card QR and join Room{' '}
                  <span className="font-mono font-bold text-cyan-300">
                    {activeRoomCode}
                  </span>{' '}
                  to appear live on this projector display.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 xl:gap-4 content-start">
                {publicPlayers.map((player) => {
                  const badgeNum = badgeIdToNumber(player.badge_id);
                  const badgeInfo = getBadgeInfo(badgeNum);
                  const avatarColor = player.color || badgeInfo.hex;
                  const isHost = Boolean(
                    room?.host_badge_id &&
                      room.host_badge_id === player.badge_id
                  );
                  const hasVoted = Boolean(
                    isMeeting &&
                      player.is_alive &&
                      (player.has_voted || votes[player.badge_id])
                  );

                  return (
                    <div
                      key={player.badge_id}
                      className={`rounded-2xl p-4 border flex flex-col justify-between gap-3 transition-all ${
                        player.is_alive
                          ? 'bg-slate-950/75 border-cyan-400/30 shadow-[0_0_24px_rgba(6,182,212,0.08)]'
                          : 'bg-violet-950/30 border-violet-500/35 opacity-75'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className={`w-13 h-13 rounded-2xl flex items-center justify-center font-mono text-base font-black text-white border-2 shrink-0 tabular-nums ${
                            player.is_alive
                              ? 'border-white/40'
                              : 'border-violet-300/35 grayscale-[45%]'
                          }`}
                          style={{
                            backgroundColor: avatarColor,
                            boxShadow: player.is_alive
                              ? `0 0 20px ${avatarColor}66`
                              : 'none',
                          }}
                        >
                          #{badgeNum}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="font-display text-lg font-extrabold text-white truncate leading-tight">
                            {player.name}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400 mt-0.5 truncate">
                            <span>{badgeInfo.colorName}</span>
                            {isHost && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 text-amber-300 font-extrabold">
                                  <Crown className="w-3.5 h-3.5 fill-amber-300/30" />
                                  HOST
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-white/8">
                        {player.is_alive ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-extrabold tracking-wider uppercase text-cyan-300">
                            <span
                              aria-hidden="true"
                              className="w-2 h-2 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.95)]"
                            />
                            ACTIVE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-extrabold tracking-wider uppercase text-violet-300">
                            <FlatlineIcon className="w-4 h-4 text-violet-300" />
                            ELIMINATED
                          </span>
                        )}

                        {hasVoted ? (
                          <span className="inline-flex items-center gap-1 font-mono text-xs font-extrabold text-emerald-300">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                            VOTED ✓
                          </span>
                        ) : isMeeting && player.is_alive ? (
                          <span className="font-mono text-[11px] font-semibold text-amber-300/80">
                            Deciding...
                          </span>
                        ) : isPlaying && player.is_alive ? (
                          <span className="font-mono text-[11px] text-slate-500">
                            In Field
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* MODULE 4: TOP 5 TOURNAMENT LEADERBOARD SIDEBAR */}
          <aside
            aria-label="Top 5 Tournament Leaderboard"
            className="lg:col-span-4 xl:col-span-3 rounded-3xl bg-[#0c1326]/90 border border-white/12 p-5 xl:p-6 flex flex-col justify-between gap-4 min-h-0"
          >
            <div className="space-y-4 min-h-0 flex-1 flex flex-col">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Trophy className="w-5 h-5 text-amber-300 shrink-0" />
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-extrabold tracking-wide text-white truncate">
                      Top 5 Leaderboard
                    </h2>
                    <p className="text-xs text-slate-400 truncate">
                      Campus Tournament · Today
                    </p>
                  </div>
                </div>
              </div>

              {leaderboardLoading ? (
                <div className="space-y-2.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <div
                      key={n}
                      className="h-16 rounded-2xl bg-slate-900/65 border border-white/8 animate-pulse"
                    />
                  ))}
                </div>
              ) : topFive.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center rounded-2xl bg-slate-950/65 border border-white/10 p-6 text-center space-y-2">
                  <Trophy className="w-8 h-8 text-amber-400/45" />
                  <div className="font-display text-sm font-bold text-slate-200">
                    Podium Awaiting Round 1
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Scores calculate automatically when each match concludes.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 flex-1">
                  {topFive.map((entry, idx) => {
                    const rank = idx + 1;
                    const badgeNum = badgeIdToNumber(entry.badge_id);
                    const isFirst = rank === 1;
                    const isSecond = rank === 2;
                    const isThird = rank === 3;

                    return (
                      <div
                        key={entry.player_key}
                        className={`rounded-2xl p-3.5 border flex items-center justify-between gap-3 ${
                          isFirst
                            ? 'bg-amber-500/12 border-amber-400/45 shadow-[0_0_24px_rgba(245,158,11,0.14)]'
                            : isSecond
                            ? 'bg-slate-800/45 border-slate-300/30'
                            : isThird
                            ? 'bg-orange-500/10 border-orange-400/30'
                            : 'bg-slate-950/65 border-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center font-mono text-xs font-black shrink-0 tabular-nums ${
                              isFirst
                                ? 'bg-amber-400 text-slate-950'
                                : isSecond
                                ? 'bg-slate-300 text-slate-950'
                                : isThird
                                ? 'bg-orange-400 text-slate-950'
                                : 'bg-slate-900 border border-white/12 text-slate-300'
                            }`}
                          >
                            {isFirst ? (
                              <Crown className="w-4 h-4" />
                            ) : (
                              `#${rank}`
                            )}
                          </div>

                          <div
                            className="w-3 h-9 rounded-full shrink-0"
                            style={{ backgroundColor: entry.color || '#06b6d4' }}
                            aria-hidden="true"
                          />

                          <div className="min-w-0">
                            <div className="font-display text-base font-extrabold text-white truncate leading-tight">
                              {entry.player_name}
                            </div>
                            <div className="text-[11px] font-mono text-slate-400 tabular-nums mt-0.5 truncate">
                              #{badgeNum} · {entry.total_wins}W ·{' '}
                              {entry.tasks_completed}T · {entry.eliminations}E
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div
                            className={`font-mono text-xl font-black tabular-nums leading-none ${
                              isFirst ? 'text-amber-300' : 'text-white'
                            }`}
                          >
                            {entry.total_points}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            pts
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                playUiClick();
                onOpenFullLeaderboard();
              }}
              className="w-full h-11 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/12 hover:border-amber-400/45 text-xs font-bold text-amber-200 inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              <Trophy className="w-4 h-4 text-amber-300" />
              <span>View Full Tournament Standings</span>
            </button>
          </aside>
        </div>
      </div>

      {/* QUIET PROJECTOR FOOTER */}
      <footer className="relative z-10 flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/10 text-xs font-mono text-slate-400">
        <span>
          Scoring · Crew Win +100 (+50 Survival) · Task +20 · Impostor Win +150 · Elim +40
        </span>
        <span>
          Spoiler-Free Lobby Display · Roles Hidden
        </span>
      </footer>
    </div>
  );
}
