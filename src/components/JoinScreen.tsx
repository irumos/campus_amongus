import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Download,
  Ghost,
  Lock,
  Megaphone,
  Monitor,
  Printer,
  QrCode,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  supabaseResolvedHost,
  type SupabaseConfigStatus,
} from '../config/supabase';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { getBadgeInfo } from '../shared/gameData';
import {
  isAmbienceMuted,
  isAmbiencePlaying,
  playUiClick,
  subscribeAmbienceState,
  toggleAmbienceMuted,
} from '../utils/feedback';
const APP_LOGO_SRC = '/assets/aistudio/image_612f43df.png';

interface JoinScreenProps {
  name: string;
  roomCode: string;
  badgeNumber: string | null;
  qrVerifiedInSession: boolean;
  wsConnected: boolean;
  supabaseConfigStatus?: SupabaseConfigStatus;
  joinError?: string | null;
  onNameChange: (val: string) => void;
  onRoomCodeChange: (val: string) => void;
  onOpenScanner: () => void;
  onJoinLobby: () => void;
  onJoinLocalFallback?: () => void;
  onOpenPrintKit: () => void;
  onOpenLeaderboard: () => void;
  onOpenSpectator?: () => void;
}

export function JoinScreen({
  name,
  roomCode,
  badgeNumber,
  qrVerifiedInSession,
  wsConnected,
  supabaseConfigStatus = 'configured',
  joinError = null,
  onNameChange,
  onRoomCodeChange,
  onOpenScanner,
  onJoinLobby,
  onJoinLocalFallback,
  onOpenPrintKit,
  onOpenLeaderboard,
  onOpenSpectator,
}: JoinScreenProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [showFieldGuide, setShowFieldGuide] = useState(false);
  const [emblemFailed, setEmblemFailed] = useState(false);
  const [bgmMuted, setBgmMuted] = useState(() => isAmbienceMuted());
  const [bgmActive, setBgmActive] = useState(() => isAmbiencePlaying());

  useEffect(() => {
    const sync = () => {
      setBgmMuted(isAmbienceMuted());
      setBgmActive(isAmbiencePlaying());
    };
    sync();
    return subscribeAmbienceState(sync);
  }, []);

  const selectedBadge =
    qrVerifiedInSession && badgeNumber ? getBadgeInfo(badgeNumber) : null;
  const canJoin =
    qrVerifiedInSession &&
    badgeNumber !== null &&
    name.trim().length > 0 &&
    roomCode.trim().length >= 4;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canJoin || !qrVerifiedInSession) return;
        playUiClick();
        onJoinLobby();
      }}
      className="flex-1 min-h-0 flex flex-col justify-between px-3.5 sm:px-5 pb-3 sm:pb-4 pt-1 gap-2 sm:gap-3"
    >
      {/* Top Utility Row + Bespoke Emblem Hero */}
      <div className="shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={() => {
              playUiClick();
              setShowFieldGuide(true);
            }}
            className="min-h-[38px] px-2.5 sm:px-3 rounded-xl bg-slate-900/75 hover:bg-slate-800/85 border border-white/12 hover:border-cyan-400/40 text-[11px] font-semibold text-slate-200 hover:text-cyan-200 inline-flex items-center gap-1.5 transition-all active:scale-95 whitespace-nowrap"
          >
            <BookOpen className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
            <span>Field Guide</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playUiClick();
              onOpenLeaderboard();
            }}
            className="min-h-[38px] px-2.5 sm:px-3 rounded-xl bg-amber-500/14 hover:bg-amber-500/22 border border-amber-400/45 text-[11px] font-extrabold uppercase tracking-wide text-amber-200 inline-flex items-center gap-1.5 transition-all active:scale-95 whitespace-nowrap shadow-[0_0_16px_rgba(245,158,11,0.16)]"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span>Leaderboard</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const nextMuted = toggleAmbienceMuted();
              if (!nextMuted) {
                playUiClick();
              }
            }}
            title={
              bgmMuted
                ? 'Enable Home Screen Space Wind & BGM'
                : 'Mute Home Screen Space Wind & BGM'
            }
            className={`min-h-[38px] px-3 rounded-xl border text-[11px] font-semibold inline-flex items-center gap-1.5 transition-all active:scale-95 whitespace-nowrap ${
              bgmMuted
                ? 'bg-slate-900/75 border-white/12 text-slate-400 hover:text-slate-200'
                : 'bg-cyan-500/15 border-cyan-400/45 text-cyan-200 hover:bg-cyan-500/25 shadow-[0_0_16px_rgba(6,182,212,0.2)]'
            }`}
          >
            {bgmMuted ? (
              <VolumeX className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Volume2
                className={`w-3.5 h-3.5 shrink-0 ${
                  bgmActive ? 'text-cyan-300' : 'text-cyan-200/80'
                }`}
              />
            )}
            <span>
              {bgmMuted ? 'Sound Off' : bgmActive ? 'Wind BGM' : 'Play BGM'}
            </span>
          </button>
        </div>

        <div className="text-center space-y-1.5">
          <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
            <span className="animate-radar absolute inset-0 rounded-2xl border border-cyan-400/40" />
            <div className="relative w-14 h-14 rounded-2xl overflow-hidden bg-gradient-to-br from-cyan-500/20 to-emerald-500/15 border border-cyan-300/50 shadow-[0_0_28px_rgba(6,182,212,0.34)] flex items-center justify-center">
              {!emblemFailed ? (
                <img
                  src={APP_LOGO_SRC}
                  alt="Campus Among Us Mission Crest"
                  onError={() => setEmblemFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <ShieldCheck className="w-7 h-7 text-cyan-300" />
              )}
            </div>
          </div>

          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-cyan-300">
            <Radio className="w-3 h-3 shrink-0" />
            <span>Live IRL Edition</span>
            <span aria-hidden="true" className="text-slate-500">·</span>
            <span className={wsConnected ? 'text-emerald-400' : 'text-amber-300'}>
              {wsConnected ? 'Online' : 'Local Ready'}
            </span>
          </div>

          <h1 className="font-display text-2xl sm:text-[28px] font-extrabold tracking-wide uppercase text-white leading-tight [text-wrap:balance]">
            Campus Among Us
          </h1>
        </div>
      </div>

      {/* Step 1 + Step 2 Stacked Compactly with Safe Scroll on Short Screens */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col justify-center gap-2.5 py-0.5">
        {/* Step 1 Card: Scan Your Player ID Card */}
        <div className="glass-card rounded-2xl p-3 sm:p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold tracking-wider uppercase text-cyan-300">
              Step 01 · Player ID Card
            </span>
            {selectedBadge ? (
              <span className="text-[11px] font-mono font-bold text-emerald-400 tabular-nums">
                #{selectedBadge.number} · {selectedBadge.callsign}
              </span>
            ) : (
              <span className="text-[11px] font-medium text-slate-400">
                QR Required
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              playUiClick();
              onOpenScanner();
            }}
            className="relative w-full min-h-[68px] py-3 px-3.5 rounded-xl bg-slate-950/80 border border-white/12 hover:border-cyan-400/55 transition-all active:scale-[0.985] group overflow-hidden"
            style={
              selectedBadge
                ? {
                    borderColor: `${selectedBadge.hex}90`,
                    boxShadow: `inset 0 0 30px ${selectedBadge.hex}26`,
                  }
                : undefined
            }
          >
            <span className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-cyan-400/80 rounded-tl" />
            <span className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-cyan-400/80 rounded-tr" />
            <span className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-cyan-400/80 rounded-bl" />
            <span className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-cyan-400/80 rounded-br" />

            {selectedBadge ? (
              <div className="flex items-center justify-center gap-3">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center font-mono text-sm font-extrabold text-white border-2 border-white/45 shrink-0 tabular-nums"
                  style={{
                    backgroundColor: selectedBadge.hex,
                    boxShadow: `0 0 22px ${selectedBadge.hex}77`,
                  }}
                >
                  #{selectedBadge.number}
                </div>
                <div className="text-left min-w-0">
                  <div className="font-display text-sm font-extrabold tracking-wide uppercase text-white truncate">
                    ID Card #{selectedBadge.number} · {selectedBadge.colorName}
                  </div>
                  <div className="text-xs text-cyan-300 font-medium truncate">
                    Callsign {selectedBadge.callsign} · Tap to re-scan
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3 py-0.5">
                <div className="w-11 h-11 rounded-xl bg-cyan-500/15 border border-cyan-400/45 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.28)] shrink-0 group-hover:scale-105 transition-transform">
                  <QrCode className="w-5 h-5 text-cyan-300" />
                </div>
                <div className="text-left min-w-0">
                  <div className="font-display text-sm font-extrabold tracking-wide uppercase text-white">
                    Scan Your ID Card QR
                  </div>
                  <div className="text-xs text-slate-300">
                    Scan your physical ID card to unlock lobby entry
                  </div>
                </div>
              </div>
            )}
          </button>
        </div>

        {/* Step 2 Card: Floating-Label Inputs */}
        <div className="glass-card rounded-2xl p-3 sm:p-3.5 space-y-2.5">
          <div className="text-[11px] font-bold tracking-wider uppercase text-cyan-300">
            Step 02 · Mission Credentials
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div className="relative col-span-2">
              <input
                id="player-nickname"
                type="text"
                maxLength={18}
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder=" "
                className="peer w-full h-12 px-3 pt-4 pb-1 rounded-xl bg-slate-950/80 border border-white/12 text-white text-sm font-semibold focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 transition-all"
              />
              <label
                htmlFor="player-nickname"
                className="pointer-events-none absolute left-3 top-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-xs peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-focus:top-1.5 peer-focus:text-[10px] peer-focus:uppercase peer-focus:tracking-wider peer-focus:text-cyan-300"
              >
                Player Nickname
              </label>
            </div>

            <div className="relative col-span-1">
              <input
                id="mission-room-code"
                type="text"
                maxLength={12}
                value={roomCode}
                onChange={(e) =>
                  onRoomCodeChange(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 12)
                  )
                }
                placeholder=" "
                className="peer w-full h-12 px-2.5 pt-4 pb-1 rounded-xl bg-slate-950/80 border border-white/12 text-cyan-300 text-base font-mono font-extrabold tracking-widest uppercase text-center focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 transition-all"
              />
              <label
                htmlFor="mission-room-code"
                className="pointer-events-none absolute left-2.5 top-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-xs peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-focus:top-1.5 peer-focus:text-[10px] peer-focus:uppercase peer-focus:tracking-wider peer-focus:text-cyan-300"
              >
                Room
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Floating Action Zone */}
      <div className="shrink-0 space-y-2">
        {joinError ? (
          <div className="rounded-xl bg-rose-950/80 border border-rose-500/45 px-3 py-2 space-y-1.5">
            <div className="flex items-start gap-2 text-xs text-rose-100 leading-snug">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-0.5">
                <div>{joinError}</div>
                {supabaseResolvedHost && (
                  <div className="text-[10px] font-mono text-rose-300/80 truncate">
                    Host: {supabaseResolvedHost}
                  </div>
                )}
              </div>
            </div>
            {onJoinLocalFallback && (
              <button
                type="button"
                disabled={!canJoin}
                onClick={() => {
                  playUiClick();
                  onJoinLocalFallback();
                }}
                className="w-full min-h-[40px] rounded-lg bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/40 text-amber-200 text-xs font-bold uppercase tracking-wide disabled:opacity-40 transition-colors"
              >
                Continue in Local Offline Mode Instead
              </button>
            )}
          </div>
        ) : supabaseConfigStatus !== 'configured' ? (
          <div className="rounded-xl bg-amber-950/50 border border-amber-500/30 px-3 py-1.5 text-[11px] font-mono text-amber-200 text-center">
            {supabaseConfigStatus === 'placeholder'
              ? 'Placeholder Supabase keys detected — joining in Local Offline Mode.'
              : supabaseConfigStatus === 'invalid_url'
              ? 'Invalid VITE_SUPABASE_URL — joining in Local Offline Mode.'
              : 'VITE_SUPABASE_URL / ANON_KEY not set — joining in Local Offline Mode.'}
          </div>
        ) : null}

        {!qrVerifiedInSession && !joinError && (
          <div className="rounded-xl bg-cyan-950/55 border border-cyan-500/30 px-3 py-1.5 text-xs font-medium text-cyan-100 flex items-center justify-center gap-1.5 text-center">
            <QrCode className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
            <span>Scan a valid Player ID Card QR above to unlock Join Lobby.</span>
          </div>
        )}

        <button
          type="submit"
          disabled={!canJoin}
          aria-disabled={!canJoin}
          className="tactical-btn-primary w-full h-14 rounded-2xl font-display font-extrabold text-base tracking-wide uppercase flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 shadow-[0_0_28px_rgba(16,185,129,0.38)] disabled:opacity-35 disabled:cursor-not-allowed disabled:shadow-none disabled:transform-none"
        >
          {!qrVerifiedInSession ? (
            <>
              <Lock className="w-4 h-4 shrink-0" />
              <span>Scan QR to Join Lobby</span>
            </>
          ) : (
            <>
              <span>Enter Mission Lobby</span>
              <ArrowRight className="w-5 h-5 shrink-0" />
            </>
          )}
        </button>

        <div className="flex items-center justify-center gap-2 sm:gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => {
              playUiClick();
              onOpenPrintKit();
            }}
            className="min-h-[42px] inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200 hover:text-cyan-300 px-3 py-2 rounded-xl bg-slate-900/55 hover:bg-slate-900/85 border border-white/10 hover:border-cyan-400/40 transition-all whitespace-nowrap active:scale-95"
          >
            <Printer className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
            <span>Host Printable QR Kit</span>
            <Lock className="w-3 h-3 text-amber-300 shrink-0" />
          </button>

          {onOpenSpectator && (
            <button
              type="button"
              onClick={() => {
                playUiClick();
                onOpenSpectator();
              }}
              className="min-h-[42px] inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200 hover:text-emerald-300 px-3 py-2 rounded-xl bg-slate-900/55 hover:bg-slate-900/85 border border-white/10 hover:border-emerald-400/40 transition-all whitespace-nowrap active:scale-95"
            >
              <Monitor className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
              <span>Projector HQ</span>
            </button>
          )}

          {!isInstalled && (isInstallable || isIOS) && (
            <button
              type="button"
              onClick={() => {
                playUiClick();
                if (isInstallable) {
                  void install();
                } else {
                  setShowIosGuide(true);
                }
              }}
              className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-200 hover:text-white px-3.5 py-2 rounded-xl bg-cyan-500/12 hover:bg-cyan-500/20 border border-cyan-400/35 transition-all whitespace-nowrap active:scale-95"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>Install App</span>
            </button>
          )}
        </div>
      </div>

      {/* Interactive Field Guide Modal */}
      {showFieldGuide && (
        <div
          className="fixed inset-0 z-50 bg-[#050814]/88 backdrop-blur-md flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Campus Among Us Field Guide"
        >
          <div className="w-full max-w-md glass-card rounded-3xl p-5 space-y-4 max-h-[85dvh] overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-cyan-300">
                  Mission Briefing
                </div>
                <h2 className="font-display text-lg font-extrabold uppercase tracking-wide text-white">
                  Campus Field Guide
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setShowFieldGuide(false);
                }}
                aria-label="Close Field Guide"
                className="w-10 h-10 rounded-xl bg-slate-900/90 border border-white/12 hover:border-cyan-400/40 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-left">
              <div className="rounded-2xl bg-slate-950/70 border border-white/10 p-3 flex items-start gap-3">
                <QrCode className="w-5 h-5 text-cyan-300 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-white">
                    Crewmates · Complete Station Tasks
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Walk to your assigned campus stations, scan the printed Station QR posters, and finish mini-games to fill the Team Tasks bar to 100%.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-950/70 border border-rose-500/25 p-3 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-white">
                    Impostors · Covert Ops &amp; Sabotage
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Hold or double-tap your Role Card to open Covert Ops. Trigger Reactor or Comms sabotages and scan a target&apos;s Player ID Card QR to eliminate them.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-950/70 border border-violet-500/30 p-3 flex items-start gap-3">
                <Ghost className="w-5 h-5 text-violet-300 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-white">
                    Eliminated · Red Headband &amp; Phantom Mode
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    When eliminated, immediately put on your Red Headband so others can identify you, remain silent, and enter Phantom Mode to finish remaining missions.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-950/70 border border-amber-500/25 p-3 flex items-start gap-3">
                <Megaphone className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-white">
                    Meetings &amp; Ejection Votes
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Report a body by scanning their ID Card QR or Call Meeting to assemble everyone in the Main Lobby. Eliminations are locked while meetings are active.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                playUiClick();
                setShowFieldGuide(false);
              }}
              className="tactical-btn-primary w-full h-12 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-display font-extrabold text-xs uppercase tracking-wider"
            >
              Ready for Deployment
            </button>
          </div>
        </div>
      )}

      {showIosGuide && (
        <div className="fixed inset-0 z-50 bg-[#050814]/90 backdrop-blur-md flex items-center justify-center p-5">
          <div className="w-full max-w-sm glass-card rounded-3xl p-5 space-y-3 text-center">
            <h3 className="font-display text-base font-extrabold uppercase tracking-wider text-white">
              Add to Home Screen
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Tap the Safari <span className="text-cyan-300 font-bold">Share</span> icon at the bottom of your screen, then choose{' '}
              <span className="text-emerald-300 font-bold">Add to Home Screen</span> for full-screen mission mode.
            </p>
            <button
              type="button"
              onClick={() => {
                playUiClick();
                setShowIosGuide(false);
              }}
              className="tactical-btn-primary w-full h-11 rounded-xl bg-cyan-400 text-slate-950 font-display font-extrabold text-xs uppercase tracking-wider"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
