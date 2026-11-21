/** Node-only KrnlTS facades. Portable imports must never instantiate services. */
export * from './facades.js';
export * from './storage-facades.js';
export * from './storage-node.js';

// Server-only encrypted provider account lifecycle; no browser token access.
export {
  saveVerifiedProviderAccount, listSavedProviderAccounts,
  readSavedProviderAccount, revokeSavedProviderAccount,
} from './saved-account-store.js';
export type {
  PublicSavedProviderAccount, ProviderAccountQuery,
} from './saved-account-store.js';
