/** Catalogued only: no Cloud Run adapter or quota telemetry is claimed. */
import { getProviderService } from '../registry.js';
export const cloudRunService = getProviderService('google-cloud-run')!;
