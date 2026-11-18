import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getStationInfo,
  toTaskStation,
  type MeetingState,
  type Player,
  type PlayerRole,
  type PlayerStatus,
  type SabotageState,
  type ScreenId,
  type TaskStation,
} from './shared/gameData';
import { useCampusStations } from './config/stationStore';
import {
  badgeIdToNumber,
  normalizeBadgeId,
  normalizeRoomCode,
  resolveSabotageTargets,
  useCampusGame,
} from './hooks/useCampusGame';
import {
  playEmergencySiren,
  playErrorFeedback,
  playTaskSuccessFeedback,
  playUiClick,
} from './utils/feedback';
import { DevSwitcherBar, type DevPresetId } from './components/DevSwitcherBar';
import { DevPasscodeModal } from './components/DevPasscodeModal';
import { DeveloperInsightsModal } from './components/DeveloperInsightsModal';
import { JoinScreen } from './components/JoinScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { GameplayScreen } from './components/GameplayScreen';
import { MeetingScreen } from './components/MeetingScreen';
import { PrintKitScreen } from './components/PrintKitScreen';
import { QrScannerModal, type ScannerMode } from './components/QrScannerModal';
import { MiniGameModal } from './components/MiniGameModal';
import { PrintKitPasscodeModal } from './components/PrintKitPasscodeModal';

const LS_KEYS = {
  NAME: 'cairl_name',
  ROOM_CODE: 'cairl_room_code',
  BADGE: 'cairl_badge',
  DEV_OVERRIDES: 'cairl_dev_overrides',
  DEV_UNLOCKED: 'cairl_dev_unlocked',
  PRINT_UNLOCKED_ROOM: 'cairl_print_unlocked_room',
} as const;

function readJsonFromStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default function App() {
  const hasDebugQuery = useMemo(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debug') === 'true',
    []
  );
  const [isDevUnlocked, setIsDevUnlocked] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(LS_KEYS.DEV_UNLOCKED) === 'true';
    } catch {
      return false;
    }
  });
  const isDebugMode = isDevUnlocked || hasDebugQuery;

  const {
    isSupabaseConfigured,
    supabaseConfigStatus,
    realtimeConnected,
    connectionStatus,
    reconnectAttempt,
    realtimeLatencyMs,
    syncError,
    insightEvents,
    clearInsightEvents,
    recentLobbies,
    identity,
    room,
    publicPlayers,
    privateRole,
    votes,
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
    setImpostorCount,
    startMatch,
    completeStation,
    eliminatePlayer,
    triggerSabotage,
    clearSabotage,
    callMeeting,
    castVote,
    finalizeMeeting,
    dismissEjection,
    resetRoom,
    leaveRoom,
  } = useCampusGame();

  const campusStations = useCampusStations();

  const [name, setName] = useState(
    () => identity?.name || localStorage.getItem(LS_KEYS.NAME) || ''
  );
  const [roomCode, setRoomCode] = useState(
    () => identity?.roomCode || localStorage.getItem(LS_KEYS.ROOM_CODE) || 'SVCE'
  );
  const [badgeNumber, setBadgeNumber] = useState<string | null>(() =>
    identity?.badgeId
      ? badgeIdToNumber(identity.badgeId)
      : localStorage.getItem(LS_KEYS.BADGE) || null
  );

  // Hydrate Dev Preview Overrides ONLY when ?debug=true is enabled
  const initialOverrides = useMemo(
    () =>
      isDebugMode
        ? readJsonFromStorage<{
            screenOverride: ScreenId | null;
            roleOverride: PlayerRole | null;
            statusOverride: PlayerStatus | null;
          }>(LS_KEYS.DEV_OVERRIDES)
        : null,
    [isDebugMode]
  );

  const [screenOverride, setScreenOverride] = useState<ScreenId | null>(() =>
    window.location.pathname === '/print'
      ? 'print'
      : isDebugMode
      ? initialOverrides?.screenOverride || null
      : null
  );
  const [roleOverride, setRoleOverride] = useState<PlayerRole | null>(
    () => (isDebugMode ? initialOverrides?.roleOverride || null : null)
  );
  const [statusOverride, setStatusOverride] = useState<PlayerStatus | null>(
    () => (isDebugMode ? initialOverrides?.statusOverride || null : null)
  );

  // Modals & Notifications
  const [scannerMode, setScannerMode] = useState<ScannerMode | null>(null);
  const [targetStationId, setTargetStationId] = useState<string | null>(null);
  const [activeMiniGameStation, setActiveMiniGameStation] =
    useState<TaskStation | null>(null);
  const [fakeCompletedIds, setFakeCompletedIds] = useState<string[]>([]);
  const [showPasscodeModal, setShowPasscodeModal] = useState(false);
  const [showPrintPasscodeModal, setShowPrintPasscodeModal] = useState(false);
  const [unlockedPrintRoomCode, setUnlockedPrintRoomCode] = useState<string | null>(
    () => {
      try {
        return sessionStorage.getItem(LS_KEYS.PRINT_UNLOCKED_ROOM) || null;
      } catch {
        return null;
      }
    }
  );
  const [showInsightsModal, setShowInsightsModal] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, durationMs = 2600) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const handleUnlockSuccess = useCallback(() => {
    try {
      sessionStorage.setItem(LS_KEYS.DEV_UNLOCKED, 'true');
    } catch {
      // ignore storage errors
    }
    setIsDevUnlocked(true);
    setShowPasscodeModal(false);
    setShowInsightsModal(true);
    showToast('Developer Mode Unlocked');
  }, [showToast]);

  const handleLockDevMode = useCallback(() => {
    try {
      sessionStorage.removeItem(LS_KEYS.DEV_UNLOCKED);
      sessionStorage.removeItem(LS_KEYS.PRINT_UNLOCKED_ROOM);
    } catch {
      // ignore storage errors
    }
    setIsDevUnlocked(false);
    setUnlockedPrintRoomCode(null);
    setShowInsightsModal(false);
    setRoleOverride(null);
    setStatusOverride(null);
    setScreenOverride(null);
    if (window.location.pathname === '/print') {
      window.history.pushState({}, '', '/');
    }
  }, []);

  // Persist draft credentials & debug overrides
  useEffect(() => {
    localStorage.setItem(LS_KEYS.NAME, name);
  }, [name]);

  useEffect(() => {
    localStorage.setItem(LS_KEYS.ROOM_CODE, roomCode);
  }, [roomCode]);

  useEffect(() => {
    if (badgeNumber) {
      localStorage.setItem(LS_KEYS.BADGE, badgeNumber);
    }
  }, [badgeNumber]);

  useEffect(() => {
    if (!isDebugMode) return;
    localStorage.setItem(
      LS_KEYS.DEV_OVERRIDES,
      JSON.stringify({ screenOverride, roleOverride, statusOverride })
    );
  }, [isDebugMode, screenOverride, roleOverride, statusOverride]);

  useEffect(() => {
    if (syncError) {
      showToast(`Sync Warning: ${syncError}`);
    }
  }, [syncError, showToast]);

  useEffect(() => {
    const onPopState = () => {
      if (window.location.pathname === '/print') {
        setScreenOverride('print');
      } else if (screenOverride === 'print') {
        setScreenOverride(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [screenOverride]);

  // Adapt Supabase rows to UI Player[] model (keeping private roles isolated)
  const uiPlayers: Player[] = useMemo(() => {
    const fellowSet = new Set(privateRole?.fellow_impostors || []);
    return publicPlayers.map((p, idx) => {
      const isMe = identity?.badgeId === p.badge_id;
      const knownImpostor =
        (isMe && privateRole?.role === 'IMPOSTOR') ||
        fellowSet.has(p.badge_id);

      const status: PlayerStatus = p.is_alive
        ? 'alive'
        : isMe && ghostModeActive
        ? 'ghost'
        : 'eliminated';

      return {
        id: p.badge_id,
        name: p.name,
        badgeNumber: badgeIdToNumber(p.badge_id),
        role: knownImpostor ? 'impostor' : 'crewmate',
        status,
        completedTaskIds: isMe ? privateRole?.completed_stations || [] : [],
        isHost: idx === 0,
        joinedAt: idx,
      };
    });
  }, [publicPlayers, identity?.badgeId, privateRole, ghostModeActive]);

  const myPlayer: Player | null = useMemo(() => {
    if (!identity?.badgeId) return null;
    return uiPlayers.find((p) => p.id === identity.badgeId) || null;
  }, [uiPlayers, identity?.badgeId]);

  const activeScreen: ScreenId = useMemo(() => {
    if (screenOverride) return screenOverride;
    if (!identity) return 'join';
    if (!room || room.status === 'LOBBY') return 'lobby';
    if (room.status === 'MEETING') return 'meeting';
    return 'gameplay';
  }, [screenOverride, identity, room]);

  const effectiveRole: PlayerRole =
    roleOverride ??
    (privateRole?.role === 'IMPOSTOR' ? 'impostor' : 'crewmate');

  const effectiveStatus: PlayerStatus =
    statusOverride ?? myPlayer?.status ?? 'alive';

  // Adapt myPlayer completedTaskIds cleanly for Impostor disguise cover
  const displayMyPlayer: Player | null = useMemo(() => {
    if (!myPlayer) return null;
    if (effectiveRole !== 'impostor') return myPlayer;
    return {
      ...myPlayer,
      completedTaskIds: fakeCompletedIds,
    };
  }, [myPlayer, effectiveRole, fakeCompletedIds]);

  // Reset fake checklist when returning to Lobby or starting a fresh match; close overlays on Meeting/End
  const prevRoomStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const status = room?.status ?? null;
    if (
      status === 'LOBBY' ||
      (status === 'PLAYING' &&
        (prevRoomStatusRef.current === 'LOBBY' ||
          prevRoomStatusRef.current === 'ENDED'))
    ) {
      setFakeCompletedIds([]);
    }
    if (status === 'MEETING' || status === 'ENDED') {
      setScannerMode(null);
      setTargetStationId(null);
      setActiveMiniGameStation(null);
    }
    prevRoomStatusRef.current = status;
  }, [room?.status]);

  const sabotageTargets = useMemo(
    () => resolveSabotageTargets(campusStations),
    [campusStations]
  );

  const uiSabotage: SabotageState | null = useMemo(() => {
    if (!room?.active_sabotage) return null;
    if (room.active_sabotage === 'REACTOR') {
      const expiresAt = room.sabotage_ends_at || Date.now() + 45_000;
      return {
        type: 'reactor',
        label: `REACTOR MELTDOWN · ${sabotageTargets.reactorLabel.toUpperCase()}`,
        targetStationId: sabotageTargets.reactorStationId,
        triggeredAt: expiresAt - 45_000,
        expiresAt,
      };
    }
    return {
      type: 'comms',
      label: `COMMS JAMMED · SCAN ${sabotageTargets.commsLabel.toUpperCase()}`,
      targetStationId:
        sabotageTargets.commsStationIds[1] ||
        sabotageTargets.commsStationIds[0] ||
        sabotageTargets.reactorStationId,
      triggeredAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
  }, [room?.active_sabotage, room?.sabotage_ends_at, sabotageTargets]);

  const uiMeeting: MeetingState | null = useMemo(() => {
    if (!room || room.status !== 'MEETING') return null;
    const callerBadge = room.meeting_caller_badge_id
      ? badgeIdToNumber(room.meeting_caller_badge_id)
      : '01';
    const callerName =
      publicPlayers.find((p) => p.badge_id === room.meeting_caller_badge_id)
        ?.name || 'Operative';
    const bodyBadge = room.meeting_body_badge_id
      ? badgeIdToNumber(room.meeting_body_badge_id)
      : null;

    return {
      reason: bodyBadge
        ? `Dead Body Reported (#${bodyBadge})`
        : 'Emergency Meeting Called',
      calledByBadge: callerBadge,
      calledByName: callerName,
      endsAt: room.meeting_ends_at || Date.now() + 60_000,
      votes,
      ejectionResult: room.ejection_result
        ? {
            ejectedPlayerId: null,
            ejectedBadgeNumber: null,
            ejectedName: null,
            message: room.ejection_result,
            timestamp: Date.now(),
          }
        : null,
    };
  }, [room, publicPlayers, votes]);

  const uiWinner: 'crewmates' | 'impostors' | null =
    room?.winner === 'CREWMATES'
      ? 'crewmates'
      : room?.winner === 'IMPOSTORS'
      ? 'impostors'
      : null;

  const uiWinReason: string | null = useMemo(() => {
    if (!uiWinner) return null;
    if (uiWinner === 'crewmates') {
      return (room?.task_progress ?? 0) >= 100
        ? 'All Campus Tasks Completed (100%)'
        : 'All Impostors Were Ejected';
    }
    return 'Impostors Achieved Campus Takeover';
  }, [uiWinner, room?.task_progress]);

  const navigateScreen = useCallback((next: ScreenId) => {
    setScreenOverride(next);
    if (next === 'print') {
      window.history.pushState({}, '', '/print');
    } else if (window.location.pathname === '/print') {
      window.history.pushState({}, '', '/');
    }
  }, []);

  const ensureJoinedForDev = useCallback(async () => {
    if (!identity) {
      const devName = name.trim() || 'Karthik';
      const devBadge = badgeNumber || '07';
      const devRoom = normalizeRoomCode(roomCode || 'SVCE');
      setName(devName);
      setBadgeNumber(devBadge);
      setRoomCode(devRoom);
      await joinRoom(devRoom, `P${devBadge}`, devName);
    }
  }, [identity, name, badgeNumber, roomCode, joinRoom]);

  const handleOpenPrintKitRequest = useCallback(() => {
    const currentLobby = normalizeRoomCode(identity?.roomCode || roomCode);
    if (unlockedPrintRoomCode === currentLobby) {
      navigateScreen('print');
      return;
    }
    setShowPrintPasscodeModal(true);
  }, [identity?.roomCode, roomCode, unlockedPrintRoomCode, navigateScreen]);

  const handlePrintPasscodeSuccess = useCallback(
    (verifiedRoomCode: string) => {
      try {
        sessionStorage.setItem(LS_KEYS.PRINT_UNLOCKED_ROOM, verifiedRoomCode);
      } catch {
        // ignore storage errors
      }
      setUnlockedPrintRoomCode(verifiedRoomCode);
      setShowPrintPasscodeModal(false);
      navigateScreen('print');
      showToast(`Printable QR Kit Unlocked (${verifiedRoomCode})`);
    },
    [navigateScreen, showToast]
  );

  const handleLockPrintKit = useCallback(() => {
    try {
      sessionStorage.removeItem(LS_KEYS.PRINT_UNLOCKED_ROOM);
    } catch {
      // ignore storage errors
    }
    setUnlockedPrintRoomCode(null);
    setScreenOverride(identity ? null : 'join');
    if (window.location.pathname === '/print') {
      window.history.pushState({}, '', '/');
    }
    showToast('Printable QR Kit Locked');
  }, [identity, showToast]);

  const handleSelectDevPreset = useCallback(
    async (preset: DevPresetId) => {
      if (preset !== 'join' && preset !== 'print') {
        await ensureJoinedForDev();
      }
      switch (preset) {
        case 'join':
          setRoleOverride(null);
          setStatusOverride(null);
          navigateScreen('join');
          break;
        case 'lobby':
          setRoleOverride(null);
          setStatusOverride(null);
          navigateScreen('lobby');
          break;
        case 'crewmate':
          setRoleOverride('crewmate');
          setStatusOverride('alive');
          navigateScreen('gameplay');
          break;
        case 'impostor':
          setRoleOverride('impostor');
          setStatusOverride('alive');
          navigateScreen('gameplay');
          break;
        case 'eliminated':
          setStatusOverride('eliminated');
          navigateScreen('gameplay');
          break;
        case 'ghost':
          setStatusOverride('ghost');
          navigateScreen('gameplay');
          break;
        case 'meeting':
          setStatusOverride('alive');
          if (room?.status !== 'MEETING') {
            await callMeeting(null);
          }
          navigateScreen('meeting');
          break;
        case 'print':
          handleOpenPrintKitRequest();
          break;
      }
    },
    [
      ensureJoinedForDev,
      navigateScreen,
      room?.status,
      callMeeting,
      handleOpenPrintKitRequest,
    ]
  );

  const handleJoinLobby = async (forceLocal = false) => {
    if (!name.trim() || !badgeNumber) return;
    setJoinError(null);
    try {
      await joinRoom(
        roomCode,
        normalizeBadgeId(`P${badgeNumber}`),
        name.trim(),
        forceLocal ? { forceLocal: true } : undefined
      );
      setScreenOverride(null);
      playTaskSuccessFeedback();
      if (forceLocal) {
        showToast('Joined in Local Offline Mode');
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to join Supabase room. Check credentials.';
      setJoinError(msg);
      playErrorFeedback();
      showToast(msg);
    }
  };

  const handleStartMatch = async () => {
    const activeCode = identity?.roomCode || normalizeRoomCode(roomCode);
    try {
      setScreenOverride(null);
      setRoleOverride(null);
      setStatusOverride(null);
      await startMatch(activeCode, room?.impostor_count === 2 ? 2 : 1);
      playTaskSuccessFeedback();
    } catch {
      playErrorFeedback();
      showToast('Failed to start match.');
    }
  };

  const handleScanBadgeResult = async (scannedBadge: string) => {
    if (scannerMode === 'wristband') {
      setBadgeNumber(scannedBadge);
      setScannerMode(null);
      showToast(`Wristband #${scannedBadge} Synced`);
      return;
    }

    if (scannerMode === 'eliminate') {
      setScannerMode(null);
      const ok = await eliminatePlayer(normalizeBadgeId(`P${scannedBadge}`));
      if (ok) {
        playErrorFeedback();
        showToast(`Target #${scannedBadge} Tagged`, 1100);
      } else {
        playErrorFeedback();
        showToast('Elimination blocked (cooldown or invalid target).', 1500);
      }
      return;
    }

    if (scannerMode === 'report') {
      setScannerMode(null);
      setScreenOverride(null);
      await callMeeting(normalizeBadgeId(`P${scannedBadge}`));
      playEmergencySiren();
    }
  };

  const handleScanStationResult = async (stationId: string) => {
    const station = getStationInfo(stationId);
    setScannerMode(null);
    setTargetStationId(null);
    if (!station) return;

    if (
      room?.active_sabotage === 'REACTOR' &&
      station.id === sabotageTargets.reactorStationId
    ) {
      await clearSabotage(station.id);
      playTaskSuccessFeedback();
      showToast('Reactor Meltdown Defused!');
    } else if (
      room?.active_sabotage === 'COMMS' &&
      sabotageTargets.commsStationIds.includes(station.id)
    ) {
      await clearSabotage(station.id);
      playTaskSuccessFeedback();
      showToast('Comms Restored!');
    }

    setActiveMiniGameStation(station);
  };

  const handleCompleteMiniGame = async (stationId: string) => {
    setActiveMiniGameStation(null);
    if (effectiveRole === 'impostor') {
      setFakeCompletedIds((prev) =>
        prev.includes(stationId) ? prev : [...prev, stationId]
      );
      return;
    }
    await completeStation(stationId);
  };

  const assignedStationIds = useMemo(() => {
    if (privateRole?.assigned_stations?.length) {
      return privateRole.assigned_stations;
    }
    return campusStations.map((s) => s.id);
  }, [privateRole?.assigned_stations, campusStations]);

  const activeSabotageStationIds = useMemo(() => {
    if (room?.active_sabotage === 'REACTOR') {
      return [sabotageTargets.reactorStationId];
    }
    if (room?.active_sabotage === 'COMMS') {
      return sabotageTargets.commsStationIds;
    }
    return [];
  }, [room?.active_sabotage, sabotageTargets]);

  const activeSabotageStationId = activeSabotageStationIds[0] || null;

  const isConnectionHealthy = identity
    ? realtimeConnected
    : isSupabaseConfigured;

  const topBarConnectionStatus = identity
    ? connectionStatus
    : isSupabaseConfigured
    ? 'connected'
    : 'disconnected';

  if (activeScreen === 'print') {
    if (!unlockedPrintRoomCode) {
      return (
        <div className="tactical-bg h-dvh overflow-hidden text-white">
          <PrintKitPasscodeModal
            initialRoomCode={identity?.roomCode || roomCode}
            onSuccess={handlePrintPasscodeSuccess}
            onClose={() => {
              setScreenOverride(identity ? null : 'join');
              if (window.location.pathname === '/print') {
                window.history.pushState({}, '', '/');
              }
            }}
          />
        </div>
      );
    }

    return (
      <>
        <DevSwitcherBar
          isFloatingOnly
          isDebugMode={isDebugMode}
          activeScreen={activeScreen}
          roleOverride={roleOverride}
          statusOverride={statusOverride}
          onSelectPreset={(preset) => void handleSelectDevPreset(preset)}
          onTriggerSabotage={() => {
            void triggerSabotage('REACTOR');
            playEmergencySiren();
          }}
          onSeedDemoPlayers={() => {
            void ensureJoinedForDev().then(() => seedDemoPlayers());
          }}
        />
        <PrintKitScreen
          unlockedRoomCode={unlockedPrintRoomCode}
          onLockPrintKit={handleLockPrintKit}
          onBack={() => {
            setScreenOverride(identity ? null : 'join');
            if (window.location.pathname === '/print') {
              window.history.pushState({}, '', '/');
            }
          }}
        />
      </>
    );
  }

  const showPhantomAtmosphere =
    activeScreen === 'gameplay' &&
    !uiWinner &&
    (effectiveStatus === 'eliminated' || effectiveStatus === 'ghost');

  return (
    <div className="tactical-bg h-dvh overflow-hidden text-white relative">
      {showPhantomAtmosphere && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed inset-0 z-0 transition-opacity duration-500 ${
            effectiveStatus === 'eliminated'
              ? 'bg-[radial-gradient(ellipse_120%_70%_at_50%_0%,rgba(139,92,246,0.36),rgba(139,92,246,0.14)_48%,transparent_82%)]'
              : 'bg-[radial-gradient(ellipse_120%_60%_at_50%_0%,rgba(139,92,246,0.28),rgba(139,92,246,0.1)_45%,transparent_78%)]'
          }`}
        />
      )}
      {/* Non-Overlapping Mobile-First Flex Column Shell */}
      <main className="w-full max-w-lg mx-auto h-dvh flex flex-col overflow-hidden relative z-10">
        {/* Reserved Top Strip with Supabase Realtime Heartbeat & Passcode-Gated Dev Controls */}
        <DevSwitcherBar
          isDebugMode={isDebugMode}
          activeScreen={activeScreen}
          roleOverride={roleOverride}
          statusOverride={statusOverride}
          roomCode={identity?.roomCode || roomCode}
          wsConnected={isConnectionHealthy}
          connectionStatus={topBarConnectionStatus}
          reconnectAttempt={reconnectAttempt}
          wsLatencyMs={realtimeLatencyMs}
          onSelectPreset={(preset) => void handleSelectDevPreset(preset)}
          onTriggerSabotage={() => {
            void ensureJoinedForDev().then(() => triggerSabotage('REACTOR'));
            playEmergencySiren();
          }}
          onSeedDemoPlayers={() => {
            void ensureJoinedForDev().then(() => {
              void seedDemoPlayers();
              showToast('Demo operatives added to roster');
            });
          }}
          onRequestUnlock={() => setShowPasscodeModal(true)}
          onOpenInsights={() => setShowInsightsModal(true)}
          onLockDevMode={handleLockDevMode}
        />

        {toastMessage && (
          <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 w-[88%] max-w-sm rounded-2xl bg-emerald-500/95 backdrop-blur-md text-slate-950 text-xs font-extrabold tracking-wide uppercase text-center px-4 py-2.5 shadow-[0_0_24px_rgba(16,185,129,0.55)]">
            {toastMessage}
          </div>
        )}

        {activeScreen === 'join' && (
          <JoinScreen
            name={name}
            roomCode={roomCode}
            badgeNumber={badgeNumber}
            wsConnected={isConnectionHealthy}
            supabaseConfigStatus={supabaseConfigStatus}
            joinError={joinError}
            onNameChange={(val) => {
              setJoinError(null);
              setName(val);
            }}
            onRoomCodeChange={(val) => {
              setJoinError(null);
              setRoomCode(val);
            }}
            onOpenScanner={() => setScannerMode('wristband')}
            onJoinLobby={() => void handleJoinLobby(false)}
            onJoinLocalFallback={() => void handleJoinLobby(true)}
            onOpenPrintKit={handleOpenPrintKitRequest}
          />
        )}

        {activeScreen === 'lobby' && (
          <LobbyScreen
            roomCode={identity?.roomCode || roomCode}
            myPlayer={myPlayer}
            players={uiPlayers}
            impostorCount={room?.impostor_count === 2 ? 2 : 1}
            isDebugMode={isDebugMode}
            onSetImpostorCount={(count) => void setImpostorCount(count)}
            onStartMatch={() => void handleStartMatch()}
            onSeedDemoPlayers={() => void seedDemoPlayers()}
            onLeaveLobby={() => {
              playUiClick();
              setJoinError(null);
              setScreenOverride(null);
              leaveRoom();
            }}
          />
        )}

        {activeScreen === 'gameplay' && (
          <GameplayScreen
            myPlayer={displayMyPlayer}
            players={uiPlayers}
            effectiveRole={effectiveRole}
            effectiveStatus={effectiveStatus}
            taskProgress={room?.task_progress ?? 0}
            sabotage={uiSabotage}
            isCommsSabotaged={isCommsSabotaged}
            commsLabel={sabotageTargets.commsLabel}
            assignedStationIds={assignedStationIds}
            killCooldownEnd={killCooldownEnd}
            winner={uiWinner}
            winReason={uiWinReason}
            onScanStation={(preselectedStationId) => {
              playUiClick();
              setTargetStationId(preselectedStationId || null);
              setScannerMode('station');
            }}
            onReportBody={() => {
              playUiClick();
              setTargetStationId(null);
              setScannerMode('report');
            }}
            onEliminateScan={() => {
              playUiClick();
              setTargetStationId(null);
              setScannerMode('eliminate');
            }}
            onTriggerSabotage={(type = 'REACTOR') => {
              void triggerSabotage(type);
              playEmergencySiren();
            }}
            onDefuseSabotage={() => {
              playUiClick();
              void clearSabotage();
            }}
            onCallMeeting={() => {
              setScreenOverride(null);
              void callMeeting(null);
              playEmergencySiren();
            }}
            onEnterGhostMode={() => {
              playUiClick();
              setStatusOverride('ghost');
              setGhostModeActive(true);
            }}
            onResetMatch={() => {
              playUiClick();
              setFakeCompletedIds([]);
              setScreenOverride(null);
              setRoleOverride(null);
              setStatusOverride(null);
              void resetRoom();
            }}
          />
        )}

        {activeScreen === 'meeting' && (
          <MeetingScreen
            meeting={uiMeeting}
            players={uiPlayers}
            myPlayer={myPlayer}
            isDead={effectiveStatus !== 'alive'}
            onCastVote={(targetPlayerId) => {
              playUiClick();
              void castVote(
                targetPlayerId === 'skip' ? 'SKIP' : targetPlayerId
              );
            }}
            onFinalizeNow={() => {
              playUiClick();
              void finalizeMeeting();
            }}
            onDismissEjection={() => {
              playUiClick();
              setScreenOverride(null);
              void dismissEjection();
            }}
          />
        )}
      </main>

      {/* Camera QR Scanner Modal */}
      {scannerMode && (
        <QrScannerModal
          mode={scannerMode}
          isDebugMode={isDebugMode}
          players={uiPlayers}
          myPlayerId={identity?.badgeId}
          assignedStationIds={assignedStationIds}
          completedStationIds={
            effectiveRole === 'impostor'
              ? fakeCompletedIds
              : privateRole?.completed_stations || []
          }
          targetStationId={targetStationId}
          isFakeScanMode={effectiveRole === 'impostor'}
          activeSabotageStationId={activeSabotageStationId}
          activeSabotageStationIds={activeSabotageStationIds}
          onScanBadge={(badge) => void handleScanBadgeResult(badge)}
          onScanStation={(stationId) => void handleScanStationResult(stationId)}
          onClose={() => {
            setScannerMode(null);
            setTargetStationId(null);
          }}
        />
      )}

      {/* Touch Mini-Game Drawer */}
      {activeMiniGameStation && (
        <MiniGameModal
          station={activeMiniGameStation}
          isFakeTask={effectiveRole === 'impostor'}
          onComplete={(stationId) => void handleCompleteMiniGame(stationId)}
          onClose={() => setActiveMiniGameStation(null)}
        />
      )}

      {/* Developer Mode Passcode Modal (7887337) */}
      {showPasscodeModal && (
        <DevPasscodeModal
          onSuccess={handleUnlockSuccess}
          onClose={() => setShowPasscodeModal(false)}
        />
      )}

      {/* Host Printable QR Kit Passcode Modal (Per-Lobby Passcode) */}
      {showPrintPasscodeModal && (
        <PrintKitPasscodeModal
          initialRoomCode={identity?.roomCode || roomCode}
          onSuccess={handlePrintPasscodeSuccess}
          onClose={() => setShowPrintPasscodeModal(false)}
        />
      )}

      {/* Developer Insights & Laptop Studio Drawer */}
      {showInsightsModal && isDebugMode && (
        <DeveloperInsightsModal
          isSupabaseConfigured={isSupabaseConfigured}
          connectionStatus={topBarConnectionStatus}
          reconnectAttempt={reconnectAttempt}
          latencyMs={realtimeLatencyMs}
          syncError={syncError}
          identity={identity}
          room={room}
          publicPlayers={publicPlayers}
          privateRole={privateRole}
          votes={votes}
          events={insightEvents}
          recentLobbies={recentLobbies}
          activeRoomCodeDraft={roomCode}
          onCreateLobby={async (code, impostors) => {
            const created = await createLobby(code, impostors);
            setRoomCode(created);
          }}
          onSwitchLobby={async (code) => {
            await switchLobby(code);
            setRoomCode(code);
          }}
          onAddCandidate={addCandidate}
          onRemoveCandidate={removeCandidate}
          onToggleCandidateAlive={toggleCandidateAlive}
          onSeedDemoPlayers={seedDemoPlayers}
          onSetImpostorCount={setImpostorCount}
          onStartMatch={startMatch}
          onResetMatch={resetRoom}
          onSelectPreset={(preset) => void handleSelectDevPreset(preset)}
          onTestStationMiniGame={(station) =>
            setActiveMiniGameStation(toTaskStation(station))
          }
          onClearEvents={clearInsightEvents}
          onLockDevMode={handleLockDevMode}
          onClose={() => setShowInsightsModal(false)}
        />
      )}
    </div>
  );
}
