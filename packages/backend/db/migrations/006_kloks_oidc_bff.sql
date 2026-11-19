-- Canonical Kloks application OAuth 2.1 BFF state.
-- Apply to an isolated Neon branch first, independently verify replay/rollback,
-- then promote through the approved database release gate.
-- This is NOT an OAuth issuer: Better Auth in Luth is the only authorization server.
BEGIN;

CREATE TABLE IF NOT EXISTS public.kloks_oidc_flows (
  state_hash varchar(43) PRIMARY KEY CHECK (state_hash ~ '^[A-Za-z0-9_-]{43}$'),
  app_id varchar(120) NOT NULL REFERENCES public."ultrst-apps"(app_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  verifier_encrypted text NOT NULL CHECK (verifier_encrypted ~ '^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$'),
  redirect_uri text NOT NULL CHECK (length(redirect_uri) BETWEEN 12 AND 2048),
  return_to text NOT NULL CHECK (left(return_to,1)='/' AND left(return_to,2)<>'//'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT kloks_oidc_flow_lifetime CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '10 minutes'
  ),
  CONSTRAINT kloks_oidc_flow_consumption CHECK (
    consumed_at IS NULL OR consumed_at >= created_at
  )
);

CREATE INDEX IF NOT EXISTS kloks_oidc_flows_expiry
  ON public.kloks_oidc_flows (expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.kloks_oidc_sessions (
  session_hash varchar(43) PRIMARY KEY CHECK (session_hash ~ '^[A-Za-z0-9_-]{43}$'),
  session_id uuid NOT NULL UNIQUE,
  app_id varchar(120) NOT NULL REFERENCES public."ultrst-apps"(app_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  principal_id text NOT NULL CHECK (btrim(principal_id) <> ''),
  email text NOT NULL CHECK (btrim(email) <> ''),
  display_name text,
  access_encrypted text NOT NULL CHECK (access_encrypted ~ '^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$'),
  refresh_encrypted text CHECK (refresh_encrypted ~ '^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$'),
  access_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  revoked_at timestamptz,
  CONSTRAINT kloks_oidc_session_lifetime CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '7 days'
  )
);

CREATE INDEX IF NOT EXISTS kloks_oidc_sessions_active
  ON public.kloks_oidc_sessions (app_id, principal_id, expires_at)
  WHERE revoked_at IS NULL;

-- A second app must never read or rewrite another application's sessions.
-- Only the trusted backend database role can access these tables. Browser /
-- Data API / 'authenticated' roles receive no policies or privileges.
ALTER TABLE public.kloks_oidc_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kloks_oidc_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kloks_oidc_flows, public.kloks_oidc_sessions FROM PUBLIC;
-- Neon does not necessarily define Supabase API roles. Only revoke grants
-- for roles that actually exist. The unconditional PUBLIC revoke above is
-- authoritative; this extra defense applies when optional roles are present.
DO $kloks_optional_data_api_roles$
DECLARE role_name text;
BEGIN
  FOR role_name IN
    SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.kloks_oidc_flows, public.kloks_oidc_sessions FROM %I',
      role_name
    );
  END LOOP;
END;
$kloks_optional_data_api_roles$;

-- A callback state is single-use and cannot be un-consumed or rebound.
CREATE OR REPLACE FUNCTION public.kloks_oidc_enforce_flow_immutable()
RETURNS trigger LANGUAGE plpgsql AS $kloks_oidc_flow$
BEGIN
  IF NEW.state_hash IS DISTINCT FROM OLD.state_hash
     OR NEW.app_id IS DISTINCT FROM OLD.app_id
     OR NEW.verifier_encrypted IS DISTINCT FROM OLD.verifier_encrypted
     OR NEW.redirect_uri IS DISTINCT FROM OLD.redirect_uri
     OR NEW.return_to IS DISTINCT FROM OLD.return_to
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN
    RAISE EXCEPTION 'OAuth BFF login state is immutable and single use'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$kloks_oidc_flow$;

DROP TRIGGER IF EXISTS kloks_oidc_flow_immutable ON public.kloks_oidc_flows;
CREATE TRIGGER kloks_oidc_flow_immutable
  BEFORE UPDATE ON public.kloks_oidc_flows
  FOR EACH ROW EXECUTE FUNCTION public.kloks_oidc_enforce_flow_immutable();

-- Principal, application and lifetime cannot be switched after issuance.
-- A revoked session may never be re-enabled.
CREATE OR REPLACE FUNCTION public.kloks_oidc_enforce_session_binding()
RETURNS trigger LANGUAGE plpgsql AS $kloks_oidc_session$
BEGIN
  IF NEW.session_hash IS DISTINCT FROM OLD.session_hash
     OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.app_id IS DISTINCT FROM OLD.app_id
     OR NEW.principal_id IS DISTINCT FROM OLD.principal_id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.revision < OLD.revision
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'OAuth BFF session principal, ownership or revocation is immutable'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$kloks_oidc_session$;

DROP TRIGGER IF EXISTS kloks_oidc_session_binding ON public.kloks_oidc_sessions;
CREATE TRIGGER kloks_oidc_session_binding
  BEFORE UPDATE ON public.kloks_oidc_sessions
  FOR EACH ROW EXECUTE FUNCTION public.kloks_oidc_enforce_session_binding();

REVOKE ALL ON FUNCTION public.kloks_oidc_enforce_flow_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kloks_oidc_enforce_session_binding() FROM PUBLIC;

COMMIT;
