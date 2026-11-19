import { useCallback, useEffect, useState } from 'react';
import {
  isSupabaseConfigured,
  logSupabaseTableError,
  supabase,
  type RoleType,
  type TournamentEntryRow,
} from './supabase';

export type TournamentEntry = TournamentEntryRow;

export const TOURNAMENT_SCORING_RULES = {
  CREWMATE_WIN: 100,
  CREWMATE_SURVIVAL: 50,
  TASK_COMPLETED: 20,
  IMPOSTOR_WIN: 150,
  ELIMINATION: 40,
} as const;

export interface TournamentMatchParticipantInput {
  playerName: string;
  badgeId: string;
  color: string;
  role: RoleType;
  isAlive: boolean;
  tasksCompleted: number;
  eliminations: number;
}

export interface TournamentMatchPlayerAward {
  player_key: string;
  player_name: string;
  badge_id: string;
  color: string;
  role: RoleType;
  is_alive: boolean;
  tasks_completed: number;
  eliminations: number;
  points_earned: number;
  won: boolean;
}

export interface TournamentAwardResult {
  ok: boolean;
  alreadyScored: boolean;
  source: 'rpc' | 'table' | 'local';
  updatedCount: number;
  awards: TournamentMatchPlayerAward[];
  error?: string;
}

const LOCAL_LEADERBOARD_KEY = 'cairl_tournament_leaderboard_v1';
const LOCAL_SCORED_MATCHES_KEY = 'cairl_tournament_scored_matches_v1';
const BROADCAST_CHANNEL_NAME = 'cairl_tournament_leaderboard_channel_v1';
const REALTIME_CHANNEL_NAME = 'campus-tournament-leaderboard-sync';

const localListeners = new Set<() => void>();

function notifyLocalListeners(): void {
  for (const listener of localListeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

function broadcastLocalLeaderboardChanged(): void {
  notifyLocalListeners();
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      ch.postMessage({ type: 'leaderboard_updated', ts: Date.now() });
      ch.close();
    }
  } catch {
    // ignore BroadcastChannel unsupported errors
  }
}

export function normalizeTournamentPlayerKey(
  playerName: string,
  badgeId: string
): string {
  const cleanedName = playerName.trim().toLowerCase().replace(/\s+/g, ' ');
  if (cleanedName.length > 0) {
    return cleanedName;
  }
  return badgeId.trim().toLowerCase() || 'p01';
}

export function sortTournamentEntries(
  entries: TournamentEntry[]
): TournamentEntry[] {
  return [...entries].sort((a, b) => {
    if (b.total_points !== a.total_points) {
      return b.total_points - a.total_points;
    }
    if (b.total_wins !== a.total_wins) {
      return b.total_wins - a.total_wins;
    }
    if (b.tasks_completed !== a.tasks_completed) {
      return b.tasks_completed - a.tasks_completed;
    }
    if (b.eliminations !== a.eliminations) {
      return b.eliminations - a.eliminations;
    }
    return a.player_name.localeCompare(b.player_name);
  });
}

function readLocalLeaderboard(): TournamentEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_LEADERBOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortTournamentEntries(parsed as TournamentEntry[]);
  } catch {
    return [];
  }
}

function writeLocalLeaderboard(entries: TournamentEntry[]): void {
  try {
    localStorage.setItem(
      LOCAL_LEADERBOARD_KEY,
      JSON.stringify(sortTournamentEntries(entries))
    );
  } catch {
    // ignore storage quota errors
  }
}

function readLocalScoredMatches(): Set<string> {
  try {
    const raw = localStorage.getItem(LOCAL_SCORED_MATCHES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set();
  }
}

function markLocalMatchScored(matchId: string): void {
  try {
    const set = readLocalScoredMatches();
    set.add(matchId);
    const trimmed = Array.from(set).slice(-80);
    localStorage.setItem(LOCAL_SCORED_MATCHES_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore storage errors
  }
}

function clearLocalScoredMatches(): void {
  try {
    localStorage.removeItem(LOCAL_SCORED_MATCHES_KEY);
  } catch {
    // ignore storage errors
  }
}

export function computeMatchTournamentAwards(
  winner: 'CREWMATES' | 'IMPOSTORS',
  participants: TournamentMatchParticipantInput[]
): TournamentMatchPlayerAward[] {
  return participants.map((p) => {
    const tasks = Math.max(0, Math.floor(p.tasksCompleted || 0));
    const elims = Math.max(0, Math.floor(p.eliminations || 0));
    const isCrewmate = p.role === 'CREWMATE';
    const won =
      (winner === 'CREWMATES' && isCrewmate) ||
      (winner === 'IMPOSTORS' && !isCrewmate);

    let pointsEarned = 0;
    if (isCrewmate) {
      if (won) {
        pointsEarned += TOURNAMENT_SCORING_RULES.CREWMATE_WIN;
        if (p.isAlive) {
          pointsEarned += TOURNAMENT_SCORING_RULES.CREWMATE_SURVIVAL;
        }
      }
      pointsEarned += tasks * TOURNAMENT_SCORING_RULES.TASK_COMPLETED;
    } else {
      if (won) {
        pointsEarned += TOURNAMENT_SCORING_RULES.IMPOSTOR_WIN;
      }
      pointsEarned += elims * TOURNAMENT_SCORING_RULES.ELIMINATION;
    }

    return {
      player_key: normalizeTournamentPlayerKey(p.playerName, p.badgeId),
      player_name: p.playerName.trim() || `Operative ${p.badgeId}`,
      badge_id: p.badgeId,
      color: p.color || '#06b6d4',
      role: p.role,
      is_alive: p.isAlive,
      tasks_completed: tasks,
      eliminations: elims,
      points_earned: pointsEarned,
      won,
    };
  });
}

function applyAwardsToLocalStorage(
  matchId: string,
  roomCode: string,
  awards: TournamentMatchPlayerAward[]
): { alreadyScored: boolean; entries: TournamentEntry[] } {
  const scoredSet = readLocalScoredMatches();
  if (scoredSet.has(matchId)) {
    return { alreadyScored: true, entries: readLocalLeaderboard() };
  }

  const existing = readLocalLeaderboard();
  const byKey = new Map<string, TournamentEntry>();
  for (const row of existing) {
    byKey.set(row.player_key, { ...row });
  }

  const nowIso = new Date().toISOString();
  for (const award of awards) {
    const prev = byKey.get(award.player_key);
    if (prev) {
      byKey.set(award.player_key, {
        ...prev,
        player_name: award.player_name,
        badge_id: award.badge_id,
        color: award.color,
        total_points: prev.total_points + award.points_earned,
        matches_played: prev.matches_played + 1,
        total_wins: prev.total_wins + (award.won ? 1 : 0),
        crewmate_wins:
          prev.crewmate_wins + (award.won && award.role === 'CREWMATE' ? 1 : 0),
        impostor_wins:
          prev.impostor_wins + (award.won && award.role === 'IMPOSTOR' ? 1 : 0),
        tasks_completed: prev.tasks_completed + award.tasks_completed,
        eliminations: prev.eliminations + award.eliminations,
        last_room_code: roomCode,
        updated_at: nowIso,
      });
    } else {
      byKey.set(award.player_key, {
        player_key: award.player_key,
        player_name: award.player_name,
        badge_id: award.badge_id,
        color: award.color,
        total_points: award.points_earned,
        matches_played: 1,
        total_wins: award.won ? 1 : 0,
        crewmate_wins: award.won && award.role === 'CREWMATE' ? 1 : 0,
        impostor_wins: award.won && award.role === 'IMPOSTOR' ? 1 : 0,
        tasks_completed: award.tasks_completed,
        eliminations: award.eliminations,
        last_room_code: roomCode,
        updated_at: nowIso,
      });
    }
  }

  const sorted = sortTournamentEntries(Array.from(byKey.values()));
  writeLocalLeaderboard(sorted);
  markLocalMatchScored(matchId);
  broadcastLocalLeaderboardChanged();
  return { alreadyScored: false, entries: sorted };
}

export async function fetchTournamentLeaderboard(): Promise<{
  entries: TournamentEntry[];
  source: 'supabase' | 'local';
  error?: string;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return { entries: readLocalLeaderboard(), source: 'local' };
  }

  const { data, error } = await supabase
    .from('tournament_leaderboard')
    .select('*')
    .order('total_points', { ascending: false })
    .order('total_wins', { ascending: false })
    .order('tasks_completed', { ascending: false })
    .limit(100);

  if (error) {
    const formatted = logSupabaseTableError(
      'tournament_leaderboard',
      'fetchLeaderboard',
      error
    );
    return {
      entries: readLocalLeaderboard(),
      source: 'local',
      error: formatted,
    };
  }

  const rows = sortTournamentEntries((data || []) as TournamentEntry[]);
  writeLocalLeaderboard(rows);
  return { entries: rows, source: 'supabase' };
}

export async function awardTournamentPoints(params: {
  matchId: string;
  roomCode: string;
  winner: 'CREWMATES' | 'IMPOSTORS';
  participants: TournamentMatchParticipantInput[];
}): Promise<TournamentAwardResult> {
  const { matchId, roomCode, winner, participants } = params;
  const awards = computeMatchTournamentAwards(winner, participants);

  if (awards.length === 0) {
    return {
      ok: true,
      alreadyScored: false,
      source: 'local',
      updatedCount: 0,
      awards: [],
    };
  }

  // Client-side guard prevents rapid double invocation in the same browser session
  if (readLocalScoredMatches().has(matchId)) {
    return {
      ok: true,
      alreadyScored: true,
      source: isSupabaseConfigured ? 'rpc' : 'local',
      updatedCount: 0,
      awards,
    };
  }

  if (!isSupabaseConfigured || !supabase) {
    const localRes = applyAwardsToLocalStorage(matchId, roomCode, awards);
    return {
      ok: true,
      alreadyScored: localRes.alreadyScored,
      source: 'local',
      updatedCount: localRes.alreadyScored ? 0 : awards.length,
      awards,
    };
  }

  // Primary path: atomic, server-deduplicated Supabase RPC `award_tournament_points`
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'award_tournament_points',
    {
      p_match_id: matchId,
      p_room_code: roomCode,
      p_winner: winner,
      p_entries: awards,
    }
  );

  if (!rpcError) {
    const payload = (rpcData || {}) as {
      already_scored?: boolean;
      updated_count?: number;
    };
    markLocalMatchScored(matchId);
    const refreshed = await fetchTournamentLeaderboard();
    if (refreshed.source === 'supabase') {
      broadcastLocalLeaderboardChanged();
    }
    return {
      ok: true,
      alreadyScored: Boolean(payload.already_scored),
      source: 'rpc',
      updatedCount: Number(payload.updated_count ?? awards.length),
      awards,
    };
  }

  // Fallback if SQL RPC hasn't been deployed to Supabase yet: try direct table upsert, else local cache
  const rpcErrMsg = logSupabaseTableError(
    'tournament_leaderboard',
    'award_tournament_points_rpc',
    rpcError
  );

  try {
    const { data: existingMatch } = await supabase
      .from('tournament_scored_matches')
      .select('match_id')
      .eq('match_id', matchId)
      .maybeSingle();

    if (existingMatch) {
      markLocalMatchScored(matchId);
      return {
        ok: true,
        alreadyScored: true,
        source: 'table',
        updatedCount: 0,
        awards,
      };
    }

    const { error: markErr } = await supabase
      .from('tournament_scored_matches')
      .insert({ match_id: matchId, room_code: roomCode, winner });

    if (markErr && (markErr as { code?: string }).code === '23505') {
      markLocalMatchScored(matchId);
      return {
        ok: true,
        alreadyScored: true,
        source: 'table',
        updatedCount: 0,
        awards,
      };
    }

    if (!markErr) {
      const { data: currentRows } = await supabase
        .from('tournament_leaderboard')
        .select('*')
        .in(
          'player_key',
          awards.map((a) => a.player_key)
        );

      const existingMap = new Map<string, TournamentEntry>();
      for (const row of (currentRows || []) as TournamentEntry[]) {
        existingMap.set(row.player_key, row);
      }

      const nowIso = new Date().toISOString();
      const upsertRows: TournamentEntry[] = awards.map((award) => {
        const prev = existingMap.get(award.player_key);
        return {
          player_key: award.player_key,
          player_name: award.player_name,
          badge_id: award.badge_id,
          color: award.color,
          total_points: (prev?.total_points ?? 0) + award.points_earned,
          matches_played: (prev?.matches_played ?? 0) + 1,
          total_wins: (prev?.total_wins ?? 0) + (award.won ? 1 : 0),
          crewmate_wins:
            (prev?.crewmate_wins ?? 0) +
            (award.won && award.role === 'CREWMATE' ? 1 : 0),
          impostor_wins:
            (prev?.impostor_wins ?? 0) +
            (award.won && award.role === 'IMPOSTOR' ? 1 : 0),
          tasks_completed: (prev?.tasks_completed ?? 0) + award.tasks_completed,
          eliminations: (prev?.eliminations ?? 0) + award.eliminations,
          last_room_code: roomCode,
          updated_at: nowIso,
        };
      });

      const { error: upsertErr } = await supabase
        .from('tournament_leaderboard')
        .upsert(upsertRows, { onConflict: 'player_key' });

      if (!upsertErr) {
        markLocalMatchScored(matchId);
        await fetchTournamentLeaderboard();
        broadcastLocalLeaderboardChanged();
        return {
          ok: true,
          alreadyScored: false,
          source: 'table',
          updatedCount: upsertRows.length,
          awards,
        };
      }
    }
  } catch {
    // Fall through to local offline scoring
  }

  const localRes = applyAwardsToLocalStorage(matchId, roomCode, awards);
  return {
    ok: true,
    alreadyScored: localRes.alreadyScored,
    source: 'local',
    updatedCount: localRes.alreadyScored ? 0 : awards.length,
    awards,
    error: rpcErrMsg,
  };
}

export async function resetTournamentLeaderboard(): Promise<{
  ok: boolean;
  error?: string;
}> {
  writeLocalLeaderboard([]);
  clearLocalScoredMatches();
  broadcastLocalLeaderboardChanged();

  if (!isSupabaseConfigured || !supabase) {
    return { ok: true };
  }

  const { error: rpcError } = await supabase.rpc(
    'reset_tournament_leaderboard'
  );
  if (!rpcError) {
    broadcastLocalLeaderboardChanged();
    return { ok: true };
  }

  // Fallback to direct table deletion if RPC is not installed yet
  const [lbRes, scoredRes] = await Promise.all([
    supabase
      .from('tournament_leaderboard')
      .delete()
      .neq('player_key', '__never__'),
    supabase
      .from('tournament_scored_matches')
      .delete()
      .neq('match_id', '__never__'),
  ]);

  if (lbRes.error && scoredRes.error) {
    const errMsg = logSupabaseTableError(
      'tournament_leaderboard',
      'resetLeaderboard',
      lbRes.error
    );
    return { ok: true, error: errMsg };
  }

  broadcastLocalLeaderboardChanged();
  return { ok: true };
}

export function useTournamentLeaderboard(): {
  entries: TournamentEntry[];
  loading: boolean;
  source: 'supabase' | 'local';
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [entries, setEntries] = useState<TournamentEntry[]>(() =>
    readLocalLeaderboard()
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [source, setSource] = useState<'supabase' | 'local'>(() =>
    isSupabaseConfigured ? 'supabase' : 'local'
  );
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetchTournamentLeaderboard();
    setEntries(res.entries);
    setSource(res.source);
    setError(res.error || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();

    const handleLocalUpdate = () => {
      if (!isSupabaseConfigured || !supabase) {
        setEntries(readLocalLeaderboard());
        setLoading(false);
      } else {
        void refresh();
      }
    };

    localListeners.add(handleLocalUpdate);

    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCAL_LEADERBOARD_KEY) {
        setEntries(readLocalLeaderboard());
      }
    };
    window.addEventListener('storage', onStorage);

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        bc.onmessage = () => {
          handleLocalUpdate();
        };
      }
    } catch {
      bc = null;
    }

    let realtimeChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null =
      null;
    if (isSupabaseConfigured && supabase) {
      const client = supabase;
      realtimeChannel = client
        .channel(`${REALTIME_CHANNEL_NAME}_${Math.random().toString(36).slice(2, 8)}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'tournament_leaderboard',
          },
          () => {
            void refresh();
          }
        )
        .subscribe();
    }

    return () => {
      localListeners.delete(handleLocalUpdate);
      window.removeEventListener('storage', onStorage);
      if (bc) {
        try {
          bc.close();
        } catch {
          // ignore
        }
      }
      if (realtimeChannel && supabase) {
        void supabase.removeChannel(realtimeChannel);
      }
    };
  }, [refresh]);

  return { entries, loading, source, error, refresh };
}
