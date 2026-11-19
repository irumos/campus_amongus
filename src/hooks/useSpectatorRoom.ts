import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isSupabaseConfigured,
  logSupabaseTableError,
  supabase,
  type PublicPlayerRow,
  type RoomRow,
  type VoteRow,
} from '../config/supabase';
import { normalizeRoomCode } from './useCampusGame';

/**
 * STRICTLY SPOILER-FREE public snapshot key mirrored for Local Offline Mode.
 * Never contains private_roles or impostor assignments.
 */
export const SPECTATOR_PUBLIC_SNAPSHOT_PREFIX =
  'cairl_spectator_public_snapshot_v1_';
export const SPECTATOR_PUBLIC_CHANNEL_NAME =
  'cairl_spectator_public_channel_v1';

export interface SpectatorPublicSnapshot {
  room: RoomRow;
  publicPlayers: PublicPlayerRow[];
  votes: Record<string, string>;
  matchStartedAt: number | null;
  updatedAt: number;
}

export function publishLocalSpectatorSnapshot(
  snapshot: SpectatorPublicSnapshot
): void {
  try {
    const code = normalizeRoomCode(snapshot.room.room_code);
    localStorage.setItem(
      `${SPECTATOR_PUBLIC_SNAPSHOT_PREFIX}${code}`,
      JSON.stringify(snapshot)
    );
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(SPECTATOR_PUBLIC_CHANNEL_NAME);
      bc.postMessage({ type: 'spectator_snapshot', roomCode: code, snapshot });
      bc.close();
    }
  } catch {
    // ignore storage/channel errors
  }
}

function readLocalSpectatorSnapshot(
  roomCode: string
): SpectatorPublicSnapshot | null {
  try {
    const code = normalizeRoomCode(roomCode);
    const raw = localStorage.getItem(
      `${SPECTATOR_PUBLIC_SNAPSHOT_PREFIX}${code}`
    );
    if (raw) {
      const parsed = JSON.parse(raw) as SpectatorPublicSnapshot;
      if (parsed && parsed.room) {
        return parsed;
      }
    }

    // Fallback to public room/players caches if room code matches
    const cachedRoomRaw = localStorage.getItem('cairl_room_cache_v1');
    if (cachedRoomRaw) {
      const cachedRoom = JSON.parse(cachedRoomRaw) as RoomRow;
      if (normalizeRoomCode(cachedRoom.room_code) === code) {
        const cachedPlayersRaw = localStorage.getItem('cairl_players_cache_v1');
        const cachedPlayers = cachedPlayersRaw
          ? (JSON.parse(cachedPlayersRaw) as PublicPlayerRow[])
          : [];
        return {
          room: cachedRoom,
          publicPlayers: Array.isArray(cachedPlayers) ? cachedPlayers : [],
          votes: {},
          matchStartedAt: null,
          updatedAt: Date.now(),
        };
      }
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

function parseTimestampMs(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return null;
      return n < 1_000_000_000_000 ? n * 1000 : n;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function normalizePublicRoomRow(row: Record<string, unknown>): RoomRow {
  const statusRaw = String(row.status || 'LOBBY').toUpperCase();
  const status: RoomRow['status'] =
    statusRaw === 'PLAYING' ||
    statusRaw === 'MEETING' ||
    statusRaw === 'ENDED'
      ? statusRaw
      : 'LOBBY';
  const winnerRaw = row.winner ? String(row.winner).toUpperCase() : null;
  const winner: RoomRow['winner'] =
    winnerRaw === 'CREWMATES' || winnerRaw === 'IMPOSTORS' ? winnerRaw : null;
  const sabRaw = row.active_sabotage
    ? String(row.active_sabotage).toUpperCase()
    : null;
  const activeSabotage: RoomRow['active_sabotage'] =
    sabRaw === 'REACTOR' || sabRaw === 'COMMS' ? sabRaw : null;

  return {
    room_code: normalizeRoomCode(String(row.room_code || 'SVCE')),
    status,
    winner,
    task_progress: Number(row.task_progress ?? 0) || 0,
    active_sabotage: activeSabotage,
    sabotage_ends_at: parseTimestampMs(row.sabotage_ends_at),
    meeting_ends_at: parseTimestampMs(row.meeting_ends_at),
    ejection_result:
      typeof row.ejection_result === 'string' ? row.ejection_result : null,
    impostor_count: Math.min(3, Math.max(1, Number(row.impostor_count ?? 1) || 1)),
    host_badge_id:
      typeof row.host_badge_id === 'string' && row.host_badge_id.trim()
        ? row.host_badge_id.trim().toUpperCase()
        : null,
    meeting_caller_badge_id:
      typeof row.meeting_caller_badge_id === 'string'
        ? row.meeting_caller_badge_id
        : null,
    meeting_body_badge_id:
      typeof row.meeting_body_badge_id === 'string'
        ? row.meeting_body_badge_id
        : null,
  };
}

function sortPublicPlayers(players: PublicPlayerRow[]): PublicPlayerRow[] {
  return [...players].sort((a, b) => a.badge_id.localeCompare(b.badge_id));
}

function getMatchTimerStorageKey(roomCode: string): string {
  return `cairl_spectator_match_start_${normalizeRoomCode(roomCode)}`;
}

/**
 * Strictly spoiler-free Supabase Realtime hook for the Lobby Spectator / Projector HQ View.
 * Only reads `rooms`, `public_players`, and `votes`. NEVER touches `private_roles`.
 */
export function useSpectatorRoom(rawRoomCode: string) {
  const roomCode = normalizeRoomCode(rawRoomCode);

  const [room, setRoom] = useState<RoomRow | null>(null);
  const [publicPlayers, setPublicPlayers] = useState<PublicPlayerRow[]>([]);
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [connected, setConnected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [matchStartedAt, setMatchStartedAt] = useState<number | null>(null);
  const [matchEndedAt, setMatchEndedAt] = useState<number | null>(null);

  const prevStatusRef = useRef<RoomRow['status'] | null>(null);

  const updateMatchClockFromStatus = useCallback(
    (nextRoom: RoomRow | null, snapshotStartAt?: number | null) => {
      if (!nextRoom) {
        prevStatusRef.current = null;
        setMatchStartedAt(null);
        setMatchEndedAt(null);
        return;
      }

      const key = getMatchTimerStorageKey(nextRoom.room_code);
      const prevStatus = prevStatusRef.current;

      if (nextRoom.status === 'LOBBY') {
        setMatchStartedAt(null);
        setMatchEndedAt(null);
        try {
          sessionStorage.removeItem(key);
        } catch {
          // ignore
        }
      } else if (nextRoom.status === 'PLAYING' || nextRoom.status === 'MEETING') {
        setMatchEndedAt(null);
        let storedStart: number | null = snapshotStartAt ?? null;
        if (!storedStart) {
          try {
            const raw = sessionStorage.getItem(key);
            if (raw) {
              const parsed = Number(raw);
              if (Number.isFinite(parsed) && parsed > 0) {
                storedStart = parsed;
              }
            }
          } catch {
            // ignore
          }
        }
        if (prevStatus === 'LOBBY' || prevStatus === 'ENDED' || !storedStart) {
          const started = snapshotStartAt || Date.now();
          setMatchStartedAt(started);
          try {
            sessionStorage.setItem(key, String(started));
          } catch {
            // ignore
          }
        } else {
          setMatchStartedAt(storedStart);
        }
      } else if (nextRoom.status === 'ENDED') {
        if (prevStatus === 'PLAYING' || prevStatus === 'MEETING') {
          setMatchEndedAt(Date.now());
        }
      }

      prevStatusRef.current = nextRoom.status;
    },
    []
  );

  const fetchPublicRoomState = useCallback(async () => {
    setError(null);

    if (!isSupabaseConfigured || !supabase) {
      const snap = readLocalSpectatorSnapshot(roomCode);
      if (snap) {
        setRoom(snap.room);
        setPublicPlayers(sortPublicPlayers(snap.publicPlayers));
        setVotes(snap.votes || {});
        updateMatchClockFromStatus(snap.room, snap.matchStartedAt);
      } else {
        setRoom(null);
        setPublicPlayers([]);
        setVotes({});
        updateMatchClockFromStatus(null);
      }
      setConnected(false);
      setLoading(false);
      return;
    }

    // ONLY query public tables — NEVER private_roles
    const [roomRes, playersRes, votesRes] = await Promise.all([
      supabase
        .from('rooms')
        .select(
          'room_code, status, winner, task_progress, active_sabotage, sabotage_ends_at, meeting_ends_at, ejection_result, impostor_count, host_badge_id, meeting_caller_badge_id, meeting_body_badge_id'
        )
        .eq('room_code', roomCode)
        .maybeSingle(),
      supabase
        .from('public_players')
        .select('id, room_code, badge_id, name, color, is_alive, has_voted')
        .eq('room_code', roomCode)
        .order('badge_id', { ascending: true }),
      supabase
        .from('votes')
        .select('room_code, voter_badge_id, target_badge_id')
        .eq('room_code', roomCode),
    ]);

    if (roomRes.error) {
      const msg = logSupabaseTableError('rooms', 'spectatorFetch', roomRes.error);
      setError(msg);
      const localSnap = readLocalSpectatorSnapshot(roomCode);
      if (localSnap) {
        setRoom(localSnap.room);
        setPublicPlayers(sortPublicPlayers(localSnap.publicPlayers));
        setVotes(localSnap.votes || {});
        updateMatchClockFromStatus(localSnap.room, localSnap.matchStartedAt);
      }
      setLoading(false);
      return;
    }

    const nextRoom = roomRes.data
      ? normalizePublicRoomRow(roomRes.data as Record<string, unknown>)
      : null;
    setRoom(nextRoom);
    updateMatchClockFromStatus(nextRoom);

    if (!playersRes.error) {
      setPublicPlayers(
        sortPublicPlayers((playersRes.data || []) as PublicPlayerRow[])
      );
    }

    if (!votesRes.error) {
      const map: Record<string, string> = {};
      for (const v of (votesRes.data || []) as VoteRow[]) {
        map[v.voter_badge_id] = v.target_badge_id;
      }
      setVotes(map);
    }

    setLoading(false);
  }, [roomCode, updateMatchClockFromStatus]);

  useEffect(() => {
    prevStatusRef.current = null;
    setLoading(true);
    void fetchPublicRoomState();

    // Listen for local offline snapshots across tabs
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === `${SPECTATOR_PUBLIC_SNAPSHOT_PREFIX}${roomCode}` ||
        e.key === 'cairl_room_cache_v1' ||
        e.key === 'cairl_players_cache_v1'
      ) {
        if (!isSupabaseConfigured || !supabase) {
          void fetchPublicRoomState();
        }
      }
    };
    window.addEventListener('storage', onStorage);

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(SPECTATOR_PUBLIC_CHANNEL_NAME);
        bc.onmessage = (evt: MessageEvent) => {
          const data = evt.data as {
            type?: string;
            roomCode?: string;
            snapshot?: SpectatorPublicSnapshot;
          };
          if (
            data?.type === 'spectator_snapshot' &&
            data.roomCode === roomCode &&
            data.snapshot &&
            (!isSupabaseConfigured || !supabase)
          ) {
            setRoom(data.snapshot.room);
            setPublicPlayers(sortPublicPlayers(data.snapshot.publicPlayers));
            setVotes(data.snapshot.votes || {});
            updateMatchClockFromStatus(
              data.snapshot.room,
              data.snapshot.matchStartedAt
            );
            setLoading(false);
          }
        };
      }
    } catch {
      bc = null;
    }

    if (!isSupabaseConfigured || !supabase) {
      return () => {
        window.removeEventListener('storage', onStorage);
        if (bc) {
          try {
            bc.close();
          } catch {
            // ignore
          }
        }
      };
    }

    const client = supabase;
    const channel = client
      .channel(
        `spectator-hq-${roomCode}-${Math.random().toString(36).slice(2, 8)}`
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rooms',
          filter: `room_code=eq.${roomCode}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setRoom(null);
            updateMatchClockFromStatus(null);
            return;
          }
          if (payload.new && typeof payload.new === 'object') {
            const nextRoom = normalizePublicRoomRow(
              payload.new as Record<string, unknown>
            );
            setRoom(nextRoom);
            updateMatchClockFromStatus(nextRoom);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'public_players',
          filter: `room_code=eq.${roomCode}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Partial<PublicPlayerRow>;
            setPublicPlayers((prev) =>
              prev.filter(
                (p) =>
                  !(
                    (oldRow.id && p.id === oldRow.id) ||
                    (oldRow.badge_id && p.badge_id === oldRow.badge_id)
                  )
              )
            );
            return;
          }
          if (payload.new && typeof payload.new === 'object') {
            const incoming = payload.new as PublicPlayerRow;
            setPublicPlayers((prev) => {
              const idx = prev.findIndex((p) => p.badge_id === incoming.badge_id);
              if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = incoming;
                return sortPublicPlayers(copy);
              }
              return sortPublicPlayers([...prev, incoming]);
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'votes',
          filter: `room_code=eq.${roomCode}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Partial<VoteRow>;
            if (oldRow.voter_badge_id) {
              setVotes((prev) => {
                const next = { ...prev };
                delete next[oldRow.voter_badge_id!];
                return next;
              });
            } else {
              void fetchPublicRoomState();
            }
            return;
          }
          if (payload.new && typeof payload.new === 'object') {
            const v = payload.new as VoteRow;
            setVotes((prev) => ({
              ...prev,
              [v.voter_badge_id]: v.target_badge_id,
            }));
          }
        }
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') {
          void fetchPublicRoomState();
        }
      });

    // Periodic silent reconciliation poll every 8s for unattended lobby TVs
    const reconcileTimer = window.setInterval(() => {
      void fetchPublicRoomState();
    }, 8000);

    return () => {
      window.clearInterval(reconcileTimer);
      window.removeEventListener('storage', onStorage);
      if (bc) {
        try {
          bc.close();
        } catch {
          // ignore
        }
      }
      void client.removeChannel(channel);
    };
  }, [roomCode, fetchPublicRoomState, updateMatchClockFromStatus]);

  return {
    roomCode,
    room,
    publicPlayers,
    votes,
    loading,
    connected,
    error,
    matchStartedAt,
    matchEndedAt,
    refresh: fetchPublicRoomState,
  };
}
