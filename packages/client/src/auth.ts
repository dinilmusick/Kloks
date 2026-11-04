export {
  LuthAuthClient,
  createLuthAuthClient,
  hydrateLuthTokenFromUrl,
  resolveClientOrigin,
  resolveClientEnvironment,
  LuthAuthError,
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
