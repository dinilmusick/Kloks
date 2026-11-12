/**
 * Lazy Google SDK boundary for storage integrations.
 *
 * Importing backend Node storage adapters must not load optional Google or
 * AWS SDK packages. The SDK is resolved only when Google Drive is used.
 */
let googleSdkPromise: Promise<any> | undefined;

export async function getGoogleSdk(): Promise<any> {
  if (!googleSdkPromise) {
    googleSdkPromise = import('@dinilmusick/gutts/storage')
      .then((storage) => storage.google)
      .catch((error) => {
        googleSdkPromise = undefined;
        throw error;
      });
  }
  return googleSdkPromise;
}
