import type { DeploymentEnvironment } from '@dinilmusick/gutts/auth';

export {
  LuthAuthClient,
  createLuthAuthClient,
  hydrateLuthTokenFromUrl,
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

export interface LuthDeploymentRecord {
  id: string;
  url: string;
  label?: string;
  environment?: DeploymentEnvironment;
  isActive: boolean;
  isPrimary?: boolean;
  priority?: number;
}

export {
  LuthAuthClient as CanonicalAuthClient,
  createLuthAuthClient as createCanonicalAuthClient,
} from '@dinilmusick/gutts/auth';

export {
  CANONICAL_PUBLIC_ROUTES,
  extractLuthToken,
  isPublicRoute,
  verifyLuthRequest,
} from './UniversalLuthGuard.js';
export type { LuthPrincipal } from './UniversalLuthGuard.js';

