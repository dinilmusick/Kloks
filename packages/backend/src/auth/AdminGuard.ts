import { SkipoBase } from '@kloks/functions';
import { BaseAccountProvider } from './BaseAccountProvider.js';
import { AuthSession } from './types.js';

export class AdminGuard extends SkipoBase {
  public static async verify(
    authHeaderOrToken: string | null | undefined,
    provider: BaseAccountProvider
  ): Promise<AuthSession> {
    const session = await AdminGuard.verifyUser(authHeaderOrToken, provider);
    if (session.role !== 'admin') {
      throw new Error('Forbidden: Admin access required.');
    }
    return session;
  }

  public static async verifyUser(
    authHeaderOrToken: string | null | undefined,
    provider: BaseAccountProvider
  ): Promise<AuthSession> {
    const token = authHeaderOrToken?.startsWith('Bearer ')
      ? authHeaderOrToken.substring(7).trim()
      : authHeaderOrToken?.trim() || null;

    const session = await provider.verifySession(token);
    if (!session) {
      throw new Error('Unauthorized: Invalid or missing session token.');
    }
    return session;
  }
}
