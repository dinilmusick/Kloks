/**
 * @file FrontendSession.ts
 * @description Frontend session container tracking credentials, capabilities, callbacks, and sequence state.
 */

import { CallbackRegistry } from './CallbackRegistry.js';
import { SequenceTracker } from './SequenceTracker.js';

export interface FrontendSessionOptions {
  sessionId?: string;
  credentials?: Record<string, string>;
  capabilities?: string[];
  callbackRegistry?: CallbackRegistry;
  sequenceTracker?: SequenceTracker;
}

export class FrontendSession {
  public readonly sessionId: string;
  private credentials: Record<string, string>;
  private capabilities: Set<string>;
  public readonly callbackRegistry: CallbackRegistry;
  public readonly sequenceTracker: SequenceTracker;
  private subscriptions: Set<() => void> = new Set();
  private disposed = false;

  constructor(options: FrontendSessionOptions = {}) {
    this.sessionId = options.sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.credentials = { ...(options.credentials || {}) };
    this.capabilities = new Set(options.capabilities || []);
    this.callbackRegistry = options.callbackRegistry || new CallbackRegistry();
    this.sequenceTracker = options.sequenceTracker || new SequenceTracker();
  }

  setCredential(key: string, value: string): this {
    if (this.disposed) throw new Error('[FrontendSession] Cannot update a disposed session.');
    this.credentials[key] = value;
    return this;
  }

  getCredential(key: string): string | undefined {
    return this.credentials[key];
  }

  getCredentials(): Record<string, string> {
    return { ...this.credentials };
  }

  grantCapability(capability: string): this {
    if (this.disposed) throw new Error('[FrontendSession] Cannot update a disposed session.');
    this.capabilities.add(capability);
    return this;
  }

  hasCapability(capability: string): boolean {
    return this.capabilities.has(capability) || this.capabilities.has('*');
  }

  trackSubscription(cleanup: () => void): () => void {
    if (this.disposed) {
      // Async subscription attachment can resolve after sign-out. Release it
      // immediately rather than leaving a live listener on a closed session.
      try { cleanup(); } catch {}
      return () => {};
    }
    this.subscriptions.add(cleanup);
    return () => {
      this.subscriptions.delete(cleanup);
      cleanup();
    };
  }

  clearSubscriptions(): void {
    for (const cleanup of this.subscriptions) {
      try { cleanup(); } catch {}
    }
    this.subscriptions.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Revoke credentials and in-memory grants before listener cleanup can run.
    this.credentials = {};
    this.capabilities.clear();
    this.clearSubscriptions();
    this.callbackRegistry.clear();
    this.sequenceTracker.reset();
  }
}
