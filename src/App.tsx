import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TASK_STATIONS,
  getStationInfo,
  type MeetingState,
  type Player,
  type PlayerRole,
  type PlayerStatus,
  type SabotageState,
  type ScreenId,
  type TaskStation,
} from './shared/gameData';
import {
  badgeIdToNumber,
  normalizeBadgeId,
  normalizeRoomCode,
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

const LS_KEYS = {
  NAME: 'cairl_name',
  ROOM_CODE: 'cairl_room_code',
  BADGE: 'cairl_badge',
  DEV_OVERRIDES: 'cairl_dev_overrides',
  DEV_UNLOCKED: 'cairl_dev_unlocked',
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
    realtimeConnected,
    connectionStatus,
    reconnectAttempt,
    realtimeLatencyMs,
    syncError,
    insightEvents,
    clearInsightEvents,
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
  } = useCampusGame();

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
  const [activeMiniGameStation, setActiveMiniGameStation] =
    useState<TaskStation | null>(null);
  const [showPasscodeModal, setShowPasscodeModal] = useState(false);
  const [showInsightsModal, setShowInsightsModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 2600);
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
    } catch {
      // ignore storage errors
    }
    setIsDevUnlocked(false);
    setShowInsightsModal(false);
    setRoleOverride(null);
    setStatusOverride(null);
    setScreenOverride((cur) => (cur === 'print' ? 'print' : null));
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

  const uiSabotage: SabotageState | null = useMemo(() => {
    if (!room?.active_sabotage) return null;
    if (room.active_sabotage === 'REACTOR') {
      const expiresAt = room.sabotage_ends_at || Date.now() + 45_000;
      return {
        type: 'reactor',
        label: 'REACTOR MELTDOWN — SCAN CYBER LAB QR',
        targetStationId: 'CYBER_LAB',
        triggeredAt: expiresAt - 45_000,
        expiresAt,
      };
    }
    return {
      type: 'comms',
      label: 'COMMS JAMMED — SCAN CYBER LAB OR RECEPTION QR',
      targetStationId: 'RECEPTION',
      triggeredAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
  }, [room?.active_sabotage, room?.sabotage_ends_at]);

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
          navigateScreen('print');
          break;
      }
    },
    [ensureJoinedForDev, navigateScreen, room?.status, callMeeting]
  );

  const handleJoinLobby = async () => {
    if (!name.trim() || !badgeNumber) return;
    try {
      await joinRoom(roomCode, normalizeBadgeId(`P${badgeNumber}`), name.trim());
      setScreenOverride(null);
      playTaskSuccessFeedback();
    } catch {
      playErrorFeedback();
      showToast('Unable to join Supabase room. Check credentials.');
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
        showToast(`Eliminated Badge #${scannedBadge}`);
      } else {
        playErrorFeedback();
        showToast('Elimination blocked (cooldown or invalid target).');
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
    if (!station) return;

    if (
      room?.active_sabotage === 'REACTOR' &&
      station.id === 'CYBER_LAB'
    ) {
      await clearSabotage(station.id);
      playTaskSuccessFeedback();
      showToast('Reactor Meltdown Defused!');
    } else if (
      room?.active_sabotage === 'COMMS' &&
      (station.id === 'CYBER_LAB' || station.id === 'RECEPTION')
    ) {
      await clearSabotage(station.id);
      playTaskSuccessFeedback();
      showToast('Comms Restored!');
    }

    setActiveMiniGameStation(station);
  };

  const handleCompleteMiniGame = async (stationId: string) => {
    setActiveMiniGameStation(null);
    await completeStation(stationId);
  };

  const assignedStationIds = useMemo(() => {
    if (privateRole?.assigned_stations?.length) {
      return privateRole.assigned_stations;
    }
    return TASK_STATIONS.map((s) => s.id);
  }, [privateRole?.assigned_stations]);

  const activeSabotageStationId =
    room?.active_sabotage === 'REACTOR'
      ? 'CYBER_LAB'
      : room?.active_sabotage === 'COMMS'
      ? 'RECEPTION'
      : null;

  const isConnectionHealthy = identity
    ? realtimeConnected
    : isSupabaseConfigured;

  const topBarConnectionStatus = identity
    ? connectionStatus
    : isSupabaseConfigured
    ? 'connected'
    : 'disconnected';

  if (activeScreen === 'print') {
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

  return (
    <div className="tactical-bg h-dvh overflow-hidden text-white">
      {/* Non-Overlapping Mobile-First Flex Column Shell */}
      <main className="max-w-md mx-auto h-dvh flex flex-col overflow-hidden relative">
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
            onNameChange={setName}
            onRoomCodeChange={setRoomCode}
            onOpenScanner={() => setScannerMode('wristband')}
            onJoinLobby={() => void handleJoinLobby()}
            onOpenPrintKit={() => navigateScreen('print')}
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
          />
        )}

        {activeScreen === 'gameplay' && (
          <GameplayScreen
            myPlayer={myPlayer}
            effectiveRole={effectiveRole}
            effectiveStatus={effectiveStatus}
            taskProgress={room?.task_progress ?? 0}
            sabotage={uiSabotage}
            isCommsSabotaged={isCommsSabotaged}
            assignedStationIds={assignedStationIds}
            killCooldownEnd={killCooldownEnd}
            winner={uiWinner}
            winReason={uiWinReason}
            onScanStation={() => {
              playUiClick();
              setScannerMode('station');
            }}
            onReportBody={() => {
              playUiClick();
              setScannerMode('report');
            }}
            onEliminateScan={() => {
              playUiClick();
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
          activeSabotageStationId={activeSabotageStationId}
          onScanBadge={(badge) => void handleScanBadgeResult(badge)}
          onScanStation={(stationId) => void handleScanStationResult(stationId)}
          onClose={() => setScannerMode(null)}
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

      {/* Developer Insights Drawer */}
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
          onClearEvents={clearInsightEvents}
          onLockDevMode={handleLockDevMode}
          onClose={() => setShowInsightsModal(false)}
        />
      )}
    </div>
  );
}
