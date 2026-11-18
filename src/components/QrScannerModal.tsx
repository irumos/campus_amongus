import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  AlertCircle,
  Camera,
  ChevronDown,
  ChevronUp,
  QrCode,
  X,
  Zap,
} from 'lucide-react';
import {
  TASK_STATIONS as CAMPUS_STATIONS,
  WRISTBANDS,
} from '../config/campusConfig';
import type { Player } from '../shared/gameData';
import {
  playErrorFeedback,
  playQrScanSuccess,
  playUiClick,
} from '../utils/feedback';

export type ScannerMode = 'wristband' | 'station' | 'eliminate' | 'report';

interface QrScannerModalProps {
  mode: ScannerMode;
  players?: Player[];
  myPlayerId?: string;
  assignedStationIds?: string[];
  activeSabotageStationId?: string | null;
  isDebugMode?: boolean;
  onScanBadge?: (badgeNumber: string) => void;
  onScanStation?: (stationId: string) => void;
  onClose: () => void;
}

const READER_ELEMENT_ID = 'campus-html5-qr-reader';

export function QrScannerModal({
  mode,
  players = [],
  myPlayerId,
  assignedStationIds = CAMPUS_STATIONS.map((s) => s.id),
  activeSabotageStationId = null,
  isDebugMode = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === 'true',
  onScanBadge,
  onScanStation,
  onClose,
}: QrScannerModalProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isRunningRef = useRef(false);
  const handledScanRef = useRef(false);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [simDrawerOpen, setSimDrawerOpen] = useState(false);

  const stopAndClearCamera = useCallback(async () => {
    const instance = scannerRef.current;
    if (!instance) return;
    if (isRunningRef.current) {
      isRunningRef.current = false;
      try {
        await instance.stop();
      } catch {
        // ignore stop errors when already stopped
      }
    }
    try {
      instance.clear();
    } catch {
      // ignore clear errors if DOM already unmounted
    }
    scannerRef.current = null;
  }, []);

  const handleDecodedPayload = useCallback(
    async (decodedText: string) => {
      if (handledScanRef.current) return;
      const raw = decodedText.trim();

      if (mode === 'wristband') {
        const wristband = WRISTBANDS.find((w) => w.qrPayload === raw);
        if (!wristband) {
          playErrorFeedback();
          setScanFeedback('Invalid QR. Scan a Wristband QR (CAMPUS_AU:WRISTBAND:P01–P16).');
          return;
        }
        handledScanRef.current = true;
        playQrScanSuccess();
        await stopAndClearCamera();
        onScanBadge?.(wristband.number);
        return;
      }

      if (mode === 'station') {
        const station = CAMPUS_STATIONS.find((s) => s.qrPayload === raw);
        if (!station) {
          playErrorFeedback();
          setScanFeedback('Invalid QR. Scan a Campus Station poster QR.');
          return;
        }
        const isAssigned = assignedStationIds.includes(station.id);
        const isSabotageTarget =
          Boolean(activeSabotageStationId) &&
          station.id === activeSabotageStationId;

        if (!isAssigned && !isSabotageTarget) {
          playErrorFeedback();
          setScanFeedback(`${station.roomName} is not assigned to your mission.`);
          return;
        }

        handledScanRef.current = true;
        playQrScanSuccess();
        await stopAndClearCamera();
        onScanStation?.(station.id);
        return;
      }

      if (mode === 'eliminate') {
        const wristband = WRISTBANDS.find((w) => w.qrPayload === raw);
        if (!wristband) {
          playErrorFeedback();
          setScanFeedback('Scan a player wristband QR to eliminate.');
          return;
        }
        const target = players.find((p) => p.badgeNumber === wristband.number);
        if (!target) {
          playErrorFeedback();
          setScanFeedback(`No player registered on ${wristband.label}.`);
          return;
        }
        if (target.id === myPlayerId) {
          playErrorFeedback();
          setScanFeedback('Cannot eliminate yourself.');
          return;
        }
        if (target.status !== 'alive') {
          playErrorFeedback();
          setScanFeedback(`${target.name} is already eliminated.`);
          return;
        }
        if (target.role === 'impostor') {
          playErrorFeedback();
          setScanFeedback(`${target.name} is a fellow Impostor!`);
          return;
        }

        handledScanRef.current = true;
        playQrScanSuccess();
        await stopAndClearCamera();
        onScanBadge?.(wristband.number);
        return;
      }

      if (mode === 'report') {
        const wristband = WRISTBANDS.find((w) => w.qrPayload === raw);
        if (!wristband) {
          playErrorFeedback();
          setScanFeedback('Scan an eliminated player wristband QR to report.');
          return;
        }
        const target = players.find((p) => p.badgeNumber === wristband.number);
        if (target && target.status !== 'eliminated') {
          playErrorFeedback();
          setScanFeedback(`${target.name} (${wristband.label}) is still alive!`);
          return;
        }

        handledScanRef.current = true;
        playQrScanSuccess();
        await stopAndClearCamera();
        onScanBadge?.(wristband.number);
      }
    },
    [
      activeSabotageStationId,
      assignedStationIds,
      mode,
      myPlayerId,
      onScanBadge,
      onScanStation,
      players,
      stopAndClearCamera,
    ]
  );

  useEffect(() => {
    let cancelled = false;
    handledScanRef.current = false;

    const html5QrCode = new Html5Qrcode(READER_ELEMENT_ID, { verbose: false });
    scannerRef.current = html5QrCode;

    html5QrCode
      .start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 210, height: 210 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          void handleDecodedPayload(decodedText);
        },
        () => {
          // Ignore per-frame decode misses
        }
      )
      .then(() => {
        if (cancelled) {
          isRunningRef.current = true;
          void stopAndClearCamera();
          return;
        }
        isRunningRef.current = true;
        setCameraReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setCameraError(
          isDebugMode
            ? 'Rear camera unavailable or permission denied. Use Dev Quick-Simulate Scan below.'
            : 'Camera access denied or unavailable. Enable rear camera permissions in browser settings.'
        );
      });

    return () => {
      cancelled = true;
      void stopAndClearCamera();
    };
  }, [handleDecodedPayload, isDebugMode, stopAndClearCamera]);

  const handleCloseModal = async () => {
    playUiClick();
    await stopAndClearCamera();
    onClose();
  };

  const titleByMode: Record<ScannerMode, string> = {
    wristband: 'SCAN WRISTBAND QR',
    station: 'SCAN ROOM / TASK QR',
    eliminate: 'ELIMINATE TARGET QR',
    report: 'REPORT BODY QR',
  };

  const livingCrewTargets = players.filter(
    (p) => p.id !== myPlayerId && p.status === 'alive' && p.role === 'crewmate'
  );
  const deadTargets = players.filter((p) => p.status === 'eliminated');

  return (
    <div className="fixed inset-0 z-50 bg-[#060913]/92 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md glass-card rounded-t-3xl sm:rounded-3xl p-4 space-y-3 max-h-[94dvh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-extrabold tracking-wider uppercase text-white">
              {titleByMode[mode]}
            </h2>
            <p className="text-[11px] text-slate-400">
              {cameraReady
                ? 'Rear camera active — align QR code inside frame.'
                : 'Starting rear camera ({ facingMode: "environment" })...'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleCloseModal()}
            aria-label="Close scanner"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 text-slate-300 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Html5Qrcode Rear Camera Viewfinder */}
        <div className="relative h-56 w-full rounded-2xl overflow-hidden bg-slate-950 border border-white/15 flex items-center justify-center">
          <div
            id={READER_ELEMENT_ID}
            className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover"
          />

          {!cameraReady && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-5 space-y-1.5 bg-slate-950/90">
              <Camera className="w-7 h-7 text-cyan-400/75" />
              <p className="text-[11px] text-slate-400">
                {cameraError || 'Requesting rear camera access...'}
              </p>
            </div>
          )}

          {/* Laser Corner Brackets */}
          <span className="pointer-events-none absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 border-cyan-400 rounded-tl-md" />
          <span className="pointer-events-none absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-cyan-400 rounded-tr-md" />
          <span className="pointer-events-none absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 border-cyan-400 rounded-bl-md" />
          <span className="pointer-events-none absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 border-cyan-400 rounded-br-md" />

          <div className="pointer-events-none absolute inset-x-5 top-0 animate-scanline">
            <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_14px_rgba(6,182,212,0.95)]" />
          </div>
        </div>

        {scanFeedback && (
          <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-950/60 border border-amber-500/40 rounded-xl px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{scanFeedback}</span>
          </div>
        )}

        {/* Collapsible Dev Quick-Simulate Scan Drawer (Strictly ?debug=true only) */}
        {isDebugMode && (
          <div className="border-t border-white/10 pt-2.5">
            <button
              type="button"
              onClick={() => {
                playUiClick();
                setSimDrawerOpen((v) => !v);
              }}
              className="w-full h-10 px-3 rounded-xl bg-slate-950/75 hover:bg-slate-900 border border-white/10 flex items-center justify-between text-xs font-bold text-cyan-300 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Dev Quick-Simulate Scan</span>
              </span>
              {simDrawerOpen ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

          {simDrawerOpen && (
            <div className="pt-2.5 space-y-2">
              {mode === 'wristband' && (
                <div className="grid grid-cols-4 gap-1.5">
                  {WRISTBANDS.map((wb) => (
                    <button
                      key={wb.id}
                      type="button"
                      onClick={() => void handleDecodedPayload(wb.qrPayload)}
                      className="h-10 px-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-800 border border-white/10 flex items-center justify-center gap-1.5 transition-all active:scale-95"
                    >
                      <span
                        className="w-3 h-3 rounded-full border border-white/30 shrink-0"
                        style={{
                          backgroundColor: wb.colorHex,
                          boxShadow: `0 0 8px ${wb.colorHex}66`,
                        }}
                      />
                      <span className="text-[10px] font-mono font-bold text-white tabular-nums">
                        {wb.id}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {mode === 'station' && (
                <div className="grid grid-cols-2 gap-1.5">
                  {CAMPUS_STATIONS.map((station, idx) => {
                    const isLastOdd =
                      CAMPUS_STATIONS.length % 2 === 1 &&
                      idx === CAMPUS_STATIONS.length - 1;
                    return (
                      <button
                        key={station.id}
                        type="button"
                        onClick={() =>
                          void handleDecodedPayload(station.qrPayload)
                        }
                        className={`min-h-[48px] px-2.5 py-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-800 border border-white/10 flex items-center justify-between gap-2 text-left active:scale-95 transition-all ${
                          isLastOdd ? 'col-span-2' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-[9px] font-mono font-bold text-cyan-400 truncate">
                            {station.roomName}
                          </div>
                          <div className="text-[11px] font-bold text-white leading-tight line-clamp-1">
                            {station.taskTitle}
                          </div>
                        </div>
                        <QrCode className="w-4 h-4 text-emerald-400 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}

              {mode === 'eliminate' && (
                <div className="grid grid-cols-2 gap-1.5">
                  {livingCrewTargets.length > 0 ? (
                    livingCrewTargets.map((target) => {
                      const wb = WRISTBANDS.find(
                        (w) => w.number === target.badgeNumber
                      );
                      return (
                        <button
                          key={target.id}
                          type="button"
                          onClick={() =>
                            wb && void handleDecodedPayload(wb.qrPayload)
                          }
                          className="h-12 px-2.5 rounded-xl bg-rose-950/60 hover:bg-rose-900/70 border border-rose-500/40 flex items-center gap-2 text-left active:scale-95 transition-all"
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-full shrink-0"
                            style={{
                              backgroundColor: wb?.colorHex || '#f43f5e',
                            }}
                          />
                          <div className="min-w-0">
                            <div className="text-[10px] font-mono font-bold text-white tabular-nums">
                              {wb?.id || `#${target.badgeNumber}`}
                            </div>
                            <div className="text-xs text-rose-200 truncate">
                              {target.name}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="col-span-2 text-xs text-slate-400 py-3 text-center bg-slate-950/60 rounded-xl">
                      Add Demo Crew in Lobby or Dev Preview to simulate Elimination.
                    </div>
                  )}
                </div>
              )}

              {mode === 'report' && (
                <div className="space-y-1.5">
                  {deadTargets.length > 0 ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      {deadTargets.map((target) => {
                        const wb = WRISTBANDS.find(
                          (w) => w.number === target.badgeNumber
                        );
                        return (
                          <button
                            key={target.id}
                            type="button"
                            onClick={() =>
                              wb && void handleDecodedPayload(wb.qrPayload)
                            }
                            className="h-12 px-2.5 rounded-xl bg-violet-950/70 hover:bg-violet-900/70 border border-violet-400/50 flex items-center gap-2 text-left"
                          >
                            <div className="min-w-0">
                              <div className="text-[10px] font-mono font-bold text-violet-200 tabular-nums">
                                #{target.badgeNumber} · ELIMINATED
                              </div>
                              <div className="text-xs text-white truncate">
                                {target.name}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const fallback = WRISTBANDS[3];
                        if (fallback) {
                          void handleDecodedPayload(fallback.qrPayload);
                        }
                      }}
                      className="w-full h-12 rounded-xl bg-rose-600/85 hover:bg-rose-500 text-white font-display font-extrabold text-xs tracking-wide uppercase"
                    >
                      Simulate Report Body (CAMPUS_AU:WRISTBAND:P04)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          </div>
        )}
      </div>
    </div>
  );
}
