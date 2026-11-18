import { useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Copy,
  Database,
  Dice5,
  KeyRound,
  Lock,
  MapPin,
  Play,
  Plus,
  Printer,
  Radio,
  RotateCcw,
  Skull,
  Trash2,
  UserPlus,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import {
  WRISTBANDS,
  type CampusMiniGameType,
  type CampusTaskCategory,
  type CampusTaskStationConfig,
} from '../config/campusConfig';
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
  votes: Record<string, string>;
  events: DeveloperInsightEvent[];
  recentLobbies: string[];
  activeRoomCodeDraft: string;
  onCreateLobby: (roomCode: string, impostorCount: 1 | 2) => Promise<void>;
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
  onSeedDemoPlayers: (roomCode?: string) => Promise<void>;
  onSetImpostorCount: (count: 1 | 2) => Promise<void>;
  onStartMatch: (roomCode: string, impostorCount: 1 | 2) => Promise<void>;
  onResetMatch: () => Promise<void>;
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
  votes,
  events,
  recentLobbies,
  activeRoomCodeDraft,
  onCreateLobby,
  onSwitchLobby,
  onAddCandidate,
  onRemoveCandidate,
  onToggleCandidateAlive,
  onSeedDemoPlayers,
  onSetImpostorCount,
  onStartMatch,
  onResetMatch,
  onSelectPreset,
  onTestStationMiniGame,
  onClearEvents,
  onLockDevMode,
  onClose,
}: DeveloperInsightsModalProps) {
  const stations = useCampusStations();

  // Mobile/compact tab selector (ignored on lg: where all 3 panels render side-by-side)
  const [mobileTab, setMobileTab] = useState<'lobby' | 'rooms' | 'telemetry'>(
    'lobby'
  );
  const [copied, setCopied] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [studioNotice, setStudioNotice] = useState<string | null>(null);

  // Create Lobby form state
  const [newLobbyCode, setNewLobbyCode] = useState(() =>
    generateRandomRoomCode()
  );
  const [newLobbyImpostors, setNewLobbyImpostors] = useState<1 | 2>(1);
  const [newLobbyPrintPasscode, setNewLobbyPrintPasscode] = useState(() =>
    generateRandomPrintPasscode()
  );

  // Add Candidate form state
  const occupiedBadges = useMemo(
    () => new Set(publicPlayers.map((p) => p.badge_id)),
    [publicPlayers]
  );
  const firstFreeBadge = useMemo(
    () => WRISTBANDS.find((w) => !occupiedBadges.has(w.id))?.id || 'P01',
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
  const activeImpostorCount: 1 | 2 = room?.impostor_count === 2 ? 2 : 1;

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
      await onCreateLobby(code, newLobbyImpostors);
      const savedPasscode = setLobbyPrintPasscode(code, newLobbyPrintPasscode);
      setPrintPasscodeDraft(savedPasscode || '');
      playTaskSuccessFeedback();
      flashNotice(
        savedPasscode
          ? `Lobby ${code} created · QR Kit passcode set`
          : `Lobby ${code} created & active`
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
        WRISTBANDS.find(
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
    { id: 'meeting', label: 'Meeting' },
    { id: 'print', label: 'Print Kit' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-[#050812]/92 backdrop-blur-xl flex items-center justify-center p-0 sm:p-4">
      <div className="w-full lg:w-[96vw] max-w-md lg:max-w-6xl h-dvh sm:h-[90dvh] glass-card sm:rounded-3xl p-4 lg:p-5 flex flex-col gap-3.5 border-cyan-400/25 overflow-hidden">
        {/* Top Laptop Header */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shrink-0">
              <Wrench className="w-5 h-5 text-cyan-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-base lg:text-lg font-extrabold tracking-wider uppercase text-white">
                  DEVELOPER STUDIO &amp; INSIGHTS
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/35 text-[10px] font-mono font-bold text-emerald-300">
                  PASSCODE VERIFIED
                </span>
                <span className="hidden sm:inline-flex px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-400/35 text-[10px] font-mono font-bold text-cyan-200">
                  LOBBY: {activeLobbyCode}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400 truncate">
                Laptop Command Deck · Create Lobbies, Candidates, Campus Rooms &amp; Task Mini-Games
              </p>
            </div>
          </div>

          {/* Quick Actions & Screen Switcher */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="hidden xl:flex items-center gap-1 bg-slate-950/80 border border-white/10 rounded-xl p-1 mr-1">
              {quickNavItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    playUiClick();
                    onSelectPreset(item.id);
                    if (item.id === 'print') {
                      onClose();
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-300 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1"
                >
                  {item.id === 'print' && <Printer className="w-3 h-3" />}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void handleCopySnapshot()}
              className="h-9 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/15 text-cyan-300 text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Copied JSON</span>
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
              className="h-9 px-3 rounded-xl bg-rose-950/75 hover:bg-rose-900/75 border border-rose-500/40 text-rose-200 text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all"
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
              aria-label="Close Developer Studio"
              className="h-9 w-9 flex items-center justify-center rounded-xl bg-white/10 text-slate-300 hover:text-white hover:bg-white/15 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
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
            <Activity className="w-3.5 h-3.5" />
            <span>Insights</span>
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

              <div className="flex items-center gap-2">
                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-900 border border-white/10 shrink-0">
                  {([1, 2] as const).map((cnt) => (
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
                      {cnt} Imp
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
                  {WRISTBANDS.map((wb) => {
                    const taken = occupiedBadges.has(wb.id);
                    return (
                      <option key={wb.id} value={wb.id}>
                        #{wb.number} · {wb.colorName.split(' ')[0]}
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
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-white">
                  Lobby Candidates ({publicPlayers.length}/16)
                </span>
                <div className="flex items-center gap-1">
                  {([1, 2] as const).map((cnt) => (
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
                  publicPlayers.map((p) => (
                    <div
                      key={p.badge_id}
                      className="flex items-center justify-between gap-2 rounded-xl bg-slate-900/80 border border-white/10 px-2.5 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: p.color }}
                        />
                        <span className="font-mono text-[11px] font-bold text-slate-300 shrink-0">
                          {p.badge_id}
                        </span>
                        <span className="text-xs font-bold text-white truncate">
                          {p.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
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
                  ))
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
                        flashNotice(`Match launched in ${activeLobbyCode}`);
                      }
                    );
                  }}
                  className="h-9 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-xs font-extrabold uppercase flex items-center justify-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Launch Match</span>
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

          {/* COLUMN 3: REALTIME INSIGHTS, ROLE STATE & EVENT LOG */}
          <section
            className={`lg:col-span-3 flex flex-col gap-3 min-h-0 overflow-y-auto pr-1 ${
              mobileTab === 'telemetry' ? 'flex' : 'hidden lg:flex'
            }`}
          >
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
            <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3 flex-1 min-h-[160px] flex flex-col gap-2">
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

              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
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
          </section>
        </div>
      </div>
    </div>
  );
}
