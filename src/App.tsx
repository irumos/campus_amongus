import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
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
import {
  setMatchQrToken,
  useMatchQrToken,
} from './config/matchQrStore';
import { useCampusStations } from './config/stationStore';
import {
  MEETING_DURATION_MS,
  REACTOR_SABOTAGE_MS,
  badgeIdToNumber,
  normalizeBadgeId,
  normalizeRoomCode,
  resolveSabotageTargets,
  useCampusGame,
  type CampusLocalIdentity,
} from './hooks/useCampusGame';
import {
  playErrorFeedback,
  playTaskSuccessFeedback,
  playUiClick,
  startHomeAmbience,
  stopHomeAmbience,
} from './utils/feedback';
import { DevSwitcherBar, type DevPresetId } from './components/DevSwitcherBar';
import { DevPasscodeModal } from './components/DevPasscodeModal';
import {
  DeveloperInsightsModal,
  type DevInboxMessage,
} from './components/DeveloperInsightsModal';
import { JoinScreen } from './components/JoinScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { GameplayScreen } from './components/GameplayScreen';
import { MeetingScreen } from './components/MeetingScreen';
import { PrintKitScreen } from './components/PrintKitScreen';
import { QrScannerModal, type ScannerMode } from './components/QrScannerModal';
import { MiniGameModal } from './components/MiniGameModal';
import { PrintKitPasscodeModal } from './components/PrintKitPasscodeModal';
import campusBackdropImg from './assets/images/campus_command_backdrop_1795073096738.jpg';

const LS_KEYS = {
  NAME: 'cairl_name',
  ROOM_CODE: 'cairl_room_code',
  BADGE: 'cairl_badge',
  DEV_OVERRIDES: 'cairl_dev_overrides',
  DEV_UNLOCKED: 'cairl_dev_unlocked',
  PRINT_UNLOCKED_ROOM: 'cairl_print_unlocked_room',
  DEV_INBOX: 'cairl_dev_inbox',
} as const;

type ToastVariant = 'success' | 'info' | 'warning' | 'error';

interface ToastState {
  id: number;
  message: string;
  variant: ToastVariant;
  durationMs: number;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_TOAST_DURATION_MS: Record<ToastVariant, number> = {
  success: 16_000,
  info: 16_000,
  warning: 20_000,
  error: 20_000,
};

const MAX_VISIBLE_TOASTS = 3;

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
  const [backdropFailed, setBackdropFailed] = useState(false);

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
    rosterNotification,
    impostorOpsLog,
    identity,
    room,
    publicPlayers,
    privateRole,
    devAllRoles,
    refreshDevRoles,
    devResetKillCooldown,
    devBoostTaskProgress,
    devReviveAllPlayers,
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
    assignHost,
    setImpostorCount,
    startMatch,
    completeStation,
    eliminatePlayer,
    triggerSabotage,
    clearSabotage,
    callMeeting,
    extendMeetingTime,
    beginDiscussionPhase,
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
    identity?.badgeId ? badgeIdToNumber(identity.badgeId) : null
  );
  const [qrVerifiedInSession, setQrVerifiedInSession] = useState(false);

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
  const [insightsInitialTab, setInsightsInitialTab] = useState<
    'lobby' | 'rooms' | 'analytics' | 'inbox'
  >('lobby');
  const [povBadgeId, setPovBadgeId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Stackable Toast Queue (16s-20s readable display with pause on hover/touch)
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const [toastsPaused, setToastsPaused] = useState(false);
  const [toastNow, setToastNow] = useState(Date.now());
  const toastSeqRef = useRef<number>(0);

  // Developer-Only Room Error & Message Inbox
  const [devInbox, setDevInbox] = useState<DevInboxMessage[]>(() => {
    try {
      const raw = sessionStorage.getItem(LS_KEYS.DEV_INBOX);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as DevInboxMessage[]) : [];
    } catch {
      return [];
    }
  });

  const activeRoomCode = normalizeRoomCode(identity?.roomCode || roomCode);
  const activeMatchToken = useMatchQrToken(activeRoomCode);

  useEffect(() => {
    try {
      sessionStorage.setItem(LS_KEYS.DEV_INBOX, JSON.stringify(devInbox.slice(0, 80)));
    } catch {
      // ignore storage quota errors
    }
  }, [devInbox]);

  const appendDevInbox = useCallback(
    (
      level: DevInboxMessage['level'],
      source: string,
      message: string,
      roomOverride?: string
    ) => {
      const targetRoom = normalizeRoomCode(roomOverride || activeRoomCode);
      setDevInbox((prev) => [
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          ts: Date.now(),
          level,
          source,
          message,
          roomCode: targetRoom,
          read: false,
        },
        ...prev.slice(0, 79),
      ]);
    },
    [activeRoomCode]
  );

  // Capture unhandled runtime & promise errors into the Developer Room Inbox
  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      const msg =
        event.error instanceof Error
          ? event.error.message
          : event.message || 'Unhandled runtime error';
      appendDevInbox('error', 'RUNTIME', msg);
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
          ? reason
          : 'Unhandled promise rejection';
      appendDevInbox('error', 'PROMISE', msg);
    };
    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [appendDevInbox]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (
      msg: string,
      options?:
        | { durationMs?: number; variant?: ToastVariant; source?: string }
        | number
    ) => {
      const variant: ToastVariant =
        typeof options === 'number' ? 'info' : options?.variant ?? 'info';
      const source =
        typeof options === 'number' ? 'APP' : options?.source ?? 'GAME';
      const durationMs =
        typeof options === 'number'
          ? Math.max(16_000, options)
          : Math.max(
              options?.durationMs ?? DEFAULT_TOAST_DURATION_MS[variant],
              variant === 'error' || variant === 'warning' ? 18_000 : 14_000
            );

      const nowMs = Date.now();
      toastSeqRef.current += 1;
      const nextId = toastSeqRef.current;

      setToasts((prev) => {
        const filtered = prev.filter((t) => t.message !== msg);
        return [
          {
            id: nextId,
            message: msg,
            variant,
            durationMs,
            createdAt: nowMs,
            expiresAt: nowMs + durationMs,
          },
          ...filtered,
        ].slice(0, MAX_VISIBLE_TOASTS);
      });

      appendDevInbox(variant, source, msg);
    },
    [appendDevInbox]
  );

  // Tick toast progress bars & expire toasts (paused while user hovers or holds a toast)
  useEffect(() => {
    if (toasts.length === 0) return;
    const interval = setInterval(() => {
      const nowMs = Date.now();
      setToastNow(nowMs);
      if (toastsPaused) {
        setToasts((prev) =>
          prev.map((t) => ({
            ...t,
            expiresAt: t.expiresAt + 250,
            createdAt: t.createdAt + 250,
          }))
        );
        return;
      }
      setToasts((prev) => prev.filter((t) => t.expiresAt > nowMs));
    }, 250);
    return () => clearInterval(interval);
  }, [toasts.length, toastsPaused]);

  const handleUnlockSuccess = useCallback(() => {
    try {
      sessionStorage.setItem(LS_KEYS.DEV_UNLOCKED, 'true');
    } catch {
      // ignore storage errors
    }
    setIsDevUnlocked(true);
    setShowPasscodeModal(false);
    setInsightsInitialTab('lobby');
    setShowInsightsModal(true);
    void refreshDevRoles();
    showToast('Developer Mode Unlocked', {
      variant: 'success',
      source: 'DEV_AUTH',
    });
  }, [refreshDevRoles, showToast]);

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
    setPovBadgeId(null);
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
      showToast(`Sync Warning: ${syncError}`, {
        variant: 'error',
        source: 'SUPABASE_SYNC',
        durationMs: 20_000,
      });
    }
  }, [syncError, showToast]);

  const lastRosterToastIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!rosterNotification) return;
    if (lastRosterToastIdRef.current === rosterNotification.id) return;
    lastRosterToastIdRef.current = rosterNotification.id;
    showToast(rosterNotification.message, {
      variant: rosterNotification.kind === 'left' ? 'warning' : 'info',
      source: 'ROSTER',
      durationMs: 16_000,
    });
  }, [rosterNotification, showToast]);

  // Keep Dev roles hydrated while Developer Mode is active so POV switching & analytics stay live
  useEffect(() => {
    if (isDebugMode && activeRoomCode) {
      void refreshDevRoles(activeRoomCode);
    }
  }, [isDebugMode, activeRoomCode, room?.status, publicPlayers.length, refreshDevRoles]);

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

  // Adapt Supabase rows to UI Player[] model (keeping private roles isolated; Dev Mode can inspect all roles for POV)
  const uiPlayers: Player[] = useMemo(() => {
    const fellowSet = new Set(privateRole?.fellow_impostors || []);
    return publicPlayers.map((p, idx) => {
      const isMe = identity?.badgeId === p.badge_id;
      const devRoleRow = isDebugMode ? devAllRoles[p.badge_id] : undefined;
      const knownImpostor =
        isDebugMode && isMe && roleOverride
          ? roleOverride === 'impostor'
          : (isMe && privateRole?.role === 'IMPOSTOR') ||
            fellowSet.has(p.badge_id) ||
            (isDebugMode && devRoleRow?.role === 'IMPOSTOR');

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
        completedTaskIds: isMe
          ? privateRole?.completed_stations || []
          : devRoleRow?.completed_stations || [],
        isHost: Boolean(room?.host_badge_id && p.badge_id === room.host_badge_id),
        joinedAt: idx,
      };
    });
  }, [
    publicPlayers,
    identity?.badgeId,
    privateRole,
    ghostModeActive,
    isDebugMode,
    roleOverride,
    devAllRoles,
    room?.host_badge_id,
  ]);

  const myPlayer: Player | null = useMemo(() => {
    if (!identity?.badgeId) return null;
    return uiPlayers.find((p) => p.id === identity.badgeId) || null;
  }, [uiPlayers, identity?.badgeId]);

  const activePovPlayer: Player | null = useMemo(() => {
    if (!isDebugMode || !povBadgeId) return null;
    return uiPlayers.find((p) => p.id === povBadgeId) || null;
  }, [isDebugMode, povBadgeId, uiPlayers]);

  const activePovRoleRow = useMemo(() => {
    if (!isDebugMode || !povBadgeId) return null;
    if (identity?.badgeId === povBadgeId) return privateRole;
    return devAllRoles[povBadgeId] || null;
  }, [isDebugMode, povBadgeId, identity?.badgeId, privateRole, devAllRoles]);

  const activeScreen: ScreenId = useMemo(() => {
    if (screenOverride) return screenOverride;
    if (!identity) return 'join';
    if (!room || room.status === 'LOBBY') return 'lobby';
    if (room.status === 'MEETING') return 'meeting';
    return 'gameplay';
  }, [screenOverride, identity, room]);

  const effectiveRole: PlayerRole =
    roleOverride ??
    (activePovPlayer
      ? activePovRoleRow?.role === 'IMPOSTOR' || activePovPlayer.role === 'impostor'
        ? 'impostor'
        : 'crewmate'
      : privateRole?.role === 'IMPOSTOR'
      ? 'impostor'
      : 'crewmate');

  const effectiveStatus: PlayerStatus =
    statusOverride ?? activePovPlayer?.status ?? myPlayer?.status ?? 'alive';

  // Adapt displayed player cleanly for POV observation or Impostor disguise cover
  const displayMyPlayer: Player | null = useMemo(() => {
    const basePlayer = activePovPlayer ?? myPlayer;
    if (!basePlayer) return null;
    if (activePovPlayer) return basePlayer;
    if (effectiveRole !== 'impostor') return basePlayer;
    return {
      ...basePlayer,
      completedTaskIds: fakeCompletedIds,
    };
  }, [activePovPlayer, myPlayer, effectiveRole, fakeCompletedIds]);

  const observingPlayerBanner = useMemo(() => {
    if (!activePovPlayer) return null;
    return {
      name: activePovPlayer.name,
      badgeNumber: activePovPlayer.badgeNumber,
      role: effectiveRole,
    };
  }, [activePovPlayer, effectiveRole]);

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

  // Play atmospheric space-wind & subtle tactical BGM only on the Home Screen
  useEffect(() => {
    if (activeScreen === 'join') {
      startHomeAmbience();
    } else {
      stopHomeAmbience();
    }
    return () => {
      stopHomeAmbience();
    };
  }, [activeScreen]);

  const sabotageTargets = useMemo(
    () => resolveSabotageTargets(campusStations),
    [campusStations]
  );

  const uiSabotage: SabotageState | null = useMemo(() => {
    if (!room?.active_sabotage) return null;
    if (room.active_sabotage === 'REACTOR') {
      const expiresAt = room.sabotage_ends_at || Date.now() + REACTOR_SABOTAGE_MS;
      return {
        type: 'reactor',
        label: `REACTOR MELTDOWN · ${sabotageTargets.reactorLabel.toUpperCase()}`,
        targetStationId: sabotageTargets.reactorStationId,
        triggeredAt: expiresAt - REACTOR_SABOTAGE_MS,
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

    let parsedEjection: MeetingState['ejectionResult'] = null;
    if (room.ejection_result) {
      const resultText = room.ejection_result;
      const isNoOneEjected = /no one was ejected/i.test(resultText);
      let ejectedPlayer: (typeof publicPlayers)[number] | null = null;
      let ejectedBadgeNumber: string | null = null;

      if (!isNoOneEjected) {
        const badgeMatch = resultText.match(/#(\d{1,2})|\bP(0[1-9]|1[0-6])\b/i);
        if (badgeMatch) {
          const rawNum = (badgeMatch[1] || badgeMatch[2] || '').padStart(2, '0');
          if (rawNum) {
            ejectedBadgeNumber = rawNum;
            const targetBadgeId = normalizeBadgeId(`P${rawNum}`);
            ejectedPlayer =
              publicPlayers.find((p) => p.badge_id === targetBadgeId) || null;
          }
        }
      }

      parsedEjection = {
        ejectedPlayerId: ejectedPlayer?.badge_id ?? null,
        ejectedBadgeNumber,
        ejectedName: ejectedPlayer?.name ?? null,
        message: resultText,
        timestamp: Date.now(),
      };
    }

    return {
      reason: bodyBadge
        ? `Dead Body Reported (#${bodyBadge})`
        : 'Emergency Meeting Called',
      calledByBadge: callerBadge,
      calledByName: callerName,
      endsAt: room.meeting_ends_at || Date.now() + MEETING_DURATION_MS,
      votes,
      ejectionResult: parsedEjection,
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

  const ensureJoinedForDev = useCallback(async (): Promise<CampusLocalIdentity> => {
    if (identity) return identity;
    const devName = name.trim() || 'Karthik';
    const devBadge = badgeNumber || '07';
    const devRoom = normalizeRoomCode(roomCode || 'SVCE');
    setName(devName);
    setBadgeNumber(devBadge);
    setRoomCode(devRoom);
    return await joinRoom(devRoom, `P${devBadge}`, devName);
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
      showToast(`Printable QR Kit Unlocked (${verifiedRoomCode})`, {
        variant: 'success',
        durationMs: 10_000,
      });
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
    showToast('Printable QR Kit Locked', { variant: 'info', durationMs: 10_000 });
  }, [identity, showToast]);

  const hasActiveOverride = Boolean(
    screenOverride || roleOverride || statusOverride || povBadgeId
  );

  const handleReturnToLiveMatch = useCallback(() => {
    setScreenOverride(null);
    setRoleOverride(null);
    setStatusOverride(null);
    setPovBadgeId(null);
    if (window.location.pathname === '/print') {
      window.history.pushState({}, '', '/');
    }
    showToast(identity ? 'Returned to Live Match' : 'Returned to Live View', {
      variant: 'info',
      source: 'DEV_NAV',
    });
  }, [identity, showToast]);

  const handleExitMatchOrLobby = useCallback(() => {
    playUiClick();
    setJoinError(null);
    setScannerMode(null);
    setTargetStationId(null);
    setActiveMiniGameStation(null);
    setFakeCompletedIds([]);
    setPovBadgeId(null);
    setBadgeNumber(null);
    setQrVerifiedInSession(false);
    setScreenOverride(null);
    setRoleOverride(null);
    setStatusOverride(null);
    if (window.location.pathname === '/print') {
      window.history.pushState({}, '', '/');
    }
    leaveRoom();
    showToast('Exited Room', { variant: 'info', source: 'LOBBY' });
  }, [leaveRoom, showToast]);

  const handleDevTriggerSabotage = useCallback(
    async (type: 'REACTOR' | 'COMMS' = 'REACTOR') => {
      try {
        const devId = await ensureJoinedForDev();
        const res = await triggerSabotage(type, {
          force: true,
          roomCodeOverride: devId.roomCode,
        });
        if (res.ok) {
          if (activeScreen !== 'gameplay') {
            navigateScreen('gameplay');
          }
          showToast(
            res.message ||
              (type === 'REACTOR'
                ? 'Reactor Meltdown triggered (2:00 countdown to defuse)!'
                : 'Comms Jammed — Crewmate task locations scrambled!'),
            {
              variant: 'warning',
              source: 'SABOTAGE',
            }
          );
        } else {
          playErrorFeedback();
          showToast(res.message || 'Unable to trigger sabotage.', {
            variant: 'error',
            source: 'SABOTAGE',
          });
        }
      } catch (err) {
        playErrorFeedback();
        showToast(
          err instanceof Error ? err.message : 'Unable to trigger sabotage.',
          { variant: 'error', source: 'SABOTAGE' }
        );
      }
    },
    [ensureJoinedForDev, triggerSabotage, activeScreen, navigateScreen, showToast]
  );

  const handleSelectPov = useCallback(
    (badgeId: string | null) => {
      setPovBadgeId(badgeId);
      setRoleOverride(null);
      setStatusOverride(null);
      if (badgeId) {
        void refreshDevRoles();
        const target = uiPlayers.find((p) => p.id === badgeId);
        if (activeScreen === 'join' || activeScreen === 'lobby' || activeScreen === 'print') {
          navigateScreen(room?.status === 'MEETING' ? 'meeting' : 'gameplay');
        }
        if (target) {
          showToast(
            `Observing POV: #${target.badgeNumber} ${target.name}`,
            { variant: 'info', source: 'DEV_POV' }
          );
        }
      } else {
        showToast('Returned to your own operative POV', {
          variant: 'info',
          source: 'DEV_POV',
        });
      }
    },
    [refreshDevRoles, uiPlayers, activeScreen, navigateScreen, room?.status, showToast]
  );

  const handleSelectDevPreset = useCallback(
    async (preset: DevPresetId) => {
      const devId =
        preset !== 'join' && preset !== 'print'
          ? await ensureJoinedForDev()
          : null;
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
        case 'meeting': {
          setStatusOverride('alive');
          if (room?.status !== 'MEETING') {
            const res = await callMeeting(
              null,
              devId
                ? {
                    roomCodeOverride: devId.roomCode,
                    badgeIdOverride: devId.badgeId,
                  }
                : undefined
            );
            if (!res.ok && res.message) {
              playErrorFeedback();
              showToast(res.message, { variant: 'error', durationMs: 15_000 });
            }
          }
          navigateScreen('meeting');
          break;
        }
        case 'print':
          if (isDebugMode) {
            const targetRoom = normalizeRoomCode(identity?.roomCode || roomCode);
            setUnlockedPrintRoomCode(targetRoom);
            navigateScreen('print');
          } else {
            handleOpenPrintKitRequest();
          }
          break;
      }
    },
    [
      ensureJoinedForDev,
      navigateScreen,
      room?.status,
      callMeeting,
      handleOpenPrintKitRequest,
      isDebugMode,
      identity?.roomCode,
      roomCode,
      showToast,
    ]
  );

  const handleJoinLobby = async (forceLocal = false) => {
    if (!qrVerifiedInSession || !badgeNumber) {
      playErrorFeedback();
      showToast(
        'Scan a valid Player ID Card QR code via the scanner before joining the lobby.',
        { variant: 'error', source: 'ID_CARD' }
      );
      return;
    }
    if (!name.trim()) return;
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
        showToast('Joined in Local Offline Mode', {
          variant: 'info',
          durationMs: 10_000,
        });
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to join Supabase room. Check credentials.';
      setJoinError(msg);
      playErrorFeedback();
      showToast(msg, { variant: 'error', durationMs: 15_000 });
    }
  };

  const activeRoomImpostorCount: 1 | 2 | 3 =
    room?.impostor_count === 3 ? 3 : room?.impostor_count === 2 ? 2 : 1;

  const handleStartMatch = async () => {
    const activeCode = identity?.roomCode || normalizeRoomCode(roomCode);
    try {
      setScreenOverride(null);
      setRoleOverride(null);
      setStatusOverride(null);
      await startMatch(activeCode, activeRoomImpostorCount);
      playTaskSuccessFeedback();
    } catch (err) {
      playErrorFeedback();
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to start match.';
      showToast(msg, { variant: 'error', durationMs: 15_000 });
    }
  };

  const handleScanBadgeResult = async (scannedBadge: string) => {
    if (scannerMode === 'wristband') {
      setBadgeNumber(scannedBadge);
      setQrVerifiedInSession(true);
      setScannerMode(null);
      showToast(`ID Card #${scannedBadge} Verified via QR`, {
        variant: 'success',
        source: 'ID_CARD',
      });
      return;
    }

    if (scannerMode === 'eliminate') {
      setScannerMode(null);
      const res = await eliminatePlayer(normalizeBadgeId(`P${scannedBadge}`));
      if (res.ok) {
        playErrorFeedback();
        showToast(
          `Target #${scannedBadge} Eliminated · 30s Kill Cooldown Started`,
          { variant: 'warning', durationMs: 12_000 }
        );
      } else {
        playErrorFeedback();
        showToast(
          res.reason || 'Elimination blocked (cooldown or invalid target).',
          { variant: 'error', durationMs: 15_000 }
        );
      }
      return;
    }

    if (scannerMode === 'report') {
      setScannerMode(null);
      const activeId = identity || (isDebugMode ? await ensureJoinedForDev() : null);
      const res = await callMeeting(
        normalizeBadgeId(`P${scannedBadge}`),
        activeId
          ? {
              roomCodeOverride: activeId.roomCode,
              badgeIdOverride: activeId.badgeId,
            }
          : undefined
      );
      if (res.ok) {
        setScreenOverride(null);
        showToast(
          res.message ||
            `Dead Body #${scannedBadge} Reported — Emergency Meeting Started!`,
          { variant: 'warning', durationMs: 12_000 }
        );
      } else {
        playErrorFeedback();
        showToast(res.message || 'Unable to report body right now.', {
          variant: 'error',
          durationMs: 15_000,
        });
      }
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
      showToast('Reactor Meltdown Defused!', {
        variant: 'success',
        durationMs: 10_000,
      });
    } else if (
      room?.active_sabotage === 'COMMS' &&
      sabotageTargets.commsStationIds.includes(station.id)
    ) {
      await clearSabotage(station.id);
      playTaskSuccessFeedback();
      showToast('Comms Restored!', { variant: 'success', durationMs: 10_000 });
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
    const activeRole = activePovRoleRow || privateRole;
    if (activeRole?.assigned_stations?.length) {
      return activeRole.assigned_stations;
    }
    return campusStations.map((s) => s.id);
  }, [activePovRoleRow, privateRole, campusStations]);

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

  const roomInboxMessages = useMemo(
    () =>
      devInbox.filter(
        (m) => !m.roomCode || m.roomCode === activeRoomCode
      ),
    [devInbox, activeRoomCode]
  );

  const unreadInboxCount = useMemo(
    () => roomInboxMessages.filter((m) => !m.read).length,
    [roomInboxMessages]
  );

  const handleMarkInboxRead = useCallback(() => {
    setDevInbox((prev) =>
      prev.map((m) =>
        !m.roomCode || m.roomCode === activeRoomCode ? { ...m, read: true } : m
      )
    );
  }, [activeRoomCode]);

  const handleClearInbox = useCallback(() => {
    setDevInbox((prev) =>
      prev.filter((m) => m.roomCode && m.roomCode !== activeRoomCode)
    );
  }, [activeRoomCode]);

  const insightsModalNode =
    showInsightsModal && isDebugMode ? (
      <DeveloperInsightsModal
        key={insightsInitialTab}
        isSupabaseConfigured={isSupabaseConfigured}
        connectionStatus={topBarConnectionStatus}
        reconnectAttempt={reconnectAttempt}
        latencyMs={realtimeLatencyMs}
        syncError={syncError}
        identity={identity}
        room={room}
        publicPlayers={publicPlayers}
        privateRole={privateRole}
        devAllRoles={devAllRoles}
        votes={votes}
        events={insightEvents}
        inboxMessages={roomInboxMessages}
        initialTab={insightsInitialTab}
        recentLobbies={recentLobbies}
        activeRoomCodeDraft={roomCode}
        hasActiveOverride={hasActiveOverride}
        povBadgeId={povBadgeId}
        onSelectPov={handleSelectPov}
        onReturnToLiveGame={handleReturnToLiveMatch}
        onCreateLobby={async (code, impostors, designatedHostBadgeId) => {
          const created = await createLobby(
            code,
            impostors,
            designatedHostBadgeId
          );
          setRoomCode(created);
        }}
        onSwitchLobby={async (code) => {
          await switchLobby(code);
          setRoomCode(code);
        }}
        onAddCandidate={addCandidate}
        onRemoveCandidate={removeCandidate}
        onToggleCandidateAlive={toggleCandidateAlive}
        onAssignHost={async (code, targetBadgeId) => {
          const res = await assignHost(code, targetBadgeId);
          if (!res.ok && res.message) {
            playErrorFeedback();
            showToast(res.message, { variant: 'error', source: 'DEV_TOOLS' });
          } else if (res.message) {
            showToast(res.message, { variant: 'warning', source: 'DEV_TOOLS' });
          }
        }}
        onSeedDemoPlayers={seedDemoPlayers}
        onSetImpostorCount={async (count) => {
          await setImpostorCount(count, { isDeveloperOverride: true });
        }}
        onStartMatch={async (code, count) => {
          await startMatch(code, count, { isDeveloperOverride: true });
        }}
        onResetMatch={resetRoom}
        onDevTriggerSabotage={(type) => handleDevTriggerSabotage(type)}
        onDevClearSabotage={async () => {
          await clearSabotage();
          showToast('Sabotage cleared by Developer', {
            variant: 'success',
            source: 'DEV_TOOLS',
          });
        }}
        onDevResetKillCooldown={() => {
          devResetKillCooldown();
          showToast('Kill Cooldown reset to 0s', {
            variant: 'info',
            source: 'DEV_TOOLS',
          });
        }}
        onDevBoostTaskProgress={async (delta = 15) => {
          await devBoostTaskProgress(delta);
        }}
        onDevCallMeeting={async () => {
          const devId = await ensureJoinedForDev();
          const res = await callMeeting(null, {
            roomCodeOverride: devId.roomCode,
            badgeIdOverride: devId.badgeId,
          });
          if (res.ok) {
            setScreenOverride(null);
          } else if (res.message) {
            showToast(res.message, { variant: 'error', source: 'DEV_TOOLS' });
          }
        }}
        onDevFinalizeMeeting={async () => {
          const res = await finalizeMeeting();
          if (!res.ok && res.message) {
            showToast(res.message, { variant: 'error', source: 'DEV_TOOLS' });
          }
        }}
        onDevReviveAll={async () => {
          await devReviveAllPlayers();
          showToast('All operatives revived', {
            variant: 'success',
            source: 'DEV_TOOLS',
          });
        }}
        onRefreshDevRoles={refreshDevRoles}
        onMarkInboxRead={handleMarkInboxRead}
        onClearInbox={handleClearInbox}
        onSelectPreset={(preset) => void handleSelectDevPreset(preset)}
        onTestStationMiniGame={(station) =>
          setActiveMiniGameStation(toTaskStation(station))
        }
        onClearEvents={clearInsightEvents}
        onLockDevMode={handleLockDevMode}
        onClose={() => setShowInsightsModal(false)}
      />
    ) : null;

  const toastNode =
    toasts.length > 0 ? (
      <div
        onMouseEnter={() => setToastsPaused(true)}
        onMouseLeave={() => setToastsPaused(false)}
        onTouchStart={() => setToastsPaused(true)}
        onTouchEnd={() => setToastsPaused(false)}
        className="fixed top-12 left-1/2 -translate-x-1/2 z-[70] w-[93%] max-w-md flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((t) => {
          const remainingRatio = Math.max(
            0,
            Math.min(1, (t.expiresAt - toastNow) / Math.max(1, t.durationMs))
          );
          const remainingSec = Math.max(
            1,
            Math.ceil((t.expiresAt - toastNow) / 1000)
          );

          return (
            <div
              key={t.id}
              role="alert"
              aria-live="assertive"
              className={`pointer-events-auto relative overflow-hidden rounded-2xl border backdrop-blur-md px-3.5 py-3 flex items-start gap-2.5 transition-all ${
                t.variant === 'error'
                  ? 'bg-rose-950/95 border-rose-400/75 text-rose-50 shadow-[0_10px_32px_rgba(244,63,94,0.45)]'
                  : t.variant === 'warning'
                  ? 'bg-amber-950/95 border-amber-400/75 text-amber-50 shadow-[0_10px_32px_rgba(245,158,11,0.4)]'
                  : t.variant === 'success'
                  ? 'bg-emerald-950/95 border-emerald-400/75 text-emerald-50 shadow-[0_10px_32px_rgba(16,185,129,0.4)]'
                  : 'bg-slate-900/95 border-cyan-400/65 text-cyan-50 shadow-[0_10px_32px_rgba(34,211,238,0.32)]'
              }`}
            >
              <span className="shrink-0 mt-0.5">
                {t.variant === 'error' ? (
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                ) : t.variant === 'warning' ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                ) : t.variant === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Info className="w-4 h-4 text-cyan-400" />
                )}
              </span>

              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-xs font-bold leading-snug tracking-wide">
                  {t.message}
                </p>
                <div className="text-[9px] font-mono opacity-65 tabular-nums">
                  {toastsPaused ? 'Paused while reading' : `${remainingSec}s`}
                </div>
              </div>

              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss notification"
                className="shrink-0 min-h-[34px] min-w-[34px] rounded-xl bg-white/10 active:bg-white/20 flex items-center justify-center text-white/85"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Smooth Visual Countdown Bar */}
              <div className="pointer-events-none absolute bottom-0 inset-x-0 h-0.5 bg-white/10">
                <div
                  className={`h-full transition-[width] duration-200 linear ${
                    t.variant === 'error'
                      ? 'bg-rose-400'
                      : t.variant === 'warning'
                      ? 'bg-amber-400'
                      : t.variant === 'success'
                      ? 'bg-emerald-400'
                      : 'bg-cyan-400'
                  }`}
                  style={{ width: `${Math.round(remainingRatio * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    ) : null;

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
          {toastNode}
        </div>
      );
    }

    return (
      <>
        <div className="print:hidden print-hide">
          <DevSwitcherBar
            isFloatingOnly
            isDebugMode={isDebugMode}
            activeScreen={activeScreen}
            roleOverride={roleOverride}
            statusOverride={statusOverride}
            hasActiveOverride={hasActiveOverride}
            onSelectPreset={(preset) => void handleSelectDevPreset(preset)}
            onClearOverrides={handleReturnToLiveMatch}
            onTriggerSabotage={() => void handleDevTriggerSabotage()}
            onSeedDemoPlayers={() => {
              void ensureJoinedForDev().then(() => {
                void seedDemoPlayers();
                showToast('Demo operatives added to roster', {
                  variant: 'info',
                  durationMs: 10_000,
                });
              });
            }}
            onOpenInsights={() => setShowInsightsModal(true)}
            onLockDevMode={handleLockDevMode}
          />
          {toastNode}
        </div>
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
        <div className="print:hidden print-hide">{insightsModalNode}</div>
      </>
    );
  }

  const showPhantomAtmosphere =
    activeScreen === 'gameplay' &&
    !uiWinner &&
    (effectiveStatus === 'eliminated' || effectiveStatus === 'ghost');

  return (
    <div className="tactical-bg h-dvh overflow-hidden text-white relative">
      {!backdropFailed && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <img
            src={campusBackdropImg}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setBackdropFailed(true)}
            className="w-full h-full object-cover object-center opacity-40 scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#050814]/88 via-[#050814]/78 to-[#050814]/94" />
        </div>
      )}
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
      {/* Non-Overlapping Scalable Flex Column Shell */}
      <main className="w-full max-w-xl md:max-w-2xl mx-auto h-dvh flex flex-col overflow-hidden relative z-10">
        {/* Reserved Top Strip with Supabase Realtime Heartbeat & Passcode-Gated Dev Controls */}
        <DevSwitcherBar
          isDebugMode={isDebugMode}
          activeScreen={activeScreen}
          roleOverride={roleOverride}
          statusOverride={statusOverride}
          hasActiveOverride={hasActiveOverride}
          roomCode={activeRoomCode}
          players={uiPlayers}
          povBadgeId={povBadgeId}
          unreadInboxCount={unreadInboxCount}
          wsConnected={isConnectionHealthy}
          connectionStatus={topBarConnectionStatus}
          reconnectAttempt={reconnectAttempt}
          wsLatencyMs={realtimeLatencyMs}
          onSelectPreset={(preset) => void handleSelectDevPreset(preset)}
          onSelectPov={handleSelectPov}
          onClearOverrides={handleReturnToLiveMatch}
          onTriggerSabotage={() => void handleDevTriggerSabotage('REACTOR')}
          onSeedDemoPlayers={() => {
            void ensureJoinedForDev().then(() => {
              void seedDemoPlayers();
              showToast('Demo operatives added to roster', {
                variant: 'info',
                source: 'DEV_TOOLS',
              });
            });
          }}
          onRequestUnlock={() => setShowPasscodeModal(true)}
          onOpenInsights={() => {
            setInsightsInitialTab('lobby');
            setShowInsightsModal(true);
          }}
          onOpenInbox={() => {
            setInsightsInitialTab('inbox');
            setShowInsightsModal(true);
          }}
          onLockDevMode={handleLockDevMode}
        />

        {toastNode}

        {activeScreen === 'join' && (
          <JoinScreen
            name={name}
            roomCode={roomCode}
            badgeNumber={badgeNumber}
            qrVerifiedInSession={qrVerifiedInSession}
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
            myPlayer={activePovPlayer ?? myPlayer}
            players={uiPlayers}
            hostBadgeId={room?.host_badge_id ?? null}
            impostorCount={activeRoomImpostorCount}
            isDebugMode={isDebugMode}
            onSetImpostorCount={(count) => {
              void setImpostorCount(count).then((res) => {
                if (!res.ok && res.reason) {
                  playErrorFeedback();
                  showToast(res.reason, {
                    variant: 'error',
                    source: 'HOST_GUARD',
                  });
                }
              });
            }}
            onStartMatch={() => void handleStartMatch()}
            onSeedDemoPlayers={() => void seedDemoPlayers()}
            onLeaveLobby={handleExitMatchOrLobby}
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
            sabotageStationIds={activeSabotageStationIds}
            isCommsSabotaged={isCommsSabotaged}
            commsLabel={sabotageTargets.commsLabel}
            assignedStationIds={assignedStationIds}
            killCooldownEnd={killCooldownEnd}
            isMeetingLocked={room?.status === 'MEETING'}
            impostorOpsLog={effectiveRole === 'impostor' ? impostorOpsLog : []}
            observingPlayer={observingPlayerBanner}
            onExitPov={() => handleSelectPov(null)}
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
              if (room?.status === 'MEETING') {
                playErrorFeedback();
                showToast(
                  'Eliminations are locked during an Emergency Meeting or Body Report!',
                  { variant: 'error', source: 'KILL_LOCK' }
                );
                return;
              }
              playUiClick();
              setTargetStationId(null);
              setScannerMode('eliminate');
            }}
            onBlockedKillAttempt={(cooldownSecs) => {
              playErrorFeedback();
              showToast(
                `Kill Cooldown Active — Wait ${cooldownSecs}s before eliminating another player.`,
                { variant: 'warning', source: 'KILL_COOLDOWN' }
              );
            }}
            onTriggerSabotage={async (type = 'REACTOR') => {
              const activeId =
                identity || (isDebugMode ? await ensureJoinedForDev() : null);
              const res = await triggerSabotage(type, {
                force: isDebugMode,
                roomCodeOverride: activeId?.roomCode,
              });
              if (res.ok) {
                showToast(
                  res.message ||
                    (type === 'REACTOR'
                      ? 'Reactor Meltdown triggered (2:00 countdown to defuse)!'
                      : 'Comms Jammed — Crewmate task locations scrambled!'),
                  { variant: 'warning', source: 'SABOTAGE' }
                );
              } else {
                playErrorFeedback();
                showToast(res.message || 'Unable to trigger sabotage right now.', {
                  variant: 'error',
                  source: 'SABOTAGE',
                });
              }
            }}
            onDefuseSabotage={() => {
              playTaskSuccessFeedback();
              void clearSabotage();
              showToast('Sabotage Defused!', {
                variant: 'success',
                source: 'SABOTAGE',
              });
            }}
            onCallMeeting={async () => {
              const activeId =
                identity || (isDebugMode ? await ensureJoinedForDev() : null);
              if (activeId) {
                setScreenOverride(null);
              }
              const res = await callMeeting(
                null,
                activeId
                  ? {
                      roomCodeOverride: activeId.roomCode,
                      badgeIdOverride: activeId.badgeId,
                    }
                  : undefined
              );
              if (res.ok) {
                setScreenOverride(null);
                showToast(
                  res.message ||
                    'Emergency Meeting Called — Gather at Main Lobby!',
                  { variant: 'warning', durationMs: 12_000 }
                );
              } else {
                playErrorFeedback();
                showToast(res.message || 'Unable to call meeting right now.', {
                  variant: 'error',
                  durationMs: 15_000,
                });
              }
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
            onExitMatch={handleExitMatchOrLobby}
          />
        )}

        {activeScreen === 'meeting' && (
          <MeetingScreen
            meeting={uiMeeting}
            players={uiPlayers}
            myPlayer={activePovPlayer ?? myPlayer}
            isDead={effectiveStatus !== 'alive'}
            observingPlayer={observingPlayerBanner}
            onExitPov={() => handleSelectPov(null)}
            onCastVote={(targetPlayerId) => {
              void castVote(
                targetPlayerId === 'skip' ? 'SKIP' : targetPlayerId
              );
            }}
            onExtendTime={async () => {
              const res = await extendMeetingTime(60_000);
              if (res.ok) {
                showToast(
                  res.message || 'Added +60s to the meeting timer.',
                  { variant: 'info', durationMs: 10_000 }
                );
              } else {
                playErrorFeedback();
                showToast(res.message || 'Unable to extend meeting timer.', {
                  variant: 'error',
                  durationMs: 15_000,
                });
              }
            }}
            onBeginDiscussion={async () => {
              const res = await beginDiscussionPhase();
              if (res.ok) {
                showToast(
                  res.message ||
                    'Everyone assembled — Discussion & Voting unlocked!',
                  { variant: 'success', durationMs: 10_000 }
                );
              } else {
                playErrorFeedback();
                showToast(res.message || 'Unable to unlock discussion.', {
                  variant: 'error',
                  durationMs: 15_000,
                });
              }
            }}
            onFinalizeNow={async () => {
              const res = await finalizeMeeting();
              if (!res.ok) {
                playErrorFeedback();
                showToast(res.message || 'Unable to tally votes right now.', {
                  variant: 'error',
                  durationMs: 15_000,
                });
              }
            }}
            onDismissEjection={() => {
              playUiClick();
              setScreenOverride(null);
              void dismissEjection();
            }}
            onExitMatch={handleExitMatchOrLobby}
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
          activeRoomCode={activeRoomCode}
          expectedMatchToken={activeMatchToken}
          assignedStationIds={assignedStationIds}
          completedStationIds={
            effectiveRole === 'impostor'
              ? fakeCompletedIds
              : (activePovRoleRow || privateRole)?.completed_stations || []
          }
          targetStationId={targetStationId}
          isFakeScanMode={effectiveRole === 'impostor'}
          activeSabotageStationId={activeSabotageStationId}
          activeSabotageStationIds={activeSabotageStationIds}
          onScanMeta={({ roomCode: scannedRoom, matchToken: scannedToken }) => {
            if (scannerMode === 'wristband' && scannedRoom) {
              const normalized = normalizeRoomCode(scannedRoom);
              setRoomCode(normalized);
              if (scannedToken) {
                setMatchQrToken(normalized, scannedToken);
              }
            }
          }}
          onScanBadge={(badge) => void handleScanBadgeResult(badge)}
          onScanStation={(stationId) => void handleScanStationResult(stationId)}
          onScanError={(msg) => appendDevInbox('error', 'QR_SCANNER', msg)}
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
      {insightsModalNode}
    </div>
  );
}
