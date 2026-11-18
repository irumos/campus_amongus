import { useEffect, useState } from 'react';
import { isSupabaseConfigured, logSupabaseTableError, supabase } from './supabase';

const PASSCODES_STORAGE_KEY = 'cairl_print_kit_passcodes';
const PASSCODES_EVENT = 'cairl-print-passcodes-updated';

function normalizeCode(raw: string): string {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return cleaned || 'SVCE';
}

export function getPrintPasscodeMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PASSCODES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.trim().length > 0) {
        clean[normalizeCode(k)] = v.trim();
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function getLobbyPrintPasscode(rawRoomCode: string): string | null {
  const code = normalizeCode(rawRoomCode);
  const map = getPrintPasscodeMap();
  return map[code] || null;
}

export function setLobbyPrintPasscode(
  rawRoomCode: string,
  rawPasscode: string
): string | null {
  const code = normalizeCode(rawRoomCode);
  const trimmed = rawPasscode.trim().slice(0, 24);
  const map = getPrintPasscodeMap();

  if (trimmed.length === 0) {
    delete map[code];
  } else {
    map[code] = trimmed;
  }

  try {
    localStorage.setItem(PASSCODES_STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(PASSCODES_EVENT));
  } catch {
    // ignore storage errors
  }

  // Best-effort sync to Supabase: update existing room or upsert minimal room row if not yet created
  if (supabase && isSupabaseConfigured) {
    const client = supabase;
    void (async () => {
      try {
        const { data: existing, error: selErr } = await client
          .from('rooms')
          .select('room_code')
          .eq('room_code', code)
          .maybeSingle();

        if (selErr) {
          logSupabaseTableError('rooms', 'checkRoomForPasscode', selErr);
        }

        if (existing) {
          const { error: updErr } = await client
            .from('rooms')
            .update({ print_passcode: trimmed || null } as Record<string, unknown>)
            .eq('room_code', code);
          if (updErr) {
            logSupabaseTableError('rooms', 'updatePrintPasscode', updErr);
          }
        } else if (trimmed) {
          const { error: insErr } = await client
            .from('rooms')
            .upsert(
              {
                room_code: code,
                status: 'LOBBY',
                winner: null,
                task_progress: 0,
                impostor_count: 1,
                print_passcode: trimmed,
              } as Record<string, unknown>,
              { onConflict: 'room_code' }
            );
          if (insErr) {
            logSupabaseTableError('rooms', 'upsertRoomPrintPasscode', insErr);
          }
        }
      } catch (err) {
        logSupabaseTableError('rooms', 'syncPrintPasscodeException', err);
      }
    })();
  }

  return trimmed || null;
}

export async function verifyLobbyPrintPasscode(
  rawRoomCode: string,
  enteredPasscode: string
): Promise<{
  ok: boolean;
  roomCode: string;
  reason?: 'NO_PASSCODE_SET' | 'INVALID_PASSCODE';
}> {
  const roomCode = normalizeCode(rawRoomCode);
  const attempt = enteredPasscode.trim();

  let expected = getLobbyPrintPasscode(roomCode);

  if (supabase && isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('room_code', roomCode)
        .maybeSingle();

      if (error) {
        logSupabaseTableError('rooms', 'selectPrintPasscode', error);
      } else if (data && typeof data === 'object') {
        const remoteCode = (data as { print_passcode?: unknown }).print_passcode;
        if (typeof remoteCode === 'string' && remoteCode.trim().length > 0) {
          expected = remoteCode.trim();
          const map = getPrintPasscodeMap();
          if (map[roomCode] !== expected) {
            map[roomCode] = expected;
            try {
              localStorage.setItem(PASSCODES_STORAGE_KEY, JSON.stringify(map));
              window.dispatchEvent(new CustomEvent(PASSCODES_EVENT));
            } catch {
              // ignore storage errors
            }
          }
        }
      }
    } catch (err) {
      logSupabaseTableError('rooms', 'selectPrintPasscodeException', err);
    }
  }

  if (!expected) {
    return { ok: false, roomCode, reason: 'NO_PASSCODE_SET' };
  }

  if (attempt !== expected) {
    return { ok: false, roomCode, reason: 'INVALID_PASSCODE' };
  }

  return { ok: true, roomCode };
}

export function useLobbyPrintPasscode(rawRoomCode: string): string | null {
  const normalized = normalizeCode(rawRoomCode);
  const [passcode, setPasscode] = useState<string | null>(() =>
    getLobbyPrintPasscode(normalized)
  );

  useEffect(() => {
    const sync = () => setPasscode(getLobbyPrintPasscode(normalized));
    sync();
    window.addEventListener(PASSCODES_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PASSCODES_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [normalized]);

  return passcode;
}

export function useAllPrintPasscodes(): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>(() =>
    getPrintPasscodeMap()
  );

  useEffect(() => {
    const sync = () => setMap(getPrintPasscodeMap());
    window.addEventListener(PASSCODES_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PASSCODES_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return map;
}
