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
  host_badge_id: string | null;
  meeting_caller_badge_id: string | null;
  meeting_body_badge_id: string | null;
  print_passcode?: string | null;
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

export type SupabaseConfigStatus =
  | 'configured'
  | 'missing'
  | 'placeholder'
  | 'invalid_url';

function stripSurroundingQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeSupabaseUrl(raw: string): string {
  const cleaned = stripSurroundingQuotes(raw);
  if (!cleaned) return '';

  try {
    const parsed = new URL(cleaned);

    // Handle accidental Supabase Dashboard URL (e.g. https://supabase.com/dashboard/project/<ref>)
    if (
      parsed.hostname === 'supabase.com' ||
      parsed.hostname === 'app.supabase.com'
    ) {
      const match = parsed.pathname.match(/\/project\/([a-z0-9]+)/i);
      if (match?.[1]) {
        return `https://${match[1]}.supabase.co`;
      }
    }

    // Handle accidental /rest/v1, /auth/v1, /storage/v1, or trailing paths on Supabase host
    if (
      parsed.hostname.endsWith('.supabase.co') ||
      parsed.hostname.endsWith('.supabase.in') ||
      /\/rest\/v1/i.test(parsed.pathname)
    ) {
      return parsed.origin;
    }

    // Strip any trailing slash
    return cleaned.replace(/\/+$/, '');
  } catch {
    return cleaned;
  }
}

const rawSupabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
const rawSupabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';

const supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl);
const supabaseAnonKey = stripSurroundingQuotes(rawSupabaseAnonKey);

function detectSupabaseConfigStatus(): SupabaseConfigStatus {
  if (!supabaseUrl || !supabaseAnonKey) {
    return 'missing';
  }
  if (
    supabaseUrl.includes('YOUR_PROJECT_ID') ||
    supabaseAnonKey.includes('YOUR_SUPABASE_ANON_KEY')
  ) {
    return 'placeholder';
  }
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'invalid_url';
    }
  } catch {
    return 'invalid_url';
  }
  return 'configured';
}

export const supabaseConfigStatus: SupabaseConfigStatus =
  detectSupabaseConfigStatus();

export const isSupabaseConfigured = supabaseConfigStatus === 'configured';

export const supabaseResolvedHost = (() => {
  if (!isSupabaseConfigured) return null;
  try {
    return new URL(supabaseUrl).origin;
  } catch {
    return null;
  }
})();

export function isSupabaseRlsError(err: unknown): boolean {
  if (!err) return false;
  const raw =
    typeof err === 'object' && err !== null
      ? (err as {
          code?: string;
          message?: string;
          details?: string;
          hint?: string;
          status?: number;
        })
      : { message: String(err) };

  const text = `${raw.code || ''} ${raw.message || ''} ${raw.details || ''} ${
    raw.hint || ''
  }`.toLowerCase();

  return (
    raw.code === '42501' ||
    raw.status === 401 ||
    raw.status === 403 ||
    text.includes('row-level security') ||
    text.includes('permission denied') ||
    text.includes('insufficient_privilege') ||
    text.includes('rls') ||
    text.includes('unauthorized') ||
    text.includes('not allowed')
  );
}

export const supabaseLogger = {
  init(detail: Record<string, unknown>) {
    console.log('[Supabase:Init]', {
      ts: new Date().toISOString(),
      ...detail,
    });
  },
  auth(event: string, detail: Record<string, unknown>) {
    console.log('[Supabase:Auth]', {
      ts: new Date().toISOString(),
      event,
      ...detail,
    });
  },
  tableError(table: string, operation: string, error: unknown): string {
    const raw =
      typeof error === 'object' && error !== null
        ? (error as {
            code?: string;
            message?: string;
            details?: string;
            hint?: string;
            status?: number;
          })
        : { message: String(error) };

    const isRlsBlocked = isSupabaseRlsError(error);
    const formatted = formatSupabaseError(error);

    console.log('[Supabase:TableError]', {
      ts: new Date().toISOString(),
      table,
      operation,
      code: raw.code || null,
      status: raw.status || null,
      message: raw.message || String(error),
      details: raw.details || null,
      hint: raw.hint || null,
      isRlsBlocked,
      diagnosis: isRlsBlocked
        ? 'RLS policy or table GRANT blocked anon/authenticated access.'
        : formatted,
    });

    return formatted;
  },
  realtimeEvent(
    channel: string,
    status: string,
    error?: unknown,
    extra?: Record<string, unknown>
  ) {
    const isRlsBlocked = isSupabaseRlsError(error) || isSupabaseRlsError(extra);
    const errMsg =
      error instanceof Error
        ? error.message
        : error
        ? formatSupabaseError(error)
        : null;

    console.log('[Supabase:Realtime]', {
      ts: new Date().toISOString(),
      channel,
      status,
      error: errMsg,
      isRlsBlocked,
      ...(isRlsBlocked
        ? {
            rlsDiagnosis:
              'Realtime postgres_changes failed due to RLS SELECT policy or missing supabase_realtime publication.',
          }
        : {}),
      ...extra,
    });
  },
};

export const logSupabaseTableError = supabaseLogger.tableError;
export const logSupabaseRealtimeError = supabaseLogger.realtimeEvent;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
        logger: (kind: string, msg: string, data?: unknown) => {
          const isErrorLike =
            kind === 'error' ||
            kind === 'warn' ||
            /error|fail|rls|denied|unauthoriz|reject|timeout|close/i.test(
              `${kind} ${msg} ${JSON.stringify(data || '')}`
            );
          if (isErrorLike) {
            console.log('[Supabase:RealtimeSDK]', {
              ts: new Date().toISOString(),
              kind,
              msg,
              data,
              isRlsBlocked: isSupabaseRlsError({ message: msg, details: JSON.stringify(data || '') }),
            });
          }
        },
      },
    })
  : null;

// Dedicated initialization tracking for config, auth session state, and RLS visibility
supabaseLogger.init({
  configStatus: supabaseConfigStatus,
  configured: isSupabaseConfigured,
  host: supabaseResolvedHost,
});

if (supabase) {
  void supabase.auth
    .getSession()
    .then(({ data, error }) => {
      if (error) {
        console.log('[Supabase:AuthError]', {
          ts: new Date().toISOString(),
          operation: 'getSession',
          message: error.message,
          status: error.status,
          isRlsBlocked: isSupabaseRlsError(error),
        });
        return;
      }
      supabaseLogger.auth('INITIAL_SESSION', {
        hasSession: Boolean(data.session),
        role: data.session?.user?.role || 'anon',
        userId: data.session?.user?.id || null,
        expiresAt: data.session?.expires_at || null,
      });
    })
    .catch((err) => {
      console.log('[Supabase:AuthError]', {
        ts: new Date().toISOString(),
        operation: 'getSession',
        error: String(err),
      });
    });

  supabase.auth.onAuthStateChange((event, session) => {
    supabaseLogger.auth(event, {
      hasSession: Boolean(session),
      role: session?.user?.role || 'anon',
      userId: session?.user?.id || null,
      expiresAt: session?.expires_at || null,
    });
  });
}

export function formatSupabaseError(err: unknown): string {
  if (!err) return 'Unknown Supabase error.';

  const raw =
    typeof err === 'object' && err !== null
      ? (err as {
          code?: string;
          message?: string;
          details?: string;
          hint?: string;
          status?: number;
        })
      : { message: String(err) };

  const msg = raw.message || String(err);
  const code = raw.code || '';
  const combined = `${code} ${msg} ${raw.details || ''} ${raw.hint || ''}`.toLowerCase();

  if (
    code === 'PGRST125' ||
    combined.includes('invalid path specified in request url')
  ) {
    return 'Invalid VITE_SUPABASE_URL path (PGRST125). Use ONLY the root Project URL (https://YOUR_PROJECT_REF.supabase.co) with no "/rest/v1" or extra path.';
  }

  if (
    code === '42P01' ||
    code === 'PGRST205' ||
    combined.includes('does not exist') ||
    combined.includes('could not find the table')
  ) {
    return 'Supabase tables missing (rooms / public_players / private_roles). Run the SQL schema in Developer Studio or use Local Mode.';
  }

  if (
    code === '42703' ||
    code === 'PGRST204' ||
    combined.includes('could not find the') ||
    combined.includes('column')
  ) {
    return `Supabase schema mismatch (${msg}). Re-run the latest SQL schema in Supabase SQL Editor.`;
  }

  if (
    code === '42P10' ||
    combined.includes('no unique or exclusion constraint')
  ) {
    return 'Supabase table is missing a UNIQUE/PRIMARY KEY constraint (room_code / badge_id). Re-run the SQL schema.';
  }

  if (
    code === '42501' ||
    combined.includes('row-level security') ||
    combined.includes('permission denied')
  ) {
    return 'Supabase Row-Level Security (RLS) blocked the request. Enable anon policies from the SQL schema.';
  }

  if (
    raw.status === 401 ||
    raw.status === 403 ||
    combined.includes('invalid api key') ||
    combined.includes('jwt')
  ) {
    return 'Invalid VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_URL. Verify your Supabase Project API keys.';
  }

  if (
    combined.includes('failed to fetch') ||
    combined.includes('networkerror') ||
    combined.includes('err_name_not_resolved')
  ) {
    return 'Cannot reach Supabase URL. Check VITE_SUPABASE_URL and your internet connection.';
  }

  return code ? `${msg} (${code})` : msg;
}

export const SUPABASE_SCHEMA_SQL = `-- Campus Among Us IRL — Supabase Schema + Realtime + RLS
CREATE TABLE IF NOT EXISTS public.rooms (
  room_code TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'LOBBY',
  winner TEXT,
  task_progress INTEGER NOT NULL DEFAULT 0,
  active_sabotage TEXT,
  sabotage_ends_at BIGINT,
  meeting_ends_at BIGINT,
  ejection_result TEXT,
  impostor_count INTEGER NOT NULL DEFAULT 1,
  host_badge_id TEXT,
  meeting_caller_badge_id TEXT,
  meeting_body_badge_id TEXT,
  print_passcode TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.public_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL REFERENCES public.rooms(room_code) ON DELETE CASCADE,
  badge_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  is_alive BOOLEAN NOT NULL DEFAULT TRUE,
  has_voted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (room_code, badge_id)
);

CREATE TABLE IF NOT EXISTS public.private_roles (
  room_code TEXT NOT NULL REFERENCES public.rooms(room_code) ON DELETE CASCADE,
  badge_id TEXT NOT NULL,
  wristband_secret TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CREWMATE',
  fellow_impostors JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_stations JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_stations JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (room_code, badge_id)
);

CREATE TABLE IF NOT EXISTS public.votes (
  room_code TEXT NOT NULL REFERENCES public.rooms(room_code) ON DELETE CASCADE,
  voter_badge_id TEXT NOT NULL,
  target_badge_id TEXT NOT NULL,
  PRIMARY KEY (room_code, voter_badge_id)
);

-- Upgrade existing tables if they were created with an earlier schema
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS winner TEXT,
  ADD COLUMN IF NOT EXISTS task_progress INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_sabotage TEXT,
  ADD COLUMN IF NOT EXISTS sabotage_ends_at BIGINT,
  ADD COLUMN IF NOT EXISTS meeting_ends_at BIGINT,
  ADD COLUMN IF NOT EXISTS ejection_result TEXT,
  ADD COLUMN IF NOT EXISTS impostor_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS host_badge_id TEXT,
  ADD COLUMN IF NOT EXISTS meeting_caller_badge_id TEXT,
  ADD COLUMN IF NOT EXISTS meeting_body_badge_id TEXT,
  ADD COLUMN IF NOT EXISTS print_passcode TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.public_players
  ADD COLUMN IF NOT EXISTS is_alive BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS has_voted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.private_roles
  ADD COLUMN IF NOT EXISTS fellow_impostors JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assigned_stations JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS completed_stations JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Ensure full row payloads for Realtime
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.public_players REPLICA IDENTITY FULL;
ALTER TABLE public.private_roles REPLICA IDENTITY FULL;
ALTER TABLE public.votes REPLICA IDENTITY FULL;

-- Enable RLS with open anon policies for live campus play
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campus_rooms_all" ON public.rooms;
CREATE POLICY "campus_rooms_all" ON public.rooms FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "campus_players_all" ON public.public_players;
CREATE POLICY "campus_players_all" ON public.public_players FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "campus_roles_all" ON public.private_roles;
CREATE POLICY "campus_roles_all" ON public.private_roles FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "campus_votes_all" ON public.votes;
CREATE POLICY "campus_votes_all" ON public.votes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Enable Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'rooms') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'public_players') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.public_players;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'private_roles') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.private_roles;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'votes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.votes;
  END IF;
END $$;

-- Refresh PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';`;
