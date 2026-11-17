/** Selectively import Google Drive. No Gemini API or other Google Cloud services. */
export { GoogleDriveWorkspaceService, GOOGLE_DRIVE_WORKSPACE_SCOPE } from '../../storage/GoogleDriveWorkspaceService.js';
export { createGoogleDriveStorageService } from '../storage/google-drive.js';
import { getProviderService } from '../registry.js';
export const driveService = getProviderService('google-drive')!;
