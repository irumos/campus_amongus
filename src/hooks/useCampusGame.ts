import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WRISTBANDS } from '../config/campusConfig';
import { getActiveStations } from '../config/stationStore';
import {
  formatSupabaseError,
  isSupabaseConfigured,
  isSupabaseRlsError,
  logSupabaseRealtimeError,
  logSupabaseTableError,
  supabase,
  supabaseConfigStatus,
  type PrivateRoleRow,
  type PublicPlayerRow,
  type RoomRow,
  type SabotageType,
  type VoteRow,
} from '../config/supabase';
import {
  playEmergencySiren,
  playFlatlineEliminated,
} from '../utils/feedback';

export type CampusRoomStatus = 'LOBBY' | 'PLAYING' | 'MEETING' | 'ENDED';
export type CampusWinner = 'CREWMATES' | 'IMPOSTORS' | null;
export type CampusSabotageType = SabotageType;
export type RealtimeConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface CampusLocalIdentity {
  roomCode: string;
  badgeId: string;
  name: string;
  wristbandSecret: string;
}

const IDENTITY_STORAGE_KEY = 'cairl_supabase_identity';
const SECRET_STORAGE_KEY = 'cairl_wristband_secret';
const ROOM_CACHE_KEY = 'cairl_supabase_room_cache';
const PLAYERS_CACHE_KEY = 'cairl_supabase_players_cache';
const ROLE_CACHE_KEY = 'cairl_supabase_role_cache';
const DEV_LOBBIES_KEY = 'cairl_dev_lobbies';

const KILL_COOLDOWN_MS = 30_000;
const POST_MEETING_COOLDOWN_MS = 15_000;
const REACTOR_SABOTAGE_MS = 45_000;
const MEETING_DURATION_MS = 60_000;
const EJECTION_REVEAL_MS = 6_000;

export function resolveSabotageTargets(
  stations: { id: string; roomName: string }[] = getActiveStations()
): {
  reactorStationId: string;
  reactorLabel: string;
  commsStationIds: string[];
  commsLabel: string;
} {
  const reactor =
    stations.find((s) => s.id === 'CYBER_LAB') || stations[0] || null;
  const reception =
    stations.find((s) => s.id === 'RECEPTION') ||
    stations.find((s) => s.id !== reactor?.id) ||
    reactor;

  const reactorStationId = reactor?.id || 'CYBER_LAB';
  const reactorLabel = reactor?.roomName || 'Cyber Lab';
  const commsIds = Array.from(
    new Set([reactorStationId, reception?.id || 'RECEPTION'])
  );
  const commsLabel =
    reception && reception.id !== reactorStationId
      ? `${reactorLabel} or ${reception.roomName}`
      : reactorLabel;

  return {
    reactorStationId,
    reactorLabel,
    commsStationIds: commsIds,
    commsLabel,
  };
}

const DEMO_NAMES = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ananya', 'Vikram'];

export function normalizeRoomCode(raw: string): string {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return cleaned || 'SVCE';
}

export function normalizeBadgeId(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (/^P(0[1-9]|1[0-6])$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '').padStart(2, '0');
  const candidate = `P${digits}`;
  return /^P(0[1-9]|1[0-6])$/.test(candidate) ? candidate : 'P01';
}

export function badgeIdToNumber(badgeId: string): string {
  return normalizeBadgeId(badgeId).slice(1);
}

export function sanitizePlayerName(raw: string): string {
  const cleaned = raw.trim().slice(0, 32);
  return cleaned || 'Operative';
}

function getOrCreateWristbandSecret(): string {
  try {
    const existing = localStorage.getItem(SECRET_STORAGE_KEY);
    if (existing && existing.length >= 8) return existing;
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sec_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    localStorage.setItem(SECRET_STORAGE_KEY, created);
    return created;
  } catch {
    return `sec_${Date.now().toString(36)}`;
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readStoredIdentity(): CampusLocalIdentity | null {
  const parsed = readJson<Partial<CampusLocalIdentity>>(IDENTITY_STORAGE_KEY);
  if (
    parsed &&
    typeof parsed.roomCode === 'string' &&
    typeof parsed.badgeId === 'string' &&
    typeof parsed.name === 'string' &&
    parsed.roomCode.trim().length >= 4 &&
    parsed.badgeId.trim().length > 0
  ) {
    return {
      roomCode: normalizeRoomCode(parsed.roomCode),
      badgeId: normalizeBadgeId(parsed.badgeId),
      name: sanitizePlayerName(parsed.name),
      wristbandSecret:
        typeof parsed.wristbandSecret === 'string' && parsed.wristbandSecret
          ? parsed.wristbandSecret
          : getOrCreateWristbandSecret(),
    };
  }
  return null;
}

function shuffleStrings(items: string[]): string[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickRandomStations(shortCount = 4): string[] {
  const active = getActiveStations();
  const shortIds = shuffleStrings(
    active.filter((s) => s.taskCategory !== 'LONG_TASK').map((s) => s.id)
  );
  const pickedShort = shortIds.slice(0, Math.min(shortCount, shortIds.length));

  const longSources = shuffleStrings(
    active
      .filter(
        (s) =>
          s.taskCategory === 'LONG_TASK' &&
          s.relayStage === 1 &&
          Boolean(s.relayPartnerId)
      )
      .map((s) => s.id)
  );

  if (longSources.length > 0) {
    const source = active.find((s) => s.id === longSources[0]);
    if (source?.relayPartnerId) {
      return [...pickedShort, source.id, source.relayPartnerId];
    }
  }

  return pickedShort;
}

function createInitialRoom(roomCode: string): RoomRow {
  return {
    room_code: roomCode,
    status: 'LOBBY',
    winner: null,
    task_progress: 0,
    active_sabotage: null,
    sabotage_ends_at: null,
    meeting_ends_at: null,
    ejection_result: null,
    impostor_count: 1,
    meeting_caller_badge_id: null,
    meeting_body_badge_id: null,
  };
}

export function useCampusGame() {
  const [identity, setIdentity] = useState<CampusLocalIdentity | null>(() =>
    readStoredIdentity()
  );

  const [room, setRoom] = useState<RoomRow | null>(() => {
    const cachedId = readStoredIdentity();
    const cachedRoom = readJson<RoomRow>(ROOM_CACHE_KEY);
    if (cachedId && cachedRoom && cachedRoom.room_code === cachedId.roomCode) {
      return cachedRoom;
    }
    return null;
  });

  const [publicPlayers, setPublicPlayers] = useState<PublicPlayerRow[]>(() => {
    const cachedId = readStoredIdentity();
    const cachedPlayers = readJson<PublicPlayerRow[]>(PLAYERS_CACHE_KEY);
    if (
      cachedId &&
      Array.isArray(cachedPlayers) &&
      cachedPlayers.every((p) => p.room_code === cachedId.roomCode)
    ) {
      return cachedPlayers;
    }
    return [];
  });

  const [privateRole, setPrivateRole] = useState<PrivateRoleRow | null>(() => {
    const cachedId = readStoredIdentity();
    const cachedRole = readJson<PrivateRoleRow>(ROLE_CACHE_KEY);
    if (
      cachedId &&
      cachedRole &&
      cachedRole.room_code === cachedId.roomCode &&
      cachedRole.badge_id === cachedId.badgeId
    ) {
      return cachedRole;
    }
    return null;
  });

  const [votes, setVotes] = useState<Record<string, string>>({});
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<RealtimeConnectionStatus>('disconnected');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [realtimeLatencyMs, setRealtimeLatencyMs] = useState<number | null>(null);
  const [isRoomLoaded, setIsRoomLoaded] = useState(false);
  const [killCooldownEnd, setKillCooldownEnd] = useState<number>(0);
  const [ghostModeActive, setGhostModeActive] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [forceLocalMode, setForceLocalMode] = useState(false);
  const useRemoteSupabase = Boolean(
    supabase && isSupabaseConfigured && !forceLocalMode
  );
  const [recentLobbies, setRecentLobbies] = useState<string[]>(() => {
    const saved = readJson<string[]>(DEV_LOBBIES_KEY);
    return Array.isArray(saved) && saved.length > 0 ? saved : ['SVCE'];
  });
  const [insightEvents, setInsightEvents] = useState<
    { id: string; ts: number; type: string; detail: string }[]
  >([]);

  const trackLobbyCode = useCallback((code: string) => {
    const normalized = normalizeRoomCode(code);
    setRecentLobbies((prev) => {
      const next = [normalized, ...prev.filter((c) => c !== normalized)].slice(0, 8);
      try {
        localStorage.setItem(DEV_LOBBIES_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const pushInsightEvent = useCallback((type: string, detail: string) => {
    setInsightEvents((prev) => [
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        type,
        detail,
      },
      ...prev.slice(0, 29),
    ]);
  }, []);

  const clearInsightEvents = useCallback(() => {
    setInsightEvents([]);
  }, []);

  const finalizingMeetingRef = useRef(false);
  const dismissingEjectionRef = useRef(false);
  const prevRoomStatusRef = useRef<CampusRoomStatus | null>(null);
  const prevSabotageRef = useRef<CampusSabotageType>(null);
  const prevIsAliveRef = useRef<boolean | null>(null);

  // Local fallback store when Supabase env vars are not yet configured (e.g. ?debug=true preview)
  const localFallbackVotesRef = useRef<Record<string, string>>({});
  const localFallbackRolesRef = useRef<Record<string, PrivateRoleRow>>({});

  // Persist identity + mission snapshot to localStorage
  useEffect(() => {
    if (!identity) {
      localStorage.removeItem(IDENTITY_STORAGE_KEY);
      localStorage.removeItem(ROOM_CACHE_KEY);
      localStorage.removeItem(PLAYERS_CACHE_KEY);
      localStorage.removeItem(ROLE_CACHE_KEY);
      return;
    }
    localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  }, [identity]);

  useEffect(() => {
    if (room) {
      localStorage.setItem(ROOM_CACHE_KEY, JSON.stringify(room));
    }
  }, [room]);

  useEffect(() => {
    if (identity?.roomCode) {
      localStorage.setItem(PLAYERS_CACHE_KEY, JSON.stringify(publicPlayers));
    }
  }, [publicPlayers, identity?.roomCode]);

  useEffect(() => {
    if (privateRole) {
      localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(privateRole));
    }
  }, [privateRole]);

  // Trigger dramatic siren on MEETING or REACTOR sabotage, and flatline when eliminated
  useEffect(() => {
    if (!room) {
      prevRoomStatusRef.current = null;
      prevSabotageRef.current = null;
      prevIsAliveRef.current = null;
      return;
    }

    if (
      (room.status === 'MEETING' && prevRoomStatusRef.current !== 'MEETING') ||
      (room.active_sabotage === 'REACTOR' && prevSabotageRef.current !== 'REACTOR')
    ) {
      playEmergencySiren();
    }

    // Reset Impostor kill cooldown across ALL clients when match starts or resumes from a meeting
    if (room.status === 'LOBBY' || room.status === 'ENDED') {
      setKillCooldownEnd(0);
    } else if (
      room.status === 'PLAYING' &&
      prevRoomStatusRef.current === 'LOBBY'
    ) {
      setKillCooldownEnd(Date.now() + KILL_COOLDOWN_MS);
    } else if (
      room.status === 'PLAYING' &&
      prevRoomStatusRef.current === 'MEETING'
    ) {
      setKillCooldownEnd(Date.now() + POST_MEETING_COOLDOWN_MS);
    }

    const me = identity?.badgeId
      ? publicPlayers.find((p) => p.badge_id === identity.badgeId)
      : null;

    if (me) {
      if (prevIsAliveRef.current === true && me.is_alive === false) {
        playFlatlineEliminated();
      }
      if (me.is_alive) {
        setGhostModeActive(false);
      }
      prevIsAliveRef.current = me.is_alive;
    }

    prevRoomStatusRef.current = room.status;
    prevSabotageRef.current = room.active_sabotage;
  }, [room, publicPlayers, identity?.badgeId]);

  const fetchRoomState = useCallback(
    async (roomCode: string, badgeId?: string) => {
      if (!supabase) return;
      const startedAt = performance.now();

      const [roomRes, playersRes] = await Promise.all([
        supabase
          .from('rooms')
          .select('*')
          .eq('room_code', roomCode)
          .maybeSingle(),
        supabase
          .from('public_players')
          .select('*')
          .eq('room_code', roomCode)
          .order('badge_id', { ascending: true }),
      ]);

      setRealtimeLatencyMs(Math.max(1, Math.round(performance.now() - startedAt)));
      setIsRoomLoaded(true);

      if (roomRes.error) {
        const msg = logSupabaseTableError('rooms', 'select', roomRes.error);
        setSyncError(msg);
        pushInsightEvent('SUPABASE_ERROR', msg);
      } else {
        setSyncError(null);
        setRoom((roomRes.data as RoomRow | null) || null);
      }

      if (playersRes.error) {
        const msg = logSupabaseTableError(
          'public_players',
          'select',
          playersRes.error
        );
        setSyncError(msg);
        pushInsightEvent('SUPABASE_ERROR', msg);
      } else if (Array.isArray(playersRes.data)) {
        setPublicPlayers(playersRes.data as PublicPlayerRow[]);
      }

      if (badgeId) {
        const roleRes = await supabase
          .from('private_roles')
          .select('*')
          .eq('room_code', roomCode)
          .eq('badge_id', badgeId)
          .maybeSingle();

        if (roleRes.error) {
          const msg = logSupabaseTableError(
            'private_roles',
            'select',
            roleRes.error
          );
          setSyncError(msg);
          pushInsightEvent('SUPABASE_ERROR', msg);
        } else {
          setPrivateRole((roleRes.data as PrivateRoleRow | null) || null);
        }
      }
    },
    [pushInsightEvent]
  );

  const fetchVotes = useCallback(
    async (roomCode: string) => {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('votes')
        .select('voter_badge_id, target_badge_id')
        .eq('room_code', roomCode);

      if (error) {
        const msg = logSupabaseTableError('votes', 'select', error);
        pushInsightEvent('SUPABASE_ERROR', msg);
        return;
      }

      if (Array.isArray(data)) {
        const next: Record<string, string> = {};
        for (const row of data as Pick<
          VoteRow,
          'voter_badge_id' | 'target_badge_id'
        >[]) {
          next[row.voter_badge_id] = row.target_badge_id;
        }
        setVotes(next);
      }
    },
    [pushInsightEvent]
  );

  // Subscribe to Supabase Realtime via supabase.channel('room-' + roomCode) with exponential backoff retry
  useEffect(() => {
    if (!identity?.roomCode) {
      setRealtimeConnected(false);
      setConnectionStatus('disconnected');
      setReconnectAttempt(0);
      setRealtimeLatencyMs(null);
      setIsRoomLoaded(false);
      return;
    }

    const roomCode = identity.roomCode;
    const myBadgeId = identity.badgeId;

    if (!supabase || !isSupabaseConfigured || forceLocalMode) {
      setRealtimeConnected(false);
      setConnectionStatus('disconnected');
      setReconnectAttempt(0);
      setIsRoomLoaded(true);
      return;
    }

    const client = supabase;
    let disposed = false;
    let activeChannel: ReturnType<typeof client.channel> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;
    let hasConnectedOnce = false;
    let retryPending = false;

    const BASE_RETRY_MS = 1000;
    const MAX_RETRY_MS = 30_000;

    const clearRetryTimer = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      retryPending = false;
    };

    const cleanupChannel = () => {
      if (activeChannel) {
        const toRemove = activeChannel;
        activeChannel = null;
        void client.removeChannel(toRemove);
      }
    };

    const scheduleReconnect = () => {
      if (disposed || retryPending) return;
      retryPending = true;
      setRealtimeConnected(false);
      setRealtimeLatencyMs(null);
      setConnectionStatus('reconnecting');

      const exponentialDelay = Math.min(
        MAX_RETRY_MS,
        BASE_RETRY_MS * Math.pow(2, retryAttempt)
      );
      const jitterMs = Math.floor(Math.random() * 400);
      const delayMs = exponentialDelay + jitterMs;

      retryAttempt += 1;
      setReconnectAttempt(retryAttempt);
      pushInsightEvent(
        'RECONNECT_BACKOFF',
        `Scheduled channel room-${roomCode} retry #${retryAttempt} in ${Math.round(
          delayMs / 100
        ) / 10}s`
      );

      cleanupChannel();

      retryTimer = setTimeout(() => {
        retryTimer = null;
        retryPending = false;
        if (!disposed) {
          connectChannel();
        }
      }, delayMs);
    };

    const connectChannel = () => {
      if (disposed) return;
      clearRetryTimer();
      cleanupChannel();

      if (hasConnectedOnce) {
        setConnectionStatus('reconnecting');
      }

      void fetchRoomState(roomCode, myBadgeId);
      void fetchVotes(roomCode);

      const channel = client
        .channel(`room-${roomCode}`)
        .on('system', {}, (sysPayload: Record<string, unknown>) => {
          const isErr =
            sysPayload?.status === 'error' ||
            isSupabaseRlsError(sysPayload) ||
            /error|fail|denied|rls/i.test(JSON.stringify(sysPayload || {}));
          if (isErr) {
            logSupabaseRealtimeError(
              `room-${roomCode}`,
              'SYSTEM_EVENT',
              sysPayload,
              { sysPayload }
            );
            pushInsightEvent(
              'REALTIME_SYSTEM_ERROR',
              JSON.stringify(sysPayload)
            );
          } else {
            console.log('[Supabase:RealtimeSystem]', {
              channel: `room-${roomCode}`,
              sysPayload,
            });
          }
        })
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
              pushInsightEvent('ROOM_DELETED', `Room ${roomCode} removed`);
              return;
            }
            if (payload.new) {
              const nextRoom = payload.new as RoomRow;
              setRoom(nextRoom);
              pushInsightEvent(
                'ROOM_SYNC',
                `status=${nextRoom.status} tasks=${nextRoom.task_progress}% sabotage=${
                  nextRoom.active_sabotage || 'NONE'
                }`
              );
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
            pushInsightEvent(
              'PLAYERS_SYNC',
              `public_players ${payload.eventType} in ${roomCode}`
            );
            void client
              .from('public_players')
              .select('*')
              .eq('room_code', roomCode)
              .order('badge_id', { ascending: true })
              .then(({ data, error }) => {
                if (error) {
                  logSupabaseTableError(
                    'public_players',
                    'realtimeRefetch',
                    error
                  );
                  return;
                }
                if (Array.isArray(data)) {
                  setPublicPlayers(data as PublicPlayerRow[]);
                }
              });
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'private_roles',
            filter: `room_code=eq.${roomCode}`,
          },
          (payload) => {
            const row = payload.new as PrivateRoleRow | undefined;
            if (row && row.badge_id === myBadgeId) {
              setPrivateRole(row);
              pushInsightEvent(
                'ROLE_SYNC',
                `Updated role=${row.role} completed=${
                  row.completed_stations?.length || 0
                }/${row.assigned_stations?.length || 4}`
              );
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
            pushInsightEvent('VOTES_SYNC', `votes ${payload.eventType}`);
            void fetchVotes(roomCode);
          }
        )
        .subscribe((status, err) => {
          if (disposed || activeChannel !== channel) return;

          if (status === 'SUBSCRIBED') {
            hasConnectedOnce = true;
            retryAttempt = 0;
            clearRetryTimer();
            setReconnectAttempt(0);
            setRealtimeConnected(true);
            setConnectionStatus('connected');
            setSyncError(null);
            logSupabaseRealtimeError(`room-${roomCode}`, status);
            pushInsightEvent('CHANNEL_SUBSCRIBED', `Connected to room-${roomCode}`);
            // Re-sync snapshot on reconnect so any missed changes are reconciled
            void fetchRoomState(roomCode, myBadgeId);
            void fetchVotes(roomCode);
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED'
          ) {
            logSupabaseRealtimeError(`room-${roomCode}`, status, err);
            pushInsightEvent(
              'CHANNEL_DROP',
              `Status=${status} on room-${roomCode}${
                err?.message ? ` (${err.message})` : ''
              }`
            );
            scheduleReconnect();
          } else if (err) {
            logSupabaseRealtimeError(`room-${roomCode}`, status, err);
          }
        });

      activeChannel = channel;
    };

    connectChannel();

    const handleOnline = () => {
      if (disposed) return;
      retryAttempt = 0;
      setReconnectAttempt(0);
      setConnectionStatus('reconnecting');
      connectChannel();
    };

    const handleOffline = () => {
      if (disposed) return;
      setRealtimeConnected(false);
      setRealtimeLatencyMs(null);
      setConnectionStatus('reconnecting');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const heartbeatTimer = setInterval(() => {
      if (disposed) return;
      const t0 = performance.now();
      void client
        .from('rooms')
        .select('room_code')
        .eq('room_code', roomCode)
        .maybeSingle()
        .then(({ error }) => {
          if (disposed) return;
          if (error) {
            logSupabaseTableError('rooms', 'heartbeatSelect', error);
            setRealtimeLatencyMs(null);
            if (!retryPending) {
              scheduleReconnect();
            }
          } else {
            setRealtimeLatencyMs(Math.max(1, Math.round(performance.now() - t0)));
          }
        });
    }, 8000);

    return () => {
      disposed = true;
      clearRetryTimer();
      clearInterval(heartbeatTimer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      setRealtimeConnected(false);
      setConnectionStatus('disconnected');
      cleanupChannel();
    };
  }, [
    identity?.roomCode,
    identity?.badgeId,
    forceLocalMode,
    fetchRoomState,
    fetchVotes,
    pushInsightEvent,
  ]);

  // Keep votes cleared when room leaves MEETING
  useEffect(() => {
    if (!identity?.roomCode) {
      setVotes({});
      return;
    }
    if (room?.status === 'MEETING' && useRemoteSupabase) {
      void fetchVotes(identity.roomCode);
    } else if (room?.status !== 'MEETING') {
      setVotes({});
      localFallbackVotesRef.current = {};
    }
  }, [identity?.roomCode, room?.status, useRemoteSupabase, fetchVotes]);

  const joinRoom = useCallback(
    async (
      rawRoomCode: string,
      rawBadgeId: string,
      rawName: string,
      options?: { forceLocal?: boolean }
    ): Promise<CampusLocalIdentity> => {
      const roomCode = normalizeRoomCode(rawRoomCode);
      const badgeId = normalizeBadgeId(rawBadgeId);
      const name = sanitizePlayerName(rawName);
      const wristbandSecret = getOrCreateWristbandSecret();
      const wristband = WRISTBANDS.find((w) => w.id === badgeId) || WRISTBANDS[0];

      const nextIdentity: CampusLocalIdentity = {
        roomCode,
        badgeId,
        name,
        wristbandSecret,
      };

      const wantLocal = Boolean(options?.forceLocal);
      if (wantLocal) {
        setForceLocalMode(true);
        setSyncError(null);
      } else if (forceLocalMode && isSupabaseConfigured) {
        setForceLocalMode(false);
      }

      if (!supabase || !isSupabaseConfigured || wantLocal) {
        setSyncError(null);
        setIdentity(nextIdentity);
        setRoom((prev) =>
          prev && prev.room_code === roomCode ? prev : createInitialRoom(roomCode)
        );
        setPublicPlayers((prev) => {
          const withoutSelf = prev.filter((p) => p.badge_id !== badgeId);
          return [
            ...withoutSelf,
            {
              id: `local-${badgeId}`,
              room_code: roomCode,
              badge_id: badgeId,
              name,
              color: wristband.colorHex,
              is_alive: true,
              has_voted: false,
            },
          ].sort((a, b) => a.badge_id.localeCompare(b.badge_id));
        });
        setPrivateRole({
          room_code: roomCode,
          badge_id: badgeId,
          wristband_secret: wristbandSecret,
          role: 'CREWMATE',
          fellow_impostors: [],
          assigned_stations: [],
          completed_stations: [],
        });
        trackLobbyCode(roomCode);
        pushInsightEvent(
          'LOCAL_JOIN',
          `Joined ${roomCode} as ${badgeId} (${name}) in Local Mode`
        );
        return nextIdentity;
      }

      try {
        // 1. Ensure room row exists
        const { error: roomError } = await supabase.from('rooms').upsert(
          {
            room_code: roomCode,
            status: 'LOBBY',
            winner: null,
            task_progress: 0,
            active_sabotage: null,
            sabotage_ends_at: null,
            meeting_ends_at: null,
            ejection_result: null,
            impostor_count: 1,
          },
          { onConflict: 'room_code', ignoreDuplicates: true }
        );
        if (roomError) {
          logSupabaseTableError('rooms', 'joinUpsert', roomError);
          throw roomError;
        }

        // 2. Upsert player in public_players
        const { error: playerError } = await supabase
          .from('public_players')
          .upsert(
            {
              room_code: roomCode,
              badge_id: badgeId,
              name,
              color: wristband.colorHex,
              is_alive: true,
              has_voted: false,
            },
            { onConflict: 'room_code,badge_id' }
          );
        if (playerError) {
          logSupabaseTableError('public_players', 'joinUpsert', playerError);
          throw playerError;
        }

        // 3. Upsert private_roles stub preserving wristband_secret
        const { error: roleError } = await supabase
          .from('private_roles')
          .upsert(
            {
              room_code: roomCode,
              badge_id: badgeId,
              wristband_secret: wristbandSecret,
              role: 'CREWMATE',
              fellow_impostors: [],
              assigned_stations: [],
              completed_stations: [],
            },
            { onConflict: 'room_code,badge_id' }
          );
        if (roleError) {
          logSupabaseTableError('private_roles', 'joinUpsert', roleError);
          throw roleError;
        }

        setSyncError(null);
        trackLobbyCode(roomCode);
        setIdentity(nextIdentity);
        await fetchRoomState(roomCode, badgeId);
        return nextIdentity;
      } catch (err) {
        const friendly = formatSupabaseError(err);
        console.log('[Supabase:JoinRoomError]', {
          roomCode,
          badgeId,
          friendly,
          isRlsBlocked: isSupabaseRlsError(err),
          rawError: err,
        });
        setSyncError(friendly);
        pushInsightEvent('SUPABASE_JOIN_ERROR', friendly);
        throw new Error(friendly);
      }
    },
    [fetchRoomState, forceLocalMode, pushInsightEvent, trackLobbyCode]
  );

  const seedDemoPlayers = useCallback(
    async (rawRoomCode?: string): Promise<void> => {
      const roomCode = normalizeRoomCode(
        rawRoomCode || identity?.roomCode || 'SVCE'
      );

      if (!useRemoteSupabase || !supabase) {
        setPublicPlayers((prev) => {
          const used = new Set(prev.map((p) => p.badge_id));
          const additions: PublicPlayerRow[] = [];
          for (const demoName of DEMO_NAMES) {
            if (prev.length + additions.length >= 8) break;
            const wb = WRISTBANDS.find((w) => !used.has(w.id));
            if (!wb) break;
            used.add(wb.id);
            additions.push({
              id: `demo-${wb.id}`,
              room_code: roomCode,
              badge_id: wb.id,
              name: demoName,
              color: wb.colorHex,
              is_alive: true,
              has_voted: false,
            });
          }
          return [...prev, ...additions].sort((a, b) =>
            a.badge_id.localeCompare(b.badge_id)
          );
        });
        return;
      }

      const { error: seedRoomErr } = await supabase.from('rooms').upsert(
        {
          room_code: roomCode,
          status: 'LOBBY',
          winner: null,
          task_progress: 0,
          impostor_count: 1,
        },
        { onConflict: 'room_code', ignoreDuplicates: true }
      );
      if (seedRoomErr) {
        logSupabaseTableError('rooms', 'seedUpsert', seedRoomErr);
      }

      const { data: existingRows, error: seedFetchErr } = await supabase
        .from('public_players')
        .select('badge_id')
        .eq('room_code', roomCode);
      if (seedFetchErr) {
        logSupabaseTableError('public_players', 'seedSelect', seedFetchErr);
      }

      const used = new Set(
        ((existingRows || []) as { badge_id: string }[]).map((r) => r.badge_id)
      );

      const playerInserts: Omit<PublicPlayerRow, 'id'>[] = [];
      const roleInserts: PrivateRoleRow[] = [];

      for (const demoName of DEMO_NAMES) {
        if (used.size + playerInserts.length >= 8) break;
        const wb = WRISTBANDS.find((w) => !used.has(w.id));
        if (!wb) break;
        used.add(wb.id);
        playerInserts.push({
          room_code: roomCode,
          badge_id: wb.id,
          name: demoName,
          color: wb.colorHex,
          is_alive: true,
          has_voted: false,
        });
        roleInserts.push({
          room_code: roomCode,
          badge_id: wb.id,
          wristband_secret: `demo_${wb.id}`,
          role: 'CREWMATE',
          fellow_impostors: [],
          assigned_stations: [],
          completed_stations: [],
        });
      }

      if (playerInserts.length > 0) {
        const { error: seedPlayersErr } = await supabase
          .from('public_players')
          .upsert(playerInserts, { onConflict: 'room_code,badge_id' });
        if (seedPlayersErr) {
          logSupabaseTableError(
            'public_players',
            'seedUpsert',
            seedPlayersErr
          );
        }
        const { error: seedRolesErr } = await supabase
          .from('private_roles')
          .upsert(roleInserts, { onConflict: 'room_code,badge_id' });
        if (seedRolesErr) {
          logSupabaseTableError('private_roles', 'seedUpsert', seedRolesErr);
        }
        await fetchRoomState(roomCode, identity?.badgeId);
      }
    },
    [identity?.roomCode, identity?.badgeId, useRemoteSupabase, fetchRoomState]
  );

  const setImpostorCount = useCallback(
    async (count: 1 | 2): Promise<void> => {
      const roomCode = identity?.roomCode;
      if (!roomCode) return;

      if (!useRemoteSupabase || !supabase) {
        setRoom((prev) => (prev ? { ...prev, impostor_count: count } : prev));
        return;
      }

      const { error } = await supabase
        .from('rooms')
        .update({ impostor_count: count })
        .eq('room_code', roomCode);
      if (error) {
        logSupabaseTableError('rooms', 'setImpostorCount', error);
      }
    },
    [identity?.roomCode, useRemoteSupabase]
  );

  const startMatch = useCallback(
    async (rawRoomCode: string, impostorCount: number): Promise<void> => {
      const roomCode = normalizeRoomCode(rawRoomCode);

      if (!useRemoteSupabase || !supabase) {
        const badges = publicPlayers.map((p) => p.badge_id);
        if (badges.length === 0) return;
        const maxImp = badges.length > 1 ? badges.length - 1 : 1;
        const targetImp = Math.min(Math.max(1, impostorCount), Math.min(4, maxImp));
        const shuffled = shuffleStrings(badges);
        const impSet = new Set(shuffled.slice(0, targetImp));
        const impList = Array.from(impSet);

        const nextRoles: Record<string, PrivateRoleRow> = {};
        for (const badgeId of badges) {
          const isImp = impSet.has(badgeId);
          nextRoles[badgeId] = {
            room_code: roomCode,
            badge_id: badgeId,
            wristband_secret: identity?.wristbandSecret || `local_${badgeId}`,
            role: isImp ? 'IMPOSTOR' : 'CREWMATE',
            fellow_impostors: isImp ? impList.filter((id) => id !== badgeId) : [],
            assigned_stations: pickRandomStations(4),
            completed_stations: [],
          };
        }
        localFallbackRolesRef.current = nextRoles;
        if (identity?.badgeId && nextRoles[identity.badgeId]) {
          setPrivateRole(nextRoles[identity.badgeId]);
        }
        setPublicPlayers((prev) =>
          prev.map((p) => ({ ...p, is_alive: true, has_voted: false }))
        );
        setRoom((prev) => ({
          ...(prev || createInitialRoom(roomCode)),
          status: 'PLAYING',
          winner: null,
          task_progress: 0,
          active_sabotage: null,
          sabotage_ends_at: null,
          meeting_ends_at: null,
          ejection_result: null,
          impostor_count: targetImp,
        }));
        setKillCooldownEnd(Date.now() + KILL_COOLDOWN_MS);
        return;
      }

      const [playersRes, existingRolesRes] = await Promise.all([
        supabase
          .from('public_players')
          .select('badge_id')
          .eq('room_code', roomCode),
        supabase
          .from('private_roles')
          .select('badge_id, wristband_secret')
          .eq('room_code', roomCode),
      ]);

      if (playersRes.error) {
        logSupabaseTableError(
          'public_players',
          'startMatchSelect',
          playersRes.error
        );
      }
      if (existingRolesRes.error) {
        logSupabaseTableError(
          'private_roles',
          'startMatchSelect',
          existingRolesRes.error
        );
      }

      const badgeIds = (
        (playersRes.data || []) as { badge_id: string }[]
      ).map((p) => p.badge_id);

      if (badgeIds.length === 0) {
        throw new Error('Cannot start match with zero players in lobby.');
      }

      const secretMap = new Map<string, string>();
      for (const row of (existingRolesRes.data || []) as {
        badge_id: string;
        wristband_secret: string;
      }[]) {
        secretMap.set(row.badge_id, row.wristband_secret);
      }

      const maxImpostors = badgeIds.length > 1 ? badgeIds.length - 1 : 1;
      const targetImpostors = Math.min(
        Math.max(1, Math.floor(impostorCount)),
        Math.min(4, maxImpostors)
      );

      const shuffled = shuffleStrings(badgeIds);
      const impostorSet = new Set(shuffled.slice(0, targetImpostors));
      const impostorList = Array.from(impostorSet);

      const roleRows: PrivateRoleRow[] = badgeIds.map((badgeId) => {
        const isImpostor = impostorSet.has(badgeId);
        return {
          room_code: roomCode,
          badge_id: badgeId,
          wristband_secret: secretMap.get(badgeId) || `wb_${badgeId}`,
          role: isImpostor ? 'IMPOSTOR' : 'CREWMATE',
          fellow_impostors: isImpostor
            ? impostorList.filter((id) => id !== badgeId)
            : [],
          assigned_stations: pickRandomStations(4),
          completed_stations: [],
        };
      });

      const [clearVotesRes, resetPlayersRes, upsertRolesRes] =
        await Promise.all([
          supabase.from('votes').delete().eq('room_code', roomCode),
          supabase
            .from('public_players')
            .update({ is_alive: true, has_voted: false })
            .eq('room_code', roomCode),
          supabase
            .from('private_roles')
            .upsert(roleRows, { onConflict: 'room_code,badge_id' }),
        ]);

      if (clearVotesRes.error) {
        logSupabaseTableError('votes', 'startMatchDelete', clearVotesRes.error);
      }
      if (resetPlayersRes.error) {
        logSupabaseTableError(
          'public_players',
          'startMatchReset',
          resetPlayersRes.error
        );
      }
      if (upsertRolesRes.error) {
        logSupabaseTableError(
          'private_roles',
          'startMatchUpsert',
          upsertRolesRes.error
        );
      }

      const { error: updateError } = await supabase
        .from('rooms')
        .update({
          status: 'PLAYING',
          winner: null,
          task_progress: 0,
          active_sabotage: null,
          sabotage_ends_at: null,
          meeting_ends_at: null,
          ejection_result: null,
          impostor_count: targetImpostors,
          meeting_caller_badge_id: null,
          meeting_body_badge_id: null,
        })
        .eq('room_code', roomCode);

      if (updateError) {
        const msg = logSupabaseTableError(
          'rooms',
          'startMatchUpdate',
          updateError
        );
        setSyncError(msg);
        throw updateError;
      }

      setKillCooldownEnd(Date.now() + KILL_COOLDOWN_MS);
      await fetchRoomState(roomCode, identity?.badgeId);
    },
    [
      publicPlayers,
      identity?.badgeId,
      identity?.wristbandSecret,
      useRemoteSupabase,
      fetchRoomState,
    ]
  );

  const completeStation = useCallback(
    async (stationId: string): Promise<void> => {
      if (!identity?.roomCode || !identity?.badgeId || !privateRole) return;
      if (room?.status !== 'PLAYING') return;

      const activeStations = getActiveStations();
      const targetStation = activeStations.find((s) => s.id === stationId);
      const assigned =
        privateRole.assigned_stations.length > 0
          ? privateRole.assigned_stations
          : activeStations.map((s) => s.id);
      const tasksPerPlayer = Math.max(1, assigned.length);

      if (!assigned.includes(stationId)) return;
      if (privateRole.completed_stations.includes(stationId)) return;

      // Guard 2-step LONG_TASK: cannot upload Step 2 before Step 1 download finishes
      if (
        targetStation?.taskCategory === 'LONG_TASK' &&
        targetStation.relayStage === 2 &&
        targetStation.relayPartnerId &&
        !privateRole.completed_stations.includes(targetStation.relayPartnerId)
      ) {
        return;
      }

      const updatedCompleted = [
        ...privateRole.completed_stations,
        stationId,
      ].slice(0, assigned.length);

      if (!useRemoteSupabase || !supabase) {
        setPrivateRole((prev) =>
          prev ? { ...prev, completed_stations: updatedCompleted } : prev
        );
        if (privateRole.role === 'CREWMATE') {
          const localRealPlayers = publicPlayers.filter(
            (p) => p.id.startsWith('local-')
          ).length;
          const totalCrewmates = Math.max(1, localRealPlayers);
          const nextPct = Math.min(
            100,
            Math.round(
              (updatedCompleted.length / (totalCrewmates * tasksPerPlayer)) * 100
            )
          );
          setRoom((prev) =>
            prev
              ? {
                  ...prev,
                  task_progress: nextPct,
                  ...(nextPct >= 100
                    ? { status: 'ENDED', winner: 'CREWMATES' }
                    : {}),
                }
              : prev
          );
        }
        return;
      }

      const { error: roleUpdateError } = await supabase
        .from('private_roles')
        .update({ completed_stations: updatedCompleted })
        .eq('room_code', identity.roomCode)
        .eq('badge_id', identity.badgeId);

      if (roleUpdateError) {
        const msg = logSupabaseTableError(
          'private_roles',
          'completeStationUpdate',
          roleUpdateError
        );
        setSyncError(msg);
        return;
      }

      setPrivateRole((prev) =>
        prev ? { ...prev, completed_stations: updatedCompleted } : prev
      );

      if (privateRole.role === 'CREWMATE') {
        const { data: crewRoleRows, error: crewFetchError } = await supabase
          .from('private_roles')
          .select('completed_stations, assigned_stations')
          .eq('room_code', identity.roomCode)
          .eq('role', 'CREWMATE');
        if (crewFetchError) {
          logSupabaseTableError(
            'private_roles',
            'completeStationCrewSelect',
            crewFetchError
          );
        }

        const rows = (crewRoleRows || []) as {
          completed_stations: string[];
          assigned_stations?: string[];
        }[];
        const totalCrewmates = Math.max(
          1,
          rows.length || publicPlayers.length - (room.impostor_count || 1)
        );
        const totalAssigned = rows.reduce(
          (sum, row) =>
            sum + (row.assigned_stations?.length || tasksPerPlayer),
          0
        );
        const totalDone = rows.reduce(
          (sum, row) => sum + (row.completed_stations?.length || 0),
          0
        );
        const denominator = Math.max(1, totalAssigned || totalCrewmates * tasksPerPlayer);
        const nextProgress = Math.min(
          100,
          Math.round((totalDone / denominator) * 100)
        );

        const { error: progressErr } = await supabase
          .from('rooms')
          .update({
            task_progress: nextProgress,
            ...(nextProgress >= 100
              ? {
                  status: 'ENDED',
                  winner: 'CREWMATES',
                  active_sabotage: null,
                  sabotage_ends_at: null,
                }
              : {}),
          })
          .eq('room_code', identity.roomCode);
        if (progressErr) {
          logSupabaseTableError(
            'rooms',
            'completeStationProgressUpdate',
            progressErr
          );
        }
      }
    },
    [
      identity?.roomCode,
      identity?.badgeId,
      privateRole,
      room,
      publicPlayers.length,
      useRemoteSupabase,
    ]
  );

  const eliminatePlayer = useCallback(
    async (rawVictimBadgeId: string): Promise<boolean> => {
      if (!identity?.roomCode || !identity?.badgeId || !privateRole) {
        return false;
      }
      if (privateRole.role !== 'IMPOSTOR') return false;
      if (Date.now() < killCooldownEnd) return false;
      if (room?.status !== 'PLAYING') return false;

      const victimBadgeId = normalizeBadgeId(rawVictimBadgeId);
      const impostorSet = new Set<string>([
        identity.badgeId,
        ...(privateRole.fellow_impostors || []),
      ]);
      if (impostorSet.has(victimBadgeId)) return false;

      const attacker = publicPlayers.find((p) => p.badge_id === identity.badgeId);
      const victim = publicPlayers.find((p) => p.badge_id === victimBadgeId);
      if (!attacker?.is_alive || !victim?.is_alive) return false;

      const remainingPlayers = publicPlayers.map((p) =>
        p.badge_id === victimBadgeId ? { ...p, is_alive: false } : p
      );

      let livingImpostors = 0;
      let livingCrewmates = 0;
      for (const player of remainingPlayers) {
        if (!player.is_alive) continue;
        if (impostorSet.has(player.badge_id)) {
          livingImpostors += 1;
        } else {
          livingCrewmates += 1;
        }
      }
      const impostorsWin = livingImpostors >= livingCrewmates;

      if (!useRemoteSupabase || !supabase) {
        setPublicPlayers(remainingPlayers);
        if (impostorsWin) {
          setRoom((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'ENDED',
                  winner: 'IMPOSTORS',
                  active_sabotage: null,
                  sabotage_ends_at: null,
                }
              : prev
          );
        }
        setKillCooldownEnd(Date.now() + KILL_COOLDOWN_MS);
        return true;
      }

      const { error: killError } = await supabase
        .from('public_players')
        .update({ is_alive: false })
        .eq('room_code', identity.roomCode)
        .eq('badge_id', victimBadgeId);

      if (killError) {
        const msg = logSupabaseTableError(
          'public_players',
          'eliminateUpdate',
          killError
        );
        setSyncError(msg);
        return false;
      }

      if (impostorsWin) {
        const { error: winError } = await supabase
          .from('rooms')
          .update({
            status: 'ENDED',
            winner: 'IMPOSTORS',
            active_sabotage: null,
            sabotage_ends_at: null,
          })
          .eq('room_code', identity.roomCode);
        if (winError) {
          logSupabaseTableError('rooms', 'eliminateWinUpdate', winError);
        }
      }

      setKillCooldownEnd(Date.now() + KILL_COOLDOWN_MS);
      return true;
    },
    [
      identity?.roomCode,
      identity?.badgeId,
      privateRole,
      killCooldownEnd,
      room?.status,
      publicPlayers,
      useRemoteSupabase,
    ]
  );

  const triggerSabotage = useCallback(
    async (sabotageType: 'REACTOR' | 'COMMS' = 'REACTOR'): Promise<void> => {
      if (!identity?.roomCode || room?.status !== 'PLAYING' || room?.active_sabotage) {
        return;
      }

      const sabotageEndsAt =
        sabotageType === 'REACTOR' ? Date.now() + REACTOR_SABOTAGE_MS : null;

      if (!useRemoteSupabase || !supabase) {
        setRoom((prev) =>
          prev
            ? {
                ...prev,
                active_sabotage: sabotageType,
                sabotage_ends_at: sabotageEndsAt,
              }
            : prev
        );
        return;
      }

      const { error } = await supabase
        .from('rooms')
        .update({
          active_sabotage: sabotageType,
          sabotage_ends_at: sabotageEndsAt,
        })
        .eq('room_code', identity.roomCode)
        .eq('status', 'PLAYING');
      if (error) {
        logSupabaseTableError('rooms', 'triggerSabotage', error);
      }
    },
    [identity?.roomCode, room?.status, room?.active_sabotage, useRemoteSupabase]
  );

  const clearSabotage = useCallback(
    async (scannedStationId?: string): Promise<void> => {
      if (!identity?.roomCode || !room?.active_sabotage) return;

      const sabotageTargets = resolveSabotageTargets();
      if (
        room.active_sabotage === 'REACTOR' &&
        scannedStationId &&
        scannedStationId !== sabotageTargets.reactorStationId
      ) {
        return;
      }

      if (
        room.active_sabotage === 'COMMS' &&
        scannedStationId &&
        !sabotageTargets.commsStationIds.includes(scannedStationId)
      ) {
        return;
      }

      if (!useRemoteSupabase || !supabase) {
        setRoom((prev) =>
          prev
            ? { ...prev, active_sabotage: null, sabotage_ends_at: null }
            : prev
        );
        return;
      }

      const { error } = await supabase
        .from('rooms')
        .update({
          active_sabotage: null,
          sabotage_ends_at: null,
        })
        .eq('room_code', identity.roomCode);
      if (error) {
        logSupabaseTableError('rooms', 'clearSabotage', error);
      }
    },
    [identity?.roomCode, room?.active_sabotage, useRemoteSupabase]
  );

  // Automatic Reactor Meltdown expiry check
  useEffect(() => {
    if (
      !identity?.roomCode ||
      room?.status !== 'PLAYING' ||
      room?.active_sabotage !== 'REACTOR' ||
      !room?.sabotage_ends_at
    ) {
      return;
    }

    const remainingMs = Math.max(0, room.sabotage_ends_at - Date.now());
    const timer = setTimeout(() => {
      if (!useRemoteSupabase || !supabase) {
        setRoom((prev) =>
          prev && prev.status === 'PLAYING' && prev.active_sabotage === 'REACTOR'
            ? {
                ...prev,
                status: 'ENDED',
                winner: 'IMPOSTORS',
                active_sabotage: null,
                sabotage_ends_at: null,
              }
            : prev
        );
        return;
      }

      void supabase
        .from('rooms')
        .update({
          status: 'ENDED',
          winner: 'IMPOSTORS',
          active_sabotage: null,
          sabotage_ends_at: null,
        })
        .eq('room_code', identity.roomCode)
        .eq('status', 'PLAYING')
        .eq('active_sabotage', 'REACTOR')
        .then(({ error }) => {
          if (error) {
            logSupabaseTableError('rooms', 'reactorExpiryUpdate', error);
          }
        });
    }, remainingMs);

    return () => clearTimeout(timer);
  }, [
    identity?.roomCode,
    room?.status,
    room?.active_sabotage,
    room?.sabotage_ends_at,
    useRemoteSupabase,
  ]);

  const callMeeting = useCallback(
    async (rawBodyBadgeId: string | null = null): Promise<void> => {
      if (!identity?.roomCode || !identity?.badgeId) return;

      const roomCode = identity.roomCode;
      const normalizedBody = rawBodyBadgeId
        ? normalizeBadgeId(rawBodyBadgeId)
        : null;
      const meetingEndsAt = Date.now() + MEETING_DURATION_MS;

      if (!useRemoteSupabase || !supabase) {
        localFallbackVotesRef.current = {};
        setVotes({});
        setPublicPlayers((prev) =>
          prev.map((p) => ({ ...p, has_voted: false }))
        );
        setRoom((prev) =>
          prev
            ? {
                ...prev,
                status: 'MEETING',
                active_sabotage: null,
                sabotage_ends_at: null,
                ejection_result: null,
                meeting_ends_at: meetingEndsAt,
                meeting_caller_badge_id: identity.badgeId,
                meeting_body_badge_id: normalizedBody,
              }
            : prev
        );
        return;
      }

      const [clearVotesRes, resetVoteFlagsRes] = await Promise.all([
        supabase.from('votes').delete().eq('room_code', roomCode),
        supabase
          .from('public_players')
          .update({ has_voted: false })
          .eq('room_code', roomCode),
      ]);
      if (clearVotesRes.error) {
        logSupabaseTableError('votes', 'callMeetingDelete', clearVotesRes.error);
      }
      if (resetVoteFlagsRes.error) {
        logSupabaseTableError(
          'public_players',
          'callMeetingResetVoted',
          resetVoteFlagsRes.error
        );
      }

      const { error: roomMeetingErr } = await supabase
        .from('rooms')
        .update({
          status: 'MEETING',
          active_sabotage: null,
          sabotage_ends_at: null,
          ejection_result: null,
          meeting_ends_at: meetingEndsAt,
          meeting_caller_badge_id: identity.badgeId,
          meeting_body_badge_id: normalizedBody,
        })
        .eq('room_code', roomCode);
      if (roomMeetingErr) {
        logSupabaseTableError('rooms', 'callMeetingUpdate', roomMeetingErr);
      }
    },
    [identity?.roomCode, identity?.badgeId, useRemoteSupabase]
  );

  const castVote = useCallback(
    async (rawTargetBadgeId: string | 'SKIP'): Promise<void> => {
      if (!identity?.roomCode || !identity?.badgeId || !room) return;
      if (room.status !== 'MEETING' || room.ejection_result) return;

      const me = publicPlayers.find((p) => p.badge_id === identity.badgeId);
      if (!me?.is_alive || me.has_voted) return;

      const targetBadgeId =
        rawTargetBadgeId.toUpperCase() === 'SKIP'
          ? 'SKIP'
          : normalizeBadgeId(rawTargetBadgeId);

      if (
        targetBadgeId !== 'SKIP' &&
        !publicPlayers.find((p) => p.badge_id === targetBadgeId)?.is_alive
      ) {
        return;
      }

      if (!useRemoteSupabase || !supabase) {
        localFallbackVotesRef.current = {
          ...localFallbackVotesRef.current,
          [identity.badgeId]: targetBadgeId,
        };
        setVotes(localFallbackVotesRef.current);
        setPublicPlayers((prev) =>
          prev.map((p) =>
            p.badge_id === identity.badgeId ? { ...p, has_voted: true } : p
          )
        );
        return;
      }

      const { error: voteErr } = await supabase.from('votes').upsert(
        {
          room_code: identity.roomCode,
          voter_badge_id: identity.badgeId,
          target_badge_id: targetBadgeId,
        },
        { onConflict: 'room_code,voter_badge_id' }
      );
      if (voteErr) {
        logSupabaseTableError('votes', 'castVoteUpsert', voteErr);
      }

      const { error: votedFlagErr } = await supabase
        .from('public_players')
        .update({ has_voted: true })
        .eq('room_code', identity.roomCode)
        .eq('badge_id', identity.badgeId);
      if (votedFlagErr) {
        logSupabaseTableError(
          'public_players',
          'castVoteMarkVoted',
          votedFlagErr
        );
      }
    },
    [identity?.roomCode, identity?.badgeId, room, publicPlayers, useRemoteSupabase]
  );

  const finalizeMeeting = useCallback(async (): Promise<void> => {
    if (!identity?.roomCode || finalizingMeetingRef.current) return;
    finalizingMeetingRef.current = true;
    const roomCode = identity.roomCode;

    try {
      let voteEntries: Pick<VoteRow, 'voter_badge_id' | 'target_badge_id'>[] =
        [];
      let playersSnapshot = publicPlayers;

      if (useRemoteSupabase && supabase) {
        const [votesRes, playersRes, roomRes] = await Promise.all([
          supabase
            .from('votes')
            .select('voter_badge_id, target_badge_id')
            .eq('room_code', roomCode),
          supabase
            .from('public_players')
            .select('*')
            .eq('room_code', roomCode),
          supabase
            .from('rooms')
            .select('status, ejection_result')
            .eq('room_code', roomCode)
            .maybeSingle(),
        ]);

        if (votesRes.error) {
          logSupabaseTableError('votes', 'finalizeMeetingSelect', votesRes.error);
        }
        if (playersRes.error) {
          logSupabaseTableError(
            'public_players',
            'finalizeMeetingSelect',
            playersRes.error
          );
        }
        if (roomRes.error) {
          logSupabaseTableError('rooms', 'finalizeMeetingSelect', roomRes.error);
        }

        const latestRoom = roomRes.data as Pick<
          RoomRow,
          'status' | 'ejection_result'
        > | null;
        if (
          !latestRoom ||
          latestRoom.status !== 'MEETING' ||
          latestRoom.ejection_result !== null
        ) {
          return;
        }

        voteEntries = (votesRes.data || []) as Pick<
          VoteRow,
          'voter_badge_id' | 'target_badge_id'
        >[];
        playersSnapshot = (playersRes.data || []) as PublicPlayerRow[];
      } else {
        voteEntries = Object.entries(localFallbackVotesRef.current).map(
          ([voter_badge_id, target_badge_id]) => ({
            voter_badge_id,
            target_badge_id,
          })
        );
      }

      const aliveSet = new Set(
        playersSnapshot.filter((p) => p.is_alive).map((p) => p.badge_id)
      );

      const counts = new Map<string, number>();
      for (const vote of voteEntries) {
        if (!aliveSet.has(vote.voter_badge_id)) continue;
        counts.set(
          vote.target_badge_id,
          (counts.get(vote.target_badge_id) || 0) + 1
        );
      }

      let maxVotes = 0;
      let topTargets: string[] = [];
      for (const [target, count] of counts.entries()) {
        if (count > maxVotes) {
          maxVotes = count;
          topTargets = [target];
        } else if (count === maxVotes) {
          topTargets.push(target);
        }
      }

      let ejectionResult: string;
      let ejectedBadgeId: string | null = null;

      if (
        maxVotes === 0 ||
        topTargets.length !== 1 ||
        topTargets[0] === 'SKIP'
      ) {
        ejectionResult =
          'No one was ejected. (Skipped / Tied) · Confirm Ejects: OFF';
      } else {
        ejectedBadgeId = topTargets[0];
        const ejectedPlayer = playersSnapshot.find(
          (p) => p.badge_id === ejectedBadgeId
        );
        const badgeLabel =
          WRISTBANDS.find((w) => w.id === ejectedBadgeId)?.label ||
          ejectedBadgeId;
        const ejectedName = ejectedPlayer?.name || 'Operative';
        ejectionResult = `${badgeLabel} (${ejectedName}) was ejected. Confirm Ejects: OFF`;
      }

      const revealEndsAt = Date.now() + EJECTION_REVEAL_MS;

      if (!useRemoteSupabase || !supabase) {
        if (ejectedBadgeId) {
          setPublicPlayers((prev) =>
            prev.map((p) =>
              p.badge_id === ejectedBadgeId ? { ...p, is_alive: false } : p
            )
          );
        }
        setRoom((prev) =>
          prev
            ? {
                ...prev,
                ejection_result: ejectionResult,
                meeting_ends_at: revealEndsAt,
              }
            : prev
        );
        return;
      }

      if (ejectedBadgeId) {
        const { error: ejectErr } = await supabase
          .from('public_players')
          .update({ is_alive: false })
          .eq('room_code', roomCode)
          .eq('badge_id', ejectedBadgeId);
        if (ejectErr) {
          logSupabaseTableError(
            'public_players',
            'finalizeMeetingEject',
            ejectErr
          );
        }
      }

      const { error: finalizeRoomErr } = await supabase
        .from('rooms')
        .update({
          ejection_result: ejectionResult,
          meeting_ends_at: revealEndsAt,
        })
        .eq('room_code', roomCode)
        .eq('status', 'MEETING')
        .is('ejection_result', null);
      if (finalizeRoomErr) {
        logSupabaseTableError(
          'rooms',
          'finalizeMeetingUpdate',
          finalizeRoomErr
        );
      }
    } finally {
      finalizingMeetingRef.current = false;
    }
  }, [identity?.roomCode, publicPlayers, useRemoteSupabase]);

  const dismissEjection = useCallback(async (): Promise<void> => {
    if (!identity?.roomCode || dismissingEjectionRef.current) return;
    dismissingEjectionRef.current = true;
    const roomCode = identity.roomCode;

    try {
      if (!useRemoteSupabase || !supabase) {
        const roleEntries = Object.values(localFallbackRolesRef.current);
        const impostorSet = new Set(
          roleEntries.filter((r) => r.role === 'IMPOSTOR').map((r) => r.badge_id)
        );
        let localWinner: CampusWinner = null;
        if (impostorSet.size > 0) {
          let livingImp = 0;
          let livingCrew = 0;
          for (const p of publicPlayers) {
            if (!p.is_alive) continue;
            if (impostorSet.has(p.badge_id)) livingImp += 1;
            else livingCrew += 1;
          }
          if (livingImp === 0) localWinner = 'CREWMATES';
          else if (livingImp >= livingCrew) localWinner = 'IMPOSTORS';
        }

        setPublicPlayers((prev) =>
          prev.map((p) => ({ ...p, has_voted: false }))
        );
        setRoom((prev) =>
          prev
            ? {
                ...prev,
                status: localWinner ? 'ENDED' : 'PLAYING',
                winner: localWinner,
                meeting_ends_at: null,
                ejection_result: null,
                meeting_caller_badge_id: null,
                meeting_body_badge_id: null,
              }
            : prev
        );
        if (!localWinner) {
          setKillCooldownEnd(Date.now() + POST_MEETING_COOLDOWN_MS);
        }
        return;
      }

      // Transient server-backed win evaluation so ejected/bot Impostors cannot soft-lock the match
      let nextWinner: CampusWinner = null;
      const [playersSnapshotRes, rolesSnapshotRes] = await Promise.all([
        supabase
          .from('public_players')
          .select('badge_id, is_alive')
          .eq('room_code', roomCode),
        supabase
          .from('private_roles')
          .select('badge_id, role')
          .eq('room_code', roomCode),
      ]);

      if (
        !playersSnapshotRes.error &&
        !rolesSnapshotRes.error &&
        Array.isArray(playersSnapshotRes.data) &&
        Array.isArray(rolesSnapshotRes.data) &&
        rolesSnapshotRes.data.length > 0
      ) {
        const impBadges = new Set(
          (rolesSnapshotRes.data as { badge_id: string; role: string }[])
            .filter((r) => r.role === 'IMPOSTOR')
            .map((r) => r.badge_id)
        );
        if (impBadges.size > 0) {
          let livingImp = 0;
          let livingCrew = 0;
          for (const p of playersSnapshotRes.data as {
            badge_id: string;
            is_alive: boolean;
          }[]) {
            if (!p.is_alive) continue;
            if (impBadges.has(p.badge_id)) livingImp += 1;
            else livingCrew += 1;
          }
          if (livingImp === 0) {
            nextWinner = 'CREWMATES';
          } else if (livingImp >= livingCrew) {
            nextWinner = 'IMPOSTORS';
          }
        }
      }

      const [resetFlagsRes, resumeRoomRes] = await Promise.all([
        supabase
          .from('public_players')
          .update({ has_voted: false })
          .eq('room_code', roomCode),
        supabase
          .from('rooms')
          .update({
            status: nextWinner ? 'ENDED' : 'PLAYING',
            winner: nextWinner,
            meeting_ends_at: null,
            ejection_result: null,
            meeting_caller_badge_id: null,
            meeting_body_badge_id: null,
          })
          .eq('room_code', roomCode)
          .eq('status', 'MEETING'),
      ]);
      if (resetFlagsRes.error) {
        logSupabaseTableError(
          'public_players',
          'dismissEjectionReset',
          resetFlagsRes.error
        );
      }
      if (resumeRoomRes.error) {
        logSupabaseTableError('rooms', 'dismissEjectionUpdate', resumeRoomRes.error);
      }
    } finally {
      dismissingEjectionRef.current = false;
    }
  }, [identity?.roomCode, publicPlayers, useRemoteSupabase]);

  const resetRoom = useCallback(async (): Promise<void> => {
    if (!identity?.roomCode) return;
    const roomCode = identity.roomCode;

    if (!useRemoteSupabase || !supabase) {
      setPublicPlayers((prev) =>
        prev.map((p) => ({ ...p, is_alive: true, has_voted: false }))
      );
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              status: 'LOBBY',
              winner: null,
              task_progress: 0,
              active_sabotage: null,
              sabotage_ends_at: null,
              meeting_ends_at: null,
              ejection_result: null,
              meeting_caller_badge_id: null,
              meeting_body_badge_id: null,
            }
          : prev
      );
      return;
    }

    const [delVotesRes, resetPlayersRes, resetRoomRes] = await Promise.all([
      supabase.from('votes').delete().eq('room_code', roomCode),
      supabase
        .from('public_players')
        .update({ is_alive: true, has_voted: false })
        .eq('room_code', roomCode),
      supabase
        .from('rooms')
        .update({
          status: 'LOBBY',
          winner: null,
          task_progress: 0,
          active_sabotage: null,
          sabotage_ends_at: null,
          meeting_ends_at: null,
          ejection_result: null,
          meeting_caller_badge_id: null,
          meeting_body_badge_id: null,
        })
        .eq('room_code', roomCode),
    ]);
    if (delVotesRes.error) {
      logSupabaseTableError('votes', 'resetRoomDelete', delVotesRes.error);
    }
    if (resetPlayersRes.error) {
      logSupabaseTableError(
        'public_players',
        'resetRoomUpdate',
        resetPlayersRes.error
      );
    }
    if (resetRoomRes.error) {
      logSupabaseTableError('rooms', 'resetRoomUpdate', resetRoomRes.error);
    }
  }, [identity?.roomCode, useRemoteSupabase]);

  // Auto-tally when all living players have voted OR 60s timer expires
  useEffect(() => {
    if (
      !identity?.roomCode ||
      room?.status !== 'MEETING' ||
      room?.ejection_result
    ) {
      return;
    }

    const livingPlayers = publicPlayers.filter((p) => p.is_alive);
    const allLivingVoted =
      livingPlayers.length > 0 && livingPlayers.every((p) => p.has_voted);

    if (allLivingVoted) {
      void finalizeMeeting();
      return;
    }

    const endsAt = room.meeting_ends_at;
    if (!endsAt) return;

    const remainingMs = Math.max(0, endsAt - Date.now());
    const timer = setTimeout(() => {
      void finalizeMeeting();
    }, remainingMs);

    return () => clearTimeout(timer);
  }, [
    identity?.roomCode,
    room?.status,
    room?.ejection_result,
    room?.meeting_ends_at,
    publicPlayers,
    finalizeMeeting,
  ]);

  // Auto-resume PLAYING after 6-second Ejection Reveal
  useEffect(() => {
    if (
      !identity?.roomCode ||
      room?.status !== 'MEETING' ||
      !room?.ejection_result ||
      !room?.meeting_ends_at
    ) {
      return;
    }

    const remainingMs = Math.max(0, room.meeting_ends_at - Date.now());
    const timer = setTimeout(() => {
      void dismissEjection();
    }, remainingMs);

    return () => clearTimeout(timer);
  }, [
    identity?.roomCode,
    room?.status,
    room?.ejection_result,
    room?.meeting_ends_at,
    dismissEjection,
  ]);

  // Post-ejection win check evaluated by Impostor client without leaking roles publicly
  useEffect(() => {
    if (
      !identity?.roomCode ||
      !identity?.badgeId ||
      room?.status !== 'PLAYING' ||
      privateRole?.role !== 'IMPOSTOR'
    ) {
      return;
    }

    const impostorSet = new Set<string>([
      identity.badgeId,
      ...(privateRole.fellow_impostors || []),
    ]);

    let livingImpostors = 0;
    let livingCrewmates = 0;
    for (const player of publicPlayers) {
      if (!player.is_alive) continue;
      if (impostorSet.has(player.badge_id)) {
        livingImpostors += 1;
      } else {
        livingCrewmates += 1;
      }
    }

    if (livingImpostors > 0 && livingImpostors < livingCrewmates) {
      return;
    }

    const nextWinner: 'CREWMATES' | 'IMPOSTORS' =
      livingImpostors === 0 ? 'CREWMATES' : 'IMPOSTORS';

    if (!useRemoteSupabase || !supabase) {
      setRoom((prev) =>
        prev && prev.status === 'PLAYING'
          ? {
              ...prev,
              status: 'ENDED',
              winner: nextWinner,
              active_sabotage: null,
              sabotage_ends_at: null,
            }
          : prev
      );
      return;
    }

    void supabase
      .from('rooms')
      .update({
        status: 'ENDED',
        winner: nextWinner,
        active_sabotage: null,
        sabotage_ends_at: null,
      })
      .eq('room_code', identity.roomCode)
      .eq('status', 'PLAYING')
      .then(({ error }) => {
        if (error) {
          logSupabaseTableError('rooms', 'postEjectionWinUpdate', error);
        }
      });
  }, [
    identity?.roomCode,
    identity?.badgeId,
    room?.status,
    publicPlayers,
    privateRole,
    useRemoteSupabase,
  ]);

  const createLobby = useCallback(
    async (rawRoomCode: string, impostorCount: 1 | 2 = 1): Promise<string> => {
      const roomCode = normalizeRoomCode(rawRoomCode);
      const badgeId = identity?.badgeId || 'P01';
      const name = identity?.name || 'Host Dev';
      const wristbandSecret =
        identity?.wristbandSecret || getOrCreateWristbandSecret();

      trackLobbyCode(roomCode);

      if (!useRemoteSupabase || !supabase) {
        setRoom({
          ...createInitialRoom(roomCode),
          impostor_count: impostorCount,
        });
        setPublicPlayers([]);
        setPrivateRole(null);
        setVotes({});
        setIdentity({ roomCode, badgeId, name, wristbandSecret });
        pushInsightEvent('LOBBY_CREATED', `Created local lobby ${roomCode}`);
        return roomCode;
      }

      const { error } = await supabase.from('rooms').upsert(
        {
          room_code: roomCode,
          status: 'LOBBY',
          winner: null,
          task_progress: 0,
          active_sabotage: null,
          sabotage_ends_at: null,
          meeting_ends_at: null,
          ejection_result: null,
          impostor_count: impostorCount,
          meeting_caller_badge_id: null,
          meeting_body_badge_id: null,
        },
        { onConflict: 'room_code' }
      );

      if (error) {
        const msg = logSupabaseTableError('rooms', 'createLobbyUpsert', error);
        setSyncError(msg);
        throw new Error(msg);
      }

      const [delVotesRes, delPlayersRes, delRolesRes] = await Promise.all([
        supabase.from('votes').delete().eq('room_code', roomCode),
        supabase.from('public_players').delete().eq('room_code', roomCode),
        supabase.from('private_roles').delete().eq('room_code', roomCode),
      ]);
      if (delVotesRes.error) {
        logSupabaseTableError('votes', 'createLobbyCleanup', delVotesRes.error);
      }
      if (delPlayersRes.error) {
        logSupabaseTableError(
          'public_players',
          'createLobbyCleanup',
          delPlayersRes.error
        );
      }
      if (delRolesRes.error) {
        logSupabaseTableError(
          'private_roles',
          'createLobbyCleanup',
          delRolesRes.error
        );
      }

      setPublicPlayers([]);
      setPrivateRole(null);
      setVotes({});
      setIdentity({ roomCode, badgeId, name, wristbandSecret });
      pushInsightEvent('LOBBY_CREATED', `Created Supabase lobby ${roomCode}`);
      await fetchRoomState(roomCode, badgeId);
      return roomCode;
    },
    [identity, trackLobbyCode, pushInsightEvent, fetchRoomState, useRemoteSupabase]
  );

  const switchLobby = useCallback(
    async (rawRoomCode: string): Promise<void> => {
      const roomCode = normalizeRoomCode(rawRoomCode);
      const badgeId = identity?.badgeId || 'P01';
      const name = identity?.name || 'Host Dev';
      const wristbandSecret =
        identity?.wristbandSecret || getOrCreateWristbandSecret();

      trackLobbyCode(roomCode);
      setIdentity({ roomCode, badgeId, name, wristbandSecret });
      if (useRemoteSupabase && supabase) {
        await fetchRoomState(roomCode, badgeId);
      }
      pushInsightEvent('LOBBY_SWITCHED', `Switched active lobby to ${roomCode}`);
    },
    [identity, trackLobbyCode, fetchRoomState, pushInsightEvent, useRemoteSupabase]
  );

  const addCandidate = useCallback(
    async (
      rawRoomCode: string,
      rawBadgeId: string,
      rawName: string
    ): Promise<void> => {
      const roomCode = normalizeRoomCode(rawRoomCode);
      const badgeId = normalizeBadgeId(rawBadgeId);
      const name = sanitizePlayerName(rawName);
      const wristband =
        WRISTBANDS.find((w) => w.id === badgeId) || WRISTBANDS[0];

      trackLobbyCode(roomCode);

      if (!useRemoteSupabase || !supabase) {
        setRoom((prev) =>
          prev && prev.room_code === roomCode
            ? prev
            : createInitialRoom(roomCode)
        );
        setPublicPlayers((prev) => {
          const without = prev.filter((p) => p.badge_id !== badgeId);
          return [
            ...without,
            {
              id: `dev-${badgeId}`,
              room_code: roomCode,
              badge_id: badgeId,
              name,
              color: wristband.colorHex,
              is_alive: true,
              has_voted: false,
            },
          ].sort((a, b) => a.badge_id.localeCompare(b.badge_id));
        });
        pushInsightEvent(
          'CANDIDATE_ADDED',
          `Added ${badgeId} (${name}) to ${roomCode}`
        );
        return;
      }

      const { error: roomUpsertErr } = await supabase.from('rooms').upsert(
        {
          room_code: roomCode,
          status: 'LOBBY',
          winner: null,
          task_progress: 0,
          impostor_count: 1,
        },
        { onConflict: 'room_code', ignoreDuplicates: true }
      );
      if (roomUpsertErr) {
        logSupabaseTableError('rooms', 'addCandidateUpsert', roomUpsertErr);
      }

      const { error: playerUpsertErr } = await supabase
        .from('public_players')
        .upsert(
          {
            room_code: roomCode,
            badge_id: badgeId,
            name,
            color: wristband.colorHex,
            is_alive: true,
            has_voted: false,
          },
          { onConflict: 'room_code,badge_id' }
        );
      if (playerUpsertErr) {
        logSupabaseTableError(
          'public_players',
          'addCandidateUpsert',
          playerUpsertErr
        );
      }

      const { error: roleUpsertErr } = await supabase
        .from('private_roles')
        .upsert(
          {
            room_code: roomCode,
            badge_id: badgeId,
            wristband_secret: `dev_${badgeId}_${Date.now().toString(36)}`,
            role: 'CREWMATE',
            fellow_impostors: [],
            assigned_stations: [],
            completed_stations: [],
          },
          { onConflict: 'room_code,badge_id' }
        );
      if (roleUpsertErr) {
        logSupabaseTableError(
          'private_roles',
          'addCandidateUpsert',
          roleUpsertErr
        );
      }

      pushInsightEvent(
        'CANDIDATE_ADDED',
        `Added ${badgeId} (${name}) to ${roomCode}`
      );
      await fetchRoomState(roomCode, identity?.badgeId);
    },
    [
      trackLobbyCode,
      pushInsightEvent,
      fetchRoomState,
      identity?.badgeId,
      useRemoteSupabase,
    ]
  );

  const removeCandidate = useCallback(
    async (rawRoomCode: string, rawBadgeId: string): Promise<void> => {
      const roomCode = normalizeRoomCode(rawRoomCode);
      const badgeId = normalizeBadgeId(rawBadgeId);

      if (!useRemoteSupabase || !supabase) {
        setPublicPlayers((prev) => prev.filter((p) => p.badge_id !== badgeId));
        pushInsightEvent('CANDIDATE_REMOVED', `Removed ${badgeId} from ${roomCode}`);
        return;
      }

      const [delVoteRes, delRoleRes, delPlayerRes] = await Promise.all([
        supabase
          .from('votes')
          .delete()
          .eq('room_code', roomCode)
          .eq('voter_badge_id', badgeId),
        supabase
          .from('private_roles')
          .delete()
          .eq('room_code', roomCode)
          .eq('badge_id', badgeId),
        supabase
          .from('public_players')
          .delete()
          .eq('room_code', roomCode)
          .eq('badge_id', badgeId),
      ]);
      if (delVoteRes.error) {
        logSupabaseTableError('votes', 'removeCandidateDelete', delVoteRes.error);
      }
      if (delRoleRes.error) {
        logSupabaseTableError(
          'private_roles',
          'removeCandidateDelete',
          delRoleRes.error
        );
      }
      if (delPlayerRes.error) {
        logSupabaseTableError(
          'public_players',
          'removeCandidateDelete',
          delPlayerRes.error
        );
      }

      pushInsightEvent('CANDIDATE_REMOVED', `Removed ${badgeId} from ${roomCode}`);
      await fetchRoomState(roomCode, identity?.badgeId);
    },
    [pushInsightEvent, fetchRoomState, identity?.badgeId, useRemoteSupabase]
  );

  const toggleCandidateAlive = useCallback(
    async (
      rawRoomCode: string,
      rawBadgeId: string,
      isAlive: boolean
    ): Promise<void> => {
      const roomCode = normalizeRoomCode(rawRoomCode);
      const badgeId = normalizeBadgeId(rawBadgeId);

      if (!useRemoteSupabase || !supabase) {
        setPublicPlayers((prev) =>
          prev.map((p) =>
            p.badge_id === badgeId ? { ...p, is_alive: isAlive } : p
          )
        );
        return;
      }

      const { error } = await supabase
        .from('public_players')
        .update({ is_alive: isAlive })
        .eq('room_code', roomCode)
        .eq('badge_id', badgeId);
      if (error) {
        logSupabaseTableError(
          'public_players',
          'toggleCandidateAlive',
          error
        );
      }
    },
    [useRemoteSupabase]
  );

  const leaveRoom = useCallback(() => {
    localFallbackVotesRef.current = {};
    localFallbackRolesRef.current = {};
    setIdentity(null);
    setRoom(null);
    setPublicPlayers([]);
    setPrivateRole(null);
    setVotes({});
    setGhostModeActive(false);
    setKillCooldownEnd(0);
    setSyncError(null);
    setIsRoomLoaded(false);
  }, []);

  const myPlayerRow = useMemo(
    () =>
      identity?.badgeId
        ? publicPlayers.find((p) => p.badge_id === identity.badgeId) || null
        : null,
    [publicPlayers, identity?.badgeId]
  );

  const isCommsSabotaged = useMemo(
    () => room?.active_sabotage === 'COMMS',
    [room?.active_sabotage]
  );

  return {
    isSupabaseConfigured: isSupabaseConfigured && !forceLocalMode,
    supabaseConfigStatus,
    forceLocalMode,
    setForceLocalMode,
    realtimeConnected,
    connectionStatus,
    reconnectAttempt,
    realtimeLatencyMs,
    syncError,
    insightEvents,
    pushInsightEvent,
    clearInsightEvents,
    recentLobbies,
    identity,
    room,
    publicPlayers,
    privateRole,
    myPlayerRow,
    votes,
    isRoomLoaded,
    killCooldownEnd,
    ghostModeActive,
    setGhostModeActive,
    isCommsSabotaged,
    joinRoom,
    createLobby,
    switchLobby,
    addCandidate,
    removeCandidate,
    toggleCandidateAlive,
    seedDemoPlayers,
    setImpostorCount,
    startMatch,
    completeStation,
    eliminatePlayer,
    triggerSabotage,
    clearSabotage,
    callMeeting,
    castVote,
    finalizeMeeting,
    dismissEjection,
    resetRoom,
    leaveRoom,
  };
}
