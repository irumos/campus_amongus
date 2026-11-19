import { useSyncExternalStore } from 'react';

const MATCH_QR_TOKENS_KEY = 'cairl_room_match_qr_tokens_v1';

type RoomTokenMap = Record<string, string>;

const listeners = new Set<() => void>();

function normalizeRoomKey(raw: string): string {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return cleaned || 'SVCE';
}

export function generateUniqueMatchToken(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let token = '';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) {
      token += alphabet[bytes[i] % alphabet.length];
    }
  } else {
    for (let i = 0; i < 6; i++) {
      token += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  }
  return token;
}

function readTokenMap(): RoomTokenMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(MATCH_QR_TOKENS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const next: RoomTokenMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) {
        next[normalizeRoomKey(k)] = v.trim().toUpperCase();
      }
    }
    return next;
  } catch {
    return {};
  }
}

let cachedTokens: RoomTokenMap = readTokenMap();

function persistTokens(next: RoomTokenMap): void {
  cachedTokens = next;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(MATCH_QR_TOKENS_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
  }
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (typeof window === 'undefined') {
    return () => {
      listeners.delete(cb);
    };
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === MATCH_QR_TOKENS_KEY) {
      cachedTokens = readTokenMap();
      cb();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function getOrCreateMatchQrToken(roomCode: string): string {
  const key = normalizeRoomKey(roomCode);
  const existing = cachedTokens[key];
  if (existing) return existing;
  const fresh = generateUniqueMatchToken();
  persistTokens({ ...cachedTokens, [key]: fresh });
  return fresh;
}

export function setMatchQrToken(roomCode: string, token: string): string {
  const key = normalizeRoomKey(roomCode);
  const clean =
    token
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10) || generateUniqueMatchToken();
  persistTokens({ ...cachedTokens, [key]: clean });
  return clean;
}

export function rotateMatchQrToken(roomCode: string): string {
  const key = normalizeRoomKey(roomCode);
  let fresh = generateUniqueMatchToken();
  if (fresh === cachedTokens[key]) {
    fresh = generateUniqueMatchToken();
  }
  persistTokens({ ...cachedTokens, [key]: fresh });
  return fresh;
}

export function useMatchQrToken(roomCode: string): string {
  const key = normalizeRoomKey(roomCode);
  const map = useSyncExternalStore(
    subscribe,
    () => cachedTokens,
    () => cachedTokens
  );
  if (map[key]) return map[key];
  return getOrCreateMatchQrToken(key);
}

export function buildIdCardQrPayload(
  roomCode: string,
  matchToken: string,
  badgeId: string
): string {
  const room = normalizeRoomKey(roomCode);
  const token = matchToken.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'GAME01';
  const cleanBadge = badgeId.trim().toUpperCase().startsWith('P')
    ? badgeId.trim().toUpperCase()
    : `P${badgeId.trim().padStart(2, '0')}`;
  return `CAMPUS_AU:IDCARD:${room}:${token}:${cleanBadge}`;
}

export function buildStationQrPayload(
  roomCode: string,
  matchToken: string,
  stationId: string
): string {
  const room = normalizeRoomKey(roomCode);
  const token = matchToken.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'GAME01';
  const cleanStation = stationId.trim().toUpperCase();
  return `CAMPUS_AU:STATION:${room}:${token}:${cleanStation}`;
}
