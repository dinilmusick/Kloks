/** Catalogued only: does not imply a GCS API or OAuth scope is available. */
import { getProviderService } from '../registry.js';
export const cloudStorageService = getProviderService('google-cloud-storage')!;
