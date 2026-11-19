import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  CheckCheck,
  Copy,
  Crown,
  Database,
  Dice5,
  Eye,
  Gavel,
  HeartPulse,
  Inbox,
  KeyRound,
  Lock,
  MapPin,
  Megaphone,
  Play,
  Plus,
  Printer,
  Radio,
  RefreshCw,
  RotateCcw,
  Skull,
  Trash2,
  UserPlus,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  ID_CARDS,
  type CampusMiniGameType,
  type CampusTaskCategory,
  type CampusTaskStationConfig,
} from '../config/campusConfig';
import { rotateMatchQrToken, useMatchQrToken } from '../config/matchQrStore';
import {
  MINI_GAME_LABELS,
  addStation,
  deleteStation,
  resetStationsToDefault,
  updateStation,
  useCampusStations,
} from '../config/stationStore';
import {
  setLobbyPrintPasscode,
  useAllPrintPasscodes,
  useLobbyPrintPasscode,
} from '../config/printPasscodeStore';
import {
  SUPABASE_SCHEMA_SQL,
  supabaseConfigStatus,
  supabaseResolvedHost,
  type PrivateRoleRow,
  type PublicPlayerRow,
  type RoomRow,
} from '../config/supabase';
import {
  normalizeRoomCode,
  type CampusLocalIdentity,
  type RealtimeConnectionStatus,
} from '../hooks/useCampusGame';
import { playTaskSuccessFeedback, playUiClick } from '../utils/feedback';
import type { DevPresetId } from './DevSwitcherBar';

export interface DeveloperInsightEvent {
  id: string;
  ts: number;
  type: string;
  detail: string;
}

export interface DevInboxMessage {
  id: string;
  ts: number;
  level: 'error' | 'warning' | 'info' | 'success';
  source: string;
  message: string;
  roomCode: string;
  read: boolean;
}

interface DeveloperInsightsModalProps {
  isSupabaseConfigured: boolean;
  connectionStatus: RealtimeConnectionStatus;
  reconnectAttempt: number;
  latencyMs: number | null;
  syncError: string | null;
  identity: CampusLocalIdentity | null;
  room: RoomRow | null;
  publicPlayers: PublicPlayerRow[];
  privateRole: PrivateRoleRow | null;
  devAllRoles?: Record<string, PrivateRoleRow>;
  votes: Record<string, string>;
  events: DeveloperInsightEvent[];
  inboxMessages?: DevInboxMessage[];
  initialTab?: 'lobby' | 'rooms' | 'analytics' | 'inbox';
  recentLobbies: string[];
  activeRoomCodeDraft: string;
  hasActiveOverride?: boolean;
  povBadgeId?: string | null;
  onSelectPov?: (badgeId: string | null) => void;
  onReturnToLiveGame?: () => void;
  onCreateLobby: (
    roomCode: string,
    impostorCount: 1 | 2 | 3,
    designatedHostBadgeId: string | null
  ) => Promise<void>;
  onSwitchLobby: (roomCode: string) => Promise<void>;
  onAddCandidate: (
    roomCode: string,
    badgeId: string,
    name: string
  ) => Promise<void>;
  onRemoveCandidate: (roomCode: string, badgeId: string) => Promise<void>;
  onToggleCandidateAlive: (
    roomCode: string,
    badgeId: string,
    isAlive: boolean
  ) => Promise<void>;
  onAssignHost: (roomCode: string, badgeId: string | null) => Promise<void>;
  onSeedDemoPlayers: (roomCode?: string) => Promise<void>;
  onSetImpostorCount: (count: 1 | 2 | 3) => Promise<void>;
  onStartMatch: (roomCode: string, impostorCount: 1 | 2 | 3) => Promise<void>;
  onResetMatch: () => Promise<void>;
  onDevTriggerSabotage?: (type: 'REACTOR' | 'COMMS') => Promise<void>;
  onDevClearSabotage?: () => Promise<void>;
  onDevResetKillCooldown?: () => void;
  onDevBoostTaskProgress?: (delta?: number) => Promise<void>;
  onDevCallMeeting?: () => Promise<void>;
  onDevFinalizeMeeting?: () => Promise<void>;
  onDevReviveAll?: () => Promise<void>;
  onRefreshDevRoles?: (roomCode?: string) => Promise<void>;
  onMarkInboxRead?: () => void;
  onClearInbox?: () => void;
  onSelectPreset: (preset: DevPresetId) => void;
  onTestStationMiniGame: (station: CampusTaskStationConfig) => void;
  onClearEvents: () => void;
  onLockDevMode: () => void;
  onClose: () => void;
}

const MINI_GAME_TYPES: CampusMiniGameType[] = [
  'WIRING',
  'MANIFOLD',
  'SWIPE',
  'SHIELDS',
  'SIMON_SAYS',
  'FREQUENCY_TUNE',
  'ASTEROID_DEFENSE',
  'BIOMETRIC_HOLD',
  'DATA_TRANSFER',
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function generateRandomRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function generateRandomPrintPasscode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function DeveloperInsightsModal({
  isSupabaseConfigured,
  connectionStatus,
  reconnectAttempt,
  latencyMs,
  syncError,
  identity,
  room,
  publicPlayers,
  privateRole,
  devAllRoles = {},
  votes,
  events,
  inboxMessages = [],
  initialTab = 'lobby',
  recentLobbies,
  activeRoomCodeDraft,
  hasActiveOverride = false,
  povBadgeId = null,
  onSelectPov,
  onReturnToLiveGame,
  onCreateLobby,
  onSwitchLobby,
  onAddCandidate,
  onRemoveCandidate,
  onToggleCandidateAlive,
  onAssignHost,
  onSeedDemoPlayers,
  onSetImpostorCount,
  onStartMatch,
  onResetMatch,
  onDevTriggerSabotage,
  onDevClearSabotage,
  onDevResetKillCooldown,
  onDevBoostTaskProgress,
  onDevCallMeeting,
  onDevFinalizeMeeting,
  onDevReviveAll,
  onRefreshDevRoles,
  onMarkInboxRead,
  onClearInbox,
  onSelectPreset,
  onTestStationMiniGame,
  onClearEvents,
  onLockDevMode,
  onClose,
}: DeveloperInsightsModalProps) {
  const stations = useCampusStations();

  // Mobile/compact tab selector (ignored on lg: where all 3 columns render side-by-side)
  const [mobileTab, setMobileTab] = useState<'lobby' | 'rooms' | 'telemetry'>(
    initialTab === 'inbox' || initialTab === 'analytics'
      ? 'telemetry'
      : initialTab
  );
  const [rightPaneTab, setRightPaneTab] = useState<
    'analytics' | 'inbox' | 'telemetry'
  >(initialTab === 'inbox' ? 'inbox' : 'analytics');
  const [inboxFilter, setInboxFilter] = useState<
    'all' | 'error' | 'warning' | 'info'
  >('all');
  const [copied, setCopied] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedInbox, setCopiedInbox] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [studioNotice, setStudioNotice] = useState<string | null>(null);

  // Create Lobby form state
  const [newLobbyCode, setNewLobbyCode] = useState(() =>
    generateRandomRoomCode()
  );
  const [newLobbyImpostors, setNewLobbyImpostors] = useState<1 | 2 | 3>(1);
  const [newLobbyHostBadge, setNewLobbyHostBadge] = useState<string>('');
  const [newLobbyPrintPasscode, setNewLobbyPrintPasscode] = useState(() =>
    generateRandomPrintPasscode()
  );

  // Add Candidate form state
  const occupiedBadges = useMemo(
    () => new Set(publicPlayers.map((p) => p.badge_id)),
    [publicPlayers]
  );
  const firstFreeBadge = useMemo(
    () => ID_CARDS.find((w) => !occupiedBadges.has(w.id))?.id || 'P01',
    [occupiedBadges]
  );
  const [candidateName, setCandidateName] = useState('');
  const [candidateBadge, setCandidateBadge] = useState<string>(firstFreeBadge);

  // Add Campus Room & Task form state
  const [newRoomName, setNewRoomName] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newMiniGame, setNewMiniGame] =
    useState<CampusMiniGameType>('WIRING');
  const [newTaskCategory, setNewTaskCategory] =
    useState<CampusTaskCategory>('SHORT_TASK');

  const activeLobbyCode = normalizeRoomCode(
    identity?.roomCode || room?.room_code || activeRoomCodeDraft || 'SVCE'
  );
  const matchQrToken = useMatchQrToken(activeLobbyCode);
  const activeImpostorCount: 1 | 2 | 3 =
    room?.impostor_count === 3 ? 3 : room?.impostor_count === 2 ? 2 : 1;

  // Refresh all operative roles for analytics & POV switching when modal opens
  useEffect(() => {
    void onRefreshDevRoles?.(activeLobbyCode);
  }, [activeLobbyCode, onRefreshDevRoles]);

  // Mark inbox read automatically when developer switches to Inbox tab
  useEffect(() => {
    if (rightPaneTab === 'inbox') {
      onMarkInboxRead?.();
    }
  }, [rightPaneTab, onMarkInboxRead]);

  const allPrintPasscodes = useAllPrintPasscodes();
  const activePrintPasscode = useLobbyPrintPasscode(activeLobbyCode);
  const [printPasscodeDraft, setPrintPasscodeDraft] = useState(
    () => activePrintPasscode || ''
  );
  const [prevSyncedLobby, setPrevSyncedLobby] = useState(activeLobbyCode);
  if (prevSyncedLobby !== activeLobbyCode) {
    setPrevSyncedLobby(activeLobbyCode);
    setPrintPasscodeDraft(allPrintPasscodes[activeLobbyCode] || '');
  }

  const selectedBadgeValid = occupiedBadges.has(candidateBadge)
    ? firstFreeBadge
    : candidateBadge;

  // Live Match Analytics Calculations
  const analytics = useMemo(() => {
    const total = publicPlayers.length;
    const alive = publicPlayers.filter((p) => p.is_alive).length;
    const dead = total - alive;
    const rolesList = Object.values(devAllRoles);
    const impBadges = new Set(
      rolesList.filter((r) => r.role === 'IMPOSTOR').map((r) => r.badge_id)
    );
    const totalImpostors = impBadges.size || (room?.status === 'PLAYING' ? activeImpostorCount : 0);
    const livingImpostors = publicPlayers.filter(
      (p) => p.is_alive && impBadges.has(p.badge_id)
    ).length;
    const livingCrewmates = Math.max(0, alive - livingImpostors);
    const completedTaskCount = rolesList.reduce(
      (sum, r) => sum + (r.completed_stations?.length || 0),
      0
    );
    const assignedTaskCount = rolesList.reduce(
      (sum, r) => sum + (r.assigned_stations?.length || 0),
      0
    );
    const errorCount = inboxMessages.filter((m) => m.level === 'error').length;
    const unreadCount = inboxMessages.filter((m) => !m.read).length;

    return {
      total,
      alive,
      dead,
      totalImpostors,
      livingImpostors,
      livingCrewmates,
      completedTaskCount,
      assignedTaskCount,
      votesCast: Object.keys(votes).length,
      errorCount,
      unreadCount,
    };
  }, [publicPlayers, devAllRoles, room?.status, activeImpostorCount, votes, inboxMessages]);

  const filteredInbox = useMemo(() => {
    if (inboxFilter === 'all') return inboxMessages;
    return inboxMessages.filter((m) => m.level === inboxFilter);
  }, [inboxMessages, inboxFilter]);

  const flashNotice = (msg: string) => {
    setStudioNotice(msg);
    setTimeout(() => {
      setStudioNotice((cur) => (cur === msg ? null : cur));
    }, 2200);
  };

  const handleCopySnapshot = async () => {
    playUiClick();
    const snapshot = {
      capturedAt: new Date().toISOString(),
      supabaseConfigured: isSupabaseConfigured,
      connectionStatus,
      reconnectAttempt,
      latencyMs,
      syncError,
      activeLobbyCode,
      identity: identity
        ? {
            roomCode: identity.roomCode,
            badgeId: identity.badgeId,
            name: identity.name,
            secretPrefix: identity.wristbandSecret.slice(0, 6) + '***',
          }
        : null,
      room,
      publicPlayersCount: publicPlayers.length,
      publicPlayers,
      privateRole,
      votes,
      configuredStations: stations,
      recentEvents: events.slice(0, 20),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      playTaskSuccessFeedback();
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors on restricted browsers
    }
  };

  const handleCreateLobbySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = normalizeRoomCode(newLobbyCode);
    if (!code) return;
    playUiClick();
    setBusyAction('create-lobby');
    try {
      const designatedHost = newLobbyHostBadge || null;
      await onCreateLobby(code, newLobbyImpostors, designatedHost);
      const savedPasscode = setLobbyPrintPasscode(code, newLobbyPrintPasscode);
      setPrintPasscodeDraft(savedPasscode || '');
      playTaskSuccessFeedback();
      const hostSummary = designatedHost
        ? `Host: #${designatedHost.slice(1)}`
        : 'Host: Auto-assign';
      flashNotice(
        savedPasscode
          ? `Lobby ${code} created · ${hostSummary} · ${newLobbyImpostors} Imp · PIN set`
          : `Lobby ${code} created · ${hostSummary} · ${newLobbyImpostors} Imp`
      );
      setNewLobbyCode(generateRandomRoomCode());
      setNewLobbyPrintPasscode(generateRandomPrintPasscode());
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveActivePrintPasscode = (e: React.FormEvent) => {
    e.preventDefault();
    playUiClick();
    const saved = setLobbyPrintPasscode(activeLobbyCode, printPasscodeDraft);
    setPrintPasscodeDraft(saved || '');
    playTaskSuccessFeedback();
    flashNotice(
      saved
        ? `QR Kit passcode updated for ${activeLobbyCode}`
        : `Cleared QR Kit passcode for ${activeLobbyCode}`
    );
  };

  const handleAddCandidateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = candidateName.trim() || `Operative ${selectedBadgeValid.slice(1)}`;
    playUiClick();
    setBusyAction('add-candidate');
    try {
      await onAddCandidate(activeLobbyCode, selectedBadgeValid, cleanName);
      playTaskSuccessFeedback();
      setCandidateName('');
      const nextFree =
        ID_CARDS.find(
          (w) => w.id !== selectedBadgeValid && !occupiedBadges.has(w.id)
        )?.id || 'P01';
      setCandidateBadge(nextFree);
      flashNotice(`Added ${cleanName} (${selectedBadgeValid}) to ${activeLobbyCode}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleAddStationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim() || !newTaskTitle.trim()) return;
    playUiClick();
    addStation(
      newRoomName.trim(),
      newTaskTitle.trim(),
      newMiniGame,
      newTaskCategory
    );
    playTaskSuccessFeedback();
    flashNotice(`Room "${newRoomName.trim()}" added (${newMiniGame})`);
    setNewRoomName('');
    setNewTaskTitle('');
    setNewTaskCategory('SHORT_TASK');
  };

  const quickNavItems: { id: DevPresetId; label: string }[] = [
    { id: 'join', label: 'Join' },
    { id: 'lobby', label: 'Lobby' },
    { id: 'crewmate', label: 'Crew HUD' },
    { id: 'impostor', label: 'Impostor HUD' },
    { id: 'eliminated', label: 'Eliminated' },
    { id: 'ghost', label: 'Ghost' },
    { id: 'meeting', label: 'Meeting' },
    { id: 'print', label: 'Print Kit' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-[#050812]/92 backdrop-blur-xl flex items-center justify-center p-0 sm:p-4">
      <div className="w-full md:w-[96vw] max-w-2xl lg:max-w-6xl h-dvh sm:h-[92dvh] glass-card sm:rounded-3xl p-3.5 sm:p-4 lg:p-5 flex flex-col gap-3 border-cyan-400/25 overflow-hidden">
        {/* Top Command Deck Header */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-2.5 border-b border-white/10 pb-2.5">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shrink-0">
              <Wrench className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 className="font-display text-sm sm:text-base lg:text-lg font-extrabold tracking-wider uppercase text-white">
                  DEVELOPER STUDIO &amp; INSIGHTS
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/35 text-[9px] sm:text-[10px] font-mono font-bold text-emerald-300">
                  VERIFIED
                </span>
                <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-400/35 text-[9px] sm:text-[10px] font-mono font-bold text-cyan-200">
                  {activeLobbyCode}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400 truncate">
                Command Deck · Manage Lobbies, Passcodes, Rooms &amp; Live View
              </p>
            </div>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void handleCopySnapshot()}
              className="h-9 px-2.5 sm:px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-cyan-300 text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all whitespace-nowrap"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Copy JSON</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                playUiClick();
                onLockDevMode();
              }}
              className="h-9 px-2.5 sm:px-3 rounded-xl bg-rose-950/75 hover:bg-rose-900/75 border border-rose-500/40 text-rose-200 text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Lock Dev</span>
            </button>

            <button
              type="button"
              onClick={() => {
                playUiClick();
                onClose();
              }}
              className="h-9 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold uppercase tracking-wide flex items-center gap-1.5 active:scale-95 transition-all whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Back to Game</span>
            </button>

            <button
              type="button"
              onClick={() => {
                playUiClick();
                onClose();
              }}
              aria-label="Close Developer Studio"
              className="h-9 w-9 flex items-center justify-center rounded-xl bg-white/10 text-slate-300 hover:text-white hover:bg-white/15 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Universal 1-Tap Screen Switcher Strip (All Viewports, Auto-Closes into Selected View) */}
        <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {onReturnToLiveGame && (
            <button
              type="button"
              onClick={() => {
                playUiClick();
                onReturnToLiveGame();
                onClose();
              }}
              className={`shrink-0 h-8 px-2.5 rounded-lg text-[11px] font-extrabold uppercase tracking-wide flex items-center gap-1 border transition-all whitespace-nowrap ${
                hasActiveOverride
                  ? 'bg-emerald-500 text-slate-950 border-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                  : 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/25'
              }`}
            >
              <Radio className="w-3 h-3" />
              <span>Live Game</span>
            </button>
          )}
          <div className="flex items-center gap-1 bg-slate-950/80 border border-white/10 rounded-xl p-1 shrink-0">
            {quickNavItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  playUiClick();
                  onSelectPreset(item.id);
                  onClose();
                }}
                className="h-7 px-2.5 rounded-lg text-[11px] font-bold text-slate-300 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1 whitespace-nowrap"
              >
                {item.id === 'print' && <Printer className="w-3 h-3" />}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        {studioNotice && (
          <div className="shrink-0 rounded-xl bg-emerald-500/15 border border-emerald-400/40 px-3 py-1.5 text-xs font-mono font-bold text-emerald-300 flex items-center justify-between">
            <span>{studioNotice}</span>
          </div>
        )}

        {/* Mobile/Tablet Segment Tabs (Hidden on lg: laptop layout) */}
        <div className="shrink-0 lg:hidden grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-950/85 border border-white/10">
          <button
            type="button"
            onClick={() => {
              playUiClick();
              setMobileTab('lobby');
            }}
            className={`h-9 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 ${
              mobileTab === 'lobby'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-400'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Lobby ({publicPlayers.length})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              playUiClick();
              setMobileTab('rooms');
            }}
            className={`h-9 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 ${
              mobileTab === 'rooms'
                ? 'bg-cyan-400 text-slate-950'
                : 'text-slate-400'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Rooms ({stations.length})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              playUiClick();
              setMobileTab('telemetry');
            }}
            className={`h-9 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 ${
              mobileTab === 'telemetry'
                ? 'bg-amber-400 text-slate-950'
                : 'text-slate-400'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>
              Tools &amp; Inbox
              {analytics.unreadCount > 0 ? ` (${analytics.unreadCount})` : ''}
            </span>
          </button>
        </div>

        {/* 3-Column Laptop Command Center */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3.5 overflow-hidden">
          {/* COLUMN 1: LOBBY & CANDIDATES CREATOR */}
          <section
            className={`lg:col-span-4 flex flex-col gap-3 min-h-0 overflow-y-auto pr-1 ${
              mobileTab === 'lobby' ? 'flex' : 'hidden lg:flex'
            }`}
          >
            {/* Create New Lobby Card */}
            <form
              onSubmit={(e) => void handleCreateLobbySubmit(e)}
              className="rounded-2xl bg-slate-950/75 border border-white/10 p-3.5 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  Create New Lobby
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  Active: <strong className="text-white">{activeLobbyCode}</strong>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={12}
                  value={newLobbyCode}
                  onChange={(e) => setNewLobbyCode(e.target.value.toUpperCase())}
                  placeholder="ROOM CODE (E.G. SVCE26)"
                  className="flex-1 h-9 rounded-xl bg-slate-900 border border-white/15 px-3 text-xs font-mono font-bold uppercase text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                />
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    setNewLobbyCode(generateRandomRoomCode());
                  }}
                  title="Generate Random Room Code"
                  className="h-9 w-9 shrink-0 rounded-xl bg-slate-900 border border-white/15 text-slate-300 hover:text-white flex items-center justify-center"
                >
                  <Dice5 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    maxLength={24}
                    value={newLobbyPrintPasscode}
                    onChange={(e) => setNewLobbyPrintPasscode(e.target.value)}
                    placeholder="QR Kit Passcode (optional)"
                    className="w-full h-9 rounded-xl bg-slate-900 border border-white/15 pl-8 pr-2.5 text-xs font-mono font-bold text-amber-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    setNewLobbyPrintPasscode(generateRandomPrintPasscode());
                  }}
                  title="Generate 6-Digit QR Kit Passcode"
                  className="h-9 px-2.5 shrink-0 rounded-xl bg-slate-900 border border-white/15 text-[10px] font-mono font-bold text-amber-300 hover:text-amber-200"
                >
                  PIN
                </button>
              </div>

              {/* Designated Host Candidate Dropdown */}
              <div className="space-y-1">
                <label
                  htmlFor="dev-designated-host"
                  className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1"
                >
                  <Crown className="w-3 h-3" />
                  <span>Designated Host Candidate</span>
                </label>
                <select
                  id="dev-designated-host"
                  value={newLobbyHostBadge}
                  onChange={(e) => setNewLobbyHostBadge(e.target.value)}
                  className="w-full h-9 rounded-xl bg-slate-900 border border-amber-400/30 px-2.5 text-xs font-mono font-bold text-amber-100 focus:outline-none focus:border-amber-400"
                >
                  <option value="">Auto-assign First Joiner</option>
                  {ID_CARDS.map((card) => (
                    <option key={card.id} value={card.id}>
                      Badge #{card.number} — {card.colorName.split(' ')[0]} ({card.callsign})
                    </option>
                  ))}
                </select>
              </div>

              {/* Initial Impostor Count (1, 2, or 3) + Submit */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  <span>Initial Impostor Count</span>
                  <span className="text-rose-300 font-bold">
                    {newLobbyImpostors} Impostor{newLobbyImpostors > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-900 border border-white/10 shrink-0">
                    {([1, 2, 3] as const).map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => {
                          playUiClick();
                          setNewLobbyImpostors(cnt);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                          newLobbyImpostors === cnt
                            ? 'bg-rose-500 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {cnt}
                      </button>
                    ))}
                  </div>

                  <button
                    type="submit"
                    disabled={busyAction === 'create-lobby'}
                    className="flex-1 h-9 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold uppercase tracking-wide flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Lobby</span>
                  </button>
                </div>
              </div>

              {recentLobbies.length > 0 && (
                <div className="pt-1 border-t border-white/10 space-y-1">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    Switch Recent Lobby
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {recentLobbies.map((code) => {
                      const hasCode = Boolean(allPrintPasscodes[code]);
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => {
                            playUiClick();
                            void onSwitchLobby(code).then(() =>
                              flashNotice(`Switched to lobby ${code}`)
                            );
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border transition-colors inline-flex items-center gap-1 ${
                            code === activeLobbyCode
                              ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
                              : 'bg-slate-900 border-white/10 text-slate-400 hover:text-white'
                          }`}
                        >
                          <span>{code}</span>
                          {hasCode && (
                            <KeyRound className="w-2.5 h-2.5 text-amber-300" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </form>

            {/* Lobby Printable QR Kit Passcode Config */}
            <form
              onSubmit={handleSaveActivePrintPasscode}
              className="rounded-2xl bg-slate-950/75 border border-amber-400/25 p-3.5 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-amber-300 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" />
                  QR Kit Passcode · {activeLobbyCode}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold ${
                    activePrintPasscode
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35'
                      : 'bg-rose-500/15 text-rose-300 border border-rose-500/35'
                  }`}
                >
                  {activePrintPasscode ? 'SET' : 'UNSET'}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  maxLength={24}
                  value={printPasscodeDraft}
                  onChange={(e) => setPrintPasscodeDraft(e.target.value)}
                  placeholder="Set QR Kit Passcode..."
                  className="flex-1 h-9 rounded-xl bg-slate-900 border border-white/15 px-3 text-xs font-mono font-bold text-amber-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    setPrintPasscodeDraft(generateRandomPrintPasscode());
                  }}
                  title="Generate Random PIN"
                  className="h-9 w-9 shrink-0 rounded-xl bg-slate-900 border border-white/15 text-amber-300 hover:text-amber-200 flex items-center justify-center"
                >
                  <Dice5 className="w-4 h-4" />
                </button>
                <button
                  type="submit"
                  className="h-9 px-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold uppercase shrink-0"
                >
                  Save
                </button>
                {activePrintPasscode && (
                  <button
                    type="button"
                    onClick={() => {
                      playUiClick();
                      setLobbyPrintPasscode(activeLobbyCode, '');
                      setPrintPasscodeDraft('');
                      flashNotice(`Removed QR Kit passcode for ${activeLobbyCode}`);
                    }}
                    title="Clear Passcode"
                    className="h-9 w-9 shrink-0 rounded-xl bg-slate-900 hover:bg-rose-950 border border-white/15 text-slate-400 hover:text-rose-300 flex items-center justify-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-[10px] font-mono text-slate-400">
                Required to open Host Printable QR Kit for lobby {activeLobbyCode}.
              </p>
            </form>

            {/* Add Candidate Form */}
            <form
              onSubmit={(e) => void handleAddCandidateSubmit(e)}
              className="rounded-2xl bg-slate-950/75 border border-white/10 p-3.5 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-cyan-300 flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5" />
                  Create Candidate in {activeLobbyCode}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    void onSeedDemoPlayers(activeLobbyCode).then(() =>
                      flashNotice(`Added demo crew to ${activeLobbyCode}`)
                    );
                  }}
                  className="px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/25"
                >
                  + Demo Crew
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <input
                  type="text"
                  maxLength={28}
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                  placeholder="Candidate Name (e.g. Priya)"
                  className="sm:col-span-7 h-9 rounded-xl bg-slate-900 border border-white/15 px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                />
                <select
                  value={selectedBadgeValid}
                  onChange={(e) => setCandidateBadge(e.target.value)}
                  className="sm:col-span-5 h-9 rounded-xl bg-slate-900 border border-white/15 px-2 text-xs font-mono font-bold text-white focus:outline-none focus:border-cyan-400"
                >
                  {ID_CARDS.map((card) => {
                    const taken = occupiedBadges.has(card.id);
                    return (
                      <option key={card.id} value={card.id}>
                        #{card.number} · {card.callsign} ({card.colorName.split(' ')[0]})
                        {taken ? ' (Taken)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <button
                type="submit"
                disabled={busyAction === 'add-candidate'}
                className="w-full h-9 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold uppercase tracking-wide flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add Candidate to Lobby</span>
              </button>
            </form>

            {/* Candidates Roster & Match Controls */}
            <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3.5 space-y-2.5 flex-1 min-h-[220px] flex flex-col">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="space-y-0.5">
                  <span className="text-[11px] font-extrabold uppercase tracking-widest text-white block">
                    Live Player Roster ({publicPlayers.length}/16)
                  </span>
                  <span className="text-[10px] font-mono text-amber-300 flex items-center gap-1">
                    <Crown className="w-3 h-3 shrink-0" />
                    <span>
                      Host:{' '}
                      {room?.host_badge_id
                        ? `Badge #${room.host_badge_id.slice(1)}`
                        : 'Auto-assign First Joiner'}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {([1, 2, 3] as const).map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => {
                        playUiClick();
                        void onSetImpostorCount(cnt);
                      }}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border ${
                        activeImpostorCount === cnt
                          ? 'bg-rose-500/25 border-rose-400/50 text-rose-200'
                          : 'bg-slate-900 border-white/10 text-slate-400'
                      }`}
                    >
                      {cnt} Imp
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
                {publicPlayers.length === 0 ? (
                  <div className="rounded-xl bg-slate-900/70 border border-white/5 p-4 text-center text-xs font-mono text-slate-500">
                    No candidates in {activeLobbyCode} yet. Add one above or click + Demo Crew.
                  </div>
                ) : (
                  publicPlayers.map((p) => {
                    const playerRole = devAllRoles[p.badge_id]?.role;
                    const isObserving = povBadgeId === p.badge_id;
                    const isCurrentHost = room?.host_badge_id === p.badge_id;
                    return (
                      <div
                        key={p.badge_id}
                        className={`flex items-center justify-between gap-1.5 rounded-xl border px-2.5 py-2 ${
                          isCurrentHost
                            ? 'bg-amber-500/12 border-amber-400/55'
                            : isObserving
                            ? 'bg-cyan-500/15 border-cyan-400/55'
                            : 'bg-slate-900/80 border-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: p.color }}
                          />
                          <span className="font-mono text-[11px] font-bold text-slate-300 shrink-0">
                            {p.badge_id}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-xs font-bold text-white truncate leading-tight">
                                {p.name}
                              </span>
                              {isCurrentHost && (
                                <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/60 text-[9px] font-mono font-extrabold text-amber-200 leading-none">
                                  <span aria-hidden="true">👑</span>
                                  <span>HOST</span>
                                </span>
                              )}
                            </div>
                            {playerRole && (
                              <div
                                className={`text-[9px] font-mono font-extrabold ${
                                  playerRole === 'IMPOSTOR'
                                    ? 'text-rose-400'
                                    : 'text-cyan-300'
                                }`}
                              >
                                {playerRole}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {!isCurrentHost && (
                            <button
                              type="button"
                              onClick={() => {
                                playUiClick();
                                void onAssignHost(activeLobbyCode, p.badge_id).then(
                                  () => {
                                    playTaskSuccessFeedback();
                                    flashNotice(
                                      `Transferred Host to ${p.name} (${p.badge_id})`
                                    );
                                  }
                                );
                              }}
                              title={`Transfer Host privileges to ${p.name}`}
                              className="px-2 py-1 rounded-lg text-[10px] font-mono font-bold border bg-amber-500/15 border-amber-400/45 text-amber-200 hover:bg-amber-500/30 flex items-center gap-1 transition-colors whitespace-nowrap"
                            >
                              <Crown className="w-3 h-3" />
                              <span>Make Host</span>
                            </button>
                          )}

                          {onSelectPov && (
                            <button
                              type="button"
                              onClick={() => {
                                playUiClick();
                                onSelectPov(isObserving ? null : p.badge_id);
                                onClose();
                              }}
                              title={`Observe ${p.name}'s live POV`}
                              className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border flex items-center gap-1 ${
                                isObserving
                                  ? 'bg-amber-400 text-slate-950 border-amber-300'
                                  : 'bg-cyan-500/15 border-cyan-400/35 text-cyan-200 hover:bg-cyan-500/25'
                              }`}
                            >
                              <Eye className="w-3 h-3" />
                              <span>POV</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              playUiClick();
                              void onToggleCandidateAlive(
                                activeLobbyCode,
                                p.badge_id,
                                !p.is_alive
                              );
                            }}
                            title="Toggle Alive / Eliminated"
                            className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border flex items-center gap-1 ${
                              p.is_alive
                                ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                                : 'bg-violet-500/20 border-violet-400/40 text-violet-300'
                            }`}
                          >
                            {!p.is_alive && <Skull className="w-3 h-3" />}
                            <span>{p.is_alive ? 'ALIVE' : 'DEAD'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              playUiClick();
                              void onRemoveCandidate(activeLobbyCode, p.badge_id);
                            }}
                            title={`Remove ${p.name}`}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10 shrink-0">
                <button
                  type="button"
                  disabled={publicPlayers.length === 0}
                  onClick={() => {
                    playUiClick();
                    void onStartMatch(activeLobbyCode, activeImpostorCount).then(
                      () => {
                        playTaskSuccessFeedback();
                        flashNotice(`Force-started match in ${activeLobbyCode}`);
                      }
                    );
                  }}
                  className="h-9 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-xs font-extrabold uppercase flex items-center justify-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Force Start Match</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    void onResetMatch().then(() =>
                      flashNotice(`Reset ${activeLobbyCode} to LOBBY`)
                    );
                  }}
                  className="h-9 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-slate-200 text-xs font-bold uppercase flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Lobby</span>
                </button>
              </div>
            </div>
          </section>

          {/* COLUMN 2: CAMPUS ROOMS & TASK TYPES EDITOR */}
          <section
            className={`lg:col-span-5 flex flex-col gap-3 min-h-0 overflow-y-auto pr-1 ${
              mobileTab === 'rooms' ? 'flex' : 'hidden lg:flex'
            }`}
          >
            {/* Add New Room + Task Form */}
            <form
              onSubmit={handleAddStationSubmit}
              className="rounded-2xl bg-slate-950/75 border border-white/10 p-3.5 space-y-2.5 shrink-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-cyan-300 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  Add Campus Room &amp; Task
                </span>
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    resetStationsToDefault();
                    flashNotice('Restored default 10 campus rooms');
                  }}
                  className="px-2 py-1 rounded-lg bg-slate-900 border border-white/10 text-[10px] font-bold text-slate-300 hover:text-amber-300 flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Defaults</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="Room Name (e.g. 3rd Floor • Robotics Lab)"
                  className="h-9 rounded-xl bg-slate-900 border border-white/15 px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                />
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Task Title (e.g. Align Laser Bus)"
                  className="h-9 rounded-xl bg-slate-900 border border-white/15 px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={newMiniGame}
                  onChange={(e) =>
                    setNewMiniGame(e.target.value as CampusMiniGameType)
                  }
                  className="flex-1 min-w-[160px] h-9 rounded-xl bg-slate-900 border border-white/15 px-3 text-xs font-bold text-cyan-200 focus:outline-none focus:border-cyan-400"
                >
                  {MINI_GAME_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t} — {MINI_GAME_LABELS[t]}
                    </option>
                  ))}
                </select>

                <select
                  value={newTaskCategory}
                  onChange={(e) =>
                    setNewTaskCategory(e.target.value as CampusTaskCategory)
                  }
                  aria-label="New station task category"
                  className="h-9 rounded-xl bg-slate-900 border border-white/15 px-2.5 text-xs font-mono font-bold text-amber-200 focus:outline-none focus:border-cyan-400"
                >
                  <option value="SHORT_TASK">SHORT TASK</option>
                  <option value="LONG_TASK">LONG RELAY</option>
                </select>

                <button
                  type="submit"
                  disabled={!newRoomName.trim() || !newTaskTitle.trim()}
                  className="h-9 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 text-xs font-extrabold uppercase flex items-center gap-1.5 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Room</span>
                </button>
              </div>
            </form>

            {/* Editable Rooms & Tasks List */}
            <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3.5 space-y-2.5 flex-1 min-h-[260px] flex flex-col">
              <div className="flex items-center justify-between gap-2 shrink-0">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-white">
                  Editable Rooms &amp; Task Assignments ({stations.length})
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  Syncs to Gameplay, Scanner &amp; Print QR Kit
                </span>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5">
                {stations.map((station) => (
                  <div
                    key={station.id}
                    className="rounded-xl bg-slate-900/85 border border-white/10 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-400/30 font-mono text-[10px] font-bold text-cyan-200 truncate">
                        {station.qrPayload}
                      </span>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            playUiClick();
                            onTestStationMiniGame(station);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/25 flex items-center gap-1"
                        >
                          <Play className="w-3 h-3" />
                          <span>Test Task</span>
                        </button>

                        <button
                          type="button"
                          disabled={stations.length <= 1}
                          onClick={() => {
                            playUiClick();
                            deleteStation(station.id);
                            flashNotice(`Deleted room ${station.id}`);
                          }}
                          title="Delete Room"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 disabled:opacity-30 text-slate-400 hover:text-rose-300 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[9px] font-mono uppercase tracking-wider text-slate-400 mb-0.5">
                          Room Location Name
                        </label>
                        <input
                          type="text"
                          value={station.roomName}
                          onChange={(e) =>
                            updateStation(station.id, {
                              roomName: e.target.value,
                            })
                          }
                          className="w-full h-8 rounded-lg bg-slate-950 border border-white/10 px-2.5 text-xs font-semibold text-white focus:outline-none focus:border-cyan-400"
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] font-mono uppercase tracking-wider text-slate-400 mb-0.5">
                          Task Objective Title
                        </label>
                        <input
                          type="text"
                          value={station.taskTitle}
                          onChange={(e) =>
                            updateStation(station.id, {
                              taskTitle: e.target.value,
                            })
                          }
                          className="w-full h-8 rounded-lg bg-slate-950 border border-white/10 px-2.5 text-xs font-semibold text-white focus:outline-none focus:border-cyan-400"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="sm:col-span-2">
                        <label className="block text-[9px] font-mono uppercase tracking-wider text-slate-400 mb-0.5">
                          Mini-Game Task Type
                        </label>
                        <select
                          value={station.miniGame}
                          onChange={(e) => {
                            playUiClick();
                            updateStation(station.id, {
                              miniGame: e.target.value as CampusMiniGameType,
                            });
                          }}
                          className="w-full h-8 rounded-lg bg-slate-950 border border-white/10 px-2.5 text-xs font-mono font-bold text-amber-300 focus:outline-none focus:border-cyan-400"
                        >
                          {MINI_GAME_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t} — {MINI_GAME_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[9px] font-mono uppercase tracking-wider text-slate-400 mb-0.5">
                          Category
                        </label>
                        <select
                          value={station.taskCategory || 'SHORT_TASK'}
                          onChange={(e) => {
                            playUiClick();
                            updateStation(station.id, {
                              taskCategory: e.target.value as CampusTaskCategory,
                            });
                          }}
                          className="w-full h-8 rounded-lg bg-slate-950 border border-white/10 px-2 text-xs font-mono font-bold text-cyan-200 focus:outline-none focus:border-cyan-400"
                        >
                          <option value="SHORT_TASK">SHORT</option>
                          <option value="LONG_TASK">LONG</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* COLUMN 3: LIVE ANALYTICS, DEBUG TOOLS, ROOM ERROR INBOX & TELEMETRY */}
          <section
            className={`lg:col-span-3 flex flex-col gap-2.5 min-h-0 overflow-hidden ${
              mobileTab === 'telemetry' ? 'flex' : 'hidden lg:flex'
            }`}
          >
            {/* Sub-tab Switcher for Column 3 */}
            <div className="shrink-0 grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-950/90 border border-white/10">
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setRightPaneTab('analytics');
                }}
                className={`h-8 rounded-lg text-[10px] font-extrabold uppercase flex items-center justify-center gap-1 transition-colors ${
                  rightPaneTab === 'analytics'
                    ? 'bg-cyan-400 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <BarChart3 className="w-3 h-3" />
                <span>Tools</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setRightPaneTab('inbox');
                }}
                className={`h-8 rounded-lg text-[10px] font-extrabold uppercase flex items-center justify-center gap-1 transition-colors ${
                  rightPaneTab === 'inbox'
                    ? 'bg-rose-500 text-white'
                    : analytics.errorCount > 0
                    ? 'text-rose-300 hover:text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Inbox className="w-3 h-3" />
                <span>
                  Inbox
                  {inboxMessages.length > 0 ? ` (${inboxMessages.length})` : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setRightPaneTab('telemetry');
                }}
                className={`h-8 rounded-lg text-[10px] font-extrabold uppercase flex items-center justify-center gap-1 transition-colors ${
                  rightPaneTab === 'telemetry'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Activity className="w-3 h-3" />
                <span>Logs</span>
              </button>
            </div>

            {/* SUB-TAB A: LIVE ANALYTICS & DEBUG SUITE */}
            {rightPaneTab === 'analytics' && (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-0.5">
                {/* Match Analytics KPIs */}
                <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-cyan-300 flex items-center gap-1.5">
                      <BarChart3 className="w-3.5 h-3.5" />
                      Match Analytics
                    </span>
                    <span className="text-[9px] font-mono font-bold text-slate-400">
                      {room?.status || 'LOBBY'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="rounded-xl bg-slate-900/90 border border-white/10 p-2">
                      <div className="text-[9px] font-mono text-slate-400">ALIVE / DEAD</div>
                      <div className="font-mono text-xs font-extrabold text-emerald-400 tabular-nums">
                        {analytics.alive} <span className="text-slate-500">/</span>{' '}
                        <span className="text-violet-300">{analytics.dead}</span>
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-900/90 border border-white/10 p-2">
                      <div className="text-[9px] font-mono text-slate-400">CREW / IMP</div>
                      <div className="font-mono text-xs font-extrabold text-cyan-300 tabular-nums">
                        {analytics.livingCrewmates}{' '}
                        <span className="text-slate-500">/</span>{' '}
                        <span className="text-rose-400">
                          {analytics.livingImpostors}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-900/90 border border-white/10 p-2">
                      <div className="text-[9px] font-mono text-slate-400">TASK PROGRESS</div>
                      <div className="font-mono text-xs font-extrabold text-emerald-300 tabular-nums">
                        {room?.task_progress ?? 0}%
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-900/90 border border-white/10 p-2">
                      <div className="text-[9px] font-mono text-slate-400">ERRORS / VOTES</div>
                      <div className="font-mono text-xs font-extrabold tabular-nums">
                        <span className={analytics.errorCount > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                          {analytics.errorCount} err
                        </span>
                        <span className="text-slate-500"> · </span>
                        <span className="text-amber-300">{analytics.votesCast}v</span>
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] font-mono text-slate-400">
                      <span>STATIONS COMPLETED</span>
                      <span className="text-white font-bold tabular-nums">
                        {analytics.completedTaskCount}/{analytics.assignedTaskCount || 0}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-900 border border-white/10 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all"
                        style={{ width: `${Math.min(100, room?.task_progress ?? 0)}%` }}
                      />
                    </div>
                  </div>

                  {/* Unique Room QR Set Rotation */}
                  <div className="pt-1.5 border-t border-white/10 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[9px] font-mono text-slate-400">ROOM QR SET</div>
                      <div className="text-[11px] font-mono font-bold text-amber-300 truncate">
                        {activeLobbyCode}:{matchQrToken}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        playUiClick();
                        const nextTok = rotateMatchQrToken(activeLobbyCode);
                        playTaskSuccessFeedback();
                        flashNotice(`Rotated match QRs → ${activeLobbyCode}:${nextTok}`);
                      }}
                      className="h-8 px-2.5 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/45 text-amber-200 text-[10px] font-extrabold flex items-center gap-1 shrink-0"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Rotate QR</span>
                    </button>
                  </div>
                </div>

                {/* Live Debug & Game Control Tools */}
                <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 space-y-2">
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-amber-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Debug &amp; Override Tools
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    {onDevTriggerSabotage && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            playUiClick();
                            void onDevTriggerSabotage('REACTOR').then(() =>
                              flashNotice('Reactor Meltdown (2:00) triggered')
                            );
                          }}
                          className="h-9 px-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/45 text-[10px] font-bold text-rose-200 flex items-center justify-center gap-1"
                        >
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>Reactor 2:00</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            playUiClick();
                            void onDevTriggerSabotage('COMMS').then(() =>
                              flashNotice('Comms Sabotage triggered')
                            );
                          }}
                          className="h-9 px-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/45 text-[10px] font-bold text-amber-200 flex items-center justify-center gap-1"
                        >
                          <Radio className="w-3 h-3 shrink-0" />
                          <span>Jam Comms</span>
                        </button>
                      </>
                    )}

                    {onDevClearSabotage && (
                      <button
                        type="button"
                        onClick={() => {
                          playUiClick();
                          void onDevClearSabotage().then(() =>
                            flashNotice('Active sabotage cleared')
                          );
                        }}
                        className="h-9 px-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/35 text-[10px] font-bold text-emerald-200 flex items-center justify-center gap-1"
                      >
                        <Zap className="w-3 h-3 shrink-0" />
                        <span>Clear Sabotage</span>
                      </button>
                    )}

                    {onDevResetKillCooldown && (
                      <button
                        type="button"
                        onClick={() => {
                          playUiClick();
                          onDevResetKillCooldown();
                          flashNotice('Kill cooldown reset to 0s');
                        }}
                        className="h-9 px-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-[10px] font-bold text-cyan-200 flex items-center justify-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3 shrink-0" />
                        <span>Reset Kill CD</span>
                      </button>
                    )}

                    {onDevBoostTaskProgress && (
                      <button
                        type="button"
                        onClick={() => {
                          playUiClick();
                          void onDevBoostTaskProgress(15).then(() =>
                            flashNotice('Boosted Team Tasks by +15%')
                          );
                        }}
                        className="h-9 px-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 text-[10px] font-bold text-cyan-200 flex items-center justify-center gap-1"
                      >
                        <Plus className="w-3 h-3 shrink-0" />
                        <span>+15% Tasks</span>
                      </button>
                    )}

                    {onDevReviveAll && (
                      <button
                        type="button"
                        onClick={() => {
                          playUiClick();
                          void onDevReviveAll().then(() =>
                            flashNotice('Revived all operatives')
                          );
                        }}
                        className="h-9 px-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/35 text-[10px] font-bold text-emerald-200 flex items-center justify-center gap-1"
                      >
                        <HeartPulse className="w-3 h-3 shrink-0" />
                        <span>Revive All</span>
                      </button>
                    )}

                    {onDevCallMeeting && (
                      <button
                        type="button"
                        onClick={() => {
                          playUiClick();
                          void onDevCallMeeting().then(() => {
                            flashNotice('Emergency meeting triggered');
                            onClose();
                          });
                        }}
                        className="h-9 px-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/45 text-[10px] font-bold text-amber-200 flex items-center justify-center gap-1"
                      >
                        <Megaphone className="w-3 h-3 shrink-0" />
                        <span>Call Meeting</span>
                      </button>
                    )}

                    {onDevFinalizeMeeting && (
                      <button
                        type="button"
                        onClick={() => {
                          playUiClick();
                          void onDevFinalizeMeeting().then(() =>
                            flashNotice('Forced vote tally')
                          );
                        }}
                        className="h-9 px-2 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/45 text-[10px] font-bold text-violet-200 flex items-center justify-center gap-1"
                      >
                        <Gavel className="w-3 h-3 shrink-0" />
                        <span>Force Tally</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* SUB-TAB B: DEVELOPER-ONLY ROOM ERROR & MESSAGE INBOX */}
            {rightPaneTab === 'inbox' && (
              <div className="flex-1 min-h-0 flex flex-col gap-2 rounded-2xl bg-slate-950/75 border border-rose-500/25 p-3 overflow-hidden">
                <div className="shrink-0 flex items-center justify-between gap-1.5">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-rose-300 flex items-center gap-1.5">
                    <Inbox className="w-3.5 h-3.5" />
                    Room Error Inbox · {activeLobbyCode}
                  </span>
                  <div className="flex items-center gap-1">
                    {onMarkInboxRead && (
                      <button
                        type="button"
                        onClick={() => {
                          playUiClick();
                          onMarkInboxRead();
                        }}
                        title="Mark all read"
                        className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-emerald-300"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        playUiClick();
                        void navigator.clipboard
                          ?.writeText(JSON.stringify(inboxMessages, null, 2))
                          .then(() => {
                            setCopiedInbox(true);
                            flashNotice('Copied Developer Error Inbox JSON');
                            setTimeout(() => setCopiedInbox(false), 1800);
                          })
                          .catch(() => {});
                      }}
                      title="Copy inbox log"
                      className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300"
                    >
                      {copiedInbox ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {onClearInbox && inboxMessages.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          playUiClick();
                          onClearInbox();
                        }}
                        title="Clear inbox"
                        className="p-1 rounded-lg bg-slate-900 hover:bg-rose-950 text-slate-400 hover:text-rose-300"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Filter Bar */}
                <div className="shrink-0 grid grid-cols-4 gap-1">
                  {(['all', 'error', 'warning', 'info'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => {
                        playUiClick();
                        setInboxFilter(lvl);
                      }}
                      className={`h-7 rounded-lg text-[9px] font-mono font-extrabold uppercase transition-colors ${
                        inboxFilter === lvl
                          ? lvl === 'error'
                            ? 'bg-rose-500 text-white'
                            : lvl === 'warning'
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-cyan-400 text-slate-950'
                          : 'bg-slate-900 text-slate-400 hover:text-white'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
                  {filteredInbox.length === 0 ? (
                    <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4 text-center text-[11px] font-mono text-slate-500">
                      No messages in {activeLobbyCode} matching &ldquo;{inboxFilter}&rdquo;. All room errors, warnings, and alerts appear here for developers only.
                    </div>
                  ) : (
                    filteredInbox.map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-xl border px-2.5 py-2 space-y-0.5 ${
                          item.level === 'error'
                            ? 'bg-rose-950/60 border-rose-500/45'
                            : item.level === 'warning'
                            ? 'bg-amber-950/50 border-amber-500/40'
                            : item.level === 'success'
                            ? 'bg-emerald-950/45 border-emerald-500/35'
                            : 'bg-slate-900/80 border-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 text-[9px] font-mono">
                          <span
                            className={`font-extrabold uppercase truncate ${
                              item.level === 'error'
                                ? 'text-rose-300'
                                : item.level === 'warning'
                                ? 'text-amber-300'
                                : item.level === 'success'
                                ? 'text-emerald-300'
                                : 'text-cyan-300'
                            }`}
                          >
                            [{item.level}] {item.source}
                          </span>
                          <span className="text-slate-400 tabular-nums shrink-0">
                            {formatTime(item.ts)}
                          </span>
                        </div>
                        <p className="text-[11px] text-white leading-snug break-words">
                          {item.message}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* SUB-TAB C: TELEMETRY, OPERATIVE STATE & EVENT LOGS */}
            {rightPaneTab === 'telemetry' && (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-0.5">
                {/* Telemetry Grid */}
                <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 space-y-2 shrink-0">
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-amber-300 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5" />
                    Realtime Telemetry
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-slate-900/90 border border-white/10 p-2">
                      <div className="text-[9px] font-mono text-slate-400">MODE</div>
                      <div
                        className={`font-mono text-[11px] font-extrabold ${
                          isSupabaseConfigured
                            ? 'text-emerald-400'
                            : 'text-amber-300'
                        }`}
                      >
                        {isSupabaseConfigured ? 'SUPABASE' : 'LOCAL'}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-900/90 border border-white/10 p-2">
                      <div className="text-[9px] font-mono text-slate-400">
                        STATUS
                      </div>
                      <div
                        className={`font-mono text-[11px] font-extrabold uppercase ${
                          connectionStatus === 'connected'
                            ? 'text-emerald-400'
                            : connectionStatus === 'reconnecting'
                            ? 'text-amber-300'
                            : 'text-rose-400'
                        }`}
                      >
                        {connectionStatus}
                        {connectionStatus === 'reconnecting' && reconnectAttempt > 0
                          ? ` #${reconnectAttempt}`
                          : ''}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-900/90 border border-white/10 p-2">
                      <div className="text-[9px] font-mono text-slate-400">RTT</div>
                      <div className="font-mono text-xs font-extrabold text-cyan-300 tabular-nums">
                        {latencyMs !== null ? `${latencyMs} ms` : '—'}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-900/90 border border-white/10 p-2">
                      <div className="text-[9px] font-mono text-slate-400">
                        PHASE
                      </div>
                      <div className="font-mono text-[11px] font-extrabold text-white truncate">
                        {room?.status || 'LOBBY'}
                      </div>
                    </div>
                  </div>

                  {syncError && (
                    <div className="rounded-xl bg-rose-950/60 border border-rose-500/40 p-2 text-[10px] font-mono text-rose-200 break-words">
                      {syncError}
                    </div>
                  )}

                  <div className="pt-1 border-t border-white/10 space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-slate-400">ENV KEYS:</span>
                      <span
                        className={`font-bold uppercase ${
                          supabaseConfigStatus === 'configured'
                            ? 'text-emerald-300'
                            : 'text-amber-300'
                        }`}
                      >
                        {supabaseConfigStatus}
                      </span>
                    </div>
                    {supabaseResolvedHost && (
                      <div className="text-[9px] font-mono text-slate-400 truncate">
                        {supabaseResolvedHost}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        playUiClick();
                        void navigator.clipboard
                          ?.writeText(SUPABASE_SCHEMA_SQL)
                          .then(() => {
                            playTaskSuccessFeedback();
                            setCopiedSql(true);
                            flashNotice('Copied Supabase SQL Schema to clipboard');
                            setTimeout(() => setCopiedSql(false), 2000);
                          })
                          .catch(() => {
                            flashNotice('Clipboard blocked in browser');
                          });
                      }}
                      className="w-full h-8 rounded-lg bg-slate-900 hover:bg-slate-800 border border-cyan-400/30 text-cyan-200 text-[10px] font-mono font-bold flex items-center justify-center gap-1.5"
                    >
                      {copiedSql ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-300">Copied SQL Schema!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy Supabase SQL Setup</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Private Role & Vote Ledger */}
                <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 space-y-1.5 shrink-0">
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-cyan-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" />
                    Operative State
                  </div>
                  <div className="text-[11px] font-mono space-y-1">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Self:</span>
                      <span className="text-white font-bold truncate">
                        {identity ? `${identity.badgeId} · ${identity.name}` : 'None'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Role:</span>
                      <span
                        className={`font-bold ${
                          privateRole?.role === 'IMPOSTOR'
                            ? 'text-rose-400'
                            : 'text-cyan-300'
                        }`}
                      >
                        {privateRole?.role || 'NONE'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Task %:</span>
                      <span className="text-emerald-400 font-bold tabular-nums">
                        {room?.task_progress ?? 0}%
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Sabotage:</span>
                      <span className="text-rose-300 font-bold">
                        {room?.active_sabotage || 'NONE'}
                      </span>
                    </div>
                  </div>

                  {Object.keys(votes).length > 0 && (
                    <div className="pt-2 mt-1 border-t border-white/10 space-y-1 text-[10px] font-mono">
                      <div className="text-amber-300 font-bold uppercase">
                        Votes ({Object.keys(votes).length})
                      </div>
                      {Object.entries(votes).map(([voter, target]) => (
                        <div key={voter} className="flex justify-between text-slate-300">
                          <span>{voter}</span>
                          <span className="text-amber-300 font-bold">→ {target}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Rolling Event Stream */}
                <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between shrink-0">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-300">
                      Events ({events.length})
                    </span>
                    {events.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          playUiClick();
                          onClearEvents();
                        }}
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-rose-300"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Clear</span>
                      </button>
                    )}
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5">
                    {events.length === 0 ? (
                      <div className="rounded-xl bg-slate-900/60 border border-white/5 p-3 text-center text-[11px] font-mono text-slate-500">
                        No Realtime events yet.
                      </div>
                    ) : (
                      events.map((ev) => (
                        <div
                          key={ev.id}
                          className="rounded-xl bg-slate-900/80 border border-white/10 px-2.5 py-1.5 space-y-0.5"
                        >
                          <div className="flex items-center justify-between text-[9px] font-mono">
                            <span className="font-extrabold text-cyan-300 truncate">
                              {ev.type}
                            </span>
                            <span className="text-slate-500 tabular-nums shrink-0">
                              {formatTime(ev.ts)}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-300 break-words">
                            {ev.detail}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
