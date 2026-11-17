/** Catalogued only: model inference adapter and quotas are not implemented. */
import { getProviderService } from '../registry.js';
export const vertexAiService = getProviderService('google-vertex-ai')!;
