import { useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Download,
  FileDown,
  ImageDown,
  Info,
  Lock,
  MapPin,
  Printer,
  RefreshCw,
  Scissors,
  ShieldAlert,
} from 'lucide-react';
import {
  ID_CARDS,
  type CampusIdCardConfig,
  type CampusTaskStationConfig,
} from '../config/campusConfig';
import {
  buildIdCardQrPayload,
  buildStationQrPayload,
  rotateMatchQrToken,
  useMatchQrToken,
} from '../config/matchQrStore';
import { useCampusStations } from '../config/stationStore';
import {
  playErrorFeedback,
  playTaskSuccessFeedback,
  playUiClick,
} from '../utils/feedback';

interface PrintKitScreenProps {
  unlockedRoomCode?: string | null;
  onLockPrintKit?: () => void;
  onBack: () => void;
}

/** Distinct geometric visual emblem per ID card (#01-#16) so crewmates can identify each other across hallways */
function CandidateEmblem({ index }: { index: number }) {
  const shape = index % 8;
  switch (shape) {
    case 0:
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <polygon points="12,2 22,12 12,22 2,12" />
        </svg>
      );
    case 1:
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <polygon points="12,2 22,20 2,20" />
        </svg>
      );
    case 2:
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" />
        </svg>
      );
    case 3:
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <path d="M12 2l2.9 6.2L22 9.2l-5 4.8 1.2 7L12 17.6 5.8 21 7 14 2 9.2l7.1-1z" />
        </svg>
      );
    case 4:
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="3" />
        </svg>
      );
    case 5:
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case 6:
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <polygon points="12,2 22,9 18,21 6,21 2,9" />
        </svg>
      );
  }
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getEmblemSvgMarkup(index: number): string {
  const shape = index % 8;
  const inner =
    shape === 0
      ? '<polygon points="12,2 22,12 12,22 2,12"/>'
      : shape === 1
      ? '<polygon points="12,2 22,20 2,20"/>'
      : shape === 2
      ? '<polygon points="12,2 21,7 21,17 12,22 3,17 3,7"/>'
      : shape === 3
      ? '<path d="M12 2l2.9 6.2L22 9.2l-5 4.8 1.2 7L12 17.6 5.8 21 7 14 2 9.2l7.1-1z"/>'
      : shape === 4
      ? '<rect x="4" y="4" width="16" height="16" rx="3"/>'
      : shape === 5
      ? '<circle cx="12" cy="12" r="9"/>'
      : shape === 6
      ? '<path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"/>'
      : '<polygon points="12,2 22,9 18,21 6,21 2,9"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="white">${inner}</svg>`;
}

function loadSvgAsImage(svgEl: SVGSVGElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const serialized = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function renderIdCardOnCanvas(
  ctx: CanvasRenderingContext2D,
  card: CampusIdCardConfig,
  qrImg: HTMLImageElement,
  roomCode: string,
  matchToken: string,
  uniqueQr: string,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<void> {
  ctx.save();
  // Outer cut border
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, x, y, w, h, 20);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);

  const pad = 10;
  const ix = x + pad;
  const iy = y + pad;
  const iw = w - pad * 2;
  const ih = h - pad * 2;

  // Tinted candidate background
  drawRoundedRect(ctx, ix, iy, iw, ih, 14);
  ctx.fillStyle = `${card.colorHex}26`;
  ctx.fill();
  ctx.strokeStyle = card.colorHex;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Clip inside inner card
  ctx.save();
  drawRoundedRect(ctx, ix, iy, iw, ih, 14);
  ctx.clip();

  // Header band
  const headerH = 88;
  ctx.fillStyle = card.colorHex;
  ctx.fillRect(ix, iy, iw, headerH);

  // Lanyard punch hole
  drawRoundedRect(ctx, ix + iw / 2 - 28, iy + 10, 56, 12, 6);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(15,23,42,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Header text
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '700 11px monospace';
  ctx.fillText('CAMPUS AMONG US · ID CARD', ix + 18, iy + 46);

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 22px sans-serif';
  ctx.fillText(`${card.callsign} · ${card.colorName}`.toUpperCase(), ix + 18, iy + 74);

  // Top-right badge pill
  drawRoundedRect(ctx, ix + iw - 92, iy + 32, 74, 42, 10);
  ctx.fillStyle = 'rgba(15,23,42,0.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 24px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`#${card.number}`, ix + iw - 55, iy + 61);
  ctx.textAlign = 'left';

  // QR colored outer frame + white quiet zone
  const qrOuterSize = 186;
  const qrX = ix + 18;
  const qrY = iy + headerH + 18;
  drawRoundedRect(ctx, qrX, qrY, qrOuterSize, qrOuterSize, 16);
  ctx.fillStyle = card.colorHex;
  ctx.fill();

  drawRoundedRect(ctx, qrX + 10, qrY + 10, qrOuterSize - 20, qrOuterSize - 20, 10);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.drawImage(qrImg, qrX + 18, qrY + 18, qrOuterSize - 36, qrOuterSize - 36);

  // Right details panel
  const infoX = qrX + qrOuterSize + 18;
  const infoW = iw - (qrOuterSize + 54);
  drawRoundedRect(ctx, infoX, qrY, infoW, 102, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(15,23,42,0.12)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = '700 12px monospace';
  ctx.fillText(`OPERATIVE ${card.id}`, infoX + 14, qrY + 26);

  ctx.fillStyle = '#0f172a';
  ctx.font = '800 18px sans-serif';
  ctx.fillText(card.colorName.toUpperCase(), infoX + 14, qrY + 52);

  ctx.fillStyle = '#64748b';
  ctx.font = '600 12px monospace';
  ctx.fillText('NAME: ___________________', infoX + 14, qrY + 84);

  // Room & Set tag box
  drawRoundedRect(ctx, infoX, qrY + 114, infoW, 34, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 12px monospace';
  ctx.fillText(`ROOM: ${roomCode}   SET: ${matchToken}`, infoX + 14, qrY + 136);

  // Payload string
  ctx.fillStyle = '#334155';
  ctx.font = '600 10px monospace';
  ctx.fillText(uniqueQr.slice(0, 36), infoX + 4, qrY + 172);
  if (uniqueQr.length > 36) {
    ctx.fillText(uniqueQr.slice(36), infoX + 4, qrY + 186);
  }

  // Bottom dark footer strip
  const footerH = 38;
  const footerY = iy + ih - footerH;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(ix, footerY, iw, footerH);

  ctx.fillStyle = '#fda4af';
  ctx.font = '700 12px sans-serif';
  ctx.fillText(
    'ELIMINATED? WEAR RED HEADBAND & FINISH MISSIONS',
    ix + 18,
    footerY + 24
  );

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '700 13px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`#${card.number}`, ix + iw - 18, footerY + 24);
  ctx.textAlign = 'left';

  ctx.restore();
  ctx.restore();
}

async function renderStationPosterOnCanvas(
  ctx: CanvasRenderingContext2D,
  station: CampusTaskStationConfig,
  qrImg: HTMLImageElement,
  roomCode: string,
  matchToken: string,
  uniqueQr: string,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<void> {
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, 20);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 5;
  ctx.stroke();

  const cx = x + w / 2;

  // Top dark pill
  drawRoundedRect(ctx, cx - 135, y + 26, 270, 30, 15);
  ctx.fillStyle = '#0f172a';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`ROOM ${roomCode} · ${station.id}`, cx, y + 46);

  ctx.fillStyle = '#0f172a';
  ctx.font = '800 28px sans-serif';
  ctx.fillText(station.roomName.toUpperCase(), cx, y + 96);

  ctx.fillStyle = '#047857';
  ctx.font = '800 16px sans-serif';
  ctx.fillText(`OBJECTIVE: ${station.taskTitle.toUpperCase()}`, cx, y + 126);

  const qrSize = 230;
  drawRoundedRect(ctx, cx - qrSize / 2 - 14, y + 148, qrSize + 28, qrSize + 28, 18);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.drawImage(qrImg, cx - qrSize / 2, y + 162, qrSize, qrSize);

  ctx.fillStyle = '#1e293b';
  ctx.font = '700 12px monospace';
  ctx.fillText(uniqueQr, cx, y + h - 46);

  ctx.fillStyle = '#64748b';
  ctx.font = '700 11px sans-serif';
  ctx.fillText(`GAME SET ${matchToken} · SCAN WITH CAMPUS AMONG US IRL`, cx, y + h - 22);

  ctx.textAlign = 'left';
  ctx.restore();
}

export function PrintKitScreen({
  unlockedRoomCode,
  onLockPrintKit,
  onBack,
}: PrintKitScreenProps) {
  const [activeTab, setActiveTab] = useState<'idcards' | 'stations'>('idcards');
  const [rotatedNotice, setRotatedNotice] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const stations = useCampusStations();

  const effectiveRoomCode = (unlockedRoomCode || 'SVCE').toUpperCase();
  const matchToken = useMatchQrToken(effectiveRoomCode);

  const showStatus = (msg: string, ms = 5500) => {
    setExportStatus(msg);
    setTimeout(() => {
      setExportStatus((prev) => (prev === msg ? null : prev));
    }, ms);
  };

  const handleGenerateFreshQrs = () => {
    playUiClick();
    rotateMatchQrToken(effectiveRoomCode);
    playTaskSuccessFeedback();
    setRotatedNotice(true);
    setTimeout(() => setRotatedNotice(false), 3000);
  };

  const buildStandalonePrintableHtml = (): string => {
    const svgNodes = sheetRef.current
      ? Array.from(sheetRef.current.querySelectorAll<SVGSVGElement>('svg[data-qr-id]'))
      : [];
    const svgMap = new Map<string, string>();
    for (const node of svgNodes) {
      const id = node.getAttribute('data-qr-id');
      if (id) {
        const clone = node.cloneNode(true) as SVGSVGElement;
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svgMap.set(id, new XMLSerializer().serializeToString(clone));
      }
    }

    const cardsHtml =
      activeTab === 'idcards'
        ? ID_CARDS.map((card, index) => {
            const uniqueQr = buildIdCardQrPayload(
              effectiveRoomCode,
              matchToken,
              card.id
            );
            const qrSvg = svgMap.get(card.id) || '';
            return `
              <div class="cut-wrap">
                <div class="id-card" style="border-color:${card.colorHex};background:${card.colorHex}20;">
                  <div class="id-header" style="background:${card.colorHex};">
                    <div class="lanyard-hole"></div>
                    <div class="id-header-row">
                      <div class="id-title-group">
                        <div class="emblem">${getEmblemSvgMarkup(index)}</div>
                        <div>
                          <div class="kicker">CAMPUS AMONG US · ID CARD</div>
                          <div class="callsign">${escapeHtml(card.callsign)} · ${escapeHtml(card.colorName)}</div>
                        </div>
                      </div>
                      <div class="badge-num">#${escapeHtml(card.number)}</div>
                    </div>
                  </div>
                  <div class="id-body">
                    <div class="qr-frame" style="background:${card.colorHex};">
                      <div class="qr-white">${qrSvg}</div>
                    </div>
                    <div class="id-details">
                      <div class="detail-box">
                        <div class="detail-top">
                          <span>OPERATIVE ID</span>
                          <span class="id-chip" style="background:${card.colorHex};">${escapeHtml(card.id)}</span>
                        </div>
                        <div class="color-label">${escapeHtml(card.colorName)}</div>
                        <div class="name-line">PLAYER NAME: ___________________</div>
                      </div>
                      <div class="meta-bar">
                        <span>ROOM: ${escapeHtml(effectiveRoomCode)}</span>
                        <span>SET: ${escapeHtml(matchToken)}</span>
                      </div>
                      <div class="payload">${escapeHtml(uniqueQr)}</div>
                    </div>
                  </div>
                  <div class="id-footer">
                    <span>ELIMINATED? WEAR RED HEADBAND &amp; FINISH MISSIONS</span>
                    <span>#${escapeHtml(card.number)}</span>
                  </div>
                </div>
              </div>`;
          }).join('\n')
        : stations
            .map((station) => {
              const uniqueStationQr = buildStationQrPayload(
                effectiveRoomCode,
                matchToken,
                station.id
              );
              const qrSvg = svgMap.get(station.id) || '';
              return `
                <div class="station-card">
                  <div class="station-tag">ROOM ${escapeHtml(effectiveRoomCode)} · ${escapeHtml(station.id)}</div>
                  <h2>${escapeHtml(station.roomName)}</h2>
                  <div class="station-obj">OBJECTIVE: ${escapeHtml(station.taskTitle)}</div>
                  <div class="station-qr">${qrSvg}</div>
                  <div class="station-payload">${escapeHtml(uniqueStationQr)}</div>
                  <div class="station-foot">GAME SET ${escapeHtml(matchToken)} · SCAN WITH CAMPUS AMONG US IRL</div>
                </div>`;
            })
            .join('\n');

    const titleText =
      activeTab === 'idcards'
        ? `Campus Among Us IRL — Player ID Cards (${effectiveRoomCode} · ${matchToken})`
        : `Campus Among Us IRL — Station QR Posters (${effectiveRoomCode} · ${matchToken})`;

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(titleText)}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; }
    .toolbar { position: sticky; top: 0; z-index: 10; background: #0f172a; color: #fff; padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .toolbar button { background: #10b981; color: #020617; border: 0; border-radius: 10px; padding: 10px 18px; font-weight: 800; font-size: 13px; cursor: pointer; }
    .page { max-width: 1020px; margin: 16px auto; padding: 0 14px 28px; }
    .sheet-head { border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 14px; }
    .sheet-head h1 { margin: 0 0 4px; font-size: 16px; text-transform: uppercase; letter-spacing: 0.04em; }
    .sheet-head p { margin: 0; font-size: 11px; color: #334155; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .cut-wrap { border: 2px dashed #94a3b8; border-radius: 14px; padding: 6px; background: #fff; break-inside: avoid; page-break-inside: avoid; }
    .id-card { border: 3px solid #0f172a; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
    .id-header { padding: 8px 12px 10px; color: #fff; }
    .lanyard-hole { width: 38px; height: 9px; border-radius: 99px; background: #fff; border: 1px solid rgba(15,23,42,0.4); margin: 0 auto 6px; }
    .id-header-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .id-title-group { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .emblem { width: 28px; height: 28px; border-radius: 7px; background: rgba(15,23,42,0.28); border: 1px solid rgba(255,255,255,0.4); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .kicker { font: 800 8px monospace; letter-spacing: 0.12em; opacity: 0.92; }
    .callsign { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
    .badge-num { background: rgba(15,23,42,0.85); border: 1px solid rgba(255,255,255,0.45); border-radius: 8px; padding: 4px 8px; font: 800 16px monospace; color: #fff; }
    .id-body { padding: 10px; display: flex; align-items: center; gap: 10px; }
    .qr-frame { padding: 7px; border-radius: 12px; flex-shrink: 0; }
    .qr-white { background: #fff; padding: 6px; border-radius: 8px; line-height: 0; }
    .qr-white svg { width: 104px; height: 104px; display: block; }
    .id-details { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .detail-box { background: rgba(255,255,255,0.95); border: 1px solid rgba(15,23,42,0.14); border-radius: 8px; padding: 7px 8px; }
    .detail-top { display: flex; justify-content: space-between; align-items: center; font: 800 9px monospace; color: #64748b; }
    .id-chip { color: #fff; padding: 2px 5px; border-radius: 4px; font-size: 8px; }
    .color-label { font-size: 12px; font-weight: 800; text-transform: uppercase; margin-top: 2px; }
    .name-line { font: 600 8.5px monospace; color: #64748b; margin-top: 8px; }
    .meta-bar { display: flex; justify-content: space-between; background: rgba(255,255,255,0.88); border: 1px solid rgba(15,23,42,0.1); border-radius: 6px; padding: 4px 7px; font: 700 8.5px monospace; }
    .payload { font: 600 7.5px monospace; color: #475569; word-break: break-all; line-height: 1.25; }
    .id-footer { background: #0f172a; color: #fda4af; padding: 6px 10px; font-size: 8.5px; font-weight: 800; display: flex; justify-content: space-between; letter-spacing: 0.03em; }
    .station-card { border: 3px solid #0f172a; border-radius: 14px; padding: 18px; background: #fff; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; break-inside: avoid; page-break-inside: avoid; }
    .station-tag { background: #0f172a; color: #fff; border-radius: 99px; padding: 3px 10px; font: 700 10px monospace; letter-spacing: 0.08em; }
    .station-card h2 { margin: 0; font-size: 20px; text-transform: uppercase; }
    .station-obj { font-size: 12px; font-weight: 800; color: #047857; text-transform: uppercase; }
    .station-qr { border: 2px solid #cbd5e1; border-radius: 12px; padding: 10px; background: #fff; line-height: 0; }
    .station-qr svg { width: 170px; height: 170px; display: block; }
    .station-payload { font: 700 10px monospace; word-break: break-all; color: #1e293b; }
    .station-foot { font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; }
    @media print {
      body { background: #fff; }
      .toolbar { display: none !important; }
      .page { margin: 0; padding: 0; max-width: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div><strong>${escapeHtml(titleText)}</strong> · Enable Background Graphics in Print Dialog</div>
    <button onclick="window.print()">Print / Save PDF</button>
  </div>
  <div class="page">
    <div class="sheet-head">
      <h1>${escapeHtml(titleText)}</h1>
      <p>Room <strong>${escapeHtml(effectiveRoomCode)}</strong> · Unique Match Set <strong>${escapeHtml(matchToken)}</strong></p>
    </div>
    <div class="grid">${cardsHtml}</div>
  </div>
</body>
</html>`;
  };

  /** Print directly using an isolated hidden print iframe (avoids parent layout clipping) with fallback */
  const handlePrintSheet = () => {
    playUiClick();
    try {
      const html = buildStandalonePrintableHtml();
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.setAttribute('aria-hidden', 'true');
      document.body.appendChild(iframe);

      const frameDoc = iframe.contentWindow?.document;
      if (frameDoc && iframe.contentWindow) {
        frameDoc.open();
        frameDoc.write(html);
        frameDoc.close();

        setTimeout(() => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            showStatus(
              'Print dialog sent! If your preview browser blocks printing inside an iframe, click "Save Printable HTML" or "Download PNG Sheet".'
            );
          } catch {
            window.print();
          } finally {
            setTimeout(() => {
              try {
                document.body.removeChild(iframe);
              } catch {
                // ignore
              }
            }, 2500);
          }
        }, 180);
      } else {
        window.print();
      }
    } catch {
      try {
        window.print();
      } catch {
        playErrorFeedback();
        showStatus(
          'Browser blocked direct print dialog — use "Save Printable HTML" or "Download PNG Sheet" instead!'
        );
      }
    }
  };

  /** Download standalone print-ready A4 HTML sheet (works 100% everywhere, even in sandboxed iframes & mobile) */
  const handleDownloadPrintableHtml = () => {
    playUiClick();
    try {
      const html = buildStandalonePrintableHtml();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const suffix = activeTab === 'idcards' ? 'IDCards' : 'Stations';
      triggerBlobDownload(
        blob,
        `CampusAmongUs_${effectiveRoomCode}_${matchToken}_${suffix}.html`
      );
      playTaskSuccessFeedback();
      showStatus(
        'Saved standalone printable HTML sheet! Open it in Chrome/Safari to print or Save as PDF.'
      );
    } catch {
      playErrorFeedback();
      showStatus('Unable to generate printable HTML sheet.');
    }
  };

  /** Download a single ID Card or Station Poster as a crisp high-res PNG */
  const handleDownloadSinglePng = async (itemId: string) => {
    playUiClick();
    const svgEl = sheetRef.current?.querySelector<SVGSVGElement>(
      `svg[data-qr-id="${itemId}"]`
    );
    if (!svgEl) return;

    try {
      const qrImg = await loadSvgAsImage(svgEl);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (activeTab === 'idcards') {
        const card = ID_CARDS.find((c) => c.id === itemId);
        if (!card) return;
        const uniqueQr = buildIdCardQrPayload(
          effectiveRoomCode,
          matchToken,
          card.id
        );
        canvas.width = 760;
        canvas.height = 420;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await renderIdCardOnCanvas(
          ctx,
          card,
          qrImg,
          effectiveRoomCode,
          matchToken,
          uniqueQr,
          20,
          20,
          720,
          380
        );
        canvas.toBlob((blob) => {
          if (!blob) return;
          triggerBlobDownload(
            blob,
            `IDCard_${card.id}_${card.colorName}_${effectiveRoomCode}_${matchToken}.png`
          );
          playTaskSuccessFeedback();
          showStatus(`Downloaded ${card.label} (${card.colorName}) PNG.`);
        }, 'image/png');
      } else {
        const station = stations.find((s) => s.id === itemId);
        if (!station) return;
        const uniqueQr = buildStationQrPayload(
          effectiveRoomCode,
          matchToken,
          station.id
        );
        canvas.width = 680;
        canvas.height = 540;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await renderStationPosterOnCanvas(
          ctx,
          station,
          qrImg,
          effectiveRoomCode,
          matchToken,
          uniqueQr,
          20,
          20,
          640,
          500
        );
        canvas.toBlob((blob) => {
          if (!blob) return;
          triggerBlobDownload(
            blob,
            `Station_${station.id}_${effectiveRoomCode}_${matchToken}.png`
          );
          playTaskSuccessFeedback();
          showStatus(`Downloaded ${station.roomName} QR Poster PNG.`);
        }, 'image/png');
      }
    } catch {
      playErrorFeedback();
      showStatus('Unable to export PNG image.');
    }
  };

  /** Download the entire active tab (all 16 ID Cards or all Stations) as a high-res printable PNG contact sheet */
  const handleDownloadFullSheetPng = async () => {
    if (isExporting) return;
    playUiClick();
    setIsExporting(true);
    try {
      const cols = 2;
      const margin = 36;
      const gap = 24;
      const headerSpace = 92;

      if (activeTab === 'idcards') {
        const cardW = 680;
        const cardH = 365;
        const rows = Math.ceil(ID_CARDS.length / cols);
        const canvas = document.createElement('canvas');
        canvas.width = margin * 2 + cols * cardW + (cols - 1) * gap;
        canvas.height = margin * 2 + headerSpace + rows * cardH + (rows - 1) * gap;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#0f172a';
        ctx.font = '800 28px sans-serif';
        ctx.fillText(
          `CAMPUS AMONG US IRL — PLAYER ID CARDS (ROOM ${effectiveRoomCode} · SET ${matchToken})`,
          margin,
          margin + 32
        );
        ctx.fillStyle = '#475569';
        ctx.font = '600 16px sans-serif';
        ctx.fillText(
          'Cut along dashed borders, punch lanyard hole, and wear visibly. Eliminated players wear Red Headband & finish missions.',
          margin,
          margin + 62
        );

        for (let i = 0; i < ID_CARDS.length; i++) {
          const card = ID_CARDS[i];
          const svgEl = sheetRef.current?.querySelector<SVGSVGElement>(
            `svg[data-qr-id="${card.id}"]`
          );
          if (!svgEl) continue;
          const qrImg = await loadSvgAsImage(svgEl);
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = margin + col * (cardW + gap);
          const y = margin + headerSpace + row * (cardH + gap);
          const uniqueQr = buildIdCardQrPayload(
            effectiveRoomCode,
            matchToken,
            card.id
          );
          await renderIdCardOnCanvas(
            ctx,
            card,
            qrImg,
            effectiveRoomCode,
            matchToken,
            uniqueQr,
            x,
            y,
            cardW,
            cardH
          );
        }

        canvas.toBlob((blob) => {
          if (!blob) return;
          triggerBlobDownload(
            blob,
            `CampusAmongUs_${effectiveRoomCode}_${matchToken}_All_16_IDCards.png`
          );
          playTaskSuccessFeedback();
          showStatus('Downloaded full 16-card high-resolution PNG sheet!');
        }, 'image/png');
      } else {
        const cardW = 640;
        const cardH = 500;
        const rows = Math.ceil(stations.length / cols);
        const canvas = document.createElement('canvas');
        canvas.width = margin * 2 + cols * cardW + (cols - 1) * gap;
        canvas.height = margin * 2 + headerSpace + rows * cardH + (rows - 1) * gap;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#0f172a';
        ctx.font = '800 28px sans-serif';
        ctx.fillText(
          `CAMPUS AMONG US IRL — STATION POSTERS (ROOM ${effectiveRoomCode} · SET ${matchToken})`,
          margin,
          margin + 32
        );
        ctx.fillStyle = '#475569';
        ctx.font = '600 16px sans-serif';
        ctx.fillText(
          'Print and post each QR code visibly outside its corresponding campus room.',
          margin,
          margin + 62
        );

        for (let i = 0; i < stations.length; i++) {
          const station = stations[i];
          const svgEl = sheetRef.current?.querySelector<SVGSVGElement>(
            `svg[data-qr-id="${station.id}"]`
          );
          if (!svgEl) continue;
          const qrImg = await loadSvgAsImage(svgEl);
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = margin + col * (cardW + gap);
          const y = margin + headerSpace + row * (cardH + gap);
          const uniqueQr = buildStationQrPayload(
            effectiveRoomCode,
            matchToken,
            station.id
          );
          await renderStationPosterOnCanvas(
            ctx,
            station,
            qrImg,
            effectiveRoomCode,
            matchToken,
            uniqueQr,
            x,
            y,
            cardW,
            cardH
          );
        }

        canvas.toBlob((blob) => {
          if (!blob) return;
          triggerBlobDownload(
            blob,
            `CampusAmongUs_${effectiveRoomCode}_${matchToken}_All_Stations.png`
          );
          playTaskSuccessFeedback();
          showStatus('Downloaded full Station Posters PNG sheet!');
        }, 'image/png');
      }
    } catch {
      playErrorFeedback();
      showStatus('Unable to generate full PNG sheet.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white text-slate-950">
      {/* Sticky Print Toolbar (hidden during printing) */}
      <div className="print:hidden print-hide sticky top-0 z-30 bg-[#070b17] text-white border-b border-slate-800 px-3 sm:px-5 py-3 shadow-lg">
        <div className="max-w-5xl mx-auto space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  onBack();
                }}
                className="min-h-[40px] px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to App</span>
              </button>

              <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                <span className="text-emerald-300 font-bold">
                  Room {effectiveRoomCode}
                </span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span className="text-cyan-300 font-bold">
                  QR Set {matchToken}
                </span>
              </div>
            </div>

            {/* Segmented Mode Switch */}
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setActiveTab('idcards');
                }}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                  activeTab === 'idcards'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Player ID Cards (16)
              </button>
              <button
                type="button"
                onClick={() => {
                  playUiClick();
                  setActiveTab('stations');
                }}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                  activeTab === 'stations'
                    ? 'bg-cyan-400 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Room Posters ({stations.length})
              </button>
            </div>
          </div>

          {/* Reliable Export & Print Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleGenerateFreshQrs}
                title="Generate brand-new unique QR tokens for a new game in this room"
                className="min-h-[40px] px-3 rounded-xl bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/45 text-amber-200 text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>
                  {rotatedNotice ? 'New QRs Generated' : 'New Game QRs'}
                </span>
              </button>

              {onLockPrintKit && (
                <button
                  type="button"
                  onClick={() => {
                    playUiClick();
                    onLockPrintKit();
                  }}
                  className="min-h-[40px] px-3 rounded-xl bg-slate-900 hover:bg-rose-950/80 border border-slate-800 hover:border-rose-500/40 text-slate-300 hover:text-rose-200 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Lock Kit</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                disabled={isExporting}
                onClick={() => void handleDownloadFullSheetPng()}
                className="min-h-[40px] px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-200 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-all disabled:opacity-50"
              >
                <ImageDown className="w-4 h-4 shrink-0" />
                <span>
                  {isExporting ? 'Rendering PNG...' : 'Download PNG Sheet'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleDownloadPrintableHtml}
                className="min-h-[40px] px-3.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/45 text-cyan-100 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-all"
              >
                <FileDown className="w-4 h-4 shrink-0" />
                <span>Save Printable HTML</span>
              </button>

              <button
                type="button"
                onClick={handlePrintSheet}
                className="min-h-[40px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold flex items-center gap-2 whitespace-nowrap active:scale-95 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)]"
              >
                <Printer className="w-4 h-4 shrink-0" />
                <span>Print Sheet</span>
              </button>
            </div>
          </div>

          {exportStatus && (
            <div className="rounded-xl bg-cyan-950/75 border border-cyan-400/40 px-3 py-2 text-xs text-cyan-100 flex items-center gap-2">
              <Info className="w-4 h-4 text-cyan-300 shrink-0" />
              <span>{exportStatus}</span>
            </div>
          )}
        </div>
      </div>

      {/* Printable A4 Sheet Container */}
      <div
        id="print-kit-sheet"
        ref={sheetRef}
        className="max-w-5xl mx-auto p-4 sm:p-6 print:p-0"
      >
        {activeTab === 'idcards' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-slate-900 pb-2.5 bg-white p-3.5 rounded-xl print:rounded-none print:p-0 print:pb-2">
              <div>
                <h1 className="font-display text-lg font-extrabold tracking-wide uppercase text-slate-950">
                  Campus Among Us IRL — Color-Coded Player ID Cards (P01–P16)
                </h1>
                <p className="text-[11px] text-slate-700 font-medium">
                  Room <strong>{effectiveRoomCode}</strong> · Unique Match Set{' '}
                  <strong>{matchToken}</strong> · Cut along dashed border, punch top lanyard hole, and wear visibly. Enable &ldquo;Background Graphics&rdquo; when printing for full candidate colors.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-700">
                <Scissors className="w-4 h-4" />
                <span>16 Unique ID Cards</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-4 print:gap-3">
              {ID_CARDS.map((card, index) => {
                const uniqueQr = buildIdCardQrPayload(
                  effectiveRoomCode,
                  matchToken,
                  card.id
                );

                return (
                  <div
                    key={card.id}
                    className="relative group rounded-2xl border-2 border-dashed border-slate-400 p-1.5 bg-white break-inside-avoid"
                  >
                    {/* Per-Card Quick PNG Download Button (hidden when printing) */}
                    <button
                      type="button"
                      onClick={() => void handleDownloadSinglePng(card.id)}
                      title={`Save ${card.label} as PNG`}
                      className="print:hidden print-hide absolute -top-2.5 right-3 z-20 px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 text-white text-[10px] font-bold flex items-center gap-1 shadow-md border border-slate-700 transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      <span>Save PNG</span>
                    </button>

                    {/* Candidate-Color Branded Wearable ID Card */}
                    <div
                      className="rounded-xl overflow-hidden border-[3px] flex flex-col justify-between shadow-sm"
                      style={{
                        borderColor: card.colorHex,
                        backgroundColor: `${card.colorHex}22`,
                        WebkitPrintColorAdjust: 'exact',
                        printColorAdjust: 'exact',
                      }}
                    >
                      {/* Top Color Header with Lanyard Punch Slot & Emblem */}
                      <div
                        className="px-3.5 pt-2 pb-2.5 text-white relative"
                        style={{
                          backgroundColor: card.colorHex,
                          WebkitPrintColorAdjust: 'exact',
                          printColorAdjust: 'exact',
                        }}
                      >
                        <div className="w-10 h-2.5 rounded-full bg-white/95 border border-slate-900/40 mx-auto mb-1.5" />

                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-slate-950/30 border border-white/40 flex items-center justify-center shrink-0 text-white">
                              <CandidateEmblem index={index} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[9px] font-mono font-extrabold tracking-widest uppercase text-white/90">
                                CAMPUS AMONG US · ID CARD
                              </div>
                              <div className="font-display text-base font-extrabold tracking-wider uppercase leading-tight truncate drop-shadow-sm">
                                {card.callsign} · {card.colorName}
                              </div>
                            </div>
                          </div>

                          <div className="px-2.5 py-1 rounded-lg bg-slate-950/85 border border-white/40 font-mono text-xl font-extrabold text-white tabular-nums leading-none shrink-0">
                            #{card.number}
                          </div>
                        </div>
                      </div>

                      {/* Middle Body: Candidate-Color Framed QR Code + Quick Identification Details */}
                      <div className="p-3.5 flex items-center gap-3.5">
                        <div
                          className="p-2 rounded-2xl shrink-0 shadow-sm"
                          style={{
                            backgroundColor: card.colorHex,
                            WebkitPrintColorAdjust: 'exact',
                            printColorAdjust: 'exact',
                          }}
                        >
                          <div className="bg-white p-2 rounded-xl border border-slate-900/15">
                            <QRCodeSVG
                              data-qr-id={card.id}
                              value={uniqueQr}
                              size={112}
                              level="H"
                              bgColor="#ffffff"
                              fgColor="#0f172a"
                            />
                          </div>
                        </div>

                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="bg-white/95 rounded-xl border border-slate-900/15 p-2 space-y-1">
                            <div className="flex items-center justify-between text-[10px] font-mono font-extrabold text-slate-500">
                              <span>OPERATIVE ID</span>
                              <span
                                className="px-1.5 py-0.5 rounded text-white text-[9px]"
                                style={{
                                  backgroundColor: card.colorHex,
                                  WebkitPrintColorAdjust: 'exact',
                                  printColorAdjust: 'exact',
                                }}
                              >
                                {card.id}
                              </span>
                            </div>
                            <div className="text-xs font-display font-extrabold text-slate-950 uppercase leading-tight">
                              {card.colorName}
                            </div>
                            <div className="border-b border-dotted border-slate-400 pt-2 text-[9px] font-mono text-slate-400">
                              PLAYER NAME: ____________________
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-1 text-[9px] font-mono font-bold text-slate-800 bg-white/85 rounded-lg px-2 py-1 border border-slate-900/10">
                            <span className="inline-flex items-center gap-1">
                              <BadgeCheck className="w-3 h-3 text-slate-900" />
                              ROOM: {effectiveRoomCode}
                            </span>
                            <span>SET: {matchToken}</span>
                          </div>

                          <div className="text-[8px] font-mono text-slate-600 break-all leading-tight">
                            {uniqueQr}
                          </div>
                        </div>
                      </div>

                      {/* Bottom Reminder Footer Strip */}
                      <div
                        className="px-3.5 py-1.5 text-white flex items-center justify-between gap-2 text-[9px] font-bold uppercase tracking-wide"
                        style={{
                          backgroundColor: '#0f172a',
                          WebkitPrintColorAdjust: 'exact',
                          printColorAdjust: 'exact',
                        }}
                      >
                        <span className="inline-flex items-center gap-1 text-rose-300">
                          <ShieldAlert className="w-3 h-3 shrink-0" />
                          <span>Eliminated? Wear Red Headband &amp; Finish Missions</span>
                        </span>
                        <span className="font-mono text-slate-300 shrink-0">
                          #{card.number}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="border-b-2 border-slate-900 pb-2.5 bg-white p-3.5 rounded-xl print:rounded-none print:p-0 print:pb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="font-display text-lg font-extrabold tracking-wide uppercase text-slate-950">
                  Campus Among Us IRL — Room Station QR Posters ({stations.length} Stations)
                </h1>
                <p className="text-[11px] text-slate-700 font-medium">
                  Room <strong>{effectiveRoomCode}</strong> · Unique Match Set{' '}
                  <strong>{matchToken}</strong> · Print on A4 and tape each poster visibly outside the matching campus room door.
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
                <span>Print Ready</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-5">
              {stations.map((station) => {
                const uniqueStationQr = buildStationQrPayload(
                  effectiveRoomCode,
                  matchToken,
                  station.id
                );

                return (
                  <div
                    key={station.id}
                    className="relative border-4 border-slate-900 rounded-2xl p-6 flex flex-col items-center text-center justify-between gap-4 bg-white break-inside-avoid"
                  >
                    <button
                      type="button"
                      onClick={() => void handleDownloadSinglePng(station.id)}
                      title={`Save ${station.roomName} Poster PNG`}
                      className="print:hidden print-hide absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-[10px] font-bold flex items-center gap-1 transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      <span>PNG</span>
                    </button>

                    <div className="space-y-1.5 w-full">
                      <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-mono font-bold uppercase tracking-widest">
                        <MapPin className="w-3 h-3" />
                        <span>
                          ROOM {effectiveRoomCode} · {station.id}
                        </span>
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
                        data-qr-id={station.id}
                        value={uniqueStationQr}
                        size={180}
                        level="M"
                        bgColor="#ffffff"
                        fgColor="#0f172a"
                      />
                    </div>

                    <div className="space-y-0.5">
                      <div className="text-[11px] font-mono font-bold text-slate-800 break-all">
                        {uniqueStationQr}
                      </div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        GAME SET {matchToken} · SCAN WITH CAMPUS AMONG US IRL
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
