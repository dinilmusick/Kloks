export type UserRole = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  displayName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthSession {
  token: string;
  userId: string;
  role: UserRole;
  expiresAt: number;
}

export interface SignupInput {
  email: string;
  password: string;
  displayName?: string;
}

export interface CreateUserData {
  email: string;
  passwordHash: string;
  role: UserRole;
  displayName?: string;
}
