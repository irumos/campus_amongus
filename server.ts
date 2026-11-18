import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import type {
  Player,
  RoomState,
} from './src/shared/gameData.ts';
import {
  TASK_STATIONS,
  WRISTBAND_BADGES,
  computeTaskProgress,
} from './src/shared/gameData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const KILL_COOLDOWN_MS = 30_000;
const SABOTAGE_DURATION_MS = 45_000;
const MEETING_DURATION_MS = 60_000;

const rooms = new Map<string, RoomState>();
const clientsBySocket = new Map<WebSocket, { roomCode: string; playerId: string }>();

function normalizeRoomCode(code?: string): string {
  const cleaned = (code || 'SVCE').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  return cleaned || 'SVCE';
}

function getOrCreateRoom(code: string): RoomState {
  const roomCode = normalizeRoomCode(code);
  let room = rooms.get(roomCode);
  if (!room) {
    room = {
      roomCode,
      phase: 'lobby',
      impostorCount: 1,
      players: [],
      sabotage: null,
      meeting: null,
      winner: null,
      winReason: null,
      killCooldownEndByPlayer: {},
      updatedAt: Date.now(),
    };
    rooms.set(roomCode, room);
  }
  return room;
}

function broadcastRoom(roomCode: string) {
  const room = rooms.get(roomCode);
  if (!room) return;
  room.updatedAt = Date.now();
  const payload = JSON.stringify({ type: 'room_state', room });
  for (const [ws, meta] of clientsBySocket.entries()) {
    if (meta.roomCode === roomCode && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function checkWinConditions(room: RoomState) {
  if (room.phase !== 'gameplay' && room.phase !== 'meeting') return;

  const taskProgress = computeTaskProgress(room.players);
  if (taskProgress >= 100 && room.players.some((p) => p.role === 'crewmate')) {
    room.phase = 'ended';
    room.winner = 'crewmates';
    room.winReason = 'All Campus Tasks Completed (100%)';
    room.sabotage = null;
    return;
  }

  const livingImpostors = room.players.filter(
    (p) => p.role === 'impostor' && p.status === 'alive'
  ).length;
  const livingCrewmates = room.players.filter(
    (p) => p.role === 'crewmate' && p.status === 'alive'
  ).length;

  if (livingImpostors === 0 && room.players.length >= 2) {
    room.phase = 'ended';
    room.winner = 'crewmates';
    room.winReason = 'All Impostors Were Ejected';
    room.sabotage = null;
    return;
  }

  if (livingImpostors > 0 && livingImpostors >= livingCrewmates && room.players.length >= 3) {
    room.phase = 'ended';
    room.winner = 'impostors';
    room.winReason = 'Impostors Outnumber Crewmates';
    room.sabotage = null;
  }
}

function tallyMeetingVotes(room: RoomState) {
  if (!room.meeting || room.meeting.ejectionResult) return;

  const tally = new Map<string, number>();
  for (const target of Object.values(room.meeting.votes)) {
    tally.set(target, (tally.get(target) || 0) + 1);
  }

  let topTarget: string | null = null;
  let topCount = 0;
  let isTie = false;

  for (const [target, count] of tally.entries()) {
    if (count > topCount) {
      topTarget = target;
      topCount = count;
      isTie = false;
    } else if (count === topCount && count > 0) {
      isTie = true;
    }
  }

  if (!topTarget || topTarget === 'skip' || isTie) {
    room.meeting.ejectionResult = {
      ejectedPlayerId: null,
      ejectedBadgeNumber: null,
      ejectedName: null,
      message: isTie
        ? 'Vote tied. No one was ejected.'
        : 'Skipped vote. No one was ejected.',
      timestamp: Date.now(),
    };
  } else {
    const ejected = room.players.find((p) => p.id === topTarget);
    if (ejected) {
      ejected.status = 'eliminated';
      room.meeting.ejectionResult = {
        ejectedPlayerId: ejected.id,
        ejectedBadgeNumber: ejected.badgeNumber,
        ejectedName: ejected.name,
        message: `Player #${ejected.badgeNumber} (${ejected.name}) was ejected. Confirm Ejects: OFF — Role Remains Unknown.`,
        timestamp: Date.now(),
      };
    }
  }

  checkWinConditions(room);
}

const DEMO_NAMES = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ananya'];

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          ts?: number;
          roomCode?: string;
          playerId?: string;
          name?: string;
          badgeNumber?: string;
          impostorCount?: 1 | 2;
          stationId?: string;
          targetBadgeNumber?: string;
          deadBadgeNumber?: string;
          targetPlayerId?: string;
          sabotageType?: 'reactor';
          cachedRoom?: RoomState;
          cachedPlayer?: Player;
        };

        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
          return;
        }

        const roomCode = normalizeRoomCode(msg.roomCode);
        const room = getOrCreateRoom(roomCode);

        switch (msg.type) {
          case 'subscribe': {
            if (msg.playerId) {
              clientsBySocket.set(ws, { roomCode, playerId: msg.playerId });
            }
            ws.send(JSON.stringify({ type: 'room_state', room }));
            break;
          }

          case 'rehydrate_room': {
            if (msg.playerId) {
              clientsBySocket.set(ws, { roomCode, playerId: msg.playerId });
            }
            // If server room is empty (e.g. server restarted) and client has a cached snapshot for this roomCode, restore it
            if (
              room.players.length === 0 &&
              msg.cachedRoom &&
              normalizeRoomCode(msg.cachedRoom.roomCode) === roomCode &&
              Array.isArray(msg.cachedRoom.players) &&
              msg.cachedRoom.players.length > 0
            ) {
              rooms.set(roomCode, {
                ...msg.cachedRoom,
                roomCode,
                updatedAt: Date.now(),
              });
              broadcastRoom(roomCode);
              break;
            }

            // If room exists on server and player is missing (e.g. partial state), re-attach cachedPlayer
            if (
              msg.cachedPlayer &&
              msg.cachedPlayer.id &&
              !room.players.some((p) => p.id === msg.cachedPlayer?.id)
            ) {
              room.players.push({
                ...msg.cachedPlayer,
                isHost: room.players.length === 0,
              });
              broadcastRoom(roomCode);
              break;
            }

            ws.send(JSON.stringify({ type: 'room_state', room }));
            break;
          }

          case 'join_room': {
            const playerId = msg.playerId || `p_${Date.now()}`;
            const badgeNumber = (msg.badgeNumber || '07').padStart(2, '0');
            const name = (msg.name || 'Student').trim().slice(0, 20) || 'Student';

            clientsBySocket.set(ws, { roomCode, playerId });

            const existing = room.players.find((p) => p.id === playerId);
            if (existing) {
              existing.name = name;
              existing.badgeNumber = badgeNumber;
            } else {
              // Remove any bot holding the requested badge
              room.players = room.players.filter(
                (p) => !(p.isBot && p.badgeNumber === badgeNumber)
              );

              const newPlayer: Player = {
                id: playerId,
                name,
                badgeNumber,
                role: 'crewmate',
                status: 'alive',
                completedTaskIds: [],
                isHost: room.players.length === 0,
                joinedAt: Date.now(),
              };
              room.players.push(newPlayer);
            }
            broadcastRoom(roomCode);
            break;
          }

          case 'seed_demo_players': {
            const usedBadges = new Set(room.players.map((p) => p.badgeNumber));
            const availableBadges = WRISTBAND_BADGES.filter(
              (b) => !usedBadges.has(b.number)
            );
            let added = 0;
            for (const demoName of DEMO_NAMES) {
              if (room.players.length >= 7 || added >= availableBadges.length) break;
              const badge = availableBadges[added];
              room.players.push({
                id: `bot_${badge.number}`,
                name: demoName,
                badgeNumber: badge.number,
                role: 'crewmate',
                status: 'alive',
                completedTaskIds: [],
                isHost: false,
                isBot: true,
                joinedAt: Date.now() + added,
              });
              added++;
            }
            broadcastRoom(roomCode);
            break;
          }

          case 'set_impostor_count': {
            room.impostorCount = msg.impostorCount === 2 ? 2 : 1;
            broadcastRoom(roomCode);
            break;
          }

          case 'start_match': {
            if (room.players.length === 0) break;
            const shuffled = [...room.players].sort(() => Math.random() - 0.5);
            const impLimit =
              room.players.length >= 5 && room.impostorCount === 2 ? 2 : 1;
            const impostorIds = new Set(
              shuffled.slice(0, impLimit).map((p) => p.id)
            );

            room.players = room.players.map((p) => ({
              ...p,
              role: impostorIds.has(p.id) ? 'impostor' : 'crewmate',
              status: 'alive',
              completedTaskIds: [],
            }));

            room.phase = 'gameplay';
            room.sabotage = null;
            room.meeting = null;
            room.winner = null;
            room.winReason = null;
            room.killCooldownEndByPlayer = {};
            for (const impId of impostorIds) {
              room.killCooldownEndByPlayer[impId] = Date.now() + KILL_COOLDOWN_MS;
            }
            broadcastRoom(roomCode);
            break;
          }

          case 'complete_task': {
            const player = room.players.find((p) => p.id === msg.playerId);
            const stationId = msg.stationId;
            if (!player || !stationId) break;

            // If Reactor Meltdown is active and Cyber Lab QR is scanned, defuse sabotage!
            if (
              room.sabotage &&
              room.sabotage.targetStationId === stationId &&
              player.status === 'alive'
            ) {
              room.sabotage = null;
            }

            if (
              player.role === 'crewmate' &&
              TASK_STATIONS.some((s) => s.id === stationId) &&
              !player.completedTaskIds.includes(stationId)
            ) {
              player.completedTaskIds.push(stationId);
              checkWinConditions(room);
            }
            broadcastRoom(roomCode);
            break;
          }

          case 'defuse_sabotage': {
            room.sabotage = null;
            broadcastRoom(roomCode);
            break;
          }

          case 'trigger_sabotage': {
            if (!room.sabotage) {
              room.sabotage = {
                type: 'reactor',
                label: 'REACTOR MELTDOWN — 45s TO SCAN CYBER LAB QR',
                targetStationId: 'CYBER_LAB',
                triggeredAt: Date.now(),
                expiresAt: Date.now() + SABOTAGE_DURATION_MS,
              };
            }
            broadcastRoom(roomCode);
            break;
          }

          case 'eliminate_player': {
            const killer = room.players.find((p) => p.id === msg.playerId);
            const target = room.players.find(
              (p) => p.badgeNumber === msg.targetBadgeNumber && p.status === 'alive'
            );
            if (!killer || !target || killer.id === target.id) break;

            target.status = 'eliminated';
            room.killCooldownEndByPlayer[killer.id] = Date.now() + KILL_COOLDOWN_MS;
            checkWinConditions(room);
            broadcastRoom(roomCode);
            break;
          }

          case 'call_meeting': {
            const caller = room.players.find((p) => p.id === msg.playerId);
            const deadBody = msg.deadBadgeNumber
              ? room.players.find((p) => p.badgeNumber === msg.deadBadgeNumber)
              : undefined;

            if (deadBody && deadBody.status === 'eliminated') {
              deadBody.status = 'ghost';
            }

            room.phase = 'meeting';
            room.sabotage = null;
            room.meeting = {
              reason: deadBody
                ? `Dead Body Reported (#${deadBody.badgeNumber} ${deadBody.name})`
                : 'Emergency Meeting Called',
              calledByBadge: caller?.badgeNumber || '01',
              calledByName: caller?.name || 'Host',
              endsAt: Date.now() + MEETING_DURATION_MS,
              votes: {},
              ejectionResult: null,
            };

            // Bots cast quick skip/random votes if any bots exist
            for (const p of room.players) {
              if (p.isBot && p.status === 'alive') {
                room.meeting.votes[p.id] = 'skip';
              }
            }
            broadcastRoom(roomCode);
            break;
          }

          case 'cast_vote': {
            if (!room.meeting || room.meeting.ejectionResult) break;
            const voter = room.players.find((p) => p.id === msg.playerId);
            if (!voter || voter.status !== 'alive') break;
            room.meeting.votes[voter.id] = msg.targetPlayerId || 'skip';

            const livingVoters = room.players.filter((p) => p.status === 'alive');
            const allVoted = livingVoters.every((p) => Boolean(room.meeting?.votes[p.id]));
            if (allVoted && livingVoters.length > 0) {
              tallyMeetingVotes(room);
            }
            broadcastRoom(roomCode);
            break;
          }

          case 'finalize_meeting': {
            if (room.meeting && !room.meeting.ejectionResult) {
              tallyMeetingVotes(room);
              broadcastRoom(roomCode);
            }
            break;
          }

          case 'dismiss_ejection': {
            if (room.phase === 'meeting') {
              room.meeting = null;
              if (room.winner) {
                room.phase = 'ended';
              } else {
                room.phase = 'gameplay';
                for (const p of room.players) {
                  if (p.role === 'impostor' && p.status === 'alive') {
                    room.killCooldownEndByPlayer[p.id] = Date.now() + 15_000;
                  }
                }
              }
              broadcastRoom(roomCode);
            }
            break;
          }

          case 'enter_ghost_mode': {
            const player = room.players.find((p) => p.id === msg.playerId);
            if (player && player.status === 'eliminated') {
              player.status = 'ghost';
              broadcastRoom(roomCode);
            }
            break;
          }

          case 'reset_room': {
            room.phase = 'lobby';
            room.sabotage = null;
            room.meeting = null;
            room.winner = null;
            room.winReason = null;
            room.killCooldownEndByPlayer = {};
            room.players = room.players.map((p) => ({
              ...p,
              role: 'crewmate',
              status: 'alive',
              completedTaskIds: [],
            }));
            broadcastRoom(roomCode);
            break;
          }
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      clientsBySocket.delete(ws);
    });
  });

  // Authoritative server timer loop for Sabotage & Meeting countdowns
  setInterval(() => {
    const now = Date.now();
    for (const [roomCode, room] of rooms.entries()) {
      let changed = false;

      if (room.phase === 'gameplay' && room.sabotage && now >= room.sabotage.expiresAt) {
        room.sabotage = null;
        room.phase = 'ended';
        room.winner = 'impostors';
        room.winReason = 'Reactor Meltdown Not Defused in Time';
        changed = true;
      }

      if (
        room.phase === 'meeting' &&
        room.meeting &&
        !room.meeting.ejectionResult &&
        now >= room.meeting.endsAt
      ) {
        tallyMeetingVotes(room);
        changed = true;
      }

      if (changed) {
        broadcastRoom(roomCode);
      }
    }
  }, 1000);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Campus Among Us IRL running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
