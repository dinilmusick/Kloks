/** Catalogued only: Cloud Shell is not a general unattended execution backend. */
import { getProviderService } from '../registry.js';
export const cloudShellService = getProviderService('google-cloud-shell')!;
