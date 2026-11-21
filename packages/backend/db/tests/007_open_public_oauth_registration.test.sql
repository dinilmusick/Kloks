-- Execute after 006_kloks_oidc_bff.sql and 007_kloks_open_oauth_registration.sql
-- in a disposable PostgreSQL 16 database. Never point at production.
BEGIN;

DO $verify_no_origin_registry$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid IN (
      'public.kloks_oidc_flows'::regclass,
      'public.kloks_oidc_sessions'::regclass
    )
    AND contype='f' AND pg_get_constraintdef(oid) ILIKE '%ultrst-apps%'
  ) THEN RAISE EXCEPTION 'App-catalogue approval prerequisite still exists'; END IF;
  IF NOT (
    SELECT relrowsecurity
    FROM pg_class WHERE oid='public.kloks_oidc_registrations'::regclass
  ) THEN RAISE EXCEPTION 'OAuth registration cache must enforce RLS'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    CROSS JOIN LATERAL aclexplode(
      COALESCE(c.relacl,acldefault('r',c.relowner))
    ) p
    WHERE c.oid='public.kloks_oidc_registrations'::regclass
      AND p.grantee=0 AND p.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
  ) THEN RAISE EXCEPTION 'OAuth registration cache publicly accessible'; END IF;
END;
$verify_no_origin_registry$;

-- This client has NO row in ultrst-apps, luth_auth_origins or any whitelist.
INSERT INTO public.kloks_oidc_registrations(
  app_id, redirect_uri, client_id, encryption_secret
) VALUES(
  'unlisted_desktop_app',
  'https://never-approved.example.test/api/auth/oidc/callback',
  'official-issued-client-identity', repeat('s',64)
);

INSERT INTO public.kloks_oidc_flows (
  state_hash, app_id, verifier_encrypted, redirect_uri,
  return_to, expires_at
) VALUES (
  repeat('A',43), 'unlisted_desktop_app',
  repeat('A',16)||'.'||repeat('B',24),
  'https://never-approved.example.test/api/auth/oidc/callback',
  '/', clock_timestamp()+interval '5 minutes'
);

DO $verify_public_registration$
BEGIN
  IF (SELECT count(*) FROM public.kloks_oidc_registrations
      WHERE app_id='unlisted_desktop_app') <> 1 THEN
    RAISE EXCEPTION 'Unapproved public client was not registered';
  END IF;
  IF (SELECT count(*) FROM public.kloks_oidc_flows
      WHERE app_id='unlisted_desktop_app') <> 1 THEN
    RAISE EXCEPTION 'App catalogue still required before BFF login state';
  END IF;
END;
$verify_public_registration$;

ROLLBACK;
