export class RateLimiter {
  private attempts: Map<string, { count: number; windowStart: number }> = new Map();
  private windowMs: number;
  private maxUser: number;
  private maxAdmin: number;

  constructor(windowMs = 900000, maxUser = 5, maxAdmin = 3) {
    this.windowMs = windowMs;
    this.maxUser = maxUser;
    this.maxAdmin = maxAdmin;
  }

  check(identifier: string, isAdminAttempt = false): void {
    const now = Date.now();
    let record = this.attempts.get(identifier);

    if (!record || now - record.windowStart > this.windowMs) {
      record = { count: 0, windowStart: now };
      this.attempts.set(identifier, record);
    }

    record.count++;
    
    const limit = isAdminAttempt ? this.maxAdmin : this.maxUser;
    if (record.count > limit) {
      throw new Error('Too many requests. Please try again later.');
    }
  }

  reset(identifier: string): void {
    this.attempts.delete(identifier);
  }
}
