-- Self-registered OAuth 2.1 BFF clients: NOT a trusted-origin allowlist.
-- Any app issues its own RFC 7591 registration directly to Luth; the
-- backend caches only Luth's returned client_id and its local encryption key.
-- Apply in an isolated Neon branch and independently verify before production.
BEGIN;

CREATE TABLE IF NOT EXISTS public.kloks_oidc_registrations (
  app_id varchar(120) NOT NULL CHECK (app_id ~ '^[a-z0-9][a-z0-9_-]{0,119}$'),
  redirect_uri text NOT NULL CHECK (length(redirect_uri) BETWEEN 15 AND 2048),
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 256),
  encryption_secret text NOT NULL CHECK (length(encryption_secret) >= 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (app_id, redirect_uri),
  UNIQUE (client_id)
);

ALTER TABLE public.kloks_oidc_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kloks_oidc_registrations FROM PUBLIC;

-- App IDs are not an enrollment/authorization registry. Session and flow
-- isolation is provided by exact app_id equality and protected DB access.
-- Existing app metadata tables must NOT be admission prerequisites.
ALTER TABLE public.kloks_oidc_flows
  DROP CONSTRAINT IF EXISTS kloks_oidc_flows_app_id_fkey;
ALTER TABLE public.kloks_oidc_sessions
  DROP CONSTRAINT IF EXISTS kloks_oidc_sessions_app_id_fkey;

DO $kloks_private_client$
DECLARE role_name text;
BEGIN
  FOR role_name IN
    SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.kloks_oidc_registrations FROM %I',
      role_name
    );
  END LOOP;
END;
$kloks_private_client$;

COMMIT;
