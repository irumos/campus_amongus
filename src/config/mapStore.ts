import { useEffect, useState } from 'react';
import type { CampusTaskStationConfig } from './campusConfig';

export type MapZoneColor =
  | 'cyan'
  | 'emerald'
  | 'amber'
  | 'violet'
  | 'rose'
  | 'slate';

export type MapCorridorKind = 'hallway' | 'stairs' | 'outdoor';

export type MapLandmarkKind =
  | 'meeting'
  | 'stairs'
  | 'entrance'
  | 'hazard'
  | 'info';

export interface CampusMapZone {
  id: string;
  label: string;
  floorTag?: string;
  x: number; // 0..100 (% width)
  y: number; // 0..100 (% height)
  w: number; // 4..100
  h: number; // 4..100
  color: MapZoneColor;
}

export interface CampusMapCorridor {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  label?: string;
  kind: MapCorridorKind;
}

export interface CampusMapStationPin {
  stationId: string;
  x: number; // 0..100
  y: number; // 0..100
  shortName?: string;
  floor?: string;
}

export interface CampusMapLandmark {
  id: string;
  label: string;
  kind: MapLandmarkKind;
  x: number;
  y: number;
}

export interface CampusMapConfig {
  version: number;
  mapTitle: string;
  subtitle: string;
  showGrid: boolean;
  backgroundImageDataUrl: string | null;
  backgroundOpacity: number;
  zones: CampusMapZone[];
  corridors: CampusMapCorridor[];
  stationPins: Record<string, CampusMapStationPin>;
  landmarks: CampusMapLandmark[];
  updatedAt: number;
}

const MAP_STORAGE_KEY = 'cairl_campus_map_v1';
const MAP_EVENT = 'cairl-campus-map-updated';

function clampPct(value: number, min = 2, max = 98): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(min, Math.min(max, Math.round(value * 10) / 10));
}

export function createDefaultCampusMap(): CampusMapConfig {
  return {
    version: 1,
    mapTitle: 'Campus Tactical Blueprint',
    subtitle: 'Main Academic Block & Courtyard',
    showGrid: true,
    backgroundImageDataUrl: null,
    backgroundOpacity: 0.35,
    zones: [
      {
        id: 'zone_basement',
        label: 'Basement Core',
        floorTag: 'B1',
        x: 4,
        y: 6,
        w: 22,
        h: 24,
        color: 'violet',
      },
      {
        id: 'zone_2f_labs',
        label: '2nd Floor Labs',
        floorTag: '2F',
        x: 31,
        y: 6,
        w: 38,
        h: 24,
        color: 'cyan',
      },
      {
        id: 'zone_3f_stairs',
        label: '3rd Floor Access',
        floorTag: '3F',
        x: 74,
        y: 6,
        w: 22,
        h: 24,
        color: 'amber',
      },
      {
        id: 'zone_1f_west',
        label: '1st Floor Library',
        floorTag: '1F',
        x: 4,
        y: 38,
        w: 24,
        h: 24,
        color: 'emerald',
      },
      {
        id: 'zone_courtyard',
        label: 'Open Courtyard',
        floorTag: 'QUAD',
        x: 34,
        y: 36,
        w: 32,
        h: 28,
        color: 'slate',
      },
      {
        id: 'zone_1f_east',
        label: 'Seminar Wing',
        floorTag: '1F',
        x: 72,
        y: 38,
        w: 24,
        h: 24,
        color: 'emerald',
      },
      {
        id: 'zone_gf_electrical',
        label: 'Electrical Wing',
        floorTag: 'GF',
        x: 4,
        y: 70,
        w: 25,
        h: 24,
        color: 'rose',
      },
      {
        id: 'zone_main_lobby',
        label: 'Main Lobby',
        floorTag: 'GF',
        x: 35,
        y: 70,
        w: 30,
        h: 24,
        color: 'cyan',
      },
      {
        id: 'zone_canteen',
        label: 'Canteen Quad',
        floorTag: 'GF',
        x: 71,
        y: 70,
        w: 25,
        h: 24,
        color: 'amber',
      },
    ],
    corridors: [
      {
        id: 'cor_1',
        fromX: 26,
        fromY: 18,
        toX: 31,
        toY: 18,
        kind: 'stairs',
        label: 'West Stairs',
      },
      {
        id: 'cor_2',
        fromX: 69,
        fromY: 18,
        toX: 74,
        toY: 18,
        kind: 'stairs',
        label: 'East Stairs',
      },
      {
        id: 'cor_3',
        fromX: 16,
        fromY: 30,
        toX: 16,
        toY: 38,
        kind: 'stairs',
      },
      {
        id: 'cor_4',
        fromX: 50,
        fromY: 30,
        toX: 50,
        toY: 36,
        kind: 'hallway',
      },
      {
        id: 'cor_5',
        fromX: 84,
        fromY: 30,
        toX: 84,
        toY: 38,
        kind: 'stairs',
      },
      {
        id: 'cor_6',
        fromX: 28,
        fromY: 50,
        toX: 34,
        toY: 50,
        kind: 'outdoor',
      },
      {
        id: 'cor_7',
        fromX: 66,
        fromY: 50,
        toX: 72,
        toY: 50,
        kind: 'outdoor',
      },
      {
        id: 'cor_8',
        fromX: 16,
        fromY: 62,
        toX: 16,
        toY: 70,
        kind: 'hallway',
      },
      {
        id: 'cor_9',
        fromX: 50,
        fromY: 64,
        toX: 50,
        toY: 70,
        kind: 'outdoor',
      },
      {
        id: 'cor_10',
        fromX: 84,
        fromY: 62,
        toX: 84,
        toY: 70,
        kind: 'hallway',
      },
      {
        id: 'cor_11',
        fromX: 29,
        fromY: 82,
        toX: 35,
        toY: 82,
        kind: 'hallway',
      },
      {
        id: 'cor_12',
        fromX: 65,
        fromY: 82,
        toX: 71,
        toY: 82,
        kind: 'hallway',
      },
    ],
    stationPins: {
      SERVER_ROOM: {
        stationId: 'SERVER_ROOM',
        x: 15,
        y: 19,
        shortName: 'Server Room',
        floor: 'B1',
      },
      CYBER_LAB: {
        stationId: 'CYBER_LAB',
        x: 42,
        y: 19,
        shortName: 'Cyber Lab',
        floor: '2F',
      },
      PHYSICS_LAB: {
        stationId: 'PHYSICS_LAB',
        x: 59,
        y: 19,
        shortName: 'Physics Lab',
        floor: '2F',
      },
      MAIN_STAIRWELL: {
        stationId: 'MAIN_STAIRWELL',
        x: 85,
        y: 19,
        shortName: 'Stairwell',
        floor: '3F',
      },
      CENTRAL_LIBRARY: {
        stationId: 'CENTRAL_LIBRARY',
        x: 16,
        y: 51,
        shortName: 'Library',
        floor: '1F',
      },
      COURTYARD: {
        stationId: 'COURTYARD',
        x: 50,
        y: 50,
        shortName: 'Gazebo',
        floor: 'QUAD',
      },
      SEMINAR_1: {
        stationId: 'SEMINAR_1',
        x: 84,
        y: 51,
        shortName: 'Seminar 1',
        floor: '1F',
      },
      ELECTRICAL: {
        stationId: 'ELECTRICAL',
        x: 16,
        y: 83,
        shortName: 'Electrical',
        floor: 'GF',
      },
      RECEPTION: {
        stationId: 'RECEPTION',
        x: 50,
        y: 83,
        shortName: 'Reception',
        floor: 'GF',
      },
      CANTEEN_QUAD: {
        stationId: 'CANTEEN_QUAD',
        x: 84,
        y: 83,
        shortName: 'Canteen',
        floor: 'GF',
      },
    },
    landmarks: [
      {
        id: 'lm_meeting',
        label: 'Emergency Table',
        kind: 'meeting',
        x: 50,
        y: 74,
      },
    ],
    updatedAt: Date.now(),
  };
}

export function createCorridorGridPreset(
  stations: CampusTaskStationConfig[]
): CampusMapConfig {
  const zones: CampusMapZone[] = [
    {
      id: 'z_north',
      label: 'North Classroom Row',
      floorTag: 'N',
      x: 5,
      y: 8,
      w: 90,
      h: 28,
      color: 'cyan',
    },
    {
      id: 'z_corridor',
      label: 'Central Spine Hallway',
      floorTag: 'HALL',
      x: 5,
      y: 41,
      w: 90,
      h: 18,
      color: 'slate',
    },
    {
      id: 'z_south',
      label: 'South Lab & Utility Row',
      floorTag: 'S',
      x: 5,
      y: 64,
      w: 90,
      h: 28,
      color: 'emerald',
    },
  ];

  const stationPins: Record<string, CampusMapStationPin> = {};
  const topCount = Math.ceil(stations.length / 2);
  const bottomCount = Math.max(1, stations.length - topCount);

  stations.forEach((st, idx) => {
    const isTop = idx < topCount;
    const rowIdx = isTop ? idx : idx - topCount;
    const rowLen = isTop ? topCount : bottomCount;
    const x = 12 + ((rowIdx + 0.5) / Math.max(1, rowLen)) * 76;
    const y = isTop ? 22 : 78;
    const cleanName = st.roomName.includes('•')
      ? st.roomName.split('•').slice(1).join('•').trim()
      : st.roomName;
    stationPins[st.id] = {
      stationId: st.id,
      x: clampPct(x),
      y,
      shortName: cleanName.slice(0, 16),
    };
  });

  return {
    version: 1,
    mapTitle: 'Single-Corridor Hallway',
    subtitle: 'North & South Wing Blueprint',
    showGrid: true,
    backgroundImageDataUrl: null,
    backgroundOpacity: 0.35,
    zones,
    corridors: [
      { id: 'c_spine', fromX: 10, fromY: 50, toX: 90, toY: 50, kind: 'hallway' },
      { id: 'c_left', fromX: 20, fromY: 36, toX: 20, toY: 64, kind: 'hallway' },
      { id: 'c_mid', fromX: 50, fromY: 36, toX: 50, toY: 64, kind: 'hallway' },
      { id: 'c_right', fromX: 80, fromY: 36, toX: 80, toY: 64, kind: 'hallway' },
    ],
    stationPins,
    landmarks: [
      {
        id: 'lm_center',
        label: 'Meeting Point',
        kind: 'meeting',
        x: 50,
        y: 50,
      },
    ],
    updatedAt: Date.now(),
  };
}

export function createBlankCanvasPreset(
  stations: CampusTaskStationConfig[]
): CampusMapConfig {
  const stationPins: Record<string, CampusMapStationPin> = {};
  stations.forEach((st, idx) => {
    const col = idx % 5;
    const row = Math.floor(idx / 5);
    const cleanName = st.roomName.includes('•')
      ? st.roomName.split('•').slice(1).join('•').trim()
      : st.roomName;
    stationPins[st.id] = {
      stationId: st.id,
      x: 15 + col * 17.5,
      y: 28 + row * 38,
      shortName: cleanName.slice(0, 16),
    };
  });

  return {
    version: 1,
    mapTitle: 'Custom Campus Map',
    subtitle: 'Drag pins & add rooms below',
    showGrid: true,
    backgroundImageDataUrl: null,
    backgroundOpacity: 0.4,
    zones: [],
    corridors: [],
    stationPins,
    landmarks: [
      {
        id: 'lm_meeting',
        label: 'Meeting Point',
        kind: 'meeting',
        x: 50,
        y: 50,
      },
    ],
    updatedAt: Date.now(),
  };
}

const VALID_ZONE_COLORS: Set<MapZoneColor> = new Set([
  'cyan',
  'emerald',
  'amber',
  'violet',
  'rose',
  'slate',
]);

const VALID_CORRIDOR_KINDS: Set<MapCorridorKind> = new Set([
  'hallway',
  'stairs',
  'outdoor',
]);

const VALID_LANDMARK_KINDS: Set<MapLandmarkKind> = new Set([
  'meeting',
  'stairs',
  'entrance',
  'hazard',
  'info',
]);

export function sanitizeCampusMapConfig(raw: unknown): CampusMapConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const mapTitle =
    typeof obj.mapTitle === 'string' && obj.mapTitle.trim()
      ? obj.mapTitle.trim().slice(0, 60)
      : 'Campus Tactical Blueprint';
  const subtitle =
    typeof obj.subtitle === 'string'
      ? obj.subtitle.trim().slice(0, 80)
      : '';
  const showGrid = obj.showGrid !== false;
  const backgroundImageDataUrl =
    typeof obj.backgroundImageDataUrl === 'string' &&
    obj.backgroundImageDataUrl.startsWith('data:image/')
      ? obj.backgroundImageDataUrl
      : null;
  const backgroundOpacity =
    typeof obj.backgroundOpacity === 'number' &&
    Number.isFinite(obj.backgroundOpacity)
      ? Math.max(0.08, Math.min(0.9, obj.backgroundOpacity))
      : 0.35;

  const zones: CampusMapZone[] = Array.isArray(obj.zones)
    ? obj.zones
        .filter((z): z is Record<string, unknown> => Boolean(z && typeof z === 'object'))
        .slice(0, 40)
        .map((z, idx) => {
          const color = VALID_ZONE_COLORS.has(z.color as MapZoneColor)
            ? (z.color as MapZoneColor)
            : 'slate';
          const x = clampPct(Number(z.x), 0, 94);
          const y = clampPct(Number(z.y), 0, 94);
          const w = clampPct(Number(z.w), 6, 100 - x);
          const h = clampPct(Number(z.h), 6, 100 - y);
          return {
            id:
              typeof z.id === 'string' && z.id.trim()
                ? z.id.trim()
                : `zone_${idx + 1}`,
            label:
              typeof z.label === 'string' && z.label.trim()
                ? z.label.trim().slice(0, 32)
                : `Zone ${idx + 1}`,
            floorTag:
              typeof z.floorTag === 'string' && z.floorTag.trim()
                ? z.floorTag.trim().slice(0, 8)
                : undefined,
            x,
            y,
            w,
            h,
            color,
          };
        })
    : [];

  const corridors: CampusMapCorridor[] = Array.isArray(obj.corridors)
    ? obj.corridors
        .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
        .slice(0, 60)
        .map((c, idx) => ({
          id:
            typeof c.id === 'string' && c.id.trim()
              ? c.id.trim()
              : `cor_${idx + 1}`,
          fromX: clampPct(Number(c.fromX), 1, 99),
          fromY: clampPct(Number(c.fromY), 1, 99),
          toX: clampPct(Number(c.toX), 1, 99),
          toY: clampPct(Number(c.toY), 1, 99),
          label:
            typeof c.label === 'string' && c.label.trim()
              ? c.label.trim().slice(0, 24)
              : undefined,
          kind: VALID_CORRIDOR_KINDS.has(c.kind as MapCorridorKind)
            ? (c.kind as MapCorridorKind)
            : 'hallway',
        }))
    : [];

  const stationPins: Record<string, CampusMapStationPin> = {};
  if (obj.stationPins && typeof obj.stationPins === 'object') {
    for (const [key, val] of Object.entries(
      obj.stationPins as Record<string, unknown>
    )) {
      if (!val || typeof val !== 'object') continue;
      const p = val as Record<string, unknown>;
      const stationId = key.trim().toUpperCase();
      if (!stationId) continue;
      stationPins[stationId] = {
        stationId,
        x: clampPct(Number(p.x), 3, 97),
        y: clampPct(Number(p.y), 4, 96),
        shortName:
          typeof p.shortName === 'string' && p.shortName.trim()
            ? p.shortName.trim().slice(0, 20)
            : undefined,
        floor:
          typeof p.floor === 'string' && p.floor.trim()
            ? p.floor.trim().slice(0, 8)
            : undefined,
      };
    }
  }

  const landmarks: CampusMapLandmark[] = Array.isArray(obj.landmarks)
    ? obj.landmarks
        .filter((l): l is Record<string, unknown> => Boolean(l && typeof l === 'object'))
        .slice(0, 30)
        .map((l, idx) => ({
          id:
            typeof l.id === 'string' && l.id.trim()
              ? l.id.trim()
              : `lm_${idx + 1}`,
          label:
            typeof l.label === 'string' && l.label.trim()
              ? l.label.trim().slice(0, 26)
              : `Marker ${idx + 1}`,
          kind: VALID_LANDMARK_KINDS.has(l.kind as MapLandmarkKind)
            ? (l.kind as MapLandmarkKind)
            : 'info',
          x: clampPct(Number(l.x), 3, 97),
          y: clampPct(Number(l.y), 4, 96),
        }))
    : [];

  return {
    version: 1,
    mapTitle,
    subtitle,
    showGrid,
    backgroundImageDataUrl,
    backgroundOpacity,
    zones,
    corridors,
    stationPins,
    landmarks,
    updatedAt:
      typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt)
        ? obj.updatedAt
        : Date.now(),
  };
}

export function resolveStationPin(
  mapConfig: CampusMapConfig,
  station: { id: string; roomName?: string; shortLabel?: string },
  fallbackIndex: number
): CampusMapStationPin {
  const existing = mapConfig.stationPins[station.id];
  const rawName = station.roomName || station.shortLabel || station.id;
  const parsedShort = rawName.includes('•')
    ? rawName.split('•').slice(1).join('•').trim()
    : rawName;

  if (existing) {
    return {
      ...existing,
      shortName: existing.shortName || parsedShort.slice(0, 18),
    };
  }

  // Deterministic fallback position for newly added custom stations
  const col = fallbackIndex % 4;
  const row = Math.floor(fallbackIndex / 4);
  return {
    stationId: station.id,
    x: clampPct(18 + col * 21),
    y: clampPct(20 + (row % 3) * 30),
    shortName: parsedShort.slice(0, 18),
  };
}

export function getActiveCampusMap(): CampusMapConfig {
  if (typeof window === 'undefined') return createDefaultCampusMap();
  try {
    const raw = localStorage.getItem(MAP_STORAGE_KEY);
    if (!raw) return createDefaultCampusMap();
    const parsed = JSON.parse(raw);
    return sanitizeCampusMapConfig(parsed) || createDefaultCampusMap();
  } catch {
    return createDefaultCampusMap();
  }
}

export function saveCampusMap(config: CampusMapConfig): CampusMapConfig {
  const next: CampusMapConfig = {
    ...config,
    updatedAt: Date.now(),
  };
  const clean = sanitizeCampusMapConfig(next) || createDefaultCampusMap();
  try {
    localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(clean));
    window.dispatchEvent(new CustomEvent(MAP_EVENT));
  } catch {
    // Handle storage quota exceeded (e.g. if floorplan image is too large)
    const withoutBg = { ...clean, backgroundImageDataUrl: null };
    try {
      localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(withoutBg));
      window.dispatchEvent(new CustomEvent(MAP_EVENT));
    } catch {
      // ignore
    }
  }
  return clean;
}

export function applyRemoteCampusMap(raw: unknown): CampusMapConfig | null {
  const clean = sanitizeCampusMapConfig(raw);
  if (!clean) return null;
  try {
    localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(clean));
    window.dispatchEvent(new CustomEvent(MAP_EVENT));
  } catch {
    // ignore storage errors
  }
  return clean;
}

export function resetCampusMapToDefault(): CampusMapConfig {
  const fresh = createDefaultCampusMap();
  try {
    localStorage.removeItem(MAP_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(MAP_EVENT));
  } catch {
    // ignore storage errors
  }
  return fresh;
}

export function exportCampusMapJson(config: CampusMapConfig): string {
  return JSON.stringify(config, null, 2);
}

export function importCampusMapJson(
  rawJson: string
): { ok: true; config: CampusMapConfig } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(rawJson);
    const clean = sanitizeCampusMapConfig(parsed);
    if (!clean) {
      return { ok: false, error: 'Invalid map JSON structure.' };
    }
    const saved = saveCampusMap(clean);
    return { ok: true, config: saved };
  } catch {
    return { ok: false, error: 'Could not parse JSON. Check formatting.' };
  }
}

/**
 * Compute cardinal direction & Euclidean blueprint distance from point A to B.
 */
export function getRelativeDirection(
  from: { x: number; y: number },
  to: { x: number; y: number }
): {
  compass: string;
  angleDeg: number;
  distanceUnits: number;
  isSameSpot: boolean;
} {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2.5) {
    return { compass: 'HERE', angleDeg: 0, distanceUnits: 0, isSameSpot: true };
  }
  const rad = Math.atan2(dy, dx);
  const deg = ((rad * 180) / Math.PI + 360) % 360;
  // 0 deg = East, 90 deg = South, 180 deg = West, 270 deg = North
  const sectors = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  const idx = Math.round(deg / 45) % 8;
  return {
    compass: sectors[idx],
    angleDeg: deg,
    distanceUnits: Math.round(dist),
    isSameSpot: false,
  };
}

export function useCampusMap(): CampusMapConfig {
  const [mapConfig, setMapConfig] = useState<CampusMapConfig>(() =>
    getActiveCampusMap()
  );

  useEffect(() => {
    const sync = () => setMapConfig(getActiveCampusMap());
    window.addEventListener(MAP_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(MAP_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return mapConfig;
}
