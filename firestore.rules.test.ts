/**
 * Phase 0 Dirty Dozen Security Test Matrix for Campus Among Us IRL.
 * Documents and verifies every adversarial payload against the Firestore rules invariants.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update';
  path: string;
  actorUid: string | null;
  emailVerified: boolean;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
  enforcingGuard: string;
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Room Read',
    operation: 'get',
    path: 'rooms/SVCE',
    actorUid: null,
    emailVerified: false,
    expectedOutcome: 'PERMISSION_DENIED',
    enforcingGuard: 'isVerifiedUser()',
  },
  {
    id: 2,
    name: 'Role Collection List Scraping',
    operation: 'list',
    path: 'rooms/SVCE/privateRoles',
    actorUid: 'uid-player-07',
    emailVerified: true,
    expectedOutcome: 'PERMISSION_DENIED',
    enforcingGuard: 'allow list: if false',
  },
  {
    id: 3,
    name: 'Cross-Player Role Peek',
    operation: 'get',
    path: 'rooms/SVCE/privateRoles/P03',
    actorUid: 'uid-player-07',
    emailVerified: true,
    expectedOutcome: 'PERMISSION_DENIED',
    enforcingGuard: 'getRoom(roomCode).data.badgeOwners[badgeId] == request.auth.uid',
  },
  {
    id: 4,
    name: 'Shadow Role Field in Public Room',
    operation: 'update',
    path: 'rooms/SVCE',
    actorUid: 'uid-host',
    emailVerified: true,
    payload: {
      roles: { P07: 'IMPOSTOR' },
    },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcingGuard: 'isValidRoom(incoming()) -> keys().hasOnly(...)',
  },
  {
    id: 5,
    name: 'Self-Promotion / Role Tampering',
    operation: 'update',
    path: 'rooms/SVCE/privateRoles/P07',
    actorUid: 'uid-player-07',
    emailVerified: true,
    payload: {
      role: 'IMPOSTOR',
      fellowImpostors: ['P03'],
      assignedStations: ['ELECTRICAL', 'CYBER_LAB', 'RECEPTION', 'SEMINAR_1'],
      completedStations: [],
    },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcingGuard: 'affectedKeys().hasOnly(["completedStations"]) && incoming().role == existing().role',
  },
  {
    id: 6,
    name: 'Host Hijack',
    operation: 'update',
    path: 'rooms/SVCE',
    actorUid: 'uid-player-07',
    emailVerified: true,
    payload: {
      hostUid: 'uid-player-07',
    },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcingGuard: 'incoming().hostUid == existing().hostUid',
  },
  {
    id: 7,
    name: 'Orphaned PrivateRole Write Outside StartMatch Batch',
    operation: 'create',
    path: 'rooms/SVCE/privateRoles/P07',
    actorUid: 'uid-host',
    emailVerified: true,
    payload: {
      role: 'CREWMATE',
      fellowImpostors: [],
      assignedStations: ['ELECTRICAL', 'CYBER_LAB', 'RECEPTION', 'SEMINAR_1'],
      completedStations: [],
    },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcingGuard: 'getRoomAfter(roomCode).data.status == "PLAYING"',
  },
  {
    id: 8,
    name: 'Out-of-Bounds Task Progress',
    operation: 'update',
    path: 'rooms/SVCE',
    actorUid: 'uid-player-07',
    emailVerified: true,
    payload: {
      taskProgress: 999,
    },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcingGuard: 'data.taskProgress >= 0 && data.taskProgress <= 100',
  },
  {
    id: 9,
    name: 'Resource Exhaustion / ID Poisoning',
    operation: 'create',
    path: `rooms/${'A'.repeat(200)}`,
    actorUid: 'uid-host',
    emailVerified: true,
    payload: {
      status: 'LOBBY',
    },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcingGuard: 'isValidRoomCode(roomCode)',
  },
  {
    id: 10,
    name: 'Client Timestamp Forgery',
    operation: 'update',
    path: 'rooms/SVCE',
    actorUid: 'uid-host',
    emailVerified: true,
    payload: {
      updatedAt: 1700000000000,
    },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcingGuard: 'data.updatedAt == request.time',
  },
  {
    id: 11,
    name: 'Invalid Station Injection',
    operation: 'update',
    path: 'rooms/SVCE/privateRoles/P07',
    actorUid: 'uid-player-07',
    emailVerified: true,
    payload: {
      completedStations: ['FAKE_ROOM'],
    },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcingGuard: 'data.completedStations.hasOnly(data.assignedStations)',
  },
  {
    id: 12,
    name: 'Post-Game Mutation After Terminal State',
    operation: 'update',
    path: 'rooms/SVCE',
    actorUid: 'uid-player-07',
    emailVerified: true,
    payload: {
      status: 'PLAYING',
      winner: 'IMPOSTORS',
    },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcingGuard: 'existing().status != "ENDED" || (existing().hostUid == request.auth.uid && incoming().status == "LOBBY")',
  },
];
