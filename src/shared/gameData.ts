import {
  TASK_STATIONS as CAMPUS_TASK_STATIONS,
  WRISTBANDS,
  type CampusMiniGameType,
} from '../config/campusConfig.ts';

export type ScreenId = 'join' | 'lobby' | 'gameplay' | 'meeting' | 'print';

export type PlayerRole = 'crewmate' | 'impostor';

export type PlayerStatus = 'alive' | 'eliminated' | 'ghost';

export type MiniGameType = 'wiring' | 'manifold' | 'swipe' | 'shields';

export interface WristbandBadge {
  id: string;
  number: string;
  label: string;
  colorName: string;
  hex: string;
  qrValue: string;
}

export interface TaskStation {
  id: string;
  location: string;
  taskName: string;
  shortLabel: string;
  miniGame: MiniGameType;
  qrValue: string;
}

export interface Player {
  id: string;
  name: string;
  badgeNumber: string;
  role: PlayerRole;
  status: PlayerStatus;
  completedTaskIds: string[];
  isHost: boolean;
  isBot?: boolean;
  joinedAt: number;
}

export interface SabotageState {
  type: 'reactor' | 'comms';
  label: string;
  targetStationId: string;
  triggeredAt: number;
  expiresAt: number;
}

export interface EjectionResult {
  ejectedPlayerId: string | null;
  ejectedBadgeNumber: string | null;
  ejectedName: string | null;
  message: string;
  timestamp: number;
}

export interface MeetingState {
  reason: string;
  calledByBadge: string;
  calledByName: string;
  endsAt: number;
  votes: Record<string, string>;
  ejectionResult: EjectionResult | null;
}

export interface RoomState {
  roomCode: string;
  phase: 'lobby' | 'gameplay' | 'meeting' | 'ended';
  impostorCount: 1 | 2;
  players: Player[];
  sabotage: SabotageState | null;
  meeting: MeetingState | null;
  winner: 'crewmates' | 'impostors' | null;
  winReason: string | null;
  killCooldownEndByPlayer: Record<string, number>;
  updatedAt: number;
}

function mapMiniGame(type: CampusMiniGameType): MiniGameType {
  switch (type) {
    case 'WIRING':
      return 'wiring';
    case 'MANIFOLD':
      return 'manifold';
    case 'SWIPE':
      return 'swipe';
    case 'SHIELDS':
      return 'shields';
  }
}

export const WRISTBAND_BADGES: WristbandBadge[] = WRISTBANDS.map((w) => ({
  id: w.id,
  number: w.number,
  label: w.label,
  colorName: w.colorName,
  hex: w.colorHex,
  qrValue: w.qrPayload,
}));

export const TASK_STATIONS: TaskStation[] = CAMPUS_TASK_STATIONS.map((s) => ({
  id: s.id,
  location: s.roomName.toUpperCase(),
  taskName: s.taskTitle,
  shortLabel: s.roomName,
  miniGame: mapMiniGame(s.miniGame),
  qrValue: s.qrPayload,
}));

export function getBadgeInfo(badgeNumber: string): WristbandBadge {
  return (
    WRISTBAND_BADGES.find((b) => b.number === badgeNumber) || WRISTBAND_BADGES[0]
  );
}

export function getStationInfo(stationId: string): TaskStation | undefined {
  return TASK_STATIONS.find((s) => s.id === stationId);
}

export function parseQrPayload(
  raw: string
): { kind: 'badge'; badgeNumber: string } | { kind: 'station'; stationId: string } | null {
  const trimmed = raw.trim();

  // Primary CAMPUS_AU payloads from campusConfig.ts
  if (trimmed.startsWith('CAMPUS_AU:WRISTBAND:')) {
    const code = trimmed.replace('CAMPUS_AU:WRISTBAND:', '').toUpperCase();
    const matched = WRISTBAND_BADGES.find((b) => b.id === code);
    if (matched) {
      return { kind: 'badge', badgeNumber: matched.number };
    }
  }
  if (trimmed.startsWith('CAMPUS_AU:STATION:')) {
    const stationId = trimmed.replace('CAMPUS_AU:STATION:', '').toUpperCase();
    if (TASK_STATIONS.some((s) => s.id === stationId)) {
      return { kind: 'station', stationId };
    }
  }

  // Backward-compatible fallback for legacy CAIRL payloads
  if (trimmed.startsWith('CAIRL:BADGE:')) {
    const num = trimmed.replace('CAIRL:BADGE:', '').padStart(2, '0');
    if (WRISTBAND_BADGES.some((b) => b.number === num)) {
      return { kind: 'badge', badgeNumber: num };
    }
  }
  if (trimmed.startsWith('CAIRL:STATION:')) {
    const legacyId = trimmed.replace('CAIRL:STATION:', '').toUpperCase();
    const mappedId = legacyId === 'SEMINAR_HALL' ? 'SEMINAR_1' : legacyId;
    if (TASK_STATIONS.some((s) => s.id === mappedId)) {
      return { kind: 'station', stationId: mappedId };
    }
  }

  return null;
}

export function computeTaskProgress(players: Player[]): number {
  const crewmates = players.filter((p) => p.role === 'crewmate');
  if (crewmates.length === 0) return 0;
  const totalRequired = crewmates.length * TASK_STATIONS.length;
  const totalCompleted = crewmates.reduce(
    (sum, p) => sum + Math.min(p.completedTaskIds.length, TASK_STATIONS.length),
    0
  );
  return Math.round((totalCompleted / totalRequired) * 100);
}
