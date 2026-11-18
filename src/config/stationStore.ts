import { useEffect, useState } from 'react';
import {
  TASK_STATIONS as DEFAULT_TASK_STATIONS,
  type CampusMiniGameType,
  type CampusTaskCategory,
  type CampusTaskStationConfig,
} from './campusConfig';

const STATIONS_STORAGE_KEY = 'cairl_custom_stations';
const STATIONS_EVENT = 'cairl-stations-updated';

export const MINI_GAME_LABELS: Record<CampusMiniGameType, string> = {
  WIRING: 'Power Conduits (Wiring)',
  MANIFOLD: 'Security Keypad (1→6)',
  SWIPE: 'Student ID Swipe',
  SHIELDS: 'Hex Firewall Nodes',
  SIMON_SAYS: 'Reactor Memory Sequence (3×3)',
  FREQUENCY_TUNE: 'Calibrate Comms Antenna',
  ASTEROID_DEFENSE: 'Clear Campus Firewall (6 Targets)',
  BIOMETRIC_HOLD: 'Verify Lab Access (4s Hold)',
  DATA_TRANSFER: 'Relay Packet Transfer (Long Task)',
};

function isValidMiniGame(val: unknown): val is CampusMiniGameType {
  return (
    val === 'WIRING' ||
    val === 'MANIFOLD' ||
    val === 'SWIPE' ||
    val === 'SHIELDS' ||
    val === 'SIMON_SAYS' ||
    val === 'FREQUENCY_TUNE' ||
    val === 'ASTEROID_DEFENSE' ||
    val === 'BIOMETRIC_HOLD' ||
    val === 'DATA_TRANSFER'
  );
}

function normalizeCategory(val: unknown): CampusTaskCategory {
  return val === 'LONG_TASK' ? 'LONG_TASK' : 'SHORT_TASK';
}

export function getActiveStations(): CampusTaskStationConfig[] {
  if (typeof window === 'undefined') return DEFAULT_TASK_STATIONS;
  try {
    const raw = localStorage.getItem(STATIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_TASK_STATIONS;
    const parsed = JSON.parse(raw) as Partial<CampusTaskStationConfig>[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return DEFAULT_TASK_STATIONS;
    }
    const valid = parsed
      .filter(
        (s) =>
          typeof s.id === 'string' &&
          s.id.trim().length > 0 &&
          typeof s.roomName === 'string' &&
          s.roomName.trim().length > 0 &&
          typeof s.taskTitle === 'string' &&
          s.taskTitle.trim().length > 0 &&
          isValidMiniGame(s.miniGame)
      )
      .map((s) => {
        const cleanId = s.id!.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const taskCategory = normalizeCategory(s.taskCategory);
        const relayStage =
          s.relayStage === 1 || s.relayStage === 2 ? s.relayStage : undefined;
        const relayPartnerId =
          typeof s.relayPartnerId === 'string' && s.relayPartnerId.trim()
            ? s.relayPartnerId.trim().toUpperCase()
            : undefined;
        return {
          id: cleanId,
          roomName: s.roomName!.trim(),
          taskTitle: s.taskTitle!.trim(),
          miniGame: s.miniGame!,
          taskCategory,
          ...(relayStage ? { relayStage } : {}),
          ...(relayPartnerId ? { relayPartnerId } : {}),
          qrPayload: `CAMPUS_AU:STATION:${cleanId}`,
        };
      });
    return valid.length > 0 ? valid : DEFAULT_TASK_STATIONS;
  } catch {
    return DEFAULT_TASK_STATIONS;
  }
}

export function saveStations(
  stations: CampusTaskStationConfig[]
): CampusTaskStationConfig[] {
  const sanitized = stations.map((s) => {
    const cleanId = s.id.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    return {
      ...s,
      id: cleanId,
      roomName: s.roomName.trim() || 'Campus Room',
      taskTitle: s.taskTitle.trim() || 'Complete Objective',
      miniGame: s.miniGame,
      taskCategory: normalizeCategory(s.taskCategory),
      qrPayload: `CAMPUS_AU:STATION:${cleanId}`,
    };
  });
  try {
    localStorage.setItem(STATIONS_STORAGE_KEY, JSON.stringify(sanitized));
    window.dispatchEvent(new CustomEvent(STATIONS_EVENT));
  } catch {
    // ignore storage errors
  }
  return sanitized;
}

export function addStation(
  roomName: string,
  taskTitle: string,
  miniGame: CampusMiniGameType,
  taskCategory: CampusTaskCategory = 'SHORT_TASK'
): CampusTaskStationConfig[] {
  const current = getActiveStations();
  const baseSlug =
    roomName
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 14) || 'ROOM';

  let candidateId = baseSlug;
  let counter = 2;
  const existingIds = new Set(current.map((s) => s.id));
  while (existingIds.has(candidateId)) {
    candidateId = `${baseSlug}_${counter}`;
    counter += 1;
  }

  const next: CampusTaskStationConfig[] = [
    ...current,
    {
      id: candidateId,
      roomName: roomName.trim(),
      taskTitle: taskTitle.trim(),
      miniGame,
      taskCategory,
      qrPayload: `CAMPUS_AU:STATION:${candidateId}`,
    },
  ];
  return saveStations(next);
}

export function updateStation(
  stationId: string,
  patch: Partial<
    Pick<
      CampusTaskStationConfig,
      'roomName' | 'taskTitle' | 'miniGame' | 'taskCategory'
    >
  >
): CampusTaskStationConfig[] {
  const current = getActiveStations();
  const next = current.map((s) =>
    s.id === stationId
      ? {
          ...s,
          roomName: patch.roomName !== undefined ? patch.roomName : s.roomName,
          taskTitle:
            patch.taskTitle !== undefined ? patch.taskTitle : s.taskTitle,
          miniGame: patch.miniGame !== undefined ? patch.miniGame : s.miniGame,
          taskCategory:
            patch.taskCategory !== undefined
              ? patch.taskCategory
              : s.taskCategory,
        }
      : s
  );
  return saveStations(next);
}

export function deleteStation(stationId: string): CampusTaskStationConfig[] {
  const current = getActiveStations();
  if (current.length <= 1) return current;
  const next = current.filter((s) => s.id !== stationId);
  return saveStations(next);
}

export function resetStationsToDefault(): CampusTaskStationConfig[] {
  try {
    localStorage.removeItem(STATIONS_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(STATIONS_EVENT));
  } catch {
    // ignore storage errors
  }
  return DEFAULT_TASK_STATIONS;
}

export function useCampusStations(): CampusTaskStationConfig[] {
  const [stations, setStations] = useState<CampusTaskStationConfig[]>(() =>
    getActiveStations()
  );

  useEffect(() => {
    const sync = () => setStations(getActiveStations());
    window.addEventListener(STATIONS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(STATIONS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return stations;
}
