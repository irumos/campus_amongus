import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  Grid3X3,
  Image as ImageIcon,
  Landmark,
  Magnet,
  MapPin,
  MousePointer2,
  Radio,
  RotateCcw,
  Route,
  Save,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  createBlankCanvasPreset,
  createCorridorGridPreset,
  createDefaultCampusMap,
  exportCampusMapJson,
  importCampusMapJson,
  resolveStationPin,
  saveCampusMap,
  useCampusMap,
  type CampusMapConfig,
  type CampusMapCorridor,
  type CampusMapLandmark,
  type CampusMapZone,
  type MapCorridorKind,
  type MapLandmarkKind,
  type MapZoneColor,
} from '../config/mapStore';
import { useCampusStations } from '../config/stationStore';
import { playTaskSuccessFeedback, playUiClick } from '../utils/feedback';

interface DeveloperMapEditorProps {
  activeRoomCode: string;
  onSyncMapToRoom?: (config: CampusMapConfig) => void;
  onNotice?: (message: string) => void;
}

type EditorTool = 'select' | 'add-zone' | 'add-corridor' | 'add-landmark';

type SelectedItem =
  | { type: 'zone'; id: string }
  | { type: 'station'; id: string }
  | { type: 'corridor'; id: string }
  | { type: 'landmark'; id: string }
  | null;

type DragAction =
  | {
      kind: 'zone-move';
      id: string;
      offsetX: number;
      offsetY: number;
    }
  | {
      kind: 'zone-resize';
      id: string;
    }
  | {
      kind: 'station-move';
      id: string;
    }
  | {
      kind: 'landmark-move';
      id: string;
    }
  | {
      kind: 'corridor-end';
      id: string;
      end: 'from' | 'to';
    };

const VIEW_W = 1000;
const VIEW_H = 625;

const ZONE_COLORS: { id: MapZoneColor; label: string; hex: string }[] = [
  { id: 'cyan', label: 'Cyan', hex: '#06b6d4' },
  { id: 'emerald', label: 'Emerald', hex: '#10b981' },
  { id: 'amber', label: 'Amber', hex: '#f59e0b' },
  { id: 'violet', label: 'Violet', hex: '#8b5cf6' },
  { id: 'rose', label: 'Rose', hex: '#f43f5e' },
  { id: 'slate', label: 'Slate', hex: '#94a3b8' },
];

const ZONE_STYLES: Record<
  MapZoneColor,
  { fill: string; stroke: string; label: string }
> = {
  cyan: {
    fill: 'rgba(6, 182, 212, 0.14)',
    stroke: 'rgba(34, 211, 238, 0.5)',
    label: '#a5f3fc',
  },
  emerald: {
    fill: 'rgba(16, 185, 129, 0.14)',
    stroke: 'rgba(52, 211, 153, 0.5)',
    label: '#a7f3d0',
  },
  amber: {
    fill: 'rgba(245, 158, 11, 0.14)',
    stroke: 'rgba(251, 191, 36, 0.5)',
    label: '#fde68a',
  },
  violet: {
    fill: 'rgba(139, 92, 246, 0.15)',
    stroke: 'rgba(167, 139, 250, 0.52)',
    label: '#ddd6fe',
  },
  rose: {
    fill: 'rgba(244, 63, 94, 0.14)',
    stroke: 'rgba(251, 113, 133, 0.5)',
    label: '#fecdd3',
  },
  slate: {
    fill: 'rgba(148, 163, 184, 0.1)',
    stroke: 'rgba(148, 163, 184, 0.42)',
    label: '#cbd5e1',
  },
};

function toSvgX(pct: number): number {
  return (pct / 100) * VIEW_W;
}

function toSvgY(pct: number): number {
  return (pct / 100) * VIEW_H;
}

function clampVal(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v * 10) / 10));
}

function makeUid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

async function compressFloorplanImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported image format.'));
      img.onload = () => {
        const maxWidth = 960;
        const maxHeight = 600;
        const ratio = Math.min(
          1,
          maxWidth / Math.max(1, img.width),
          maxHeight / Math.max(1, img.height)
        );
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.fillStyle = '#070c18';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export function DeveloperMapEditor({
  activeRoomCode,
  onSyncMapToRoom,
  onNotice,
}: DeveloperMapEditorProps) {
  const stations = useCampusStations();
  const storedMap = useCampusMap();

  const [draft, setDraft] = useState<CampusMapConfig>(() => storedMap);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [tool, setTool] = useState<EditorTool>('select');
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [crisisPreview, setCrisisPreview] = useState<
    'off' | 'reactor' | 'comms'
  >('off');
  const [justSaved, setJustSaved] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragAction | null>(null);
  const floorplanInputRef = useRef<HTMLInputElement | null>(null);
  const jsonImportInputRef = useRef<HTMLInputElement | null>(null);

  // Sync draft when external map resets occur and user has no unsaved edits
  useEffect(() => {
    if (!hasUnsavedChanges) {
      setDraft(storedMap);
    }
  }, [storedMap, hasUnsavedChanges]);

  const snap = useCallback(
    (val: number) => (snapToGrid ? Math.round(val / 2) * 2 : clampVal(val, 0, 100)),
    [snapToGrid]
  );

  const updateDraft = useCallback(
    (updater: (prev: CampusMapConfig) => CampusMapConfig) => {
      setDraft((prev) => updater(prev));
      setHasUnsavedChanges(true);
    },
    []
  );

  const resolvedStationList = useMemo(
    () =>
      stations.map((st, idx) => ({
        station: st,
        pin: resolveStationPin(draft, st, idx),
      })),
    [stations, draft]
  );

  const getPointerPct = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 50, y: 50 };
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * 100;
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * 100;
    return {
      x: clampVal(x, 1, 99),
      y: clampVal(y, 1, 99),
    };
  }, []);

  const handleCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const pt = getPointerPct(e.clientX, e.clientY);

    if (tool === 'add-zone') {
      playUiClick();
      const newZone: CampusMapZone = {
        id: makeUid('zone'),
        label: `Room ${draft.zones.length + 1}`,
        floorTag: '1F',
        x: clampVal(snap(pt.x - 11), 2, 76),
        y: clampVal(snap(pt.y - 10), 2, 76),
        w: 22,
        h: 20,
        color: 'cyan',
      };
      updateDraft((prev) => ({
        ...prev,
        zones: [...prev.zones, newZone],
      }));
      setSelected({ type: 'zone', id: newZone.id });
      setTool('select');
      return;
    }

    if (tool === 'add-corridor') {
      playUiClick();
      const sx = clampVal(snap(pt.x - 8), 4, 88);
      const sy = clampVal(snap(pt.y), 4, 96);
      const newCor: CampusMapCorridor = {
        id: makeUid('cor'),
        fromX: sx,
        fromY: sy,
        toX: clampVal(sx + 16, 6, 96),
        toY: sy,
        kind: 'hallway',
      };
      updateDraft((prev) => ({
        ...prev,
        corridors: [...prev.corridors, newCor],
      }));
      setSelected({ type: 'corridor', id: newCor.id });
      setTool('select');
      return;
    }

    if (tool === 'add-landmark') {
      playUiClick();
      const newLm: CampusMapLandmark = {
        id: makeUid('lm'),
        label: 'Landmark',
        kind: 'stairs',
        x: clampVal(snap(pt.x), 4, 96),
        y: clampVal(snap(pt.y), 5, 95),
      };
      updateDraft((prev) => ({
        ...prev,
        landmarks: [...prev.landmarks, newLm],
      }));
      setSelected({ type: 'landmark', id: newLm.id });
      setTool('select');
      return;
    }

    // Clicked empty background in select mode
    if (e.target === e.currentTarget || (e.target as Element).getAttribute('data-canvas-bg') === 'true') {
      setSelected(null);
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const pt = getPointerPct(e.clientX, e.clientY);

    if (drag.kind === 'zone-move') {
      updateDraft((prev) => ({
        ...prev,
        zones: prev.zones.map((z) => {
          if (z.id !== drag.id) return z;
          const nx = clampVal(snap(pt.x - drag.offsetX), 0, 100 - z.w);
          const ny = clampVal(snap(pt.y - drag.offsetY), 0, 100 - z.h);
          return { ...z, x: nx, y: ny };
        }),
      }));
    } else if (drag.kind === 'zone-resize') {
      updateDraft((prev) => ({
        ...prev,
        zones: prev.zones.map((z) => {
          if (z.id !== drag.id) return z;
          const nw = clampVal(snap(pt.x - z.x), 8, 100 - z.x);
          const nh = clampVal(snap(pt.y - z.y), 8, 100 - z.y);
          return { ...z, w: nw, h: nh };
        }),
      }));
    } else if (drag.kind === 'station-move') {
      const nx = clampVal(snap(pt.x), 3, 97);
      const ny = clampVal(snap(pt.y), 4, 96);
      updateDraft((prev) => {
        const existing = prev.stationPins[drag.id];
        return {
          ...prev,
          stationPins: {
            ...prev.stationPins,
            [drag.id]: {
              stationId: drag.id,
              shortName: existing?.shortName,
              floor: existing?.floor,
              x: nx,
              y: ny,
            },
          },
        };
      });
    } else if (drag.kind === 'landmark-move') {
      const nx = clampVal(snap(pt.x), 3, 97);
      const ny = clampVal(snap(pt.y), 4, 96);
      updateDraft((prev) => ({
        ...prev,
        landmarks: prev.landmarks.map((l) =>
          l.id === drag.id ? { ...l, x: nx, y: ny } : l
        ),
      }));
    } else if (drag.kind === 'corridor-end') {
      const nx = clampVal(snap(pt.x), 2, 98);
      const ny = clampVal(snap(pt.y), 2, 98);
      updateDraft((prev) => ({
        ...prev,
        corridors: prev.corridors.map((c) => {
          if (c.id !== drag.id) return c;
          return drag.end === 'from'
            ? { ...c, fromX: nx, fromY: ny }
            : { ...c, toX: nx, toY: ny };
        }),
      }));
    }
  };

  const handleCanvasPointerUp = () => {
    dragRef.current = null;
  };

  const startDrag = (
    e: React.PointerEvent,
    action: DragAction,
    sel: SelectedItem
  ) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // ignore if unsupported
    }
    dragRef.current = action;
    setSelected(sel);
  };

  const handleSaveAndSync = () => {
    playTaskSuccessFeedback();
    const saved = saveCampusMap(draft);
    setDraft(saved);
    setHasUnsavedChanges(false);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1800);
    onSyncMapToRoom?.(saved);
    onNotice?.(`Saved & synced "${saved.mapTitle}" to room ${activeRoomCode}`);
  };

  const handleUploadFloorplan = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await compressFloorplanImage(file);
      updateDraft((prev) => ({
        ...prev,
        backgroundImageDataUrl: dataUrl,
      }));
      playTaskSuccessFeedback();
      onNotice?.('Floorplan image loaded — position pins over your rooms & save');
    } catch (err) {
      onNotice?.(
        err instanceof Error ? err.message : 'Failed to load floorplan image'
      );
    }
  };

  const handleExportJson = () => {
    playUiClick();
    const json = exportCampusMapJson(draft);
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `campus-map-${activeRoomCode.toLowerCase()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onNotice?.('Exported map blueprint JSON');
    } catch {
      void navigator.clipboard?.writeText(json);
      onNotice?.('Copied map blueprint JSON to clipboard');
    }
  };

  const handleImportJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = importCampusMapJson(String(reader.result || ''));
      if (res.ok) {
        setDraft(res.config);
        setHasUnsavedChanges(false);
        setSelected(null);
        onSyncMapToRoom?.(res.config);
        playTaskSuccessFeedback();
        onNotice?.(`Imported "${res.config.mapTitle}" & synced to room`);
      } else {
        onNotice?.(res.error);
      }
    };
    reader.readAsText(file);
  };

  // Preview Crisis Vector (for developer testing)
  const previewCurrentPin = resolvedStationList[0] || null;
  const previewSabotagePin =
    crisisPreview === 'reactor'
      ? resolvedStationList.find((s) => s.station.id === 'ELECTRICAL') ||
        resolvedStationList[resolvedStationList.length - 1] ||
        null
      : crisisPreview === 'comms'
      ? resolvedStationList.find((s) => s.station.id === 'CYBER_LAB') ||
        resolvedStationList[Math.min(1, resolvedStationList.length - 1)] ||
        null
      : null;

  const selectedZone =
    selected?.type === 'zone'
      ? draft.zones.find((z) => z.id === selected.id) || null
      : null;
  const selectedCorridor =
    selected?.type === 'corridor'
      ? draft.corridors.find((c) => c.id === selected.id) || null
      : null;
  const selectedLandmark =
    selected?.type === 'landmark'
      ? draft.landmarks.find((l) => l.id === selected.id) || null
      : null;
  const selectedStationEntry =
    selected?.type === 'station'
      ? resolvedStationList.find((s) => s.station.id === selected.id) || null
      : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
      {/* Top Designer Toolbar */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-950/80 border border-white/10 p-2">
        {/* Drawing Tools */}
        <div className="flex items-center gap-1 flex-wrap">
          {(
            [
              { id: 'select', label: 'Move / Edit', icon: MousePointer2 },
              { id: 'add-zone', label: 'Add Room', icon: Square },
              { id: 'add-corridor', label: 'Add Path', icon: Route },
              { id: 'add-landmark', label: 'Add Marker', icon: Landmark },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tool === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  playUiClick();
                  setTool(item.id);
                }}
                className={`h-9 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-cyan-400 text-slate-950'
                    : 'bg-slate-900 text-slate-300 hover:text-white border border-white/10'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Utility Toggles + Preview + Save */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => {
              playUiClick();
              updateDraft((prev) => ({ ...prev, showGrid: !prev.showGrid }));
            }}
            className={`h-9 px-2.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              draft.showGrid
                ? 'bg-slate-800 border-cyan-400/40 text-cyan-200'
                : 'bg-slate-900 border-white/10 text-slate-400'
            }`}
          >
            <Grid3X3 className="w-3.5 h-3.5" />
            <span>Grid</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playUiClick();
              setSnapToGrid((v) => !v);
            }}
            className={`h-9 px-2.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              snapToGrid
                ? 'bg-slate-800 border-cyan-400/40 text-cyan-200'
                : 'bg-slate-900 border-white/10 text-slate-400'
            }`}
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>Snap</span>
          </button>

          {/* Crisis Preview Switcher */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-900 border border-white/10">
            {(
              [
                { id: 'off', label: 'Normal' },
                { id: 'reactor', label: 'Reactor' },
                { id: 'comms', label: 'Comms' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  playUiClick();
                  setCrisisPreview(opt.id);
                }}
                className={`h-8 px-2.5 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 ${
                  crisisPreview === opt.id
                    ? opt.id === 'reactor'
                      ? 'bg-rose-500 text-white'
                      : opt.id === 'comms'
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSaveAndSync}
            className={`h-9 px-3.5 rounded-xl text-xs font-extrabold uppercase tracking-wide flex items-center gap-1.5 transition-all active:scale-95 whitespace-nowrap shrink-0 ${
              justSaved
                ? 'bg-emerald-400 text-slate-950'
                : hasUnsavedChanges
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-[0_0_18px_rgba(16,185,129,0.4)]'
                : 'bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/45 text-emerald-200'
            }`}
          >
            {justSaved ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Synced</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save &amp; Sync Map</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main 2-Column Workspace: Interactive Canvas + Inspector */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 overflow-hidden">
        {/* Interactive Map Canvas */}
        <div className="lg:col-span-8 flex flex-col gap-2 min-h-0">
          <div className="relative flex-1 min-h-[260px] rounded-2xl bg-[#070c18] border border-white/12 overflow-hidden flex items-center justify-center p-2">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
              className={`w-full h-full max-h-full aspect-[16/10] touch-none select-none ${
                tool === 'select' ? 'cursor-default' : 'cursor-crosshair'
              }`}
            >
              <defs>
                <pattern
                  id="editor-grid"
                  width="40"
                  height="40"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 40 0 L 0 0 0 40"
                    fill="none"
                    stroke="rgba(148, 163, 184, 0.1)"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>

              <rect
                data-canvas-bg="true"
                x={0}
                y={0}
                width={VIEW_W}
                height={VIEW_H}
                fill="#070c18"
              />

              {draft.backgroundImageDataUrl && (
                <image
                  href={draft.backgroundImageDataUrl}
                  x={0}
                  y={0}
                  width={VIEW_W}
                  height={VIEW_H}
                  preserveAspectRatio="xMidYMid meet"
                  opacity={draft.backgroundOpacity}
                  pointerEvents="none"
                />
              )}

              {draft.showGrid && (
                <rect
                  data-canvas-bg="true"
                  x={0}
                  y={0}
                  width={VIEW_W}
                  height={VIEW_H}
                  fill="url(#editor-grid)"
                />
              )}

              {/* Corridors */}
              {draft.corridors.map((cor) => {
                const isSel =
                  selected?.type === 'corridor' && selected.id === cor.id;
                const x1 = toSvgX(cor.fromX);
                const y1 = toSvgY(cor.fromY);
                const x2 = toSvgX(cor.toX);
                const y2 = toSvgY(cor.toY);
                const stroke = isSel
                  ? '#22d3ee'
                  : cor.kind === 'stairs'
                  ? 'rgba(251, 191, 36, 0.55)'
                  : cor.kind === 'outdoor'
                  ? 'rgba(52, 211, 153, 0.45)'
                  : 'rgba(148, 163, 184, 0.45)';
                return (
                  <g key={cor.id}>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="transparent"
                      strokeWidth={18}
                      className="cursor-pointer"
                      onPointerDown={(e) => {
                        if (tool !== 'select') return;
                        e.stopPropagation();
                        setSelected({ type: 'corridor', id: cor.id });
                      }}
                    />
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={stroke}
                      strokeWidth={cor.kind === 'hallway' ? 8 : 5}
                      strokeLinecap="round"
                      strokeDasharray={
                        cor.kind === 'stairs'
                          ? '6 5'
                          : cor.kind === 'outdoor'
                          ? '3 6'
                          : undefined
                      }
                      pointerEvents="none"
                    />
                    {cor.label && (
                      <text
                        x={(x1 + x2) / 2}
                        y={(y1 + y2) / 2 - 9}
                        textAnchor="middle"
                        fill="#cbd5e1"
                        fontSize="11"
                        fontFamily="JetBrains Mono, monospace"
                        pointerEvents="none"
                      >
                        {cor.label}
                      </text>
                    )}
                    {isSel && (
                      <>
                        <circle
                          cx={x1}
                          cy={y1}
                          r={8}
                          fill="#22d3ee"
                          stroke="#060913"
                          strokeWidth={2}
                          className="cursor-grab"
                          onPointerDown={(e) =>
                            startDrag(
                              e,
                              { kind: 'corridor-end', id: cor.id, end: 'from' },
                              { type: 'corridor', id: cor.id }
                            )
                          }
                        />
                        <circle
                          cx={x2}
                          cy={y2}
                          r={8}
                          fill="#22d3ee"
                          stroke="#060913"
                          strokeWidth={2}
                          className="cursor-grab"
                          onPointerDown={(e) =>
                            startDrag(
                              e,
                              { kind: 'corridor-end', id: cor.id, end: 'to' },
                              { type: 'corridor', id: cor.id }
                            )
                          }
                        />
                      </>
                    )}
                  </g>
                );
              })}

              {/* Room Zones */}
              {draft.zones.map((zone) => {
                const isSel =
                  selected?.type === 'zone' && selected.id === zone.id;
                const style = ZONE_STYLES[zone.color] || ZONE_STYLES.slate;
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
                      stroke={isSel ? '#ffffff' : style.stroke}
                      strokeWidth={isSel ? 2.5 : 1.6}
                      strokeDasharray={isSel ? '6 3' : undefined}
                      className={tool === 'select' ? 'cursor-move' : ''}
                      onPointerDown={(e) => {
                        const pt = getPointerPct(e.clientX, e.clientY);
                        startDrag(
                          e,
                          {
                            kind: 'zone-move',
                            id: zone.id,
                            offsetX: pt.x - zone.x,
                            offsetY: pt.y - zone.y,
                          },
                          { type: 'zone', id: zone.id }
                        );
                      }}
                    />
                    <text
                      x={zx + 12}
                      y={zy + 20}
                      fill={style.label}
                      fontSize="13.5"
                      fontWeight="700"
                      fontFamily="Outfit, sans-serif"
                      pointerEvents="none"
                    >
                      {zone.label}
                    </text>
                    {zone.floorTag && (
                      <text
                        x={zx + zw - 10}
                        y={zy + 19}
                        textAnchor="end"
                        fill={style.label}
                        fontSize="11"
                        fontWeight="700"
                        fontFamily="JetBrains Mono, monospace"
                        opacity={0.75}
                        pointerEvents="none"
                      >
                        {zone.floorTag}
                      </text>
                    )}
                    {/* Bottom-right resize handle */}
                    {isSel && (
                      <rect
                        x={zx + zw - 10}
                        y={zy + zh - 10}
                        width={14}
                        height={14}
                        rx={3}
                        fill="#22d3ee"
                        stroke="#060913"
                        strokeWidth={2}
                        className="cursor-nwse-resize"
                        onPointerDown={(e) =>
                          startDrag(
                            e,
                            { kind: 'zone-resize', id: zone.id },
                            { type: 'zone', id: zone.id }
                          )
                        }
                      />
                    )}
                  </g>
                );
              })}

              {/* Landmarks */}
              {draft.landmarks.map((lm) => {
                const isSel =
                  selected?.type === 'landmark' && selected.id === lm.id;
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
                  <g
                    key={lm.id}
                    transform={`translate(${lx}, ${ly})`}
                    className={tool === 'select' ? 'cursor-grab' : ''}
                    onPointerDown={(e) =>
                      startDrag(
                        e,
                        { kind: 'landmark-move', id: lm.id },
                        { type: 'landmark', id: lm.id }
                      )
                    }
                  >
                    {isSel && (
                      <circle
                        r={16}
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth={1.6}
                        strokeDasharray="3 3"
                      />
                    )}
                    <polygon
                      points="0,-10 9,0 0,10 -9,0"
                      fill={color}
                      fillOpacity={0.3}
                      stroke={color}
                      strokeWidth={2}
                    />
                    <text
                      x={0}
                      y={22}
                      textAnchor="middle"
                      fill={color}
                      fontSize="11"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                      pointerEvents="none"
                    >
                      {lm.label}
                    </text>
                  </g>
                );
              })}

              {/* Crisis Preview Overlay */}
              {crisisPreview !== 'off' &&
                previewCurrentPin &&
                previewSabotagePin &&
                previewCurrentPin.station.id !==
                  previewSabotagePin.station.id && (
                  <g pointerEvents="none">
                    <line
                      x1={toSvgX(previewCurrentPin.pin.x)}
                      y1={toSvgY(previewCurrentPin.pin.y)}
                      x2={toSvgX(previewSabotagePin.pin.x)}
                      y2={toSvgY(previewSabotagePin.pin.y)}
                      stroke={crisisPreview === 'reactor' ? '#fb7185' : '#fbbf24'}
                      strokeWidth={3.5}
                      strokeDasharray="10 8"
                      strokeLinecap="round"
                      className="animate-map-route"
                    />
                  </g>
                )}

              {/* Draggable Task Station Pins */}
              {resolvedStationList.map(({ station, pin }) => {
                const isSel =
                  selected?.type === 'station' && selected.id === station.id;
                const isPreviewSab =
                  crisisPreview !== 'off' &&
                  previewSabotagePin?.station.id === station.id;
                const isPreviewCurrent =
                  crisisPreview !== 'off' &&
                  previewCurrentPin?.station.id === station.id;
                const px = toSvgX(pin.x);
                const py = toSvgY(pin.y);
                const label = pin.shortName || station.id;
                const fill = isPreviewSab
                  ? crisisPreview === 'reactor'
                    ? '#f43f5e'
                    : '#f59e0b'
                  : isPreviewCurrent
                  ? '#06b6d4'
                  : '#38bdf8';

                return (
                  <g
                    key={station.id}
                    transform={`translate(${px}, ${py})`}
                    className={tool === 'select' ? 'cursor-grab' : ''}
                    onPointerDown={(e) =>
                      startDrag(
                        e,
                        { kind: 'station-move', id: station.id },
                        { type: 'station', id: station.id }
                      )
                    }
                  >
                    {isPreviewSab && (
                      <circle
                        r={24}
                        fill="none"
                        stroke={fill}
                        strokeWidth={2.5}
                        className="animate-map-sabotage-ring"
                      />
                    )}
                    {isSel && (
                      <circle
                        r={19}
                        fill="rgba(34, 211, 238, 0.16)"
                        stroke="#ffffff"
                        strokeWidth={1.8}
                        strokeDasharray="4 3"
                      />
                    )}
                    <circle
                      r={13}
                      fill={fill}
                      stroke="#ffffff"
                      strokeWidth={isSel ? 2.8 : 2}
                    />
                    <text
                      x={0}
                      y={4}
                      textAnchor="middle"
                      fill="#060913"
                      fontSize="11"
                      fontWeight="900"
                      fontFamily="JetBrains Mono, monospace"
                      pointerEvents="none"
                    >
                      {isPreviewSab ? '!' : 'Q'}
                    </text>
                    <rect
                      x={-Math.max(38, label.length * 3.8)}
                      y={17}
                      width={Math.max(76, label.length * 7.6)}
                      height={18}
                      rx={5}
                      fill="rgba(6, 9, 19, 0.9)"
                      stroke={isSel ? '#22d3ee' : 'rgba(255,255,255,0.18)'}
                      strokeWidth={1}
                      pointerEvents="none"
                    />
                    <text
                      x={0}
                      y={30}
                      textAnchor="middle"
                      fill="#f8fafc"
                      fontSize="10.5"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                      pointerEvents="none"
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] font-mono text-slate-400">
            <span>
              {tool === 'select'
                ? 'Drag rooms, pins, paths, or markers directly on the canvas.'
                : tool === 'add-zone'
                ? 'Click anywhere on the map to place a new room zone.'
                : tool === 'add-corridor'
                ? 'Click anywhere on the map to drop a connecting path.'
                : 'Click anywhere on the map to place a landmark marker.'}
            </span>
            <span className="tabular-nums text-slate-500">
              {draft.zones.length} rooms · {draft.corridors.length} paths ·{' '}
              {resolvedStationList.length} QR pins
            </span>
          </div>
        </div>

        {/* Right Inspector & Settings Sidebar */}
        <div className="lg:col-span-4 flex flex-col gap-3 min-h-0 overflow-y-auto pr-0.5">
          {/* Context-Sensitive Selected Item Inspector */}
          <div className="rounded-2xl bg-slate-950/80 border border-white/10 p-3.5 space-y-3">
            {selectedZone ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                    <Square className="w-3.5 h-3.5" />
                    <span>Edit Room Zone</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      playUiClick();
                      updateDraft((prev) => ({
                        ...prev,
                        zones: prev.zones.filter((z) => z.id !== selectedZone.id),
                      }));
                      setSelected(null);
                    }}
                    className="h-8 px-2.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-200 text-[11px] font-bold flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Delete</span>
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Zone Label
                    </label>
                    <input
                      type="text"
                      value={selectedZone.label}
                      onChange={(e) =>
                        updateDraft((prev) => ({
                          ...prev,
                          zones: prev.zones.map((z) =>
                            z.id === selectedZone.id
                              ? { ...z, label: e.target.value }
                              : z
                          ),
                        }))
                      }
                      className="w-full h-9 rounded-lg bg-slate-900 border border-white/12 px-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Floor Tag
                    </label>
                    <input
                      type="text"
                      maxLength={8}
                      value={selectedZone.floorTag || ''}
                      placeholder="GF / 1F"
                      onChange={(e) =>
                        updateDraft((prev) => ({
                          ...prev,
                          zones: prev.zones.map((z) =>
                            z.id === selectedZone.id
                              ? { ...z, floorTag: e.target.value }
                              : z
                          ),
                        }))
                      }
                      className="w-full h-9 rounded-lg bg-slate-900 border border-white/12 px-2.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1.5">
                    Zone Accent Color
                  </label>
                  <div className="flex items-center gap-1.5">
                    {ZONE_COLORS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        title={c.label}
                        onClick={() => {
                          playUiClick();
                          updateDraft((prev) => ({
                            ...prev,
                            zones: prev.zones.map((z) =>
                              z.id === selectedZone.id
                                ? { ...z, color: c.id }
                                : z
                            ),
                          }));
                        }}
                        className={`w-7 h-7 rounded-lg border-2 transition-transform ${
                          selectedZone.color === c.id
                            ? 'border-white scale-110'
                            : 'border-transparent opacity-70 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: c.hex }}
                      />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1.5 text-[10px] font-mono text-slate-400 tabular-nums">
                  <div>
                    X: <strong className="text-white">{selectedZone.x}%</strong>
                  </div>
                  <div>
                    Y: <strong className="text-white">{selectedZone.y}%</strong>
                  </div>
                  <div>
                    W: <strong className="text-white">{selectedZone.w}%</strong>
                  </div>
                  <div>
                    H: <strong className="text-white">{selectedZone.h}%</strong>
                  </div>
                </div>
              </>
            ) : selectedStationEntry ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Station QR Pin</span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {selectedStationEntry.station.id}
                  </span>
                </div>

                <div className="text-xs text-slate-300">
                  {selectedStationEntry.station.roomName}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Map Pin Label
                    </label>
                    <input
                      type="text"
                      maxLength={20}
                      value={selectedStationEntry.pin.shortName || ''}
                      onChange={(e) =>
                        updateDraft((prev) => ({
                          ...prev,
                          stationPins: {
                            ...prev.stationPins,
                            [selectedStationEntry.station.id]: {
                              ...selectedStationEntry.pin,
                              shortName: e.target.value,
                            },
                          },
                        }))
                      }
                      className="w-full h-9 rounded-lg bg-slate-900 border border-white/12 px-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Floor
                    </label>
                    <input
                      type="text"
                      maxLength={8}
                      value={selectedStationEntry.pin.floor || ''}
                      placeholder="GF / 2F"
                      onChange={(e) =>
                        updateDraft((prev) => ({
                          ...prev,
                          stationPins: {
                            ...prev.stationPins,
                            [selectedStationEntry.station.id]: {
                              ...selectedStationEntry.pin,
                              floor: e.target.value,
                            },
                          },
                        }))
                      }
                      className="w-full h-9 rounded-lg bg-slate-900 border border-white/12 px-2.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                </div>

                <div className="text-[10px] font-mono text-slate-400 tabular-nums">
                  Position: X {selectedStationEntry.pin.x}% · Y{' '}
                  {selectedStationEntry.pin.y}% (drag pin on map to move)
                </div>
              </>
            ) : selectedCorridor ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                    <Route className="w-3.5 h-3.5" />
                    <span>Edit Connecting Path</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      playUiClick();
                      updateDraft((prev) => ({
                        ...prev,
                        corridors: prev.corridors.filter(
                          (c) => c.id !== selectedCorridor.id
                        ),
                      }));
                      setSelected(null);
                    }}
                    className="h-8 px-2.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-200 text-[11px] font-bold flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Delete</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Path Type
                    </label>
                    <select
                      value={selectedCorridor.kind}
                      onChange={(e) =>
                        updateDraft((prev) => ({
                          ...prev,
                          corridors: prev.corridors.map((c) =>
                            c.id === selectedCorridor.id
                              ? { ...c, kind: e.target.value as MapCorridorKind }
                              : c
                          ),
                        }))
                      }
                      className="w-full h-9 rounded-lg bg-slate-900 border border-white/12 px-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                    >
                      <option value="hallway">Hallway (Solid)</option>
                      <option value="stairs">Stairs (Dashed)</option>
                      <option value="outdoor">Outdoor (Dotted)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Label (optional)
                    </label>
                    <input
                      type="text"
                      maxLength={24}
                      value={selectedCorridor.label || ''}
                      placeholder="North Stairs"
                      onChange={(e) =>
                        updateDraft((prev) => ({
                          ...prev,
                          corridors: prev.corridors.map((c) =>
                            c.id === selectedCorridor.id
                              ? { ...c, label: e.target.value }
                              : c
                          ),
                        }))
                      }
                      className="w-full h-9 rounded-lg bg-slate-900 border border-white/12 px-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                </div>
                <p className="text-[10px] font-mono text-slate-400">
                  Drag the cyan circles on each end of the path to reposition.
                </p>
              </>
            ) : selectedLandmark ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <Landmark className="w-3.5 h-3.5" />
                    <span>Edit Map Marker</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      playUiClick();
                      updateDraft((prev) => ({
                        ...prev,
                        landmarks: prev.landmarks.filter(
                          (l) => l.id !== selectedLandmark.id
                        ),
                      }));
                      setSelected(null);
                    }}
                    className="h-8 px-2.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-200 text-[11px] font-bold flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Delete</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Label
                    </label>
                    <input
                      type="text"
                      maxLength={26}
                      value={selectedLandmark.label}
                      onChange={(e) =>
                        updateDraft((prev) => ({
                          ...prev,
                          landmarks: prev.landmarks.map((l) =>
                            l.id === selectedLandmark.id
                              ? { ...l, label: e.target.value }
                              : l
                          ),
                        }))
                      }
                      className="w-full h-9 rounded-lg bg-slate-900 border border-white/12 px-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Marker Type
                    </label>
                    <select
                      value={selectedLandmark.kind}
                      onChange={(e) =>
                        updateDraft((prev) => ({
                          ...prev,
                          landmarks: prev.landmarks.map((l) =>
                            l.id === selectedLandmark.id
                              ? { ...l, kind: e.target.value as MapLandmarkKind }
                              : l
                          ),
                        }))
                      }
                      className="w-full h-9 rounded-lg bg-slate-900 border border-white/12 px-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                    >
                      <option value="meeting">Meeting Point</option>
                      <option value="stairs">Staircase</option>
                      <option value="entrance">Entrance / Exit</option>
                      <option value="hazard">Boundary / Hazard</option>
                      <option value="info">Info Marker</option>
                    </select>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-bold text-white">
                  Task Station Pins ({resolvedStationList.length})
                </div>
                <p className="text-[11px] text-slate-400">
                  Select a station below or click any room, pin, or path on the map to customize it.
                </p>
                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-0.5">
                  {resolvedStationList.map(({ station, pin }) => (
                    <button
                      key={station.id}
                      type="button"
                      onClick={() => {
                        playUiClick();
                        setSelected({ type: 'station', id: station.id });
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-left text-[11px] text-slate-200 truncate"
                    >
                      {pin.shortName || station.id}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Map Title, Subtitle & Floorplan Overlay */}
          <div className="rounded-2xl bg-slate-950/80 border border-white/10 p-3.5 space-y-2.5">
            <div className="text-xs font-bold text-white">
              Blueprint Details &amp; Floorplan
            </div>

            <div className="space-y-2">
              <input
                type="text"
                maxLength={60}
                value={draft.mapTitle}
                onChange={(e) =>
                  updateDraft((prev) => ({ ...prev, mapTitle: e.target.value }))
                }
                placeholder="Map Title (e.g. Main Engineering Block)"
                className="w-full h-9 rounded-lg bg-slate-900 border border-white/12 px-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
              />
              <input
                type="text"
                maxLength={80}
                value={draft.subtitle}
                onChange={(e) =>
                  updateDraft((prev) => ({ ...prev, subtitle: e.target.value }))
                }
                placeholder="Subtitle (e.g. Floors GF – 3F)"
                className="w-full h-9 rounded-lg bg-slate-900 border border-white/12 px-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div className="pt-1 border-t border-white/10 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <input
                  ref={floorplanInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleUploadFloorplan(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    floorplanInputRef.current?.click();
                  }}
                  className="flex-1 h-9 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/12 text-xs font-semibold text-cyan-200 flex items-center justify-center gap-1.5"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>
                    {draft.backgroundImageDataUrl
                      ? 'Replace Floorplan Image'
                      : 'Upload Floorplan Image'}
                  </span>
                </button>
                {draft.backgroundImageDataUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      playUiClick();
                      updateDraft((prev) => ({
                        ...prev,
                        backgroundImageDataUrl: null,
                      }));
                    }}
                    title="Remove Floorplan Image"
                    className="h-9 w-9 rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-200 flex items-center justify-center shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {draft.backgroundImageDataUrl && (
                <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
                  <span>Opacity</span>
                  <input
                    type="range"
                    min={10}
                    max={85}
                    value={Math.round(draft.backgroundOpacity * 100)}
                    onChange={(e) =>
                      updateDraft((prev) => ({
                        ...prev,
                        backgroundOpacity: Number(e.target.value) / 100,
                      }))
                    }
                    className="flex-1 accent-cyan-400"
                  />
                  <span className="tabular-nums text-white w-8 text-right">
                    {Math.round(draft.backgroundOpacity * 100)}%
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Templates & Import / Export */}
          <div className="rounded-2xl bg-slate-950/80 border border-white/10 p-3.5 space-y-2.5">
            <div className="text-xs font-bold text-white">
              Starter Layouts &amp; Backup
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setDraft(createDefaultCampusMap());
                  setHasUnsavedChanges(true);
                  setSelected(null);
                }}
                className="h-8 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-[11px] font-semibold text-slate-200 truncate"
              >
                Default
              </button>
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setDraft(createCorridorGridPreset(stations));
                  setHasUnsavedChanges(true);
                  setSelected(null);
                }}
                className="h-8 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-[11px] font-semibold text-slate-200 truncate"
              >
                Hallway
              </button>
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setDraft(createBlankCanvasPreset(stations));
                  setHasUnsavedChanges(true);
                  setSelected(null);
                }}
                className="h-8 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-[11px] font-semibold text-slate-200 truncate"
              >
                Blank
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={handleExportJson}
                className="h-8 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-[11px] font-semibold text-cyan-200 flex items-center justify-center gap-1"
              >
                <Download className="w-3 h-3" />
                <span>Export</span>
              </button>
              <input
                ref={jsonImportInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportJsonFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  jsonImportInputRef.current?.click();
                }}
                className="h-8 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-[11px] font-semibold text-emerald-200 flex items-center justify-center gap-1"
              >
                <Upload className="w-3 h-3" />
                <span>Import</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  const def = createDefaultCampusMap();
                  const saved = saveCampusMap(def);
                  setDraft(saved);
                  setHasUnsavedChanges(false);
                  setSelected(null);
                  onSyncMapToRoom?.(saved);
                  onNotice?.('Reset map to default campus blueprint');
                }}
                className="h-8 px-2 rounded-lg bg-slate-900 hover:bg-rose-950 border border-white/10 text-[11px] font-semibold text-slate-300 hover:text-rose-200 flex items-center justify-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>

            {crisisPreview !== 'off' && (
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-amber-200 pt-1">
                {crisisPreview === 'reactor' ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                ) : (
                  <Radio className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                )}
                <span>
                  Previewing live sabotage route vector from current task to crisis
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
