import { useCallback, useEffect, useState } from 'react';
import { Delete, Lock, ShieldCheck, X } from 'lucide-react';
import {
  playErrorFeedback,
  playTaskSuccessFeedback,
  playUiClick,
} from '../utils/feedback';

const DEV_PASSCODE = '7887337';

interface DevPasscodeModalProps {
  onSuccess: () => void;
  onClose: () => void;
}

export function DevPasscodeModal({ onSuccess, onClose }: DevPasscodeModalProps) {
  const [digits, setDigits] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submitCode = useCallback(
    (candidate: string) => {
      if (candidate === DEV_PASSCODE) {
        playTaskSuccessFeedback();
        onSuccess();
      } else {
        playErrorFeedback();
        setErrorMsg('ACCESS DENIED · INVALID PASSCODE');
        setDigits('');
      }
    },
    [onSuccess]
  );

  const handleDigit = useCallback(
    (d: string) => {
      playUiClick();
      setErrorMsg(null);
      setDigits((prev) => {
        if (prev.length >= DEV_PASSCODE.length) return prev;
        const next = prev + d;
        if (next.length === DEV_PASSCODE.length) {
          setTimeout(() => submitCode(next), 90);
        }
        return next;
      });
    },
    [submitCode]
  );

  const handleBackspace = useCallback(() => {
    playUiClick();
    setErrorMsg(null);
    setDigits((prev) => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    playUiClick();
    setErrorMsg(null);
    setDigits('');
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && digits.length > 0) {
        e.preventDefault();
        submitCode(digits);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [digits, handleBackspace, handleDigit, onClose, submitCode]);

  const keypad = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="fixed inset-0 z-50 bg-[#060913]/92 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md glass-card rounded-t-3xl sm:rounded-3xl p-5 space-y-4 border-cyan-400/25">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center">
              <Lock className="w-4 h-4 text-cyan-300" />
            </div>
            <div>
              <h2 className="font-display text-sm font-extrabold tracking-wider uppercase text-white">
                DEVELOPER ACCESS
              </h2>
              <p className="text-[11px] text-slate-400">
                Enter 7-digit passcode to unlock Insights &amp; Dev Mode
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              playUiClick();
              onClose();
            }}
            aria-label="Close passcode modal"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/10 text-slate-300 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 7-Slot Passcode Display */}
        <div className="rounded-2xl bg-slate-950/80 border border-white/10 py-3.5 px-4 flex flex-col items-center gap-2">
          <div className="flex items-center justify-center gap-2.5">
            {Array.from({ length: DEV_PASSCODE.length }).map((_, idx) => {
              const filled = idx < digits.length;
              return (
                <span
                  key={idx}
                  className={`w-3.5 h-3.5 rounded-full border transition-all ${
                    errorMsg
                      ? 'border-rose-500 bg-rose-500/30'
                      : filled
                      ? 'border-cyan-400 bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.8)] scale-110'
                      : 'border-white/25 bg-white/5'
                  }`}
                />
              );
            })}
          </div>
          {errorMsg ? (
            <span className="text-[10px] font-mono font-bold tracking-wider text-rose-400">
              {errorMsg}
            </span>
          ) : (
            <span className="text-[10px] font-mono text-slate-500 tabular-nums">
              {digits.length}/{DEV_PASSCODE.length} DIGITS
            </span>
          )}
        </div>

        {/* Tactile Numeric Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {keypad.map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => handleDigit(num)}
              className="h-13 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-white/10 font-mono text-lg font-extrabold text-white active:scale-95 transition-all"
            >
              {num}
            </button>
          ))}

          <button
            type="button"
            onClick={handleClear}
            className="h-13 rounded-2xl bg-slate-950/80 hover:bg-slate-800 border border-white/10 text-[11px] font-bold uppercase tracking-wider text-slate-400 active:scale-95 transition-all"
          >
            Clear
          </button>

          <button
            type="button"
            onClick={() => handleDigit('0')}
            className="h-13 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-white/10 font-mono text-lg font-extrabold text-white active:scale-95 transition-all"
          >
            0
          </button>

          <button
            type="button"
            onClick={handleBackspace}
            aria-label="Backspace"
            className="h-13 rounded-2xl bg-slate-950/80 hover:bg-slate-800 border border-white/10 flex items-center justify-center text-slate-300 active:scale-95 transition-all"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

        <button
          type="button"
          disabled={digits.length === 0}
          onClick={() => submitCode(digits)}
          className="w-full h-12 rounded-2xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-display font-extrabold text-xs tracking-wider uppercase flex items-center justify-center gap-2 disabled:opacity-35 active:scale-95 transition-all"
        >
          <ShieldCheck className="w-4 h-4" />
          <span>UNLOCK DEVELOPER MODE</span>
        </button>
      </div>
    </div>
  );
}
