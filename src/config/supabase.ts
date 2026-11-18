import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type RoomStatus = 'LOBBY' | 'PLAYING' | 'MEETING' | 'ENDED';
export type RoomWinner = 'CREWMATES' | 'IMPOSTORS' | null;
export type SabotageType = 'REACTOR' | 'COMMS' | null;
export type RoleType = 'CREWMATE' | 'IMPOSTOR';

export interface RoomRow {
  room_code: string;
  status: RoomStatus;
  winner: RoomWinner;
  task_progress: number;
  active_sabotage: SabotageType;
  sabotage_ends_at: number | null;
  meeting_ends_at: number | null;
  ejection_result: string | null;
  impostor_count: number;
  meeting_caller_badge_id: string | null;
  meeting_body_badge_id: string | null;
}

export interface PublicPlayerRow {
  id: string;
  room_code: string;
  badge_id: string;
  name: string;
  color: string;
  is_alive: boolean;
  has_voted: boolean;
}

export interface PrivateRoleRow {
  room_code: string;
  badge_id: string;
  wristband_secret: string;
  role: RoleType;
  fellow_impostors: string[];
  assigned_stations: string[];
  completed_stations: string[];
}

export interface VoteRow {
  room_code: string;
  voter_badge_id: string;
  target_badge_id: string;
}

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;
