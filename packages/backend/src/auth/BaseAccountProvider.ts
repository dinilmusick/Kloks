import { SkipoBase } from '@kloks/functions';
import { AuthCredentials, AuthSession, CreateUserData, SignupInput, User } from './types.js';
import { PasswordHasher } from './PasswordHasher.js';
import { RateLimiter } from './RateLimiter.js';
import { SessionManager } from './SessionManager.js';

export abstract class BaseAccountProvider extends SkipoBase {
  protected rateLimiter = new RateLimiter();
  protected sessionManager = new SessionManager();

  abstract findUserByEmail(email: string): Promise<User | null>;
  abstract findUserById(id: string): Promise<User | null>;
  abstract createUser(data: CreateUserData): Promise<User>;
  abstract updateUser(id: string, data: Partial<User>): Promise<User>;
  abstract listUsers(): Promise<User[]>;

  async authenticate(credentials: AuthCredentials): Promise<AuthSession> {
    this.rateLimiter.check(credentials.email);

    const user = await this.findUserByEmail(credentials.email);
    if (!user) {
      throw new Error('Invalid credentials.');
    }

    const isValid = await PasswordHasher.verify(credentials.password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid credentials.');
    }

    this.rateLimiter.reset(credentials.email);
    return this.sessionManager.createSession(user.id, user.role);
  }

  async signup(input: SignupInput): Promise<User> {
    const existing = await this.findUserByEmail(input.email);
    if (existing) {
      throw new Error('Email already in use.'); // Can be generic too, but usually signup indicates taken
    }

    const passwordHash = await PasswordHasher.hash(input.password);
    return this.createUser({
      email: input.email,
      passwordHash,
      role: 'user', // Enforce user role
      displayName: input.displayName
    });
  }

  async verifySession(token: string | null): Promise<AuthSession | null> {
    if (!token) return null;
    const parts = token.split('::');
    if (parts.length >= 4 && parts[0] === 'sess') {
      const userId = parts[1];
      const user = await this.findUserById(userId);
      if (user) {
        // We'd typically validate expiry here too, but token doesn't encode expiry, so we might need to store sessions.
        // For stateless tokens, we embed expiry or trust DB. Since SessionManager issues tokens...
        // Let's assume valid for 24h from issue time in token.
        const issueTime = parseInt(parts[2], 10);
        if (Date.now() - issueTime < 86400000) {
          return {
            token,
            userId: user.id,
            role: user.role,
            expiresAt: issueTime + 86400000
          };
        }
      }
    }
    return null;
  }
}
