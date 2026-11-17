/** Google is a suite. Child services have independent credentials and entrypoints. */
import { getProviderService, listProviderServiceChildren } from '../registry.js';
export { getGoogleAccountProfile } from '../operations.js';
export const getGoogleSuite = () => getProviderService('google')!;
export const listGoogleServices = () => listProviderServiceChildren('google');
