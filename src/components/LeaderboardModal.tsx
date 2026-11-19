import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Crown,
  Medal,
  RefreshCw,
  Skull,
  Trophy,
  X,
} from 'lucide-react';
import {
  TOURNAMENT_SCORING_RULES,
  normalizeTournamentPlayerKey,
  useTournamentLeaderboard,
  type TournamentEntry,
} from '../config/tournamentStore';
import { badgeIdToNumber } from '../hooks/useCampusGame';
import { playUiClick } from '../utils/feedback';

type SortMetric = 'points' | 'wins' | 'tasks' | 'eliminations';

interface LeaderboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlayerName?: string | null;
  currentBadgeId?: string | null;
}

export function LeaderboardModal({
  isOpen,
  onClose,
  currentPlayerName,
  currentBadgeId,
}: LeaderboardModalProps) {
  const { entries, loading, refresh } = useTournamentLeaderboard();
  const [sortBy, setSortBy] = useState<SortMetric>('points');
  const [refreshing, setRefreshing] = useState(false);

  const currentPlayerKey = useMemo(() => {
    if (!currentPlayerName && !currentBadgeId) return null;
    return normalizeTournamentPlayerKey(
      currentPlayerName || '',
      currentBadgeId || ''
    );
  }, [currentPlayerName, currentBadgeId]);

  const sortedEntries = useMemo(() => {
    const list = [...entries];
    list.sort((a, b) => {
      if (sortBy === 'wins') {
        return b.total_wins - a.total_wins || b.total_points - a.total_points;
      }
      if (sortBy === 'tasks') {
        return (
          b.tasks_completed - a.tasks_completed ||
          b.total_points - a.total_points
        );
      }
      if (sortBy === 'eliminations') {
        return (
          b.eliminations - a.eliminations || b.total_points - a.total_points
        );
      }
      return (
        b.total_points - a.total_points ||
        b.total_wins - a.total_wins ||
        b.tasks_completed - a.tasks_completed
      );
    });
    return list;
  }, [entries, sortBy]);

  // Overall points rank (independent of active sort tab)
  const myRankInfo = useMemo(() => {
    if (!currentPlayerKey) return null;
    const idx = entries.findIndex((e) => e.player_key === currentPlayerKey);
    if (idx < 0) return null;
    return { rank: idx + 1, entry: entries[idx] };
  }, [entries, currentPlayerKey]);

  if (!isOpen) return null;

  const handleRefresh = async () => {
    playUiClick();
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setTimeout(() => setRefreshing(false), 320);
    }
  };

  const renderRankMark = (rank: number) => {
    if (rank === 1) {
      return (
        <div className="w-8 h-8 rounded-lg bg-amber-400/20 border border-amber-400/55 flex items-center justify-center text-amber-300 shrink-0">
          <Crown className="w-4 h-4" />
        </div>
      );
    }
    if (rank === 2) {
      return (
        <div className="w-8 h-8 rounded-lg bg-slate-300/15 border border-slate-300/45 flex items-center justify-center text-slate-200 shrink-0">
          <Medal className="w-4 h-4" />
        </div>
      );
    }
    if (rank === 3) {
      return (
        <div className="w-8 h-8 rounded-lg bg-orange-500/20 border border-orange-400/50 flex items-center justify-center text-orange-300 shrink-0">
          <Medal className="w-4 h-4" />
        </div>
      );
    }
    return (
      <div className="w-8 h-8 rounded-lg bg-slate-900/90 border border-white/10 flex items-center justify-center font-mono text-xs font-extrabold text-slate-400 tabular-nums shrink-0">
        #{rank}
      </div>
    );
  };

  const sortTabs: { id: SortMetric; label: string }[] = [
    { id: 'points', label: 'Points' },
    { id: 'wins', label: 'Wins' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'eliminations', label: 'Elims' },
  ];

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Campus Tournament Leaderboard"
      className="fixed inset-0 z-50 bg-[#050814]/88 backdrop-blur-md flex items-center justify-center p-3.5 sm:p-5"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl max-h-[88dvh] rounded-3xl bg-[#0b1122] border border-white/15 shadow-[0_24px_80px_rgba(0,0,0,0.65)] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-3.5 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/45 flex items-center justify-center text-amber-300 shrink-0">
              <Trophy className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-extrabold tracking-wide text-white truncate">
                Campus Tournament Leaderboard
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Multi-round cumulative standings · Live synced
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              aria-label="Refresh leaderboard"
              className="w-9 h-9 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/12 flex items-center justify-center text-slate-300 hover:text-cyan-300 transition-colors active:scale-95"
            >
              <RefreshCw
                className={`w-4 h-4 ${refreshing ? 'animate-spin text-cyan-300' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={() => {
                playUiClick();
                onClose();
              }}
              aria-label="Close leaderboard"
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/15 flex items-center justify-center text-slate-200 transition-colors active:scale-95"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Personal Rank Strip (when current player has tournament scores) */}
        {myRankInfo && (
          <div className="shrink-0 mx-5 mt-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-400/35 px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-cyan-300">
                Your Campus Standing
              </div>
              <div className="text-sm font-bold text-white truncate">
                #{myRankInfo.rank} · {myRankInfo.entry.player_name}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono text-lg font-extrabold text-amber-300 tabular-nums leading-tight">
                {myRankInfo.entry.total_points} pts
              </div>
              <div className="text-[11px] font-mono text-slate-300 tabular-nums">
                {myRankInfo.entry.total_wins}W · {myRankInfo.entry.tasks_completed}T ·{' '}
                {myRankInfo.entry.eliminations}E
              </div>
            </div>
          </div>
        )}

        {/* Interactive Sort Controls */}
        <div className="shrink-0 px-5 pt-3.5 pb-2.5 flex items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Sort leaderboard"
            className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-950/90 border border-white/10"
          >
            {sortTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={sortBy === tab.id}
                onClick={() => {
                  playUiClick();
                  setSortBy(tab.id);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  sortBy === tab.id
                    ? 'bg-cyan-400 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <span className="text-xs font-mono text-slate-400 tabular-nums whitespace-nowrap">
            {entries.length} {entries.length === 1 ? 'player' : 'players'}
          </span>
        </div>

        {/* Standings List */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4 space-y-2">
          {loading ? (
            <div className="space-y-2 py-2">
              {[1, 2, 3, 4].map((row) => (
                <div
                  key={row}
                  className="h-16 rounded-2xl bg-slate-900/65 border border-white/8 animate-pulse"
                />
              ))}
            </div>
          ) : sortedEntries.length === 0 ? (
            <div className="rounded-2xl bg-slate-950/70 border border-white/10 px-5 py-10 text-center space-y-2">
              <Trophy className="w-9 h-9 text-amber-400/50 mx-auto" />
              <div className="font-display text-base font-bold text-white">
                No Tournament Scores Yet
              </div>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                Complete a campus round to automatically award Crewmate, survival, task, Impostor, and elimination points here.
              </p>
            </div>
          ) : (
            sortedEntries.map((entry: TournamentEntry, idx: number) => {
              const rank = idx + 1;
              const isMe =
                Boolean(currentPlayerKey) &&
                entry.player_key === currentPlayerKey;
              const badgeNum = badgeIdToNumber(entry.badge_id);

              return (
                <div
                  key={entry.player_key}
                  className={`rounded-2xl px-3.5 py-2.5 border flex items-center justify-between gap-3 transition-colors ${
                    isMe
                      ? 'bg-cyan-500/12 border-cyan-400/45'
                      : rank === 1
                      ? 'bg-amber-500/10 border-amber-400/35'
                      : 'bg-slate-900/65 border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {renderRankMark(rank)}

                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center font-mono text-xs font-extrabold text-white border border-white/30 shrink-0 tabular-nums"
                      style={{
                        backgroundColor: entry.color || '#06b6d4',
                        boxShadow: `0 0 14px ${entry.color || '#06b6d4'}55`,
                      }}
                    >
                      #{badgeNum}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-display text-sm font-bold text-white truncate">
                          {entry.player_name}
                        </span>
                        {isMe && (
                          <span className="text-[11px] font-mono font-extrabold text-cyan-300 shrink-0">
                            · You
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 tabular-nums mt-0.5 flex-wrap">
                        <span className="text-emerald-300">
                          {entry.total_wins} {entry.total_wins === 1 ? 'Win' : 'Wins'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 text-slate-300">
                          <CheckCircle2 className="w-3 h-3 text-cyan-400" />
                          {entry.tasks_completed} Tasks
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 text-slate-300">
                          <Skull className="w-3 h-3 text-rose-400" />
                          {entry.eliminations} Elims
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div
                      className={`font-mono text-lg font-extrabold tabular-nums leading-tight ${
                        rank === 1
                          ? 'text-amber-300'
                          : isMe
                          ? 'text-cyan-300'
                          : 'text-white'
                      }`}
                    >
                      {entry.total_points}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 tabular-nums">
                      pts · {entry.matches_played}{' '}
                      {entry.matches_played === 1 ? 'rd' : 'rds'}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Scoring Breakdown Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-white/10 bg-slate-950/75 text-[11px] font-mono text-slate-400 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span>
            Crew Win +{TOURNAMENT_SCORING_RULES.CREWMATE_WIN} · Survival +
            {TOURNAMENT_SCORING_RULES.CREWMATE_SURVIVAL} · Task +
            {TOURNAMENT_SCORING_RULES.TASK_COMPLETED}
          </span>
          <span>
            Impostor Win +{TOURNAMENT_SCORING_RULES.IMPOSTOR_WIN} · Elim +
            {TOURNAMENT_SCORING_RULES.ELIMINATION}
          </span>
        </div>
      </div>
    </div>
  );
}
