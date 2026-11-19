import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
  type CameraDevice,
} from 'html5-qrcode';
import {
  AlertCircle,
  Camera,
  ChevronDown,
  ChevronUp,
  QrCode,
  RefreshCw,
  SwitchCamera,
  X,
  Zap,
} from 'lucide-react';
import { ID_CARDS } from '../config/campusConfig';
import {
  buildIdCardQrPayload,
  buildStationQrPayload,
} from '../config/matchQrStore';
import { useCampusStations } from '../config/stationStore';
import { parseQrPayload, type Player } from '../shared/gameData';
import {
  playErrorFeedback,
  playIdCardScanSound,
  playQrScanSuccess,
  playUiClick,
} from '../utils/feedback';

export type ScannerMode = 'wristband' | 'station' | 'eliminate' | 'report';

interface QrScannerModalProps {
  mode: ScannerMode;
  players?: Player[];
  myPlayerId?: string;
  activeRoomCode?: string;
  expectedMatchToken?: string;
  assignedStationIds?: string[];
  completedStationIds?: string[];
  targetStationId?: string | null;
  isFakeScanMode?: boolean;
  activeSabotageStationId?: string | null;
  activeSabotageStationIds?: string[];
  isDebugMode?: boolean;
  onScanBadge?: (badgeNumber: string) => void;
  onScanMeta?: (meta: { roomCode?: string; matchToken?: string }) => void;
  onScanStation?: (stationId: string) => void;
  onScanError?: (message: string) => void;
  onClose: () => void;
}

const READER_ELEMENT_ID = 'campus-html5-qr-reader';

export function QrScannerModal({
  mode,
  players = [],
  myPlayerId,
  activeRoomCode,
  expectedMatchToken,
  assignedStationIds,
  completedStationIds = [],
  targetStationId = null,
  isFakeScanMode = false,
  activeSabotageStationId = null,
  activeSabotageStationIds = [],
  isDebugMode = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === 'true',
  onScanBadge,
  onScanMeta,
  onScanStation,
  onScanError,
  onClose,
}: QrScannerModalProps) {
  const campusStations = useCampusStations();
  const targetStation = targetStationId
    ? campusStations.find((s) => s.id === targetStationId) || null
    : null;
  const effectiveAssignedStationIds =
    assignedStationIds && assignedStationIds.length > 0
      ? assignedStationIds
      : campusStations.map((s) => s.id);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isRunningRef = useRef(false);
  const handledScanRef = useRef(false);
  const opChainRef = useRef<Promise<void>>(Promise.resolve());

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStatusText, setCameraStatusText] = useState(
    'Initializing camera...'
  );
  const [availableCameras, setAvailableCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [cameraRestartNonce, setCameraRestartNonce] = useState(0);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [simDrawerOpen, setSimDrawerOpen] = useState(false);

  const stopAndClearCamera = useCallback(async () => {
    const instance = scannerRef.current;
    scannerRef.current = null;
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
  }, []);

  const handleDecodedPayload = useCallback(
    async (decodedText: string) => {
      if (handledScanRef.current) return;
      const raw = decodedText.trim();
      if (!raw) return;

      const parsed = parseQrPayload(raw);

      const rejectScan = (msg: string) => {
        playErrorFeedback();
        setScanFeedback(msg);
        onScanError?.(msg);
      };

      const normalizedActiveRoom = activeRoomCode?.trim().toUpperCase();

      if (mode === 'wristband') {
        const upper = raw.toUpperCase();
        const card =
          (parsed?.kind === 'badge'
            ? ID_CARDS.find((w) => w.number === parsed.badgeNumber)
            : undefined) ||
          ID_CARDS.find(
            (w) =>
              w.qrPayload.toUpperCase() === upper ||
              w.id.toUpperCase() === upper ||
              w.number === upper
          );

        if (!card) {
          rejectScan('Invalid QR. Scan a Player ID Card QR (#01–#16).');
          return;
        }
        handledScanRef.current = true;
        playIdCardScanSound();
        await stopAndClearCamera();
        if (parsed?.roomCode || parsed?.matchToken) {
          onScanMeta?.({
            roomCode: parsed.roomCode,
            matchToken: parsed.matchToken,
          });
        }
        onScanBadge?.(card.number);
        return;
      }

      // Room validation for active match modes (station, eliminate, report)
      if (
        parsed?.roomCode &&
        normalizedActiveRoom &&
        parsed.roomCode.toUpperCase() !== normalizedActiveRoom
      ) {
        rejectScan(
          `Wrong Room QR! This card belongs to room ${parsed.roomCode}, not ${normalizedActiveRoom}.`
        );
        return;
      }

      if (mode === 'station') {
        const upper = raw.toUpperCase();
        const station =
          (parsed?.kind === 'station'
            ? campusStations.find((s) => s.id === parsed.stationId)
            : undefined) ||
          campusStations.find(
            (s) =>
              s.qrPayload.toUpperCase() === upper || s.id.toUpperCase() === upper
          );

        if (!station) {
          rejectScan('Invalid QR. Scan a Campus Station poster QR.');
          return;
        }
        const isAssigned = effectiveAssignedStationIds.includes(station.id);
        const isSabotageTarget =
          (Boolean(activeSabotageStationId) &&
            station.id === activeSabotageStationId) ||
          activeSabotageStationIds.includes(station.id);

        if (!isAssigned && !isSabotageTarget && !isFakeScanMode) {
          rejectScan(`${station.roomName} is not assigned to your mission.`);
          return;
        }

        // Enforce 2-step LONG_TASK order: Step 2 requires Step 1 completion first
        if (
          !isFakeScanMode &&
          !isSabotageTarget &&
          station.taskCategory === 'LONG_TASK' &&
          station.relayStage === 2 &&
          station.relayPartnerId &&
          !completedStationIds.includes(station.relayPartnerId)
        ) {
          const partner = campusStations.find(
            (s) => s.id === station.relayPartnerId
          );
          rejectScan(
            `Relay Locked! Scan ${
              partner?.roomName || station.relayPartnerId
            } first to Download Campus Logs.`
          );
          return;
        }

        handledScanRef.current = true;
        playQrScanSuccess();
        await stopAndClearCamera();
        onScanStation?.(station.id);
        return;
      }

      if (mode === 'eliminate') {
        const upper = raw.toUpperCase();
        const card =
          (parsed?.kind === 'badge'
            ? ID_CARDS.find((w) => w.number === parsed.badgeNumber)
            : undefined) ||
          ID_CARDS.find((w) => w.qrPayload.toUpperCase() === upper);

        if (!card) {
          rejectScan('Scan a player ID Card QR to eliminate.');
          return;
        }
        const target = players.find((p) => p.badgeNumber === card.number);
        if (!target) {
          rejectScan(`No player registered on ${card.label}.`);
          return;
        }
        if (target.id === myPlayerId) {
          rejectScan('Cannot eliminate yourself.');
          return;
        }
        if (target.status !== 'alive') {
          rejectScan(`${target.name} is already eliminated.`);
          return;
        }
        if (target.role === 'impostor') {
          rejectScan(`${target.name} is a fellow Impostor!`);
          return;
        }

        handledScanRef.current = true;
        playIdCardScanSound();
        await stopAndClearCamera();
        onScanBadge?.(card.number);
        return;
      }

      if (mode === 'report') {
        const upper = raw.toUpperCase();
        const card =
          (parsed?.kind === 'badge'
            ? ID_CARDS.find((w) => w.number === parsed.badgeNumber)
            : undefined) ||
          ID_CARDS.find((w) => w.qrPayload.toUpperCase() === upper);

        if (!card) {
          rejectScan('Scan an eliminated player ID Card QR to report.');
          return;
        }
        const target = players.find((p) => p.badgeNumber === card.number);
        if (target && target.status !== 'eliminated') {
          rejectScan(`${target.name} (${card.label}) is still alive!`);
          return;
        }

        handledScanRef.current = true;
        playIdCardScanSound();
        await stopAndClearCamera();
        onScanBadge?.(card.number);
      }
    },
    [
      activeRoomCode,
      activeSabotageStationId,
      activeSabotageStationIds,
      campusStations,
      completedStationIds,
      effectiveAssignedStationIds,
      isFakeScanMode,
      mode,
      myPlayerId,
      onScanBadge,
      onScanError,
      onScanMeta,
      onScanStation,
      players,
      stopAndClearCamera,
    ]
  );

  // Keep latest decode handler in a ref so camera stream NEVER restarts when players/props re-render
  const decodeHandlerRef = useRef(handleDecodedPayload);
  useEffect(() => {
    decodeHandlerRef.current = handleDecodedPayload;
  }, [handleDecodedPayload]);

  const isDebugModeRef = useRef(isDebugMode);
  useEffect(() => {
    isDebugModeRef.current = isDebugMode;
  }, [isDebugMode]);

  useEffect(() => {
    let cancelled = false;
    handledScanRef.current = false;

    const startScanner = async () => {
      await stopAndClearCamera();
      if (cancelled) return;

      const readerEl = document.getElementById(READER_ELEMENT_ID);
      if (!readerEl) return;
      readerEl.innerHTML = '';

      setCameraReady(false);
      setCameraError(null);
      setCameraStatusText('Requesting camera permission...');

      let cameras: CameraDevice[] = [];
      try {
        cameras = await Html5Qrcode.getCameras();
        if (!cancelled && cameras.length > 0) {
          setAvailableCameras(cameras);
        }
      } catch {
        // Ignore enumeration errors (e.g. iOS before permission granted)
      }

      if (cancelled) return;

      const rearCamera = cameras.find((c) =>
        /back|rear|environment|wide|ultra/i.test(c.label)
      );

      const candidateConstraints: Array<string | MediaTrackConstraints> = [];
      if (selectedCameraId) {
        candidateConstraints.push(selectedCameraId);
      } else {
        if (rearCamera) {
          candidateConstraints.push(rearCamera.id);
        }
        candidateConstraints.push({ facingMode: { ideal: 'environment' } });
        if (cameras[0] && cameras[0].id !== rearCamera?.id) {
          candidateConstraints.push(cameras[0].id);
        }
        candidateConstraints.push({ facingMode: 'user' });
        candidateConstraints.push({ facingMode: 'environment' });
      }

      const scanConfig = {
        fps: 15,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const edge = Math.max(140, Math.min(240, Math.floor(minEdge * 0.72)));
          return { width: edge, height: edge };
        },
        disableFlip: false,
      };

      let lastErr: unknown = null;

      for (const source of candidateConstraints) {
        if (cancelled) return;

        const instance = new Html5Qrcode(READER_ELEMENT_ID, {
          verbose: false,
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          useBarCodeDetectorIfSupported: true,
        });
        scannerRef.current = instance;

        try {
          await instance.start(
            source,
            scanConfig,
            (decodedText) => {
              void decodeHandlerRef.current(decodedText);
            },
            () => {
              // Ignore per-frame decode misses
            }
          );

          if (cancelled) {
            isRunningRef.current = true;
            await stopAndClearCamera();
            return;
          }

          isRunningRef.current = true;
          setCameraReady(true);
          setCameraError(null);
          setCameraStatusText('Camera active — align QR code inside frame.');
          return;
        } catch (err) {
          lastErr = err;
          scannerRef.current = null;
          isRunningRef.current = false;
          try {
            instance.clear();
          } catch {
            // ignore cleanup errors
          }
        }
      }

      if (cancelled) return;

      const errMsg =
        lastErr instanceof Error
          ? lastErr.message
          : typeof lastErr === 'string'
          ? lastErr
          : '';
      const isPermissionDenied =
        /NotAllowedError|Permission denied|permission/i.test(errMsg);

      setCameraReady(false);
      setCameraStatusText('Camera feed unavailable');
      setCameraError(
        isPermissionDenied
          ? 'Camera permission blocked in this browser/iframe. Allow camera access and tap "Retry Camera".'
          : isDebugModeRef.current
          ? 'No camera detected. Allow camera access or use Dev Quick-Simulate below.'
          : 'Camera unavailable on this device/browser. Allow camera access and tap "Retry Camera".'
      );
    };

    opChainRef.current = opChainRef.current.then(startScanner);

    return () => {
      cancelled = true;
      opChainRef.current = opChainRef.current.then(stopAndClearCamera);
    };
  }, [stopAndClearCamera, cameraRestartNonce, selectedCameraId]);

  const handleCloseModal = async () => {
    playUiClick();
    await stopAndClearCamera();
    onClose();
  };

  const handleSwitchCamera = () => {
    if (availableCameras.length < 2) return;
    playUiClick();
    const curIdx = availableCameras.findIndex((c) => c.id === selectedCameraId);
    const nextCamera =
      availableCameras[(curIdx + 1) % availableCameras.length] ||
      availableCameras[0];
    setSelectedCameraId(nextCamera.id);
  };

  const handleRetryCamera = () => {
    playUiClick();
    setCameraRestartNonce((n) => n + 1);
  };

  const titleByMode: Record<ScannerMode, string> = {
    wristband: 'SCAN ID CARD QR',
    station: 'SCAN ROOM / TASK QR',
    eliminate: 'ELIMINATE ID CARD QR',
    report: 'REPORT BODY ID CARD',
  };

  const simCardPayload = (badgeId: string) =>
    activeRoomCode && expectedMatchToken
      ? buildIdCardQrPayload(activeRoomCode, expectedMatchToken, badgeId)
      : `CAMPUS_AU:IDCARD:${badgeId}`;

  const simStationPayload = (stationId: string) =>
    activeRoomCode && expectedMatchToken
      ? buildStationQrPayload(activeRoomCode, expectedMatchToken, stationId)
      : `CAMPUS_AU:STATION:${stationId}`;

  const livingCrewTargets = players.filter(
    (p) => p.id !== myPlayerId && p.status === 'alive' && p.role === 'crewmate'
  );
  const deadTargets = players.filter((p) => p.status === 'eliminated');

  return (
    <div className="fixed inset-0 z-50 bg-[#060913]/92 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md glass-card rounded-t-3xl sm:rounded-3xl p-4 space-y-3 max-h-[94dvh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-base font-extrabold tracking-wider uppercase text-white">
              {titleByMode[mode]}
            </h2>
            <p className="text-[11px] text-slate-400 truncate">
              {mode === 'station' && targetStation
                ? `Target: ${targetStation.roomName}`
                : cameraStatusText}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {availableCameras.length > 1 && (
              <button
                type="button"
                onClick={handleSwitchCamera}
                aria-label="Switch camera"
                title="Switch Camera"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 text-cyan-300 hover:bg-white/15"
              >
                <SwitchCamera className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleCloseModal()}
              aria-label="Close scanner"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 text-slate-300 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Html5Qrcode Camera Viewfinder */}
        <div className="relative h-64 w-full rounded-2xl overflow-hidden bg-slate-950 border border-white/15 flex items-center justify-center">
          <div
            id={READER_ELEMENT_ID}
            className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover"
          />

          {!cameraReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5 space-y-2.5 bg-slate-950/92">
              <Camera className="w-7 h-7 text-cyan-400/80" />
              <p className="text-[11px] text-slate-300 leading-relaxed max-w-xs">
                {cameraError || 'Requesting camera access...'}
              </p>
              {cameraError && (
                <button
                  type="button"
                  onClick={handleRetryCamera}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 text-[11px] font-bold flex items-center gap-1.5 hover:bg-cyan-500/30"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Camera</span>
                </button>
              )}
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

        {/* Collapsible Dev Quick-Simulate Scan Drawer (Strictly ?debug=true / Dev Unlocked) */}
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
                    {ID_CARDS.map((card) => (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() =>
                          void handleDecodedPayload(simCardPayload(card.id))
                        }
                        className="h-10 px-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-800 border border-white/10 flex items-center justify-center gap-1.5 transition-all active:scale-95"
                      >
                        <span
                          className="w-3 h-3 rounded-full border border-white/30 shrink-0"
                          style={{
                            backgroundColor: card.colorHex,
                            boxShadow: `0 0 8px ${card.colorHex}66`,
                          }}
                        />
                        <span className="text-[10px] font-mono font-bold text-white tabular-nums">
                          {card.id}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {mode === 'station' && (
                  <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-0.5">
                    {campusStations.map((station, idx) => {
                      const isLastOdd =
                        campusStations.length % 2 === 1 &&
                        idx === campusStations.length - 1;
                      return (
                        <button
                          key={station.id}
                          type="button"
                          onClick={() =>
                            void handleDecodedPayload(
                              simStationPayload(station.id)
                            )
                          }
                          className={`min-h-[48px] px-2.5 py-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-800 border border-white/10 flex items-center justify-between gap-2 text-left active:scale-95 transition-all ${
                            isLastOdd ? 'col-span-2' : ''
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <span
                                className={`text-[8px] font-mono font-extrabold ${
                                  station.taskCategory === 'LONG_TASK'
                                    ? 'text-amber-300'
                                    : 'text-emerald-300'
                                }`}
                              >
                                {station.taskCategory === 'LONG_TASK'
                                  ? `RELAY ${station.relayStage || 1}/2`
                                  : 'SHORT'}
                              </span>
                              <span className="text-[9px] font-mono font-bold text-cyan-400 truncate">
                                {station.roomName}
                              </span>
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
                        const card = ID_CARDS.find(
                          (w) => w.number === target.badgeNumber
                        );
                        return (
                          <button
                            key={target.id}
                            type="button"
                            onClick={() =>
                              card &&
                              void handleDecodedPayload(simCardPayload(card.id))
                            }
                            className="h-12 px-2.5 rounded-xl bg-rose-950/60 hover:bg-rose-900/70 border border-rose-500/40 flex items-center gap-2 text-left active:scale-95 transition-all"
                          >
                            <span
                              className="w-3.5 h-3.5 rounded-full shrink-0"
                              style={{
                                backgroundColor: card?.colorHex || '#f43f5e',
                              }}
                            />
                            <div className="min-w-0">
                              <div className="text-[10px] font-mono font-bold text-white tabular-nums">
                                {card?.id || `#${target.badgeNumber}`}
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
                        Add Demo Crew in Lobby or Dev Preview to simulate
                        Elimination.
                      </div>
                    )}
                  </div>
                )}

                {mode === 'report' && (
                  <div className="space-y-1.5">
                    {deadTargets.length > 0 ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        {deadTargets.map((target) => {
                          const card = ID_CARDS.find(
                            (w) => w.number === target.badgeNumber
                          );
                          return (
                            <button
                              key={target.id}
                              type="button"
                              onClick={() =>
                                card &&
                                void handleDecodedPayload(
                                  simCardPayload(card.id)
                                )
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
                          const fallback = ID_CARDS[3];
                          if (fallback) {
                            void handleDecodedPayload(
                              simCardPayload(fallback.id)
                            );
                          }
                        }}
                        className="w-full h-12 rounded-xl bg-rose-600/85 hover:bg-rose-500 text-white font-display font-extrabold text-xs tracking-wide uppercase"
                      >
                        Simulate Report Body (ID Card #04)
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
