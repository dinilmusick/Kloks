import { promises as fs } from 'fs';
import path from 'path';
import { BaseAccountProvider } from './BaseAccountProvider.js';
import { CreateUserData, User } from './types.js';

export class LocalAccountProvider extends BaseAccountProvider {
  private filePath: string;
  private users: Map<string, User> = new Map();
  private isLoaded = false;

  constructor(filePath = '.skipo/accounts.json') {
    super();
    this.filePath = path.resolve(filePath);
  }

  private async load(): Promise<void> {
    if (this.isLoaded) return;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const data = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      for (const [id, user] of Object.entries(parsed)) {
        this.users.set(id, user as User);
      }
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }
    this.isLoaded = true;
  }

  private async persist(): Promise<void> {
    const data = Object.fromEntries(this.users);
    // Ideally use file locking from @kloks/functions, using simple write for now
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async findUserByEmail(email: string): Promise<User | null> {
    await this.load();
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async findUserById(id: string): Promise<User | null> {
    await this.load();
    return this.users.get(id) || null;
  }

  async createUser(data: CreateUserData): Promise<User> {
    await this.load();
    const isFirst = this.users.size === 0;
    
    const user: User = {
      id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      email: data.email,
      passwordHash: data.passwordHash,
      role: isFirst ? 'admin' : data.role,
      displayName: data.displayName,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.users.set(user.id, user);
    await this.persist();
    return user;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    await this.load();
    const user = this.users.get(id);
    if (!user) throw new Error('User not found');
    
    const updated = { ...user, ...data, updatedAt: Date.now() };
    this.users.set(id, updated);
    await this.persist();
    return updated;
  }

  async listUsers(): Promise<User[]> {
    await this.load();
    return Array.from(this.users.values());
  }
}
