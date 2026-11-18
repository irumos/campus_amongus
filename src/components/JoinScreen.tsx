import { useState } from 'react';
import {
  ArrowRight,
  Download,
  Printer,
  QrCode,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { getBadgeInfo } from '../shared/gameData';
import { playUiClick } from '../utils/feedback';

interface JoinScreenProps {
  name: string;
  roomCode: string;
  badgeNumber: string | null;
  wsConnected: boolean;
  onNameChange: (val: string) => void;
  onRoomCodeChange: (val: string) => void;
  onOpenScanner: () => void;
  onJoinLobby: () => void;
  onOpenPrintKit: () => void;
}

export function JoinScreen({
  name,
  roomCode,
  badgeNumber,
  wsConnected,
  onNameChange,
  onRoomCodeChange,
  onOpenScanner,
  onJoinLobby,
  onOpenPrintKit,
}: JoinScreenProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIosGuide, setShowIosGuide] = useState(false);

  const selectedBadge = badgeNumber ? getBadgeInfo(badgeNumber) : null;
  const canJoin =
    name.trim().length > 0 && roomCode.trim().length === 4 && badgeNumber !== null;

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-between px-3.5 pb-3 pt-1 gap-2">
      {/* Compact Hero */}
      <div className="text-center space-y-1.5 shrink-0">
        <div className="relative w-12 h-12 mx-auto flex items-center justify-center">
          <span className="animate-radar absolute inset-0 rounded-full border border-cyan-400/45" />
          <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/25 to-emerald-500/20 border border-cyan-400/50 shadow-[0_0_20px_rgba(6,182,212,0.35)] flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-cyan-300" />
          </div>
        </div>

        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-400/30 text-[10px] font-bold tracking-widest uppercase text-cyan-300">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
            }`}
          />
          <Radio className="w-2.5 h-2.5" />
          <span>LIVE IRL EDITION</span>
        </div>

        <h1 className="font-display text-2xl font-extrabold tracking-wider uppercase text-white leading-none">
          CAMPUS AMONG US
        </h1>
      </div>

      {/* Step 1 + Step 2 Stacked Compactly to Fit Without Scrolling */}
      <div className="flex-1 min-h-0 flex flex-col justify-center gap-2.5">
        {/* Step 1 Card: Scan Your Wristband */}
        <div className="glass-card rounded-2xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-widest uppercase text-cyan-400">
              STEP 01 · WRISTBAND ID
            </span>
            {selectedBadge && (
              <span className="text-[10px] font-mono font-bold text-emerald-400">
                SYNCED #{selectedBadge.number}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              playUiClick();
              onOpenScanner();
            }}
            className="relative w-full py-3 px-3 rounded-xl bg-slate-950/75 border border-white/10 hover:border-cyan-400/50 transition-all active:scale-[0.98] group overflow-hidden"
          >
            <span className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-cyan-400 rounded-tl" />
            <span className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-cyan-400 rounded-tr" />
            <span className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-cyan-400 rounded-bl" />
            <span className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-cyan-400 rounded-br" />

            {selectedBadge ? (
              <div className="flex items-center justify-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center font-mono text-sm font-extrabold text-white border border-white/30"
                  style={{
                    backgroundColor: `${selectedBadge.hex}33`,
                    boxShadow: `0 0 18px ${selectedBadge.hex}55`,
                  }}
                >
                  #{selectedBadge.number}
                </div>
                <div className="text-left">
                  <div className="font-display text-sm font-extrabold tracking-wide uppercase text-white">
                    BADGE #{selectedBadge.number} · {selectedBadge.colorName}
                  </div>
                  <div className="text-[11px] text-cyan-300 font-semibold">
                    Tap to change or re-scan QR
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3 py-0.5">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.28)]">
                  <QrCode className="w-5 h-5 text-cyan-300" />
                </div>
                <div className="text-left">
                  <div className="font-display text-sm font-extrabold tracking-wider uppercase text-white">
                    SCAN YOUR WRISTBAND
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Camera QR or tap badge #01–#16
                  </div>
                </div>
              </div>
            )}
          </button>
        </div>

        {/* Step 2 Card: Floating-Label Inputs */}
        <div className="glass-card rounded-2xl p-3 space-y-2.5">
          <div className="text-[10px] font-bold tracking-widest uppercase text-cyan-400">
            STEP 02 · MISSION CREDENTIALS
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="relative col-span-2">
              <input
                id="player-nickname"
                type="text"
                maxLength={18}
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder=" "
                className="peer w-full h-12 px-3 pt-3.5 pb-1 rounded-xl bg-slate-950/75 border border-white/10 text-white text-sm font-semibold focus:outline-none focus:border-cyan-400 transition-colors"
              />
              <label
                htmlFor="player-nickname"
                className="pointer-events-none absolute left-3 top-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-xs peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-focus:top-1.5 peer-focus:text-[9px] peer-focus:uppercase peer-focus:tracking-wider peer-focus:text-cyan-400"
              >
                Player Nickname
              </label>
            </div>

            <div className="relative col-span-1">
              <input
                id="mission-room-code"
                type="text"
                maxLength={4}
                value={roomCode}
                onChange={(e) =>
                  onRoomCodeChange(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
                  )
                }
                placeholder=" "
                className="peer w-full h-12 px-2.5 pt-3.5 pb-1 rounded-xl bg-slate-950/75 border border-white/10 text-cyan-300 text-base font-mono font-extrabold tracking-widest uppercase text-center focus:outline-none focus:border-cyan-400 transition-colors"
              />
              <label
                htmlFor="mission-room-code"
                className="pointer-events-none absolute left-2.5 top-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-focus:text-cyan-400"
              >
                Room
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Floating Action Zone */}
      <div className="shrink-0 space-y-1.5">
        <button
          type="button"
          disabled={!canJoin}
          onClick={() => {
            playUiClick();
            onJoinLobby();
          }}
          className="w-full h-14 rounded-2xl font-display font-extrabold text-base tracking-wide uppercase flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 shadow-[0_0_26px_rgba(16,185,129,0.4)] disabled:opacity-35 disabled:shadow-none active:scale-95 transition-all"
        >
          <span>ENTER MISSION LOBBY</span>
          <ArrowRight className="w-5 h-5" />
        </button>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              playUiClick();
              onOpenPrintKit();
            }}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-cyan-300 py-1 px-2 transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Host Printable QR Kit</span>
          </button>

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
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 py-1 px-2 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Add to Home Screen</span>
            </button>
          )}
        </div>
      </div>

      {showIosGuide && (
        <div className="fixed inset-0 z-50 bg-[#060913]/90 backdrop-blur-md flex items-center justify-center p-5">
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
              className="w-full h-11 rounded-xl bg-cyan-500 text-slate-950 font-display font-extrabold text-xs uppercase tracking-wider"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
