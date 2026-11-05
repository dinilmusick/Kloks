import { createLuthAuthClient, type LuthAuthClient, type LuthSessionResult, type LuthUser } from "@dinilmusick/gutts/auth";
import { AuthServiceUISchema } from "./auth.ui.js";

export type UserRole = "user" | "admin";
export type UserAccount = LuthUser & { username: string; role: "user" };
export type UserSession = LuthSessionResult;
export type UserWorkspaceRecord = { id: string; name: string };

export interface AuthState {
  currentUser: UserAccount | null;
  token: string | null;
  isAuthenticated: boolean;
  isAdmin: false;
}

export type AuthListener = (state: AuthState) => void;

export class AuthService {
  static readonly ui = AuthServiceUISchema;
  readonly ui = AuthServiceUISchema;
  private client: LuthAuthClient | null = null;

  private getClient(): LuthAuthClient {
    if (!this.client) {
      this.client = createLuthAuthClient({
        ecosystemId: "ultrst-armada",
        applicationId: "kloks",
        autoRegister: true,
      });
    }
    return this.client;
  }
  private currentUser: UserAccount | null = null;
  private listeners = new Set<AuthListener>();

  private get token(): string | null {
    const value = new Headers(this.getClient().getAuthHeaders()).get("authorization") || "";
    return value.replace(/^Bearer\\s+/i, "").trim() || null;
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  getState(): AuthState {
    return {
      currentUser: this.currentUser,
      token: this.token,
      isAuthenticated: Boolean(this.currentUser && this.token),
      isAdmin: false,
    };
  }

  getCurrentUser(): UserAccount | null {
    return this.currentUser;
  }

  getAuthToken(): string | null {
    return this.token;
  }

  getAuthHeaders(): Record<string, string> {
    return Object.fromEntries(new Headers(this.getClient().getAuthHeaders()).entries());
  }

  getRegisteredUsers(): UserAccount[] {
    // Luth owns the identity directory; Kloks must not enumerate or cache local users.
    return [];
  }

  deleteUser(_userId: string): boolean {
    // User administration is owned by Luth and SRKL policy, never this client package.
    return false;
  }

  subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  async refreshSession(): Promise<LuthSessionResult> {
    const session = await this.getClient().refreshSession();
    this.currentUser = session.authenticated && session.user
      ? { ...session.user, username: session.user.email.split("@")[0], role: "user" }
      : null;
    this.notify();
    return session;
  }

  async login(email: string, password: string, requiredRole?: UserRole) {
    if (requiredRole === "admin") {
      return { success: false, error: "Administrative access is managed by Luth and SRKL policy." };
    }
    try {
      await this.getClient().signInWithEmail({ email, password });
      const session = await this.refreshSession();
      if (!session.authenticated || !session.user) {
        return { success: false, error: "Luth did not establish an authenticated session." };
      }
      return { success: true, user: this.currentUser!, token: this.token || undefined };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Luth sign-in failed." };
    }
  }

  async loginUser(email: string, password: string) {
    return this.login(email, password);
  }

  async loginAdmin(_email: string, _password: string) {
    return { success: false, error: "Administrative authentication is managed by Luth." };
  }

  async register(params: { email: string; password: string; name: string; role?: UserRole }) {
    if (params.role === "admin") {
      return { success: false, error: "Administrative registration is managed by Luth." };
    }
    try {
      await this.getClient().signUpWithEmail({ email: params.email, password: params.password, name: params.name });
      const session = await this.refreshSession();
      if (!session.authenticated || !session.user) {
        return { success: false, error: "Luth registration did not establish an authenticated session." };
      }
      return { success: true, user: this.currentUser!, token: this.token || undefined };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Luth registration failed." };
    }
  }

  async logout(): Promise<void> {
    await this.getClient().signOut();
    this.currentUser = null;
    this.notify();
  }

  async fetchWorkspaces(): Promise<never> {
    throw new Error("Workspace ownership and persistence are managed by SRKL, not the authentication client.");
  }

  async createWorkspace(_params: unknown): Promise<never> {
    throw new Error("Workspace creation is managed by SRKL.");
  }

  async updateWorkspace(_workspaceId: string, _updates: unknown): Promise<never> {
    throw new Error("Workspace updates are managed by SRKL.");
  }

  async deleteWorkspace(_workspaceId: string): Promise<never> {
    throw new Error("Workspace deletion is managed by SRKL.");
  }

  setActiveWorkspace(_workspaceId: string): never {
    throw new Error("Workspace selection is managed by SRKL.");
  }
}

export const authService = new AuthService();
