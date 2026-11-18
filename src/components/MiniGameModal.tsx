import { useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, ShieldAlert, X } from 'lucide-react';
import type { TaskStation } from '../shared/gameData';
import { playErrorSound, playSuccessSound, playTapSound } from '../utils/sound';

interface MiniGameModalProps {
  station: TaskStation;
  isFakeTask: boolean;
  onComplete: (stationId: string) => void;
  onClose: () => void;
}

const CONDUIT_NODES = [
  { id: 'cyan', label: 'CY-01', hex: '#06b6d4', row: 0 },
  { id: 'emerald', label: 'EM-02', hex: '#10b981', row: 1 },
  { id: 'amber', label: 'AM-03', hex: '#f59e0b', row: 2 },
  { id: 'rose', label: 'CR-04', hex: '#f43f5e', row: 3 },
];

export function MiniGameModal({
  station,
  isFakeTask,
  onComplete,
  onClose,
}: MiniGameModalProps) {
  const [completed, setCompleted] = useState(false);

  // Security Manifold: 1 to 6 keypad
  const shuffledNumbers = useMemo(
    () => [1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5),
    []
  );
  const [nextNumber, setNextNumber] = useState(1);
  const [wrongNum, setWrongNum] = useState<number | null>(null);

  // Power Conduits: 4 left terminals -> 4 shuffled right terminals with animated SVG beams
  const rightOrder = useMemo(
    () => [...CONDUIT_NODES].sort(() => Math.random() - 0.5),
    []
  );
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);

  // Firewall Nodes: 7 hexagonal shield tiles
  const [lockedHexes, setLockedHexes] = useState<boolean[]>([
    false,
    true,
    false,
    false,
    true,
    false,
    false,
  ]);

  // Verify Student ID Swipe
  const [swipeProgress, setSwipeProgress] = useState(0);

  function triggerSuccess() {
    if (completed) return;
    setCompleted(true);
    playSuccessSound();
    setTimeout(() => {
      onComplete(station.id);
    }, 950);
  }

  function handleManifoldTap(num: number) {
    if (completed) return;
    if (num === nextNumber) {
      playTapSound();
      if (num === 6) {
        setNextNumber(7);
        triggerSuccess();
      } else {
        setNextNumber(num + 1);
      }
    } else {
      playErrorSound();
      setWrongNum(num);
      setNextNumber(1);
      setTimeout(() => setWrongNum(null), 350);
    }
  }

  function handleRightConduitTap(rightId: string) {
    if (completed || !selectedLeft) return;
    if (selectedLeft === rightId) {
      playTapSound();
      const updated = [...connectedIds, rightId];
      setConnectedIds(updated);
      setSelectedLeft(null);
      if (updated.length === CONDUIT_NODES.length) {
        triggerSuccess();
      }
    } else {
      playErrorSound();
      setSelectedLeft(null);
    }
  }

  function handleHexTap(index: number) {
    if (completed || lockedHexes[index]) return;
    playTapSound();
    const updated = [...lockedHexes];
    updated[index] = true;
    setLockedHexes(updated);
    if (updated.every(Boolean)) {
      triggerSuccess();
    }
  }

  function handleSwipeChange(val: number) {
    if (completed) return;
    setSwipeProgress(val);
    if (val >= 95) {
      triggerSuccess();
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#060913]/90 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md glass-card rounded-t-3xl sm:rounded-3xl p-5 relative overflow-hidden">
        {/* Celebratory Full-Screen Emerald Pulse */}
        {completed && (
          <div className="absolute inset-0 z-20 bg-emerald-500/95 flex flex-col items-center justify-center text-center p-6 animate-in fade-in duration-150">
            <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center mb-3 animate-pulse">
              <CheckCircle2 className="w-12 h-12 text-white" />
            </div>
            <h3 className="font-display text-2xl font-extrabold tracking-wider uppercase text-white">
              {isFakeTask ? 'FAKE SCAN COMPLETE' : 'OBJECTIVE COMPLETE +20%'}
            </h3>
            <p className="text-xs font-bold text-emerald-50 mt-1">
              {isFakeTask
                ? 'Blend in with Crewmates.'
                : 'Campus Team Task Progress Synchronized'}
            </p>
          </div>
        )}

        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <p className="text-[10px] font-mono font-bold tracking-widest uppercase text-cyan-400">
              [{station.location}]
            </p>
            <h2 className="font-display text-xl font-extrabold tracking-wide uppercase text-white mt-0.5">
              {station.taskName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close mini-game"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-2xl bg-white/10 text-slate-300 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mini-Game 1: Security Manifold (2x3 neon cyan keypad 1-6) */}
        {station.miniGame === 'manifold' && (
          <div>
            <p className="text-xs text-slate-400 mb-3">
              Tap keypad tiles <span className="text-cyan-300 font-bold">1 → 6</span> in sequence.
            </p>
            <div className="grid grid-cols-3 gap-3">
              {shuffledNumbers.map((num) => {
                const isDone = num < nextNumber;
                const isWrong = wrongNum === num;
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleManifoldTap(num)}
                    className={`h-20 rounded-2xl font-display text-2xl font-extrabold tabular-nums border-2 transition-all active:scale-95 ${
                      isDone
                        ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-[0_0_20px_rgba(6,182,212,0.45)]'
                        : isWrong
                        ? 'bg-rose-600/80 border-rose-400 text-white'
                        : 'bg-slate-950/80 border-white/10 text-white hover:border-cyan-400/40'
                    }`}
                  >
                    {num}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Mini-Game 2: Power Conduits (Animated SVG Beams) */}
        {station.miniGame === 'wiring' && (
          <div>
            <p className="text-xs text-slate-400 mb-4">
              Tap a left terminal, then tap its matching color terminal on the right.
            </p>
            <div className="relative">
              {/* SVG Beam Overlay */}
              <svg
                className="pointer-events-none absolute inset-0 w-full h-full z-10"
                viewBox="0 0 320 248"
                preserveAspectRatio="none"
              >
                {connectedIds.map((id) => {
                  const leftIdx = CONDUIT_NODES.findIndex((n) => n.id === id);
                  const rightIdx = rightOrder.findIndex((n) => n.id === id);
                  const node = CONDUIT_NODES[leftIdx];
                  if (!node || leftIdx < 0 || rightIdx < 0) return null;
                  const y1 = leftIdx * 64 + 28;
                  const y2 = rightIdx * 64 + 28;
                  return (
                    <line
                      key={id}
                      x1="106"
                      y1={y1}
                      x2="214"
                      y2={y2}
                      stroke={node.hex}
                      strokeWidth="5"
                      strokeLinecap="round"
                      style={{ filter: `drop-shadow(0 0 8px ${node.hex})` }}
                    />
                  );
                })}
              </svg>

              <div className="grid grid-cols-2 gap-24">
                <div className="space-y-2.5">
                  {CONDUIT_NODES.map((node) => {
                    const isDone = connectedIds.includes(node.id);
                    const isSelected = selectedLeft === node.id;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        disabled={isDone}
                        onClick={() => {
                          playTapSound();
                          setSelectedLeft(node.id);
                        }}
                        className={`h-14 w-full rounded-2xl px-3 flex items-center justify-between font-mono text-xs font-bold border-2 transition-all active:scale-95 ${
                          isSelected
                            ? 'bg-slate-800 border-white text-white scale-[1.03]'
                            : 'bg-slate-950/85 border-white/10 text-slate-200'
                        }`}
                      >
                        <span>{node.label}</span>
                        <span
                          className="w-4 h-4 rounded-full"
                          style={{
                            backgroundColor: node.hex,
                            boxShadow: `0 0 12px ${node.hex}`,
                          }}
                        />
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2.5">
                  {rightOrder.map((node) => {
                    const isDone = connectedIds.includes(node.id);
                    return (
                      <button
                        key={node.id}
                        type="button"
                        disabled={isDone}
                        onClick={() => handleRightConduitTap(node.id)}
                        className={`h-14 w-full rounded-2xl px-3 flex items-center justify-between font-mono text-xs font-bold border-2 transition-all active:scale-95 ${
                          isDone
                            ? 'bg-emerald-950/50 border-emerald-400/60 text-emerald-300'
                            : 'bg-slate-950/85 border-white/10 text-slate-200 hover:border-white/30'
                        }`}
                      >
                        <span
                          className="w-4 h-4 rounded-full"
                          style={{
                            backgroundColor: node.hex,
                            boxShadow: `0 0 12px ${node.hex}`,
                          }}
                        />
                        <span>{isDone ? 'OK' : node.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mini-Game 3: Firewall Nodes (7 Hexagonal Shield Tiles) */}
        {station.miniGame === 'shields' && (
          <div>
            <p className="text-xs text-slate-400 mb-4">
              Tap all red unstable hex nodes to lock them into glowing emerald.
            </p>
            <div className="flex flex-col items-center gap-2 py-1">
              <div className="flex gap-3">
                {[0, 1].map((idx) => (
                  <HexTile
                    key={idx}
                    locked={lockedHexes[idx]}
                    label={`H${idx + 1}`}
                    onTap={() => handleHexTap(idx)}
                  />
                ))}
              </div>
              <div className="flex gap-3 -mt-2">
                {[2, 3, 4].map((idx) => (
                  <HexTile
                    key={idx}
                    locked={lockedHexes[idx]}
                    label={`H${idx + 1}`}
                    onTap={() => handleHexTap(idx)}
                  />
                ))}
              </div>
              <div className="flex gap-3 -mt-2">
                {[5, 6].map((idx) => (
                  <HexTile
                    key={idx}
                    locked={lockedHexes[idx]}
                    label={`H${idx + 1}`}
                    onTap={() => handleHexTap(idx)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Mini-Game 4: Verify Student ID Swipe */}
        {station.miniGame === 'swipe' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              Slide the Student ID badge smoothly across the magnetic terminal.
            </p>
            <div className="rounded-2xl bg-slate-950/85 border border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="flex items-center gap-1.5 text-cyan-300">
                  <CreditCard className="w-4 h-4" />
                  <span>CAMPUS ID READER</span>
                </span>
                <span className="font-mono tabular-nums text-emerald-400">
                  {swipeProgress}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={swipeProgress}
                onChange={(e) => handleSwipeChange(Number(e.target.value))}
                className="w-full h-12 accent-cyan-400 cursor-pointer"
              />
            </div>
            <button
              type="button"
              onClick={() => handleSwipeChange(100)}
              className="h-14 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-display font-extrabold text-sm tracking-wider uppercase active:scale-95 transition-all"
            >
              TAP TO VERIFY ID SWIPE
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function HexTile({
  locked,
  label,
  onTap,
}: {
  locked: boolean;
  label: string;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      style={{
        clipPath: 'polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%)',
      }}
      className={`w-20 h-20 flex flex-col items-center justify-center font-mono text-xs font-extrabold transition-all active:scale-90 ${
        locked
          ? 'bg-emerald-500/85 text-slate-950 shadow-[0_0_24px_rgba(16,185,129,0.7)]'
          : 'bg-rose-600/80 text-white hover:bg-rose-500'
      }`}
    >
      <ShieldAlert className="w-5 h-5 mb-0.5" />
      <span>{locked ? 'LOCKED' : label}</span>
    </button>
  );
}
