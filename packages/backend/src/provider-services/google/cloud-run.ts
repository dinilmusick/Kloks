/** Canonical Cloud Run provider entrypoint: real v2 management with separate quota telemetry. */
import { getProviderService } from '../registry.js';
export const cloudRunService = getProviderService('google-cloud-run')!;
export {
  getCloudRunService, createCloudRunService, setCloudRunManualInstances,
  deleteCloudRunService, getCloudRunOperation,
} from './cloud-run-lifecycle.js';
export type { CloudRunScope, CloudRunCreate, CloudRunService, CloudRunOperation }
  from './cloud-run-lifecycle.js';
