export {
  LuthAuthClient,
  createLuthAuthClient,
  resolveClientOrigin,
  resolveClientEnvironment,
} from '@dinilmusick/gutts';

export type {
  DeploymentEnvironment,
  EmailSignInCredentials,
  EmailSignUpData,
  GoogleSignInOptions,
  LuthAuthClientConfig,
  LuthAuthTokenStore,
  LuthSessionResult,
  RegisterApplicationResult,
  LuthUser,
  LuthSession,
} from '@dinilmusick/gutts';

export { LuthAuthError } from '@dinilmusick/gutts';

export { LuthAuthClient as CanonicalAuthClient } from '@dinilmusick/gutts';
export { createLuthAuthClient as createCanonicalAuthClient } from '@dinilmusick/gutts';
export type { LuthUser as CanonicalAuthUser, LuthSession as CanonicalAuthSession } from '@dinilmusick/gutts';
