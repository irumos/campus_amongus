import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, Lock, MapPin, Printer, Scissors } from 'lucide-react';
import { WRISTBANDS } from '../config/campusConfig';
import { useCampusStations } from '../config/stationStore';

interface PrintKitScreenProps {
  unlockedRoomCode?: string | null;
  onLockPrintKit?: () => void;
  onBack: () => void;
}

export function PrintKitScreen({
  unlockedRoomCode,
  onLockPrintKit,
  onBack,
}: PrintKitScreenProps) {
  const [activeTab, setActiveTab] = useState<'wristbands' | 'stations'>('wristbands');
  const stations = useCampusStations();

  return (
    <div className="min-h-screen bg-white text-slate-950">
      {/* Sticky Print Toolbar (hidden during printing) */}
      <div className="print:hidden sticky top-0 z-30 bg-slate-950 text-white border-b border-slate-800 px-4 py-3">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="min-h-[40px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-bold flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to App</span>
            </button>
            {unlockedRoomCode && (
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-[11px] font-mono font-bold text-emerald-300">
                LOBBY: {unlockedRoomCode}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('wristbands')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                activeTab === 'wristbands'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Wristbands (P01–P16)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('stations')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                activeTab === 'stations'
                  ? 'bg-cyan-400 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Room Posters ({stations.length} Stations)
            </button>
          </div>

          <div className="flex items-center gap-2">
            {onLockPrintKit && (
              <button
                type="button"
                onClick={onLockPrintKit}
                className="min-h-[40px] px-3 rounded-xl bg-slate-900 hover:bg-rose-950 border border-slate-800 hover:border-rose-500/40 text-slate-300 hover:text-rose-200 text-xs font-bold flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Lock</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-[40px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold flex items-center gap-2"
            >
              <Printer className="w-4 h-4" />
              <span>Print QRs</span>
            </button>
          </div>
        </div>
      </div>

      {/* Printable A4 Sheet Container */}
      <div className="max-w-4xl mx-auto p-6 print:p-0">
        {activeTab === 'wristbands' ? (
          <div>
            <div className="mb-3 flex items-center justify-between border-b-2 border-slate-900 pb-2">
              <div>
                <h1 className="font-display text-lg font-extrabold tracking-wide uppercase text-slate-950">
                  CAMPUS AMONG US IRL — WRISTBAND STRIPS (P01–P16)
                </h1>
                <p className="text-[11px] text-slate-600">
                  Cut along dashed borders. Fold ends around wrist and secure at tape guides.
                </p>
              </div>
              <Scissors className="w-5 h-5 text-slate-600" />
            </div>

            <div className="space-y-2">
              {WRISTBANDS.map((wb) => (
                <div
                  key={wb.id}
                  className="border-2 border-dashed border-slate-400 rounded-lg overflow-hidden flex items-stretch justify-between bg-white break-inside-avoid"
                >
                  {/* Left Color Stripe */}
                  <div
                    className="w-3.5 shrink-0"
                    style={{ backgroundColor: wb.colorHex }}
                  />

                  {/* Left Fold / Tape Guide */}
                  <div className="w-24 border-r border-dotted border-slate-400 px-2 py-1.5 flex flex-col items-center justify-center text-center bg-slate-50">
                    <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">
                      FOLD / TAPE
                    </span>
                    <span className="text-[10px] font-mono font-bold text-slate-700">
                      ----&gt;
                    </span>
                  </div>

                  {/* Center Wristband QR + Badge Identity */}
                  <div className="flex-1 px-3 py-1.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="p-1 bg-white border border-slate-200 rounded">
                        <QRCodeSVG
                          value={wb.qrPayload}
                          size={58}
                          level="M"
                          bgColor="#ffffff"
                          fgColor="#0f172a"
                        />
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block w-4 h-4 rounded-full border border-slate-900"
                            style={{ backgroundColor: wb.colorHex }}
                          />
                          <span className="font-display text-base font-extrabold text-slate-950 uppercase">
                            {wb.label}
                          </span>
                          <span className="text-xs font-mono font-bold text-slate-500">
                            ({wb.id})
                          </span>
                        </div>
                        <div className="text-[11px] font-bold text-slate-700">
                          {wb.colorName} · Campus Among Us IRL
                        </div>
                        <div className="text-[9px] font-mono text-slate-500">
                          {wb.qrPayload}
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono font-extrabold text-xl text-slate-900 tabular-nums pr-1">
                      #{wb.number}
                    </div>
                  </div>

                  {/* Right Wrist Overlap Guide */}
                  <div className="w-24 border-l border-dotted border-slate-400 px-2 py-1.5 flex flex-col items-center justify-center text-center bg-slate-50">
                    <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">
                      TAPE OVERLAP
                    </span>
                    <span className="text-[10px] font-mono font-bold text-slate-800">
                      {wb.id}
                    </span>
                  </div>

                  {/* Right Color Stripe */}
                  <div
                    className="w-3.5 shrink-0"
                    style={{ backgroundColor: wb.colorHex }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="border-b-2 border-slate-900 pb-2">
              <h1 className="font-display text-lg font-extrabold tracking-wide uppercase text-slate-950">
                CAMPUS AMONG US IRL — ROOM STATION QR POSTERS ({stations.length} STATIONS)
              </h1>
              <p className="text-[11px] text-slate-600">
                Print on A4 and tape each poster visibly outside the matching campus room door.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-5">
              {stations.map((station) => (
                <div
                  key={station.id}
                  className="border-4 border-slate-900 rounded-2xl p-6 flex flex-col items-center text-center justify-between gap-4 bg-white break-inside-avoid"
                >
                  <div className="space-y-1.5 w-full">
                    <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-mono font-bold uppercase tracking-widest">
                      <MapPin className="w-3 h-3" />
                      <span>STATION CODE: {station.id}</span>
                    </div>
                    <h2 className="font-display text-2xl font-extrabold text-slate-950 leading-tight">
                      {station.roomName}
                    </h2>
                    <p className="text-sm font-extrabold text-emerald-700 uppercase tracking-wide">
                      OBJECTIVE: {station.taskTitle}
                    </p>
                  </div>

                  <div className="p-3.5 border-2 border-slate-300 rounded-2xl bg-white">
                    <QRCodeSVG
                      value={station.qrPayload}
                      size={180}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#0f172a"
                    />
                  </div>

                  <div className="space-y-0.5">
                    <div className="text-[11px] font-mono font-bold text-slate-800">
                      {station.qrPayload}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      SCAN WITH CAMPUS AMONG US IRL
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
