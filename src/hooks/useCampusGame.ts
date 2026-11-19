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
  getOrCreateMatchQrToken,
  rotateMatchQrToken,
} from '../config/matchQrStore';
import {
  playCommsJamSound,
  playEmergencySiren,
  playFlatlineEliminated,
  playSabotageAlarm,
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

export interface RosterNotification {
  id: string;
  kind: 'joined' | 'left';
  badgeId: string;
  name: string;
  message: string;
  ts: number;
}

export interface ImpostorOpsLogEntry {
  id: string;
  roomCode: string;
  kind: 'KILL' | 'SABOTAGE_TRIGGERED' | 'SABOTAGE_DEFUSED';
  timestamp: number;
  victimBadgeId?: string;
  victimBadgeNumber?: string;
  victimName?: string;
  actorSource?: 'YOU' | 'ALLY';
  sabotageType?: 'REACTOR' | 'COMMS';
  targetLabel?: string;
}

const IDENTITY_STORAGE_KEY = 'cairl_supabase_identity';
const SECRET_STORAGE_KEY = 'cairl_wristband_secret';
const ROOM_CACHE_KEY = 'cairl_supabase_room_cache';
const PLAYERS_CACHE_KEY = 'cairl_supabase_players_cache';
const ROLE_CACHE_KEY = 'cairl_supabase_role_cache';
const DEV_LOBBIES_KEY = 'cairl_dev_lobbies';
const IMPOSTOR_OPS_LOG_KEY = 'cairl_impostor_ops_log';

const KILL_COOLDOWN_MS = 30_000;
const POST_MEETING_COOLDOWN_MS = 15_000;
export const REACTOR_SABOTAGE_MS = 120_000;
export const MEETING_ASSEMBLE_MS = 90_000;
export const MEETING_DISCUSSION_MS = 120_000;
export const MEETING_DURATION_MS = MEETING_ASSEMBLE_MS + MEETING_DISCUSSION_MS;
export const EJECTION_REVEAL_MS = 16_000;

type RoomTimestampMode = 'epoch' | 'iso';

function parseRoomTimestampMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // Handle Unix seconds (< 1e11) vs Unix milliseconds
    return value > 0 && value < 1e11 ? Math.round(value * 1000) : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const parsedNum = Number(trimmed);
      if (!Number.isFinite(parsedNum)) return null;
      return parsedNum > 0 && parsedNum < 1e11
        ? Math.round(parsedNum * 1000)
        : parsedNum;
    }
    // Postgres `timestamp without time zone` strips the trailing `Z` from ISO UTC strings.
    // ECMAScript Date.parse() treats timezone-less ISO strings as LOCAL time, which shifts
    // timestamps by the user's UTC offset (e.g. -5.5h in IST -> instant expiry!).
    let isoCandidate = trimmed;
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(isoCandidate)) {
      isoCandidate = isoCandidate.replace(' ', 'T');
      const hasTimezone = /(Z|[+-]\d{2}(?::?\d{2})?)$/i.test(isoCandidate);
      if (!hasTimezone) {
        isoCandidate = `${isoCandidate}Z`;
      }
    }
    const parsedDate = Date.parse(isoCandidate);
    return Number.isFinite(parsedDate) ? parsedDate : null;
  }
  return null;
}

function detectTimestampModeFromRaw(raw: unknown): RoomTimestampMode | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  for (const field of [row.meeting_ends_at, row.sabotage_ends_at]) {
    if (typeof field === 'string' && /[-T:]/.test(field)) {
      return 'iso';
    }
    if (typeof field === 'number' && Number.isFinite(field)) {
      return 'epoch';
    }
  }
  return null;
}

function clampImpostorCount(raw: unknown): 1 | 2 | 3 {
  const n = Math.round(Number(raw) || 1);
  if (n >= 3) return 3;
  if (n === 2) return 2;
  return 1;
}

function normalizeRoomRow(raw: unknown): RoomRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const rawHost =
    typeof row.host_badge_id === 'string' && row.host_badge_id.trim().length > 0
      ? normalizeBadgeId(row.host_badge_id)
      : null;
  return {
    ...(row as unknown as RoomRow),
    impostor_count: clampImpostorCount(row.impostor_count),
    host_badge_id: rawHost,
    sabotage_ends_at: parseRoomTimestampMs(row.sabotage_ends_at),
    meeting_ends_at: parseRoomTimestampMs(row.meeting_ends_at),
  };
}

function formatRoomTimestamp(
  ms: number | null,
  mode: RoomTimestampMode
): number | string | null {
  if (ms === null) return null;
  return mode === 'iso' ? new Date(ms).toISOString() : Math.round(ms);
}

function isDatetimeOutOfRangeError(
  err: { code?: string; message?: string } | null | undefined
): boolean {
  if (!err) return false;
  return (
    err.code === '22008' ||
    /date\/time field value out of range|invalid input syntax for type timestamp/i.test(
      err.message || ''
    )
  );
}

function isBigintSyntaxError(
  err: { code?: string; message?: string } | null | undefined
): boolean {
  if (!err) return false;
  return (
    err.code === '22P02' &&
    /bigint|integer|numeric/i.test(err.message || '')
  );
}

function isMissingOptionalColumnError(
  err: { code?: string; message?: string } | null | undefined
): boolean {
  if (!err) return false;
  return (
    err.code === '42703' ||
    err.code === 'PGRST204' ||
    /column|meeting_caller|meeting_body|host_badge_id/i.test(err.message || '')
  );
}

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

function createInitialRoom(
  roomCode: string,
  hostBadgeId: string | null = null,
  impostorCount: 1 | 2 | 3 = 1
): RoomRow {
  return {
    room_code: roomCode,
    status: 'LOBBY',
    winner: null,
    task_progress: 0,
    active_sabotage: null,
    sabotage_ends_at: null,
    meeting_ends_at: null,
    ejection_result: null,
    impostor_count: clampImpostorCount(impostorCount),
    host_badge_id: hostBadgeId ? normalizeBadgeId(hostBadgeId) : null,
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
  const [devAllRoles, setDevAllRoles] = useState<Record<string, PrivateRoleRow>>(
    {}
  );
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
  const [rosterNotification, setRosterNotification] =
    useState<RosterNotification | null>(null);
  const [impostorOpsLog, setImpostorOpsLog] = useState<ImpostorOpsLogEntry[]>(
    () => {
      const cachedId = readStoredIdentity();
      const saved = readJson<ImpostorOpsLogEntry[]>(IMPOSTOR_OPS_LOG_KEY);
      if (cachedId && Array.isArray(saved)) {
        return saved.filter((e) => e.roomCode === cachedId.roomCode);
      }
      return [];
    }
  );

  const appendImpostorOpsLog = useCallback(
    (entry: Omit<ImpostorOpsLogEntry, 'id'>) => {
      setImpostorOpsLog((prev) => {
        // Deduplicate rapid double-logging of the same kill victim or same sabotage event
        const isDuplicate = prev.some((existing) => {
          if (existing.roomCode !== entry.roomCode || existing.kind !== entry.kind) {
            return false;
          }
          if (Math.abs(existing.timestamp - entry.timestamp) > 10_000) {
            return false;
          }
          if (entry.kind === 'KILL') {
            return existing.victimBadgeId === entry.victimBadgeId;
          }
          return existing.sabotageType === entry.sabotageType;
        });
        if (isDuplicate) return prev;
        const next: ImpostorOpsLogEntry[] = [
          {
            ...entry,
            id: `${entry.timestamp}_${Math.random().toString(36).slice(2, 7)}`,
          },
          ...prev.filter((e) => e.roomCode === entry.roomCode),
        ].slice(0, 60);
        try {
          localStorage.setItem(IMPOSTOR_OPS_LOG_KEY, JSON.stringify(next));
        } catch {
          // ignore storage errors
        }
        return next;
      });
    },
    []
  );

  const clearImpostorOpsLog = useCallback(() => {
    setImpostorOpsLog([]);
    try {
      localStorage.removeItem(IMPOSTOR_OPS_LOG_KEY);
    } catch {
      // ignore storage errors
    }
  }, []);

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
  const roomTimestampModeRef = useRef<RoomTimestampMode>('epoch');
  const prevRoomStatusRef = useRef<CampusRoomStatus | null>(null);
  const prevSabotageRef = useRef<CampusSabotageType>(null);
  const activeSabotageRef = useRef<CampusSabotageType>(room?.active_sabotage ?? null);
  const sabotageActivatedAtRef = useRef<number>(0);
  const ejectionShownAtRef = useRef<number>(0);
  const prevEjectionResultRef = useRef<string | null>(room?.ejection_result ?? null);
  const prevIsAliveRef = useRef<boolean | null>(null);
  const prevAliveMapRef = useRef<{
    roomCode: string;
    aliveByBadge: Record<string, boolean>;
  }>({ roomCode: '', aliveByBadge: {} });
  const identityRef = useRef<CampusLocalIdentity | null>(identity);
  const roomStatusRef = useRef<CampusRoomStatus | null>(room?.status ?? null);
  const prevPlayersSnapshotRef = useRef<{
    roomCode: string;
    players: PublicPlayerRow[];
  }>({
    roomCode: identity?.roomCode || '',
    players: publicPlayers,
  });

  const executeRoomTimestampWrite = useCallback(
    async <T extends { error: { code?: string; message?: string } | null }>(
      writeFn: (mode: RoomTimestampMode) => PromiseLike<T>
    ): Promise<T> => {
      const initialMode = roomTimestampModeRef.current;
      let res = await writeFn(initialMode);
      if (res.error) {
        if (initialMode === 'epoch' && isDatetimeOutOfRangeError(res.error)) {
          roomTimestampModeRef.current = 'iso';
          res = await writeFn('iso');
        } else if (initialMode === 'iso' && isBigintSyntaxError(res.error)) {
          roomTimestampModeRef.current = 'epoch';
          res = await writeFn('epoch');
        }
      }
      return res;
    },
    []
  );

  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  useEffect(() => {
    roomStatusRef.current = room?.status ?? null;
    activeSabotageRef.current = room?.active_sabotage ?? null;
  }, [room?.status, room?.active_sabotage]);

  // Local fallback store when Supabase env vars are not yet configured (e.g. ?debug=true preview)
  const localFallbackVotesRef = useRef<Record<string, string>>({});
  const localFallbackRolesRef = useRef<Record<string, PrivateRoleRow>>({});
  const roomChannelRef = useRef<ReturnType<
    NonNullable<typeof supabase>['channel']
  > | null>(null);

  const broadcastTaskProgress = useCallback(
    (nextProgress: number) => {
      const ch = roomChannelRef.current;
      if (!ch) return;
      void ch.send({
        type: 'broadcast',
        event: 'task_progress_sync',
        payload: {
          task_progress: nextProgress,
          status: nextProgress >= 100 ? 'ENDED' : undefined,
          winner: nextProgress >= 100 ? 'CREWMATES' : undefined,
          ts: Date.now(),
        },
      });
    },
    []
  );

  const broadcastHostSettings = useCallback(
    (patch: { host_badge_id?: string | null; impostor_count?: 1 | 2 | 3 }) => {
      const ch = roomChannelRef.current;
      if (!ch) return;
      void ch.send({
        type: 'broadcast',
        event: 'room_host_sync',
        payload: {
          ...patch,
          ts: Date.now(),
        },
      });
    },
    []
  );

  const reconcilePublicPlayers = useCallback(
    (
      roomCode: string,
      nextPlayers: PublicPlayerRow[],
      source: 'fetch' | 'realtime'
    ) => {
      const prevSnap = prevPlayersSnapshotRef.current;
      const myBadge = identityRef.current?.badgeId;
      const status = roomStatusRef.current;

      if (prevSnap.roomCode === roomCode && prevSnap.players.length > 0) {
        const nextIds = new Set(nextPlayers.map((p) => p.badge_id));
        const prevIds = new Set(prevSnap.players.map((p) => p.badge_id));

        const isBulkReset = nextPlayers.length === 0 && prevSnap.players.length > 2;
        if (!isBulkReset) {
          const departed = prevSnap.players.filter(
            (p) => !nextIds.has(p.badge_id) && p.badge_id !== myBadge
          );
          if (departed.length > 0) {
            const actionLabel =
              status === 'PLAYING' || status === 'MEETING'
                ? 'exited the match'
                : 'exited the lobby';
            for (const p of departed) {
              pushInsightEvent(
                'PLAYER_LEFT',
                `${p.name} (#${badgeIdToNumber(p.badge_id)}) ${actionLabel} (${roomCode})`
              );
            }
            const first = departed[0];
            const summaryMsg =
              departed.length === 1
                ? `${first.name} (#${badgeIdToNumber(first.badge_id)}) ${actionLabel}`
                : `${departed.length} operatives ${actionLabel}`;
            setRosterNotification({
              id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              kind: 'left',
              badgeId: first.badge_id,
              name: first.name,
              message: summaryMsg,
              ts: Date.now(),
            });
          } else if (source === 'realtime') {
            const joined = nextPlayers.filter(
              (p) => !prevIds.has(p.badge_id) && p.badge_id !== myBadge
            );
            if (joined.length === 1) {
              const p = joined[0];
              pushInsightEvent(
                'PLAYER_JOINED',
                `${p.name} (#${badgeIdToNumber(p.badge_id)}) joined ${roomCode}`
              );
              setRosterNotification({
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                kind: 'joined',
                badgeId: p.badge_id,
                name: p.name,
                message: `${p.name} (#${badgeIdToNumber(p.badge_id)}) joined ${roomCode}`,
                ts: Date.now(),
              });
            }
          }
        }
      }

      prevPlayersSnapshotRef.current = {
        roomCode,
        players: nextPlayers,
      };
      setPublicPlayers(nextPlayers);
    },
    [pushInsightEvent]
  );

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

    if (room.status === 'MEETING' && prevRoomStatusRef.current !== 'MEETING') {
      playEmergencySiren();
    } else if (
      room.active_sabotage === 'REACTOR' &&
      prevSabotageRef.current !== 'REACTOR'
    ) {
      sabotageActivatedAtRef.current = Date.now();
      playSabotageAlarm();
      const targets = resolveSabotageTargets();
      appendImpostorOpsLog({
        roomCode: room.room_code,
        kind: 'SABOTAGE_TRIGGERED',
        timestamp: Date.now(),
        sabotageType: 'REACTOR',
        targetLabel: targets.reactorLabel,
      });
    } else if (
      room.active_sabotage === 'COMMS' &&
      prevSabotageRef.current !== 'COMMS'
    ) {
      playCommsJamSound();
      const targets = resolveSabotageTargets();
      appendImpostorOpsLog({
        roomCode: room.room_code,
        kind: 'SABOTAGE_TRIGGERED',
        timestamp: Date.now(),
        sabotageType: 'COMMS',
        targetLabel: targets.commsLabel,
      });
    } else if (
      !room.active_sabotage &&
      prevSabotageRef.current &&
      room.status === 'PLAYING'
    ) {
      const targets = resolveSabotageTargets();
      appendImpostorOpsLog({
        roomCode: room.room_code,
        kind: 'SABOTAGE_DEFUSED',
        timestamp: Date.now(),
        sabotageType: prevSabotageRef.current,
        targetLabel:
          prevSabotageRef.current === 'REACTOR'
            ? targets.reactorLabel
            : targets.commsLabel,
      });
    }

    if (room.ejection_result && room.ejection_result !== prevEjectionResultRef.current) {
      ejectionShownAtRef.current = Date.now();
    } else if (!room.ejection_result) {
      ejectionShownAtRef.current = 0;
    }
    prevEjectionResultRef.current = room.ejection_result;

    // Reset Impostor kill cooldown & ops log across ALL clients when match resets or starts fresh
    if (room.status === 'LOBBY') {
      setKillCooldownEnd(0);
      if (
        prevRoomStatusRef.current &&
        prevRoomStatusRef.current !== 'LOBBY'
      ) {
        clearImpostorOpsLog();
      }
    } else if (room.status === 'ENDED') {
      setKillCooldownEnd(0);
    } else if (
      room.status === 'PLAYING' &&
      prevRoomStatusRef.current === 'LOBBY'
    ) {
      clearImpostorOpsLog();
      setKillCooldownEnd(Date.now() + KILL_COOLDOWN_MS);
    } else if (
      room.status === 'PLAYING' &&
      prevRoomStatusRef.current === 'MEETING'
    ) {
      setKillCooldownEnd(Date.now() + POST_MEETING_COOLDOWN_MS);
    }

    // Track realtime eliminations during PLAYING (captures both local & fellow Impostor kills)
    const prevAliveSnap = prevAliveMapRef.current;
    const nextAliveByBadge: Record<string, boolean> = {};
    for (const p of publicPlayers) {
      nextAliveByBadge[p.badge_id] = p.is_alive;
      if (
        room.status === 'PLAYING' &&
        prevAliveSnap.roomCode === room.room_code &&
        prevAliveSnap.aliveByBadge[p.badge_id] === true &&
        p.is_alive === false
      ) {
        appendImpostorOpsLog({
          roomCode: room.room_code,
          kind: 'KILL',
          timestamp: Date.now(),
          victimBadgeId: p.badge_id,
          victimBadgeNumber: badgeIdToNumber(p.badge_id),
          victimName: p.name,
          actorSource: 'ALLY',
        });
      }
    }
    prevAliveMapRef.current = {
      roomCode: room.room_code,
      aliveByBadge: nextAliveByBadge,
    };

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
  }, [
    room,
    publicPlayers,
    identity?.badgeId,
    appendImpostorOpsLog,
    clearImpostorOpsLog,
  ]);

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
        const detectedMode = detectTimestampModeFromRaw(roomRes.data);
        if (detectedMode) {
          roomTimestampModeRef.current = detectedMode;
        }
        setRoom(normalizeRoomRow(roomRes.data));
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
        reconcilePublicPlayers(
          roomCode,
          playersRes.data as PublicPlayerRow[],
          'fetch'
        );
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
    [pushInsightEvent, reconcilePublicPlayers]
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
        if (roomChannelRef.current === toRemove) {
          roomChannelRef.current = null;
        }
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
          'broadcast',
          { event: 'task_progress_sync' },
          (msg: { payload?: Record<string, unknown> }) => {
            const p = msg?.payload;
            const rawPct = p?.task_progress;
            if (typeof rawPct !== 'number' || !Number.isFinite(rawPct)) return;
            const syncedPct = Math.max(0, Math.min(100, Math.round(rawPct)));
            setRoom((prev) => {
              if (!prev) return prev;
              const nextPct =
                prev.status === 'PLAYING'
                  ? Math.max(prev.task_progress, syncedPct)
                  : syncedPct;
              return {
                ...prev,
                task_progress: nextPct,
                ...(nextPct >= 100
                  ? {
                      status: 'ENDED',
                      winner: 'CREWMATES',
                      active_sabotage: null,
                      sabotage_ends_at: null,
                    }
                  : {}),
              };
            });
            pushInsightEvent(
              'TASK_PROGRESS_BROADCAST',
              `Global team task progress synced → ${syncedPct}%`
            );
          }
        )
        .on(
          'broadcast',
          { event: 'room_host_sync' },
          (msg: { payload?: Record<string, unknown> }) => {
            const p = msg?.payload;
            if (!p) return;
            const hasHost = 'host_badge_id' in p;
            const hasImp = 'impostor_count' in p;
            if (!hasHost && !hasImp) return;
            setRoom((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                ...(hasHost
                  ? {
                      host_badge_id:
                        typeof p.host_badge_id === 'string' && p.host_badge_id.trim()
                          ? normalizeBadgeId(p.host_badge_id)
                          : null,
                    }
                  : {}),
                ...(hasImp
                  ? { impostor_count: clampImpostorCount(p.impostor_count) }
                  : {}),
              };
            });
          }
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
              pushInsightEvent('ROOM_DELETED', `Room ${roomCode} removed`);
              return;
            }
            if (payload.new) {
              const detectedMode = detectTimestampModeFromRaw(payload.new);
              if (detectedMode) {
                roomTimestampModeRef.current = detectedMode;
              }
              const nextRoom = normalizeRoomRow(payload.new);
              if (!nextRoom) return;
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
                  reconcilePublicPlayers(
                    roomCode,
                    data as PublicPlayerRow[],
                    'realtime'
                  );
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
            if (row?.badge_id) {
              setDevAllRoles((prev) => ({
                ...prev,
                [row.badge_id]: row,
              }));
            }
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
      roomChannelRef.current = channel;
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
        .select('room_code, task_progress, status, winner, impostor_count, host_badge_id')
        .eq('room_code', roomCode)
        .maybeSingle()
        .then(({ data, error }) => {
          if (disposed) return;
          if (error) {
            if (isMissingOptionalColumnError(error)) {
              void client
                .from('rooms')
                .select('room_code, task_progress, status, winner, impostor_count')
                .eq('room_code', roomCode)
                .maybeSingle()
                .then(({ data: fallbackData }) => {
                  if (disposed || !fallbackData) return;
                  setRealtimeLatencyMs(
                    Math.max(1, Math.round(performance.now() - t0))
                  );
                  setRoom((prev) =>
                    prev
                      ? {
                          ...prev,
                          task_progress:
                            typeof fallbackData.task_progress === 'number'
                              ? fallbackData.task_progress
                              : prev.task_progress,
                          impostor_count: clampImpostorCount(
                            fallbackData.impostor_count ?? prev.impostor_count
                          ),
                          status:
                            (fallbackData.status as CampusRoomStatus) || prev.status,
                          winner:
                            (fallbackData.winner as CampusWinner) ?? prev.winner,
                        }
                      : prev
                  );
                });
              return;
            }
            logSupabaseTableError('rooms', 'heartbeatSelect', error);
            setRealtimeLatencyMs(null);
            if (!retryPending) {
              scheduleReconnect();
            }
          } else {
            setRealtimeLatencyMs(Math.max(1, Math.round(performance.now() - t0)));
            if (data && typeof data.task_progress === 'number') {
              const nextHost =
                typeof data.host_badge_id === 'string' && data.host_badge_id.trim()
                  ? normalizeBadgeId(data.host_badge_id)
                  : null;
              const nextImp = clampImpostorCount(data.impostor_count);
              setRoom((prev) => {
                if (!prev) return prev;
                if (
                  prev.task_progress === data.task_progress &&
                  prev.status === data.status &&
                  prev.winner === data.winner &&
                  prev.impostor_count === nextImp &&
                  prev.host_badge_id === nextHost
                ) {
                  return prev;
                }
                return {
                  ...prev,
                  task_progress: data.task_progress,
                  impostor_count: nextImp,
                  host_badge_id: nextHost,
                  status: (data.status as CampusRoomStatus) || prev.status,
                  winner: (data.winner as CampusWinner) ?? prev.winner,
                };
              });
            }
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
    reconcilePublicPlayers,
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
      getOrCreateMatchQrToken(roomCode);

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
        setRoom((prev) => {
          if (prev && prev.room_code === roomCode) {
            return prev.host_badge_id
              ? prev
              : { ...prev, host_badge_id: badgeId };
          }
          return createInitialRoom(roomCode, badgeId, 1);
        });
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
        // 1. Ensure room row exists (assigning first joiner as host_badge_id if brand new)
        let { error: roomError } = await supabase.from('rooms').upsert(
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
            host_badge_id: badgeId,
          },
          { onConflict: 'room_code', ignoreDuplicates: true }
        );
        if (roomError && isMissingOptionalColumnError(roomError)) {
          const fallbackRes = await supabase.from('rooms').upsert(
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
          roomError = fallbackRes.error;
        }
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

        // 4. Atomically claim host_badge_id ONLY if the room currently has no assigned host
        //    (preserves any Developer pre-assigned host_badge_id!)
        const { error: autoHostErr } = await supabase
          .from('rooms')
          .update({ host_badge_id: badgeId })
          .eq('room_code', roomCode)
          .is('host_badge_id', null);
        if (autoHostErr && !isMissingOptionalColumnError(autoHostErr)) {
          logSupabaseTableError('rooms', 'autoClaimHost', autoHostErr);
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

  const assignHost = useCallback(
    async (
      rawRoomCode: string,
      targetBadgeId: string | null
    ): Promise<{ ok: boolean; message?: string }> => {
      const roomCode = normalizeRoomCode(
        rawRoomCode || identity?.roomCode || room?.room_code || 'SVCE'
      );
      const nextHost = targetBadgeId ? normalizeBadgeId(targetBadgeId) : null;

      setRoom((prev) =>
        prev && prev.room_code === roomCode
          ? { ...prev, host_badge_id: nextHost }
          : prev
      );
      broadcastHostSettings({ host_badge_id: nextHost });

      if (!useRemoteSupabase || !supabase) {
        pushInsightEvent(
          'HOST_TRANSFERRED',
          nextHost
            ? `Assigned ${nextHost} as Host of ${roomCode}`
            : `Cleared designated Host in ${roomCode} (Auto-assign first joiner)`
        );
        return { ok: true };
      }

      const { error } = await supabase
        .from('rooms')
        .update({ host_badge_id: nextHost })
        .eq('room_code', roomCode);

      if (error) {
        if (isMissingOptionalColumnError(error)) {
          pushInsightEvent(
            'HOST_SCHEMA_NOTICE',
            'Run updated Supabase SQL schema to persist rooms.host_badge_id (synced via Realtime broadcast for this session).'
          );
          return {
            ok: true,
            message:
              'Host synced live via Realtime. Run the updated SQL migration to persist host_badge_id in Supabase.',
          };
        }
        const msg = logSupabaseTableError('rooms', 'assignHost', error);
        setSyncError(msg);
        return { ok: false, message: msg };
      }

      pushInsightEvent(
        'HOST_TRANSFERRED',
        nextHost
          ? `Assigned ${nextHost} as Host of ${roomCode}`
          : `Cleared designated Host in ${roomCode}`
      );
      return { ok: true };
    },
    [
      identity?.roomCode,
      room?.room_code,
      useRemoteSupabase,
      broadcastHostSettings,
      pushInsightEvent,
    ]
  );

  const verifyHostPrivileges = useCallback(
    async (
      roomCode: string,
      isDeveloperOverride?: boolean
    ): Promise<{ ok: boolean; reason?: string }> => {
      if (isDeveloperOverride) return { ok: true };

      const myBadge = identityRef.current?.badgeId;
      const mySecret = identityRef.current?.wristbandSecret;
      if (!myBadge || !mySecret) {
        return {
          ok: false,
          reason: 'Only the designated Room Host can perform this action.',
        };
      }

      const normalizedMyBadge = normalizeBadgeId(myBadge);

      if (!useRemoteSupabase || !supabase) {
        const expectedHost = room?.host_badge_id
          ? normalizeBadgeId(room.host_badge_id)
          : null;
        if (!expectedHost || expectedHost !== normalizedMyBadge) {
          return {
            ok: false,
            reason:
              'Only the designated Room Host can modify settings or launch the match.',
          };
        }
        if (
          privateRole?.wristband_secret &&
          privateRole.wristband_secret !== mySecret
        ) {
          return {
            ok: false,
            reason: 'Host ID Card secret verification failed.',
          };
        }
        return { ok: true };
      }

      const [roomCheckRes, roleCheckRes] = await Promise.all([
        supabase
          .from('rooms')
          .select('host_badge_id')
          .eq('room_code', roomCode)
          .maybeSingle(),
        supabase
          .from('private_roles')
          .select('wristband_secret')
          .eq('room_code', roomCode)
          .eq('badge_id', normalizedMyBadge)
          .maybeSingle(),
      ]);

      let authoritativeHost = room?.host_badge_id
        ? normalizeBadgeId(room.host_badge_id)
        : null;
      if (!roomCheckRes.error && roomCheckRes.data) {
        const raw = (roomCheckRes.data as { host_badge_id?: string | null })
          .host_badge_id;
        authoritativeHost =
          typeof raw === 'string' && raw.trim() ? normalizeBadgeId(raw) : null;
      }

      if (!authoritativeHost || authoritativeHost !== normalizedMyBadge) {
        return {
          ok: false,
          reason:
            'Only the designated Room Host can control match settings or launch.',
        };
      }

      if (!roleCheckRes.error && roleCheckRes.data) {
        const dbSecret = (roleCheckRes.data as { wristband_secret?: string })
          .wristband_secret;
        if (dbSecret && dbSecret !== mySecret) {
          return {
            ok: false,
            reason:
              'Host wristband_secret verification failed. Re-scan your Host ID Card QR.',
          };
        }
      }

      return { ok: true };
    },
    [room?.host_badge_id, privateRole?.wristband_secret, useRemoteSupabase]
  );

  const setImpostorCount = useCallback(
    async (
      count: 1 | 2 | 3,
      options?: { isDeveloperOverride?: boolean }
    ): Promise<{ ok: boolean; reason?: string }> => {
      const roomCode = normalizeRoomCode(
        identity?.roomCode || room?.room_code || ''
      );
      if (!roomCode) return { ok: false, reason: 'No active room.' };
      const clamped = clampImpostorCount(count);

      const auth = await verifyHostPrivileges(
        roomCode,
        options?.isDeveloperOverride
      );
      if (!auth.ok) {
        return { ok: false, reason: auth.reason };
      }

      setRoom((prev) =>
        prev ? { ...prev, impostor_count: clamped } : prev
      );
      broadcastHostSettings({ impostor_count: clamped });

      if (!useRemoteSupabase || !supabase) {
        return { ok: true };
      }

      const { error } = await supabase
        .from('rooms')
        .update({ impostor_count: clamped })
        .eq('room_code', roomCode);
      if (error) {
        const msg = logSupabaseTableError('rooms', 'setImpostorCount', error);
        return { ok: false, reason: msg };
      }
      return { ok: true };
    },
    [
      identity?.roomCode,
      room?.room_code,
      useRemoteSupabase,
      verifyHostPrivileges,
      broadcastHostSettings,
    ]
  );

  const startMatch = useCallback(
    async (
      rawRoomCode: string,
      impostorCount: number,
      options?: { isDeveloperOverride?: boolean }
    ): Promise<void> => {
      const roomCode = normalizeRoomCode(rawRoomCode);

      const auth = await verifyHostPrivileges(
        roomCode,
        options?.isDeveloperOverride
      );
      if (!auth.ok) {
        throw new Error(
          auth.reason || 'Only the designated Room Host can launch the match.'
        );
      }

      if (!useRemoteSupabase || !supabase) {
        const badges = publicPlayers.map((p) => p.badge_id);
        if (badges.length === 0) return;
        const maxImp = badges.length > 1 ? badges.length - 1 : 1;
        const targetImp = Math.min(Math.max(1, impostorCount), Math.min(3, maxImp));
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
        setDevAllRoles(nextRoles);
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
        Math.min(3, maxImpostors)
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
      verifyHostPrivileges,
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

        // Optimistically update local room state + broadcast immediately for sub-second global bar updates
        setRoom((prev) =>
          prev
            ? {
                ...prev,
                task_progress: nextProgress,
                ...(nextProgress >= 100
                  ? {
                      status: 'ENDED',
                      winner: 'CREWMATES',
                      active_sabotage: null,
                      sabotage_ends_at: null,
                    }
                  : {}),
              }
            : prev
        );
        broadcastTaskProgress(nextProgress);

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
      broadcastTaskProgress,
    ]
  );

  const eliminatePlayer = useCallback(
    async (
      rawVictimBadgeId: string
    ): Promise<{ ok: boolean; reason?: string; cooldownSeconds?: number }> => {
      const currentIdentity = identityRef.current || identity;
      if (!currentIdentity?.roomCode || !currentIdentity?.badgeId || !privateRole) {
        return {
          ok: false,
          reason: 'Not connected to an active match room.',
        };
      }
      if (privateRole.role !== 'IMPOSTOR') {
        return {
          ok: false,
          reason: 'Only an Impostor can eliminate another player.',
        };
      }
      if (room?.status === 'MEETING') {
        return {
          ok: false,
          reason:
            'Eliminations are locked during an Emergency Meeting or Body Report.',
        };
      }
      if (room?.status !== 'PLAYING') {
        return {
          ok: false,
          reason: 'Eliminations are only allowed while a match is in progress.',
        };
      }
      if (Date.now() < killCooldownEnd) {
        const secs = Math.max(1, Math.ceil((killCooldownEnd - Date.now()) / 1000));
        return {
          ok: false,
          cooldownSeconds: secs,
          reason: `Kill cooldown active — wait ${secs}s before eliminating another player.`,
        };
      }

      const victimBadgeId = normalizeBadgeId(rawVictimBadgeId);
      const impostorSet = new Set<string>([
        currentIdentity.badgeId,
        ...(privateRole.fellow_impostors || []),
      ]);
      if (impostorSet.has(victimBadgeId)) {
        return {
          ok: false,
          reason:
            victimBadgeId === currentIdentity.badgeId
              ? 'You cannot eliminate yourself.'
              : 'You cannot eliminate a fellow Impostor.',
        };
      }

      const attacker = publicPlayers.find(
        (p) => p.badge_id === currentIdentity.badgeId
      );
      const victim = publicPlayers.find((p) => p.badge_id === victimBadgeId);
      if (!attacker?.is_alive) {
        return {
          ok: false,
          reason: 'Eliminated operatives cannot eliminate players.',
        };
      }
      if (!victim) {
        return {
          ok: false,
          reason: `ID Card #${badgeIdToNumber(victimBadgeId)} is not in this room.`,
        };
      }
      if (!victim.is_alive) {
        return {
          ok: false,
          reason: `${victim.name} (#${badgeIdToNumber(victimBadgeId)}) is already eliminated.`,
        };
      }

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
        appendImpostorOpsLog({
          roomCode: currentIdentity.roomCode,
          kind: 'KILL',
          timestamp: Date.now(),
          victimBadgeId,
          victimBadgeNumber: badgeIdToNumber(victimBadgeId),
          victimName: victim.name,
          actorSource: 'YOU',
        });
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
        return { ok: true };
      }

      const { error: killError } = await supabase
        .from('public_players')
        .update({ is_alive: false })
        .eq('room_code', currentIdentity.roomCode)
        .eq('badge_id', victimBadgeId);

      if (killError) {
        const msg = logSupabaseTableError(
          'public_players',
          'eliminateUpdate',
          killError
        );
        setSyncError(msg);
        return { ok: false, reason: `Elimination failed: ${msg}` };
      }

      // Log successful elimination immediately with exact timestamp & victim badge ID
      appendImpostorOpsLog({
        roomCode: currentIdentity.roomCode,
        kind: 'KILL',
        timestamp: Date.now(),
        victimBadgeId,
        victimBadgeNumber: badgeIdToNumber(victimBadgeId),
        victimName: victim.name,
        actorSource: 'YOU',
      });

      // Optimistic local roster update so Impostor UI updates immediately
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
        const { error: winError } = await supabase
          .from('rooms')
          .update({
            status: 'ENDED',
            winner: 'IMPOSTORS',
            active_sabotage: null,
            sabotage_ends_at: null,
          })
          .eq('room_code', currentIdentity.roomCode);
        if (winError) {
          logSupabaseTableError('rooms', 'eliminateWinUpdate', winError);
        }
      }

      setKillCooldownEnd(Date.now() + KILL_COOLDOWN_MS);
      return { ok: true };
    },
    [
      identity,
      privateRole,
      killCooldownEnd,
      room?.status,
      publicPlayers,
      useRemoteSupabase,
    ]
  );

  const triggerSabotage = useCallback(
    async (
      sabotageType: 'REACTOR' | 'COMMS' = 'REACTOR',
      options?: { force?: boolean; roomCodeOverride?: string }
    ): Promise<{ ok: boolean; message?: string }> => {
      const activeRoomCode = normalizeRoomCode(
        options?.roomCodeOverride ||
          identityRef.current?.roomCode ||
          identity?.roomCode ||
          room?.room_code ||
          ''
      );
      if (!activeRoomCode) {
        return {
          ok: false,
          message: 'Join or create a lobby before triggering sabotage.',
        };
      }

      const isForced = Boolean(options?.force);

      if (!isForced) {
        if (room?.status !== 'PLAYING') {
          return {
            ok: false,
            message: 'Sabotage can only be triggered during an active match.',
          };
        }
        const reactorStillRunning =
          room?.active_sabotage === 'REACTOR' &&
          (!room.sabotage_ends_at || room.sabotage_ends_at > Date.now());
        const commsActive = room?.active_sabotage === 'COMMS';
        if (reactorStillRunning || commsActive) {
          return {
            ok: false,
            message:
              'A sabotage is already active! Wait or defuse it before triggering another.',
          };
        }
      }

      const sabotageEndsAt =
        sabotageType === 'REACTOR' ? Date.now() + REACTOR_SABOTAGE_MS : null;
      if (sabotageType === 'REACTOR') {
        sabotageActivatedAtRef.current = Date.now();
      }

      // Optimistic local state update so HUD displays sabotage immediately
      setRoom((prev) => {
        const base =
          prev && prev.room_code === activeRoomCode
            ? prev
            : createInitialRoom(activeRoomCode);
        return {
          ...base,
          status: isForced ? 'PLAYING' : base.status,
          winner: isForced ? null : base.winner,
          active_sabotage: sabotageType,
          sabotage_ends_at: sabotageEndsAt,
          meeting_ends_at: isForced ? null : base.meeting_ends_at,
          ejection_result: isForced ? null : base.ejection_result,
        };
      });

      if (!useRemoteSupabase || !supabase) {
        pushInsightEvent(
          'SABOTAGE_TRIGGERED',
          `${sabotageType} sabotage active in ${activeRoomCode} (Local)`
        );
        return {
          ok: true,
          message:
            sabotageType === 'REACTOR'
              ? 'Reactor Meltdown triggered (2:00 countdown to defuse)!'
              : 'Comms Jammed — Crewmate task locations scrambled!',
        };
      }

      const client = supabase;
      if (isForced) {
        const { error: upsertErr } = await executeRoomTimestampWrite((mode) =>
          client.from('rooms').upsert(
            {
              room_code: activeRoomCode,
              status: 'PLAYING',
              winner: null,
              active_sabotage: sabotageType,
              sabotage_ends_at: formatRoomTimestamp(sabotageEndsAt, mode),
              meeting_ends_at: null,
              ejection_result: null,
            },
            { onConflict: 'room_code' }
          )
        );
        if (upsertErr) {
          const msg = logSupabaseTableError(
            'rooms',
            'triggerSabotageForceUpsert',
            upsertErr
          );
          setSyncError(msg);
          return { ok: false, message: `Sabotage sync error: ${msg}` };
        }
      } else {
        const { error } = await executeRoomTimestampWrite((mode) =>
          client
            .from('rooms')
            .update({
              active_sabotage: sabotageType,
              sabotage_ends_at: formatRoomTimestamp(sabotageEndsAt, mode),
            })
            .eq('room_code', activeRoomCode)
            .eq('status', 'PLAYING')
        );
        if (error) {
          const msg = logSupabaseTableError('rooms', 'triggerSabotage', error);
          setSyncError(msg);
          return { ok: false, message: `Sabotage failed: ${msg}` };
        }
      }

      pushInsightEvent(
        'SABOTAGE_TRIGGERED',
        `${sabotageType} sabotage triggered in ${activeRoomCode}`
      );
      return {
        ok: true,
        message:
          sabotageType === 'REACTOR'
            ? 'Reactor Meltdown triggered (2:00 countdown to defuse)!'
            : 'Comms Jammed — Crewmate task locations scrambled!',
      };
    },
    [
      identity?.roomCode,
      room?.room_code,
      room?.status,
      room?.active_sabotage,
      room?.sabotage_ends_at,
      useRemoteSupabase,
      pushInsightEvent,
      executeRoomTimestampWrite,
    ]
  );

  const clearSabotage = useCallback(
    async (scannedStationId?: string): Promise<void> => {
      const activeRoomCode = normalizeRoomCode(
        identityRef.current?.roomCode ||
          identity?.roomCode ||
          room?.room_code ||
          ''
      );
      if (!activeRoomCode || !room?.active_sabotage) return;

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

      // Optimistically clear sabotage locally so UI responds immediately on mobile
      setRoom((prev) =>
        prev
          ? { ...prev, active_sabotage: null, sabotage_ends_at: null }
          : prev
      );

      if (!useRemoteSupabase || !supabase) {
        return;
      }

      const { error } = await supabase
        .from('rooms')
        .update({
          active_sabotage: null,
          sabotage_ends_at: null,
        })
        .eq('room_code', activeRoomCode);
      if (error) {
        logSupabaseTableError('rooms', 'clearSabotage', error);
      }
    },
    [identity?.roomCode, room?.room_code, room?.active_sabotage, useRemoteSupabase]
  );

  // Automatic Reactor Meltdown expiry check (with clock-skew / fresh-trigger protection)
  useEffect(() => {
    if (
      !identity?.roomCode ||
      room?.status !== 'PLAYING' ||
      room?.active_sabotage !== 'REACTOR' ||
      !room?.sabotage_ends_at
    ) {
      return;
    }

    const nowMs = Date.now();
    const rawRemainingMs = room.sabotage_ends_at - nowMs;
    const elapsedSinceActivated =
      sabotageActivatedAtRef.current > 0
        ? nowMs - sabotageActivatedAtRef.current
        : Infinity;

    // Guard against clock skew or stale timestamp echoes immediately triggering Impostor Victory
    let safeRemainingMs = Math.max(0, rawRemainingMs);
    if (elapsedSinceActivated < 6_000 && safeRemainingMs < 15_000) {
      safeRemainingMs = Math.max(
        REACTOR_SABOTAGE_MS - elapsedSinceActivated,
        15_000
      );
    } else if (rawRemainingMs < -30_000 && elapsedSinceActivated < REACTOR_SABOTAGE_MS) {
      safeRemainingMs = Math.max(
        REACTOR_SABOTAGE_MS - elapsedSinceActivated,
        15_000
      );
    }

    const timer = setTimeout(() => {
      if (
        roomStatusRef.current !== 'PLAYING' ||
        activeSabotageRef.current !== 'REACTOR'
      ) {
        return;
      }

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
    }, safeRemainingMs);

    return () => clearTimeout(timer);
  }, [
    identity?.roomCode,
    room?.status,
    room?.active_sabotage,
    room?.sabotage_ends_at,
    useRemoteSupabase,
  ]);

  const callMeeting = useCallback(
    async (
      rawBodyBadgeId: string | null = null,
      options?: { roomCodeOverride?: string; badgeIdOverride?: string }
    ): Promise<{ ok: boolean; message?: string }> => {
      const currentIdentity = identityRef.current || identity;
      const roomCode = normalizeRoomCode(
        options?.roomCodeOverride ||
          currentIdentity?.roomCode ||
          room?.room_code ||
          ''
      );
      const callerBadgeId = normalizeBadgeId(
        options?.badgeIdOverride || currentIdentity?.badgeId || 'P01'
      );

      if (!roomCode) {
        return {
          ok: false,
          message: 'Join a lobby before calling an emergency meeting.',
        };
      }

      const normalizedBody = rawBodyBadgeId
        ? normalizeBadgeId(rawBodyBadgeId)
        : null;
      const meetingEndsAt = Date.now() + MEETING_DURATION_MS;

      // Immediately update local UI state so mobile clients never stall waiting on Realtime
      localFallbackVotesRef.current = {};
      setVotes({});
      setPublicPlayers((prev) =>
        prev.map((p) => ({ ...p, has_voted: false }))
      );
      setRoom((prev) => {
        const base =
          prev && prev.room_code === roomCode
            ? prev
            : createInitialRoom(roomCode);
        return {
          ...base,
          status: 'MEETING',
          active_sabotage: null,
          sabotage_ends_at: null,
          ejection_result: null,
          meeting_ends_at: meetingEndsAt,
          meeting_caller_badge_id: callerBadgeId,
          meeting_body_badge_id: normalizedBody,
        };
      });

      if (!useRemoteSupabase || !supabase) {
        pushInsightEvent(
          'MEETING_CALLED',
          normalizedBody
            ? `Body #${badgeIdToNumber(normalizedBody)} reported in ${roomCode}`
            : `Emergency meeting called by ${callerBadgeId} in ${roomCode}`
        );
        return {
          ok: true,
          message: normalizedBody
            ? `Dead Body #${badgeIdToNumber(normalizedBody)} Reported — Emergency Meeting Started!`
            : 'Emergency Meeting Called — Gather at Main Lobby!',
        };
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

      const client = supabase;
      let roomMeetingErr = (
        await executeRoomTimestampWrite((mode) =>
          client.from('rooms').upsert(
            {
              room_code: roomCode,
              status: 'MEETING' as const,
              active_sabotage: null,
              sabotage_ends_at: null,
              ejection_result: null,
              meeting_ends_at: formatRoomTimestamp(meetingEndsAt, mode),
              meeting_caller_badge_id: callerBadgeId,
              meeting_body_badge_id: normalizedBody,
            },
            { onConflict: 'room_code' }
          )
        )
      ).error;

      // Fallback if an older Supabase rooms table lacks optional caller/body columns
      if (roomMeetingErr && isMissingOptionalColumnError(roomMeetingErr)) {
        const retryRes = await executeRoomTimestampWrite((mode) =>
          client.from('rooms').upsert(
            {
              room_code: roomCode,
              status: 'MEETING',
              active_sabotage: null,
              sabotage_ends_at: null,
              ejection_result: null,
              meeting_ends_at: formatRoomTimestamp(meetingEndsAt, mode),
            },
            { onConflict: 'room_code' }
          )
        );
        roomMeetingErr = retryRes.error;
      }

      if (roomMeetingErr) {
        const msg = logSupabaseTableError(
          'rooms',
          'callMeetingUpdate',
          roomMeetingErr
        );
        setSyncError(msg);
        return {
          ok: false,
          message: `Meeting opened locally, but Supabase sync failed: ${msg}`,
        };
      }

      pushInsightEvent(
        'MEETING_CALLED',
        normalizedBody
          ? `Body #${badgeIdToNumber(normalizedBody)} reported in ${roomCode}`
          : `Emergency meeting called by ${callerBadgeId} in ${roomCode}`
      );
      return {
        ok: true,
        message: normalizedBody
          ? `Dead Body #${badgeIdToNumber(normalizedBody)} Reported — Assemble at Main Lobby (1m 30s)!`
          : 'Emergency Meeting Called — Assemble at Main Lobby (1m 30s)!',
      };
    },
    [
      identity,
      room?.room_code,
      useRemoteSupabase,
      pushInsightEvent,
      executeRoomTimestampWrite,
    ]
  );

  const extendMeetingTime = useCallback(
    async (extraMs = 60_000): Promise<{ ok: boolean; message?: string }> => {
      const activeRoomCode = normalizeRoomCode(
        identityRef.current?.roomCode ||
          identity?.roomCode ||
          room?.room_code ||
          ''
      );
      if (!activeRoomCode) {
        return { ok: false, message: 'No active meeting room found.' };
      }

      const baseTime = Math.max(Date.now(), room?.meeting_ends_at || Date.now());
      const nextEndsAt = baseTime + extraMs;

      setRoom((prev) =>
        prev
          ? {
              ...prev,
              meeting_ends_at: nextEndsAt,
            }
          : prev
      );

      const addedSecs = Math.round(extraMs / 1000);
      if (!useRemoteSupabase || !supabase) {
        return {
          ok: true,
          message: `Added +${addedSecs}s to meeting timer.`,
        };
      }

      const client = supabase;
      const { error } = await executeRoomTimestampWrite((mode) =>
        client
          .from('rooms')
          .update({
            meeting_ends_at: formatRoomTimestamp(nextEndsAt, mode),
          })
          .eq('room_code', activeRoomCode)
      );
      if (error) {
        const msg = logSupabaseTableError('rooms', 'extendMeetingTime', error);
        setSyncError(msg);
        return { ok: false, message: `Unable to sync extra time: ${msg}` };
      }

      return {
        ok: true,
        message: `Added +${addedSecs}s for everyone to assemble & discuss.`,
      };
    },
    [
      identity?.roomCode,
      room?.room_code,
      room?.meeting_ends_at,
      useRemoteSupabase,
      executeRoomTimestampWrite,
    ]
  );

  const beginDiscussionPhase = useCallback(async (): Promise<{
    ok: boolean;
    message?: string;
  }> => {
    const activeRoomCode = normalizeRoomCode(
      identityRef.current?.roomCode ||
        identity?.roomCode ||
        room?.room_code ||
        ''
    );
    if (!activeRoomCode) {
      return { ok: false, message: 'No active meeting room found.' };
    }

    const nextEndsAt = Date.now() + MEETING_DISCUSSION_MS;
    setRoom((prev) =>
      prev
        ? {
            ...prev,
            meeting_ends_at: nextEndsAt,
          }
        : prev
    );

    if (!useRemoteSupabase || !supabase) {
      return {
        ok: true,
        message: 'Everyone assembled — Discussion & Voting unlocked (2:00)!',
      };
    }

    const client = supabase;
    const { error } = await executeRoomTimestampWrite((mode) =>
      client
        .from('rooms')
        .update({
          meeting_ends_at: formatRoomTimestamp(nextEndsAt, mode),
        })
        .eq('room_code', activeRoomCode)
    );
    if (error) {
      const msg = logSupabaseTableError('rooms', 'beginDiscussionPhase', error);
      setSyncError(msg);
      return {
        ok: false,
        message: `Voting unlocked locally, but sync failed: ${msg}`,
      };
    }

    return {
      ok: true,
      message: 'Everyone assembled — Discussion & Voting unlocked (2:00)!',
    };
  }, [
    identity?.roomCode,
    room?.room_code,
    useRemoteSupabase,
    executeRoomTimestampWrite,
  ]);

  const castVote = useCallback(
    async (rawTargetBadgeId: string | 'SKIP'): Promise<void> => {
      const currentIdentity = identityRef.current || identity;
      if (!currentIdentity?.roomCode || !currentIdentity?.badgeId || !room) {
        return;
      }
      if (room.status !== 'MEETING' || room.ejection_result) return;

      const me = publicPlayers.find(
        (p) => p.badge_id === currentIdentity.badgeId
      );
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

      // Immediate optimistic update so mobile clients lock votes without Realtime lag
      localFallbackVotesRef.current = {
        ...localFallbackVotesRef.current,
        [currentIdentity.badgeId]: targetBadgeId,
      };
      setVotes((prev) => ({
        ...prev,
        [currentIdentity.badgeId]: targetBadgeId,
      }));
      setPublicPlayers((prev) =>
        prev.map((p) =>
          p.badge_id === currentIdentity.badgeId
            ? { ...p, has_voted: true }
            : p
        )
      );

      if (!useRemoteSupabase || !supabase) {
        return;
      }

      const { error: voteErr } = await supabase.from('votes').upsert(
        {
          room_code: currentIdentity.roomCode,
          voter_badge_id: currentIdentity.badgeId,
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
        .eq('room_code', currentIdentity.roomCode)
        .eq('badge_id', currentIdentity.badgeId);
      if (votedFlagErr) {
        logSupabaseTableError(
          'public_players',
          'castVoteMarkVoted',
          votedFlagErr
        );
      }
    },
    [identity, room, publicPlayers, useRemoteSupabase]
  );

  const finalizeMeeting = useCallback(async (): Promise<{
    ok: boolean;
    message?: string;
  }> => {
    const activeRoomCode = normalizeRoomCode(
      identityRef.current?.roomCode ||
        identity?.roomCode ||
        room?.room_code ||
        ''
    );
    if (!activeRoomCode) {
      return { ok: false, message: 'Not connected to an active meeting room.' };
    }
    if (finalizingMeetingRef.current) {
      return { ok: true };
    }
    finalizingMeetingRef.current = true;
    const roomCode = activeRoomCode;

    try {
      let voteEntries: Pick<VoteRow, 'voter_badge_id' | 'target_badge_id'>[] =
        Object.entries(votes).map(([voter_badge_id, target_badge_id]) => ({
          voter_badge_id,
          target_badge_id,
        }));
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
        if (latestRoom?.ejection_result) {
          setRoom((prev) =>
            prev
              ? { ...prev, ejection_result: latestRoom.ejection_result }
              : prev
          );
          return { ok: true };
        }

        const remoteVotes = (votesRes.data || []) as Pick<
          VoteRow,
          'voter_badge_id' | 'target_badge_id'
        >[];
        if (remoteVotes.length > 0) {
          voteEntries = remoteVotes;
        }
        const remotePlayers = (playersRes.data || []) as PublicPlayerRow[];
        if (remotePlayers.length > 0) {
          playersSnapshot = remotePlayers;
        }
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

      // Optimistic local state update so Tally & Ejection Reveal always appear immediately
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
              status: 'MEETING',
              ejection_result: ejectionResult,
              meeting_ends_at: revealEndsAt,
            }
          : prev
      );

      if (!useRemoteSupabase || !supabase) {
        return { ok: true, message: ejectionResult };
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

      const client = supabase;
      const { error: finalizeRoomErr } = await executeRoomTimestampWrite(
        (mode) =>
          client.from('rooms').upsert(
            {
              room_code: roomCode,
              status: 'MEETING',
              ejection_result: ejectionResult,
              meeting_ends_at: formatRoomTimestamp(revealEndsAt, mode),
            },
            { onConflict: 'room_code' }
          )
      );
      if (finalizeRoomErr) {
        const msg = logSupabaseTableError(
          'rooms',
          'finalizeMeetingUpdate',
          finalizeRoomErr
        );
        setSyncError(msg);
        return {
          ok: false,
          message: `Votes tallied locally, but Supabase sync failed: ${msg}`,
        };
      }

      return { ok: true, message: ejectionResult };
    } finally {
      finalizingMeetingRef.current = false;
    }
  }, [
    identity?.roomCode,
    room?.room_code,
    publicPlayers,
    votes,
    useRemoteSupabase,
    executeRoomTimestampWrite,
  ]);

  const dismissEjection = useCallback(async (): Promise<void> => {
    const activeRoomCode = normalizeRoomCode(
      identityRef.current?.roomCode ||
        identity?.roomCode ||
        room?.room_code ||
        ''
    );
    if (!activeRoomCode || dismissingEjectionRef.current) return;
    dismissingEjectionRef.current = true;
    const roomCode = activeRoomCode;

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

        localFallbackVotesRef.current = {};
        setVotes({});
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

      // Optimistic local state resume so mobile exits the ejection screen instantaneously
      localFallbackVotesRef.current = {};
      setVotes({});
      setPublicPlayers((prev) =>
        prev.map((p) => ({ ...p, has_voted: false }))
      );
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              status: nextWinner ? 'ENDED' : 'PLAYING',
              winner: nextWinner,
              meeting_ends_at: null,
              ejection_result: null,
              meeting_caller_badge_id: null,
              meeting_body_badge_id: null,
            }
          : prev
      );
      if (!nextWinner) {
        setKillCooldownEnd(Date.now() + POST_MEETING_COOLDOWN_MS);
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
          .eq('room_code', roomCode),
      ]);
      if (resetFlagsRes.error) {
        logSupabaseTableError(
          'public_players',
          'dismissEjectionReset',
          resetFlagsRes.error
        );
      }
      if (resumeRoomRes.error) {
        if (isMissingOptionalColumnError(resumeRoomRes.error)) {
          const fallbackRes = await supabase
            .from('rooms')
            .update({
              status: nextWinner ? 'ENDED' : 'PLAYING',
              winner: nextWinner,
              meeting_ends_at: null,
              ejection_result: null,
            })
            .eq('room_code', roomCode);
          if (fallbackRes.error) {
            logSupabaseTableError(
              'rooms',
              'dismissEjectionUpdateFallback',
              fallbackRes.error
            );
          }
        } else {
          logSupabaseTableError(
            'rooms',
            'dismissEjectionUpdate',
            resumeRoomRes.error
          );
        }
      }
    } finally {
      dismissingEjectionRef.current = false;
    }
  }, [identity?.roomCode, room?.room_code, publicPlayers, useRemoteSupabase]);

  const resetRoom = useCallback(async (): Promise<void> => {
    if (!identity?.roomCode) return;
    const roomCode = identity.roomCode;
    rotateMatchQrToken(roomCode);

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
      livingPlayers.length > 0 &&
      livingPlayers.every((p) => p.has_voted && Boolean(votes[p.badge_id]));

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
    votes,
    finalizeMeeting,
  ]);

  // Auto-resume PLAYING after full 16-second Ejection Reveal (with clock-skew protection)
  useEffect(() => {
    if (
      !identity?.roomCode ||
      room?.status !== 'MEETING' ||
      !room?.ejection_result
    ) {
      return;
    }

    const nowMs = Date.now();
    if (!ejectionShownAtRef.current) {
      ejectionShownAtRef.current = nowMs;
    }
    const elapsedSinceShown = Math.max(0, nowMs - ejectionShownAtRef.current);
    const localMinRemaining = Math.max(0, EJECTION_REVEAL_MS - elapsedSinceShown);
    const serverRemaining = room.meeting_ends_at
      ? Math.max(0, room.meeting_ends_at - nowMs)
      : localMinRemaining;

    // Never close immediately due to cross-device clock skew; honor at least the local reveal window
    const safeRemainingMs = Math.max(localMinRemaining, Math.min(serverRemaining, EJECTION_REVEAL_MS + 4_000));

    const timer = setTimeout(() => {
      void dismissEjection();
    }, safeRemainingMs);

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
      privateRole?.role !== 'IMPOSTOR' ||
      publicPlayers.length < 3
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
    async (
      rawRoomCode: string,
      impostorCount: 1 | 2 | 3 = 1,
      designatedHostBadgeId: string | null = null
    ): Promise<string> => {
      const roomCode = normalizeRoomCode(rawRoomCode);
      const badgeId = identity?.badgeId || 'P01';
      const name = identity?.name || 'Host Dev';
      const wristbandSecret =
        identity?.wristbandSecret || getOrCreateWristbandSecret();
      const clampedImp = clampImpostorCount(impostorCount);
      const normalizedHost = designatedHostBadgeId
        ? normalizeBadgeId(designatedHostBadgeId)
        : null;

      trackLobbyCode(roomCode);
      rotateMatchQrToken(roomCode);

      if (!useRemoteSupabase || !supabase) {
        setRoom(createInitialRoom(roomCode, normalizedHost, clampedImp));
        setPublicPlayers([]);
        setPrivateRole(null);
        setVotes({});
        setIdentity({ roomCode, badgeId, name, wristbandSecret });
        pushInsightEvent(
          'LOBBY_CREATED',
          `Created local lobby ${roomCode} (Host: ${normalizedHost || 'Auto'}, Impostors: ${clampedImp})`
        );
        return roomCode;
      }

      let { error } = await supabase.from('rooms').upsert(
        {
          room_code: roomCode,
          status: 'LOBBY',
          winner: null,
          task_progress: 0,
          active_sabotage: null,
          sabotage_ends_at: null,
          meeting_ends_at: null,
          ejection_result: null,
          impostor_count: clampedImp,
          host_badge_id: normalizedHost,
          meeting_caller_badge_id: null,
          meeting_body_badge_id: null,
        },
        { onConflict: 'room_code' }
      );

      if (error && isMissingOptionalColumnError(error)) {
        const fallbackRes = await supabase.from('rooms').upsert(
          {
            room_code: roomCode,
            status: 'LOBBY',
            winner: null,
            task_progress: 0,
            active_sabotage: null,
            sabotage_ends_at: null,
            meeting_ends_at: null,
            ejection_result: null,
            impostor_count: clampedImp,
            meeting_caller_badge_id: null,
            meeting_body_badge_id: null,
          },
          { onConflict: 'room_code' }
        );
        error = fallbackRes.error;
      }

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

      prevPlayersSnapshotRef.current = { roomCode, players: [] };
      setPublicPlayers([]);
      setPrivateRole(null);
      setVotes({});
      setIdentity({ roomCode, badgeId, name, wristbandSecret });
      setRoom(createInitialRoom(roomCode, normalizedHost, clampedImp));
      pushInsightEvent(
        'LOBBY_CREATED',
        `Created Supabase lobby ${roomCode} (Host: ${normalizedHost || 'Auto'}, Impostors: ${clampedImp})`
      );
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
      prevPlayersSnapshotRef.current = { roomCode, players: [] };
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
        setRoom((prev) => {
          if (prev && prev.room_code === roomCode) {
            return prev.host_badge_id
              ? prev
              : { ...prev, host_badge_id: badgeId };
          }
          return createInitialRoom(roomCode, badgeId, 1);
        });
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

      // Auto-assign host if room has no host_badge_id yet (preserves pre-assigned host)
      const { error: claimHostErr } = await supabase
        .from('rooms')
        .update({ host_badge_id: badgeId })
        .eq('room_code', roomCode)
        .is('host_badge_id', null);
      if (claimHostErr && !isMissingOptionalColumnError(claimHostErr)) {
        logSupabaseTableError('rooms', 'addCandidateAutoHost', claimHostErr);
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
    const leavingIdentity = identity;
    const leavingRoomStatus = room?.status;

    localFallbackVotesRef.current = {};
    localFallbackRolesRef.current = {};
    prevPlayersSnapshotRef.current = { roomCode: '', players: [] };
    setIdentity(null);
    setRoom(null);
    setPublicPlayers([]);
    setPrivateRole(null);
    setDevAllRoles({});
    setVotes({});
    setGhostModeActive(false);
    setKillCooldownEnd(0);
    setSyncError(null);
    setIsRoomLoaded(false);
    setRosterNotification(null);

    if (leavingIdentity) {
      pushInsightEvent(
        'SELF_LEFT',
        `${leavingIdentity.name} (${leavingIdentity.badgeId}) exited ${leavingIdentity.roomCode}`
      );
    }

    if (useRemoteSupabase && supabase && leavingIdentity) {
      const client = supabase;
      const { roomCode, badgeId } = leavingIdentity;
      void (async () => {
        try {
          const [delVoteRes, delRoleRes, delPlayerRes] = await Promise.all([
            client
              .from('votes')
              .delete()
              .eq('room_code', roomCode)
              .eq('voter_badge_id', badgeId),
            client
              .from('private_roles')
              .delete()
              .eq('room_code', roomCode)
              .eq('badge_id', badgeId),
            client
              .from('public_players')
              .delete()
              .eq('room_code', roomCode)
              .eq('badge_id', badgeId),
          ]);

          if (delVoteRes.error) {
            logSupabaseTableError('votes', 'leaveRoomDelete', delVoteRes.error);
          }
          if (delRoleRes.error) {
            logSupabaseTableError(
              'private_roles',
              'leaveRoomDelete',
              delRoleRes.error
            );
          }
          if (delPlayerRes.error) {
            logSupabaseTableError(
              'public_players',
              'leaveRoomDelete',
              delPlayerRes.error
            );
          }

          if (
            leavingRoomStatus === 'PLAYING' ||
            leavingRoomStatus === 'MEETING'
          ) {
            const [remPlayersRes, remRolesRes] = await Promise.all([
              client
                .from('public_players')
                .select('badge_id, is_alive')
                .eq('room_code', roomCode),
              client
                .from('private_roles')
                .select('badge_id, role')
                .eq('room_code', roomCode),
            ]);

            const remPlayers = (remPlayersRes.data || []) as {
              badge_id: string;
              is_alive: boolean;
            }[];
            const remRoles = (remRolesRes.data || []) as {
              badge_id: string;
              role: string;
            }[];

            if (!remPlayersRes.error && !remRolesRes.error && remPlayers.length > 0) {
              const impBadges = new Set(
                remRoles
                  .filter((r) => r.role === 'IMPOSTOR')
                  .map((r) => r.badge_id)
              );
              let livingImp = 0;
              let livingCrew = 0;
              for (const p of remPlayers) {
                if (!p.is_alive) continue;
                if (impBadges.has(p.badge_id)) livingImp += 1;
                else livingCrew += 1;
              }
              const nextWinner: CampusWinner =
                livingImp === 0 && livingCrew > 0
                  ? 'CREWMATES'
                  : livingImp > 0 && livingImp >= livingCrew
                  ? 'IMPOSTORS'
                  : null;

              if (nextWinner) {
                const { error: winErr } = await client
                  .from('rooms')
                  .update({
                    status: 'ENDED',
                    winner: nextWinner,
                    active_sabotage: null,
                    sabotage_ends_at: null,
                    meeting_ends_at: null,
                    ejection_result: null,
                  })
                  .eq('room_code', roomCode)
                  .in('status', ['PLAYING', 'MEETING']);
                if (winErr) {
                  logSupabaseTableError('rooms', 'leaveRoomWinUpdate', winErr);
                }
              }
            }
          }
        } catch (err) {
          logSupabaseTableError('public_players', 'leaveRoomCleanup', err);
        }
      })();
    }
  }, [identity, room?.status, useRemoteSupabase, pushInsightEvent]);

  const myPlayerRow = useMemo(
    () =>
      identity?.badgeId
        ? publicPlayers.find((p) => p.badge_id === identity.badgeId) || null
        : null,
    [publicPlayers, identity?.badgeId]
  );

  const refreshDevRoles = useCallback(
    async (rawRoomCode?: string): Promise<void> => {
      const roomCode = normalizeRoomCode(
        rawRoomCode ||
          identityRef.current?.roomCode ||
          identity?.roomCode ||
          room?.room_code ||
          ''
      );
      if (!roomCode) return;

      if (!useRemoteSupabase || !supabase) {
        const localRoles = { ...localFallbackRolesRef.current };
        if (privateRole && privateRole.room_code === roomCode) {
          localRoles[privateRole.badge_id] = privateRole;
        }
        setDevAllRoles(localRoles);
        return;
      }

      const { data, error } = await supabase
        .from('private_roles')
        .select('*')
        .eq('room_code', roomCode);
      if (error) {
        logSupabaseTableError('private_roles', 'devRefreshSelect', error);
        return;
      }
      const mapped: Record<string, PrivateRoleRow> = {};
      for (const row of (data || []) as PrivateRoleRow[]) {
        mapped[row.badge_id] = row;
      }
      setDevAllRoles(mapped);
    },
    [identity?.roomCode, room?.room_code, privateRole, useRemoteSupabase]
  );

  const devResetKillCooldown = useCallback(() => {
    setKillCooldownEnd(0);
    pushInsightEvent('DEV_DEBUG', 'Impostor kill cooldown reset to 0s');
  }, [pushInsightEvent]);

  const devBoostTaskProgress = useCallback(
    async (delta = 15): Promise<void> => {
      const activeRoomCode = normalizeRoomCode(
        identityRef.current?.roomCode ||
          identity?.roomCode ||
          room?.room_code ||
          ''
      );
      if (!activeRoomCode) return;
      const nextProgress = Math.min(100, (room?.task_progress || 0) + delta);

      setRoom((prev) =>
        prev
          ? {
              ...prev,
              task_progress: nextProgress,
              ...(nextProgress >= 100
                ? {
                    status: 'ENDED',
                    winner: 'CREWMATES',
                    active_sabotage: null,
                    sabotage_ends_at: null,
                  }
                : {}),
            }
          : prev
      );

      if (useRemoteSupabase && supabase) {
        broadcastTaskProgress(nextProgress);
        const { error } = await supabase
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
          .eq('room_code', activeRoomCode);
        if (error) {
          logSupabaseTableError('rooms', 'devBoostTaskProgress', error);
        }
      }
      pushInsightEvent(
        'DEV_DEBUG',
        `Boosted team task progress by +${delta}% (now ${nextProgress}%)`
      );
    },
    [
      identity?.roomCode,
      room?.room_code,
      room?.task_progress,
      useRemoteSupabase,
      pushInsightEvent,
      broadcastTaskProgress,
    ]
  );

  const devReviveAllPlayers = useCallback(async (): Promise<void> => {
    const activeRoomCode = normalizeRoomCode(
      identityRef.current?.roomCode ||
        identity?.roomCode ||
        room?.room_code ||
        ''
    );
    if (!activeRoomCode) return;

    setPublicPlayers((prev) =>
      prev.map((p) => ({ ...p, is_alive: true, has_voted: false }))
    );

    if (useRemoteSupabase && supabase) {
      const { error } = await supabase
        .from('public_players')
        .update({ is_alive: true, has_voted: false })
        .eq('room_code', activeRoomCode);
      if (error) {
        logSupabaseTableError('public_players', 'devReviveAllPlayers', error);
      }
    }
    pushInsightEvent('DEV_DEBUG', `Revived all operatives in ${activeRoomCode}`);
  }, [identity?.roomCode, room?.room_code, useRemoteSupabase, pushInsightEvent]);

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
    rosterNotification,
    impostorOpsLog,
    clearImpostorOpsLog,
    identity,
    room,
    publicPlayers,
    privateRole,
    devAllRoles,
    refreshDevRoles,
    devResetKillCooldown,
    devBoostTaskProgress,
    devReviveAllPlayers,
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
    assignHost,
    setImpostorCount,
    startMatch,
    completeStation,
    eliminatePlayer,
    triggerSabotage,
    clearSabotage,
    callMeeting,
    extendMeetingTime,
    beginDiscussionPhase,
    castVote,
    finalizeMeeting,
    dismissEjection,
    resetRoom,
    leaveRoom,
  };
}
