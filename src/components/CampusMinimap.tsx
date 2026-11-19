import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  ChevronDown,
  ChevronUp,
  Compass,
  Map as MapIcon,
  Maximize2,
  Navigation,
  Pin,
  Radio,
  Star,
  X,
} from 'lucide-react';
import {
  getRelativeDirection,
  resolveStationPin,
  useCampusMap,
  type CampusMapConfig,
  type MapZoneColor,
} from '../config/mapStore';
import type { SabotageState, TaskStation } from '../shared/gameData';
import { playUiClick } from '../utils/feedback';

interface CampusMinimapProps {
  stations: TaskStation[];
  assignedStationIds: string[];
  completedStationIds: string[];
  currentStationId: string | null;
  pinnedStationId?: string | null;
  sabotage: SabotageState | null;
  sabotageStationIds: string[];
  isCommsSabotaged?: boolean;
  onSelectCurrentStation: (stationId: string) => void;
  onTogglePinStation?: (stationId: string) => void;
  onScanStation: (stationId?: string) => void;
  /** Optional override map config (used by Developer Map Editor live preview) */
  mapConfigOverride?: CampusMapConfig;
  /** Render expanded inline without collapse toggle (used in previews) */
  alwaysExpanded?: boolean;
}

const VIEW_W = 1000;
const VIEW_H = 625;

const ZONE_SVG_STYLES: Record<
  MapZoneColor,
  { fill: string; stroke: string; label: string }
> = {
  cyan: {
    fill: 'rgba(6, 182, 212, 0.11)',
    stroke: 'rgba(34, 211, 238, 0.36)',
    label: '#a5f3fc',
  },
  emerald: {
    fill: 'rgba(16, 185, 129, 0.11)',
    stroke: 'rgba(52, 211, 153, 0.36)',
    label: '#a7f3d0',
  },
  amber: {
    fill: 'rgba(245, 158, 11, 0.11)',
    stroke: 'rgba(251, 191, 36, 0.36)',
    label: '#fde68a',
  },
  violet: {
    fill: 'rgba(139, 92, 246, 0.12)',
    stroke: 'rgba(167, 139, 250, 0.38)',
    label: '#ddd6fe',
  },
  rose: {
    fill: 'rgba(244, 63, 94, 0.11)',
    stroke: 'rgba(251, 113, 133, 0.36)',
    label: '#fecdd3',
  },
  slate: {
    fill: 'rgba(148, 163, 184, 0.08)',
    stroke: 'rgba(148, 163, 184, 0.28)',
    label: '#cbd5e1',
  },
};

function toSvgX(pct: number): number {
  return (pct / 100) * VIEW_W;
}

function toSvgY(pct: number): number {
  return (pct / 100) * VIEW_H;
}

export function CampusMinimap({
  stations,
  assignedStationIds,
  completedStationIds,
  currentStationId,
  pinnedStationId = null,
  sabotage,
  sabotageStationIds,
  isCommsSabotaged = false,
  onSelectCurrentStation,
  onTogglePinStation,
  onScanStation,
  mapConfigOverride,
  alwaysExpanded = false,
}: CampusMinimapProps) {
  const storedMap = useCampusMap();
  const mapConfig = mapConfigOverride || storedMap;

  const [isOpen, setIsOpen] = useState(alwaysExpanded || Boolean(sabotage));
  const [fullScreenOpen, setFullScreenOpen] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const prevSabotageKeyRef = useRef<string | null>(null);

  // Auto-open inline minimap whenever a new sabotage crisis begins
  useEffect(() => {
    const sabKey = sabotage
      ? `${sabotage.type}:${sabotage.targetStationId}:${sabotageStationIds.join(',')}`
      : null;
    if (sabKey && prevSabotageKeyRef.current !== sabKey) {
      setIsOpen(true);
      setSelectedPinId(sabotageStationIds[0] || sabotage?.targetStationId || null);
    }
    prevSabotageKeyRef.current = sabKey;
  }, [sabotage, sabotageStationIds]);

  useEffect(() => {
    if (!fullScreenOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullScreenOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullScreenOpen]);

  const assignedSet = useMemo(
    () => new Set(assignedStationIds),
    [assignedStationIds]
  );
  const completedSet = useMemo(
    () => new Set(completedStationIds),
    [completedStationIds]
  );
  const sabotageSet = useMemo(() => {
    const set = new Set<string>();
    if (sabotage) {
      for (const id of sabotageStationIds) set.add(id);
      if (sabotage.targetStationId) set.add(sabotage.targetStationId);
    }
    return set;
  }, [sabotage, sabotageStationIds]);

  const resolvedPins = useMemo(() => {
    return stations.map((st, idx) => {
      const pin = resolveStationPin(mapConfig, st, idx);
      return {
        station: st,
        pin,
        isAssigned: assignedSet.has(st.id),
        isCompleted: completedSet.has(st.id),
        isCurrent: currentStationId === st.id,
        isPinned: pinnedStationId === st.id,
        isSabotage: sabotageSet.has(st.id),
      };
    });
  }, [
    stations,
    mapConfig,
    assignedSet,
    completedSet,
    currentStationId,
    pinnedStationId,
    sabotageSet,
  ]);

  const currentPinEntry = useMemo(
    () => resolvedPins.find((p) => p.isCurrent) || resolvedPins[0] || null,
    [resolvedPins]
  );

  const pinnedPinEntry = useMemo(
    () => resolvedPins.find((p) => p.isPinned) || null,
    [resolvedPins]
  );

  const pinnedGuidance = useMemo(() => {
    if (!pinnedPinEntry || !currentPinEntry) return null;
    const rel = getRelativeDirection(currentPinEntry.pin, pinnedPinEntry.pin);
    return {
      toName:
        pinnedPinEntry.pin.shortName || pinnedPinEntry.station.shortLabel,
      toFloor: pinnedPinEntry.pin.floor,
      ...rel,
    };
  }, [pinnedPinEntry, currentPinEntry]);

  const sabotagePinEntries = useMemo(
    () => resolvedPins.filter((p) => p.isSabotage),
    [resolvedPins]
  );

  const primarySabotageEntry = sabotagePinEntries[0] || null;

  const crisisGuidance = useMemo(() => {
    if (!sabotage || !primarySabotageEntry || !currentPinEntry) return null;
    const rel = getRelativeDirection(
      currentPinEntry.pin,
      primarySabotageEntry.pin
    );
    return {
      fromName: currentPinEntry.pin.shortName || currentPinEntry.station.shortLabel,
      toName:
        primarySabotageEntry.pin.shortName ||
        primarySabotageEntry.station.shortLabel,
      toFloor: primarySabotageEntry.pin.floor,
      toStationId: primarySabotageEntry.station.id,
      ...rel,
    };
  }, [sabotage, primarySabotageEntry, currentPinEntry]);

  const selectedPinEntry = useMemo(
    () => resolvedPins.find((p) => p.station.id === selectedPinId) || null,
    [resolvedPins, selectedPinId]
  );

  const selectedDirection = useMemo(() => {
    if (!selectedPinEntry || !currentPinEntry) return null;
    return getRelativeDirection(currentPinEntry.pin, selectedPinEntry.pin);
  }, [selectedPinEntry, currentPinEntry]);

  const isReactor = sabotage?.type === 'reactor';

  const renderBlueprintSvg = (isLarge: boolean) => (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full h-full block select-none"
      role="img"
      aria-label={`${mapConfig.mapTitle} tactical minimap`}
    >
      <defs>
        <pattern
          id={isLarge ? 'blueprint-grid-lg' : 'blueprint-grid-sm'}
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="rgba(148, 163, 184, 0.08)"
            strokeWidth="1"
          />
        </pattern>
        <radialGradient
          id={isLarge ? 'reactor-glow-lg' : 'reactor-glow-sm'}
          cx="50%"
          cy="50%"
          r="50%"
        >
          <stop offset="0%" stopColor="rgba(244, 63, 94, 0.45)" />
          <stop offset="100%" stopColor="rgba(244, 63, 94, 0)" />
        </radialGradient>
        <radialGradient
          id={isLarge ? 'comms-glow-lg' : 'comms-glow-sm'}
          cx="50%"
          cy="50%"
          r="50%"
        >
          <stop offset="0%" stopColor="rgba(245, 158, 11, 0.45)" />
          <stop offset="100%" stopColor="rgba(245, 158, 11, 0)" />
        </radialGradient>
      </defs>

      {/* Base Canvas */}
      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="#070c18" />

      {/* Optional Custom Floorplan Image */}
      {mapConfig.backgroundImageDataUrl && (
        <image
          href={mapConfig.backgroundImageDataUrl}
          x={0}
          y={0}
          width={VIEW_W}
          height={VIEW_H}
          preserveAspectRatio="xMidYMid meet"
          opacity={mapConfig.backgroundOpacity}
        />
      )}

      {/* Blueprint Grid */}
      {mapConfig.showGrid && (
        <rect
          x={0}
          y={0}
          width={VIEW_W}
          height={VIEW_H}
          fill={`url(#${isLarge ? 'blueprint-grid-lg' : 'blueprint-grid-sm'})`}
        />
      )}

      {/* Corridors & Pathways */}
      {mapConfig.corridors.map((cor) => {
        const x1 = toSvgX(cor.fromX);
        const y1 = toSvgY(cor.fromY);
        const x2 = toSvgX(cor.toX);
        const y2 = toSvgY(cor.toY);
        const strokeColor =
          cor.kind === 'stairs'
            ? 'rgba(251, 191, 36, 0.42)'
            : cor.kind === 'outdoor'
            ? 'rgba(52, 211, 153, 0.35)'
            : 'rgba(148, 163, 184, 0.36)';
        const dash =
          cor.kind === 'stairs'
            ? '6 5'
            : cor.kind === 'outdoor'
            ? '3 6'
            : undefined;
        return (
          <g key={cor.id}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={strokeColor}
              strokeWidth={cor.kind === 'hallway' ? 8 : 5}
              strokeLinecap="round"
              strokeDasharray={dash}
            />
            {cor.label && isLarge && (
              <text
                x={(x1 + x2) / 2}
                y={(y1 + y2) / 2 - 8}
                textAnchor="middle"
                fill="rgba(203, 213, 225, 0.65)"
                fontSize="11"
                fontFamily="JetBrains Mono, monospace"
              >
                {cor.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Room / Floor Zones */}
      {mapConfig.zones.map((zone) => {
        const style = ZONE_SVG_STYLES[zone.color] || ZONE_SVG_STYLES.slate;
        const zx = toSvgX(zone.x);
        const zy = toSvgY(zone.y);
        const zw = toSvgX(zone.w);
        const zh = toSvgY(zone.h);
        return (
          <g key={zone.id}>
            <rect
              x={zx}
              y={zy}
              width={zw}
              height={zh}
              rx={14}
              fill={style.fill}
              stroke={style.stroke}
              strokeWidth={1.6}
            />
            <text
              x={zx + 12}
              y={zy + 20}
              fill={style.label}
              fontSize={isLarge ? 14 : 13}
              fontWeight="700"
              fontFamily="Outfit, sans-serif"
              opacity={0.92}
            >
              {zone.label}
            </text>
            {zone.floorTag && (
              <text
                x={zx + zw - 10}
                y={zy + 19}
                textAnchor="end"
                fill={style.label}
                fontSize={11}
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
                opacity={0.7}
              >
                {zone.floorTag}
              </text>
            )}
          </g>
        );
      })}

      {/* Landmarks (Meeting Table, Stairs, Entrances) */}
      {mapConfig.landmarks.map((lm) => {
        const lx = toSvgX(lm.x);
        const ly = toSvgY(lm.y);
        const color =
          lm.kind === 'meeting'
            ? '#fbbf24'
            : lm.kind === 'hazard'
            ? '#fb7185'
            : lm.kind === 'entrance'
            ? '#34d399'
            : '#94a3b8';
        return (
          <g key={lm.id} transform={`translate(${lx}, ${ly})`}>
            <polygon
              points="0,-9 8,0 0,9 -8,0"
              fill={color}
              fillOpacity={0.22}
              stroke={color}
              strokeWidth={1.6}
            />
            <text
              x={0}
              y={21}
              textAnchor="middle"
              fill={color}
              fontSize={10.5}
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
              opacity={0.9}
            >
              {lm.label}
            </text>
          </g>
        );
      })}

      {/* Crisis Navigation Vectors: Current Task Station -> Active Sabotage Station(s) */}
      {sabotage &&
        currentPinEntry &&
        sabotagePinEntries.map((sabEntry) => {
          if (sabEntry.station.id === currentPinEntry.station.id) return null;
          const x1 = toSvgX(currentPinEntry.pin.x);
          const y1 = toSvgY(currentPinEntry.pin.y);
          const x2 = toSvgX(sabEntry.pin.x);
          const y2 = toSvgY(sabEntry.pin.y);
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
          const lineColor = isReactor ? '#fb7185' : '#fbbf24';
          return (
            <g key={`route_${sabEntry.station.id}`}>
              {/* Soft outer glow */}
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={lineColor}
                strokeOpacity={0.22}
                strokeWidth={9}
                strokeLinecap="round"
              />
              {/* Animated directional dashed beam */}
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={lineColor}
                strokeWidth={3.2}
                strokeDasharray="10 8"
                strokeLinecap="round"
                className="animate-map-route"
              />
              {/* Midpoint directional arrow chevron */}
              <g transform={`translate(${mx}, ${my}) rotate(${angle})`}>
                <circle r={11} fill="#070c18" stroke={lineColor} strokeWidth={2} />
                <path
                  d="M -4 -4 L 4 0 L -4 4"
                  fill="none"
                  stroke={lineColor}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </g>
          );
        })}

      {/* Personal Pinned Target Vector: Current Task Station -> Pinned Favorite/Target */}
      {pinnedPinEntry &&
        currentPinEntry &&
        pinnedPinEntry.station.id !== currentPinEntry.station.id &&
        !pinnedPinEntry.isSabotage && (
          <g pointerEvents="none">
            <line
              x1={toSvgX(currentPinEntry.pin.x)}
              y1={toSvgY(currentPinEntry.pin.y)}
              x2={toSvgX(pinnedPinEntry.pin.x)}
              y2={toSvgY(pinnedPinEntry.pin.y)}
              stroke="#facc15"
              strokeOpacity={sabotage ? 0.35 : 0.72}
              strokeWidth={sabotage ? 2 : 2.6}
              strokeDasharray="6 6"
              strokeLinecap="round"
            />
          </g>
        )}

      {/* Station Pins */}
      {resolvedPins.map((entry) => {
        const px = toSvgX(entry.pin.x);
        const py = toSvgY(entry.pin.y);
        const isSelected = selectedPinId === entry.station.id;
        const dimmedByComms =
          isCommsSabotaged &&
          !entry.isSabotage &&
          !entry.isCurrent &&
          !entry.isPinned;
        const shortLabel = entry.pin.shortName || entry.station.shortLabel;

        // Small persistent gold star badge for pins that also have Sabotage or Current styling
        const pinnedShoulderBadge = entry.isPinned ? (
          <g transform="translate(14, -14)" pointerEvents="none">
            <circle
              r={8.5}
              fill="#facc15"
              stroke="#060913"
              strokeWidth={1.8}
            />
            <polygon
              points="0,-5 1.4,-1.6 5,-1.6 2.1,0.7 3.2,4.2 0,2.1 -3.2,4.2 -2.1,0.7 -5,-1.6 -1.4,-1.6"
              fill="#060913"
            />
          </g>
        ) : null;

        if (entry.isSabotage) {
          const sabColor = isReactor ? '#f43f5e' : '#f59e0b';
          const sabLight = isReactor ? '#fecdd3' : '#fef3c7';
          return (
            <g
              key={entry.station.id}
              transform={`translate(${px}, ${py})`}
              onClick={() => {
                playUiClick();
                setSelectedPinId(entry.station.id);
              }}
              className="cursor-pointer"
            >
              <circle
                r={54}
                fill={`url(#${
                  isReactor
                    ? isLarge
                      ? 'reactor-glow-lg'
                      : 'reactor-glow-sm'
                    : isLarge
                    ? 'comms-glow-lg'
                    : 'comms-glow-sm'
                })`}
              />
              <circle
                r={26}
                fill="none"
                stroke={sabColor}
                strokeWidth={2.5}
                className="animate-map-sabotage-ring"
              />
              <circle
                r={isSelected ? 19 : 16}
                fill={sabColor}
                stroke="#ffffff"
                strokeWidth={2.5}
              />
              <text
                x={0}
                y={5}
                textAnchor="middle"
                fill="#060913"
                fontSize="16"
                fontWeight="900"
                fontFamily="Outfit, sans-serif"
              >
                !
              </text>
              <rect
                x={-Math.max(44, shortLabel.length * 4.4)}
                y={22}
                width={Math.max(88, shortLabel.length * 8.8)}
                height={20}
                rx={6}
                fill="rgba(6, 9, 19, 0.9)"
                stroke={sabColor}
                strokeWidth={1.2}
              />
              <text
                x={0}
                y={36}
                textAnchor="middle"
                fill={sabLight}
                fontSize="11.5"
                fontWeight="800"
                fontFamily="JetBrains Mono, monospace"
              >
                {shortLabel}
              </text>
              {pinnedShoulderBadge}
            </g>
          );
        }

        if (entry.isCurrent) {
          return (
            <g
              key={entry.station.id}
              transform={`translate(${px}, ${py})`}
              onClick={() => {
                playUiClick();
                setSelectedPinId(entry.station.id);
              }}
              className="cursor-pointer"
            >
              <circle
                r={24}
                fill="rgba(34, 211, 238, 0.16)"
                stroke={
                  entry.isPinned
                    ? 'rgba(250, 204, 21, 0.85)'
                    : 'rgba(34, 211, 238, 0.65)'
                }
                strokeWidth={1.8}
                strokeDasharray="4 4"
              />
              <circle
                r={isSelected ? 15 : 13}
                fill="#06b6d4"
                stroke="#ffffff"
                strokeWidth={2.4}
              />
              <circle r={4.5} fill="#060913" />
              <rect
                x={-Math.max(40, shortLabel.length * 4.2)}
                y={19}
                width={Math.max(80, shortLabel.length * 8.4)}
                height={19}
                rx={6}
                fill="rgba(6, 9, 19, 0.92)"
                stroke={
                  entry.isPinned
                    ? 'rgba(250, 204, 21, 0.85)'
                    : 'rgba(34, 211, 238, 0.7)'
                }
                strokeWidth={1.2}
              />
              <text
                x={0}
                y={32}
                textAnchor="middle"
                fill="#a5f3fc"
                fontSize="11"
                fontWeight="800"
                fontFamily="JetBrains Mono, monospace"
              >
                {shortLabel}
              </text>
              {pinnedShoulderBadge}
            </g>
          );
        }

        if (entry.isPinned) {
          return (
            <g
              key={entry.station.id}
              transform={`translate(${px}, ${py})`}
              onClick={() => {
                playUiClick();
                setSelectedPinId(entry.station.id);
              }}
              className="cursor-pointer"
            >
              <circle
                r={26}
                fill="rgba(250, 204, 21, 0.14)"
                stroke="rgba(250, 204, 21, 0.7)"
                strokeWidth={1.8}
                strokeDasharray="5 4"
              />
              <circle
                r={isSelected ? 16 : 14}
                fill="#facc15"
                stroke="#ffffff"
                strokeWidth={2.4}
              />
              <polygon
                points="0,-7.5 2.1,-2.3 7.6,-2.3 3.2,1 4.8,6.2 0,3 -4.8,6.2 -3.2,1 -7.6,-2.3 -2.1,-2.3"
                fill="#060913"
              />
              <rect
                x={-Math.max(44, shortLabel.length * 4.4)}
                y={20}
                width={Math.max(88, shortLabel.length * 8.8)}
                height={19}
                rx={6}
                fill="rgba(6, 9, 19, 0.94)"
                stroke="rgba(250, 204, 21, 0.85)"
                strokeWidth={1.3}
              />
              <text
                x={0}
                y={33}
                textAnchor="middle"
                fill="#fef08a"
                fontSize="11"
                fontWeight="800"
                fontFamily="JetBrains Mono, monospace"
              >
                ★ {shortLabel}
              </text>
            </g>
          );
        }

        const fill = entry.isCompleted
          ? '#10b981'
          : entry.isAssigned
          ? '#38bdf8'
          : '#475569';
        const stroke = isSelected
          ? '#ffffff'
          : entry.isCompleted
          ? '#a7f3d0'
          : entry.isAssigned
          ? '#bae6fd'
          : '#94a3b8';

        return (
          <g
            key={entry.station.id}
            transform={`translate(${px}, ${py})`}
            opacity={dimmedByComms ? 0.35 : entry.isAssigned ? 1 : 0.7}
            onClick={() => {
              playUiClick();
              setSelectedPinId(entry.station.id);
            }}
            className="cursor-pointer"
          >
            <circle
              r={isSelected ? 13 : entry.isAssigned ? 10.5 : 8}
              fill={fill}
              stroke={stroke}
              strokeWidth={isSelected ? 2.4 : 1.8}
            />
            {entry.isCompleted && (
              <path
                d="M -4 0 L -1 3 L 4 -3"
                fill="none"
                stroke="#060913"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            <text
              x={0}
              y={23}
              textAnchor="middle"
              fill={
                entry.isCompleted
                  ? '#a7f3d0'
                  : entry.isAssigned
                  ? '#e2e8f0'
                  : '#94a3b8'
              }
              fontSize={isLarge ? 12 : 11}
              fontWeight={entry.isAssigned ? '700' : '600'}
              fontFamily="JetBrains Mono, monospace"
            >
              {dimmedByComms ? '???' : shortLabel}
            </text>
          </g>
        );
      })}

      {/* Compass Rose (Top-Right) */}
      <g transform={`translate(${VIEW_W - 36}, 34)`} opacity={0.7}>
        <circle
          r={16}
          fill="rgba(7, 12, 24, 0.8)"
          stroke="rgba(148, 163, 184, 0.35)"
          strokeWidth={1.2}
        />
        <polygon points="0,-10 3.5,-1 0,-3 -3.5,-1" fill="#38bdf8" />
        <text
          x={0}
          y={9}
          textAnchor="middle"
          fill="#cbd5e1"
          fontSize="9"
          fontWeight="800"
          fontFamily="JetBrains Mono, monospace"
        >
          N
        </text>
      </g>
    </svg>
  );

  const renderInspectorBar = () => {
    if (!selectedPinEntry) return null;
    const isSab = selectedPinEntry.isSabotage;
    const isCur = selectedPinEntry.isCurrent;
    const isPin = selectedPinEntry.isPinned;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-950/90 border-t border-white/10 text-xs">
        <div className="min-w-0">
          <div className="font-display font-bold text-white truncate flex items-center gap-1.5">
            {isPin && (
              <Star className="w-3.5 h-3.5 text-yellow-300 fill-yellow-300 shrink-0" />
            )}
            <span>{selectedPinEntry.station.shortLabel}</span>
            {selectedPinEntry.pin.floor && (
              <span className="font-mono text-[10px] text-slate-400">
                · {selectedPinEntry.pin.floor}
              </span>
            )}
          </div>
          <div className="text-[11px] font-mono text-slate-400 truncate">
            {isPin && !isCur && selectedDirection && !selectedDirection.isSameSpot
              ? `Pinned Target · Head ${selectedDirection.compass} from ${
                  currentPinEntry?.pin.shortName || 'current task'
                }`
              : isCur
              ? isPin
                ? 'Current anchor & pinned target'
                : 'Current anchor station'
              : selectedDirection?.isSameSpot
              ? 'At your current station'
              : selectedDirection
              ? `Head ${selectedDirection.compass} from ${
                  currentPinEntry?.pin.shortName || 'current task'
                }`
              : selectedPinEntry.station.taskName}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onTogglePinStation && (
            <button
              type="button"
              onClick={() => {
                playUiClick();
                onTogglePinStation(selectedPinEntry.station.id);
              }}
              className={`min-h-[36px] px-2.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap transition-colors ${
                isPin
                  ? 'bg-yellow-400/20 border-yellow-400/60 text-yellow-200 hover:bg-yellow-400/30'
                  : 'bg-slate-800 hover:bg-slate-700 border-white/12 text-slate-200'
              }`}
            >
              <Pin className="w-3.5 h-3.5" />
              <span>{isPin ? 'Unpin' : 'Pin Target'}</span>
            </button>
          )}
          {!isCur && (
            <button
              type="button"
              onClick={() => {
                playUiClick();
                onSelectCurrentStation(selectedPinEntry.station.id);
              }}
              className="min-h-[36px] px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/12 text-[11px] font-semibold text-cyan-200 whitespace-nowrap"
            >
              Set Current
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              playUiClick();
              setFullScreenOpen(false);
              onScanStation(selectedPinEntry.station.id);
            }}
            className={`min-h-[36px] px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap ${
              isSab
                ? isReactor
                  ? 'bg-rose-500 hover:bg-rose-400 text-white'
                  : 'bg-amber-400 hover:bg-amber-300 text-slate-950'
                : 'bg-cyan-400 hover:bg-cyan-300 text-slate-950'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>{isSab ? 'Defuse QR' : 'Scan QR'}</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <div
        className={`shrink-0 glass-card rounded-2xl overflow-hidden transition-colors duration-200 ${
          sabotage
            ? isReactor
              ? 'border-rose-400/75 shadow-[0_0_24px_rgba(244,63,94,0.22)]'
              : 'border-amber-400/75 shadow-[0_0_24px_rgba(245,158,11,0.22)]'
            : 'border-white/12'
        }`}
      >
        {/* Compact Header Strip */}
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => {
              if (alwaysExpanded) return;
              playUiClick();
              setIsOpen((v) => !v);
            }}
            className="flex-1 min-w-0 flex items-center gap-2 text-left min-h-[36px]"
          >
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                sabotage
                  ? isReactor
                    ? 'bg-rose-500/20 border-rose-400/50 text-rose-300'
                    : 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                  : 'bg-cyan-500/15 border-cyan-400/35 text-cyan-300'
              }`}
            >
              {sabotage ? (
                isReactor ? (
                  <AlertTriangle className="w-4 h-4" />
                ) : (
                  <Radio className="w-4 h-4" />
                )
              ) : (
                <MapIcon className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-display font-bold text-white truncate">
                <span className="truncate">{mapConfig.mapTitle}</span>
              </div>
              <div
                className={`text-[11px] font-mono truncate ${
                  sabotage
                    ? isReactor
                      ? 'text-rose-200'
                      : 'text-amber-200'
                    : pinnedGuidance
                    ? 'text-yellow-200'
                    : 'text-slate-400'
                }`}
              >
                {crisisGuidance ? (
                  crisisGuidance.isSameSpot ? (
                    `Sabotage at current station (${crisisGuidance.toName})`
                  ) : (
                    `Go ${crisisGuidance.compass} → ${crisisGuidance.toName}${
                      crisisGuidance.toFloor ? ` (${crisisGuidance.toFloor})` : ''
                    }`
                  )
                ) : pinnedGuidance ? (
                  pinnedGuidance.isSameSpot ? (
                    `★ Pinned Target: ${pinnedGuidance.toName} (Here)`
                  ) : (
                    `★ Target: ${pinnedGuidance.toName} · Head ${pinnedGuidance.compass}`
                  )
                ) : currentPinEntry ? (
                  `Current: ${
                    currentPinEntry.pin.shortName ||
                    currentPinEntry.station.shortLabel
                  }`
                ) : (
                  'Tap to view campus layout'
                )}
              </div>
            </div>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                playUiClick();
                setFullScreenOpen(true);
              }}
              aria-label="Expand full campus map"
              title="Expand full map"
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-white/10 text-cyan-300 transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            {!alwaysExpanded && (
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setIsOpen((v) => !v);
                }}
                aria-label={isOpen ? 'Collapse minimap' : 'Show minimap'}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-white/10 text-slate-300 hover:text-white transition-colors"
              >
                {isOpen ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Inline Minimap Blueprint Viewport */}
        {isOpen && (
          <div className="border-t border-white/10">
            <div className="relative w-full aspect-[16/10] max-h-[210px] sm:max-h-[240px] bg-[#070c18] overflow-hidden">
              {renderBlueprintSvg(false)}
            </div>

            {renderInspectorBar()}

            {/* Quiet Unboxed Legend Line */}
            <div className="px-3 py-1.5 bg-slate-950/80 border-t border-white/10 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] font-mono text-slate-400">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                <span className="text-cyan-300">● Current Task</span>
                <span aria-hidden="true">·</span>
                <span className="text-sky-300">● Assigned</span>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-300">● Done</span>
                {pinnedPinEntry && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-yellow-300">★ Target</span>
                  </>
                )}
                {sabotage && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className={isReactor ? 'text-rose-300' : 'text-amber-300'}>
                      ! {isReactor ? 'Reactor' : 'Comms'}
                    </span>
                  </>
                )}
              </div>
              <span className="text-slate-500">Tap any pin to navigate</span>
            </div>
          </div>
        )}
      </div>

      {/* Fullscreen Tactical Map Modal */}
      {fullScreenOpen && (
        <div
          onClick={() => setFullScreenOpen(false)}
          className="fixed inset-0 z-50 bg-[#050812]/94 backdrop-blur-xl flex items-center justify-center p-2.5 sm:p-5"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl max-h-[94dvh] glass-card rounded-3xl overflow-hidden flex flex-col border-cyan-400/30"
          >
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold text-white truncate flex items-center gap-2">
                  <Compass className="w-4 h-4 text-cyan-300 shrink-0" />
                  <span>{mapConfig.mapTitle}</span>
                </h3>
                <p className="text-xs font-mono text-slate-400 truncate">
                  {crisisGuidance ? (
                    <span className={isReactor ? 'text-rose-300' : 'text-amber-300'}>
                      Crisis Vector: From {crisisGuidance.fromName} → Head{' '}
                      {crisisGuidance.compass} to {crisisGuidance.toName}
                    </span>
                  ) : (
                    mapConfig.subtitle || 'Tap a pin to set current location or scan QR'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setFullScreenOpen(false);
                }}
                aria-label="Close full map"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 text-slate-300 hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 min-h-0 bg-[#070c18] p-2 sm:p-3 flex items-center justify-center overflow-auto">
              <div className="w-full aspect-[16/10] max-h-[64dvh] rounded-xl overflow-hidden border border-white/10">
                {renderBlueprintSvg(true)}
              </div>
            </div>

            {renderInspectorBar()}

            <div className="shrink-0 px-4 py-2.5 bg-slate-950/90 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-cyan-300">● Current Task</span>
                <span className="text-sky-300">● Assigned</span>
                <span className="text-emerald-300">● Done</span>
                {pinnedPinEntry && (
                  <span className="text-yellow-300">★ Pinned Target</span>
                )}
                <span className="text-amber-300">◆ Landmark</span>
                {sabotage && (
                  <span className={isReactor ? 'text-rose-300' : 'text-amber-300'}>
                    <Navigation className="w-3 h-3 inline mr-1" />
                    Active Sabotage Route
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setFullScreenOpen(false);
                }}
                className="min-h-[36px] px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-sans text-xs font-semibold"
              >
                Close Map
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
