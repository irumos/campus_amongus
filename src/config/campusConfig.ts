export type CampusMiniGameType =
  | 'WIRING'
  | 'MANIFOLD'
  | 'SWIPE'
  | 'SHIELDS'
  | 'SIMON_SAYS'
  | 'FREQUENCY_TUNE'
  | 'ASTEROID_DEFENSE'
  | 'BIOMETRIC_HOLD'
  | 'DATA_TRANSFER';

export type CampusTaskCategory = 'SHORT_TASK' | 'LONG_TASK';

export interface CampusWristbandConfig {
  id: string;
  number: string;
  label: string;
  colorName: string;
  colorHex: string;
  qrPayload: string;
}

export interface CampusTaskStationConfig {
  id: string;
  roomName: string;
  taskTitle: string;
  miniGame: CampusMiniGameType;
  taskCategory: CampusTaskCategory;
  relayStage?: 1 | 2;
  relayPartnerId?: string;
  qrPayload: string;
}

const WRISTBAND_PALETTE: { colorName: string; colorHex: string }[] = [
  { colorName: 'Electric Cyan', colorHex: '#06b6d4' },
  { colorName: 'Cobalt Blue', colorHex: '#3b82f6' },
  { colorName: 'Neon Emerald', colorHex: '#10b981' },
  { colorName: 'High-Voltage Amber', colorHex: '#f59e0b' },
  { colorName: 'Phantom Violet', colorHex: '#8b5cf6' },
  { colorName: 'Coral Rose', colorHex: '#f43f5e' },
  { colorName: 'Crimson Laser', colorHex: '#ef4444' },
  { colorName: 'Acid Lime', colorHex: '#84cc16' },
  { colorName: 'Solar Orange', colorHex: '#f97316' },
  { colorName: 'Deep Indigo', colorHex: '#6366f1' },
  { colorName: 'Cyber Teal', colorHex: '#14b8a6' },
  { colorName: 'Hyper Pink', colorHex: '#ec4899' },
  { colorName: 'Sky Pulse', colorHex: '#0ea5e9' },
  { colorName: 'Fuchsia Glow', colorHex: '#d946ef' },
  { colorName: 'Gold Volt', colorHex: '#eab308' },
  { colorName: 'Mint Frost', colorHex: '#34d399' },
];

export const WRISTBANDS: CampusWristbandConfig[] = WRISTBAND_PALETTE.map(
  (palette, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    const id = `P${num}`;
    return {
      id,
      number: num,
      label: `Badge #${num}`,
      colorName: palette.colorName,
      colorHex: palette.colorHex,
      qrPayload: `CAMPUS_AU:WRISTBAND:${id}`,
    };
  }
);

export const TASK_STATIONS: CampusTaskStationConfig[] = [
  {
    id: 'ELECTRICAL',
    roomName: 'Ground Floor • Electrical',
    taskTitle: 'Connect Power Conduits',
    miniGame: 'WIRING',
    taskCategory: 'SHORT_TASK',
    qrPayload: 'CAMPUS_AU:STATION:ELECTRICAL',
  },
  {
    id: 'CYBER_LAB',
    roomName: '2nd Floor • Cyber Lab',
    taskTitle: 'Reactor Memory Sequence',
    miniGame: 'SIMON_SAYS',
    taskCategory: 'SHORT_TASK',
    qrPayload: 'CAMPUS_AU:STATION:CYBER_LAB',
  },
  {
    id: 'RECEPTION',
    roomName: 'Main Lobby • Reception',
    taskTitle: 'Verify Student ID Swipe',
    miniGame: 'SWIPE',
    taskCategory: 'SHORT_TASK',
    qrPayload: 'CAMPUS_AU:STATION:RECEPTION',
  },
  {
    id: 'SEMINAR_1',
    roomName: '1st Floor • Seminar Hall 1',
    taskTitle: 'Calibrate Firewall Nodes',
    miniGame: 'SHIELDS',
    taskCategory: 'SHORT_TASK',
    qrPayload: 'CAMPUS_AU:STATION:SEMINAR_1',
  },
  {
    id: 'COURTYARD',
    roomName: 'Open Quad • Courtyard Gazebo',
    taskTitle: 'Calibrate Comms Antenna',
    miniGame: 'FREQUENCY_TUNE',
    taskCategory: 'SHORT_TASK',
    qrPayload: 'CAMPUS_AU:STATION:COURTYARD',
  },
  {
    id: 'CENTRAL_LIBRARY',
    roomName: '1st Floor • Central Library',
    taskTitle: 'Download Campus Logs',
    miniGame: 'DATA_TRANSFER',
    taskCategory: 'LONG_TASK',
    relayStage: 1,
    relayPartnerId: 'SERVER_ROOM',
    qrPayload: 'CAMPUS_AU:STATION:CENTRAL_LIBRARY',
  },
  {
    id: 'PHYSICS_LAB',
    roomName: '2nd Floor • Physics Lab',
    taskTitle: 'Verify Lab Access',
    miniGame: 'BIOMETRIC_HOLD',
    taskCategory: 'SHORT_TASK',
    qrPayload: 'CAMPUS_AU:STATION:PHYSICS_LAB',
  },
  {
    id: 'CANTEEN_QUAD',
    roomName: 'Ground Floor • Canteen Quad',
    taskTitle: 'Clear Campus Firewall',
    miniGame: 'ASTEROID_DEFENSE',
    taskCategory: 'SHORT_TASK',
    qrPayload: 'CAMPUS_AU:STATION:CANTEEN_QUAD',
  },
  {
    id: 'SERVER_ROOM',
    roomName: 'Basement • Server Room',
    taskTitle: 'Upload Logs to Server',
    miniGame: 'DATA_TRANSFER',
    taskCategory: 'LONG_TASK',
    relayStage: 2,
    relayPartnerId: 'CENTRAL_LIBRARY',
    qrPayload: 'CAMPUS_AU:STATION:SERVER_ROOM',
  },
  {
    id: 'MAIN_STAIRWELL',
    roomName: '3rd Floor • Main Stairwell',
    taskTitle: 'Unlock Security Manifold',
    miniGame: 'MANIFOLD',
    taskCategory: 'SHORT_TASK',
    qrPayload: 'CAMPUS_AU:STATION:MAIN_STAIRWELL',
  },
];
