export {
  LuthAuthClient,
  createLuthAuthClient,
  hydrateLuthTokenFromUrl,
  refreshSession,
  resolveClientOrigin,
  resolveClientEnvironment,
  LuthAuthError,
  DEFAULT_LUTH_URL,
} from '@dinilmusick/gutts/auth';

export type {
  DeploymentEnvironment,
  EmailSignInCredentials,
  EmailSignUpData,
  GoogleSignInOptions,
  LuthAuthClientConfig,
  LuthAuthTokenStore,
  LuthSession,
  LuthUser,
  LuthSessionResult,
  RegisterApplicationResult,
} from '@dinilmusick/gutts/auth';

export {
  LuthAuthClient as CanonicalAuthClient,
  createLuthAuthClient as createCanonicalAuthClient,
} from '@dinilmusick/gutts/auth';
