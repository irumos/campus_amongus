import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, Printer, ShieldAlert, X } from 'lucide-react';
import { verifyLobbyPrintPasscode } from '../config/printPasscodeStore';
import {
  playErrorFeedback,
  playTaskSuccessFeedback,
  playUiClick,
} from '../utils/feedback';

interface PrintKitPasscodeModalProps {
  initialRoomCode: string;
  onSuccess: (verifiedRoomCode: string) => void;
  onClose: () => void;
}

export function PrintKitPasscodeModal({
  initialRoomCode,
  onSuccess,
  onClose,
}: PrintKitPasscodeModalProps) {
  const [roomCode, setRoomCode] = useState(
    () =>
      initialRoomCode
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 12) || 'SVCE'
  );
  const [passcode, setPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim() || verifying) return;
    playUiClick();
    setVerifying(true);
    setErrorMsg(null);
    try {
      const res = await verifyLobbyPrintPasscode(roomCode, passcode);
      if (res.ok) {
        playTaskSuccessFeedback();
        onSuccess(res.roomCode);
      } else if (res.reason === 'NO_PASSCODE_SET') {
        playErrorFeedback();
        setErrorMsg(
          `No Printable QR Kit passcode is set for lobby "${res.roomCode}". Ask the developer to set one in Developer Mode.`
        );
      } else {
        playErrorFeedback();
        setErrorMsg(`ACCESS DENIED · INVALID PASSCODE FOR LOBBY ${res.roomCode}`);
        setPasscode('');
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#060913]/92 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md max-h-[94dvh] overflow-y-auto overscroll-contain glass-card rounded-t-3xl sm:rounded-3xl p-4 sm:p-5 space-y-4 border-emerald-400/25">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center shrink-0">
              <Printer className="w-4 h-4 text-emerald-300" />
            </div>
            <div>
              <h2 className="font-display text-sm font-extrabold tracking-wider uppercase text-white">
                HOST PRINTABLE QR KIT
              </h2>
              <p className="text-[11px] text-slate-400">
                Enter the lobby&apos;s QR Kit passcode set by the developer
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              playUiClick();
              onClose();
            }}
            aria-label="Close Print Kit Passcode"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white/10 text-slate-300 hover:text-white shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div>
            <label
              htmlFor="print-kit-room-code"
              className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1"
            >
              Lobby Room Code
            </label>
            <input
              id="print-kit-room-code"
              type="text"
              maxLength={12}
              value={roomCode}
              onChange={(e) => {
                setErrorMsg(null);
                setRoomCode(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, 12)
                );
              }}
              placeholder="SVCE"
              className="w-full h-11 rounded-xl bg-slate-950/85 border border-white/15 px-3.5 text-sm font-mono font-extrabold tracking-widest uppercase text-cyan-300 focus:outline-none focus:border-emerald-400"
            />
          </div>

          <div>
            <label
              htmlFor="print-kit-passcode"
              className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1"
            >
              Lobby QR Kit Passcode
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="print-kit-passcode"
                type={showPasscode ? 'text' : 'password'}
                autoFocus
                maxLength={24}
                value={passcode}
                onChange={(e) => {
                  setErrorMsg(null);
                  setPasscode(e.target.value);
                }}
                placeholder="Enter developer-set passcode"
                className="w-full h-12 rounded-xl bg-slate-950/85 border border-white/15 pl-10 pr-11 text-sm font-mono font-bold tracking-wider text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
              />
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setShowPasscode((v) => !v);
                }}
                aria-label={showPasscode ? 'Hide passcode' : 'Show passcode'}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white"
              >
                {showPasscode ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-xl bg-rose-950/75 border border-rose-500/45 px-3 py-2.5 flex items-start gap-2 text-[11px] font-mono text-rose-200">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!roomCode.trim() || !passcode.trim() || verifying}
            className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-display font-extrabold text-xs tracking-wider uppercase flex items-center justify-center gap-2 disabled:opacity-35 active:scale-95 transition-all"
          >
            <Lock className="w-4 h-4" />
            <span>
              {verifying ? 'VERIFYING...' : 'UNLOCK PRINTABLE QR KIT'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}
