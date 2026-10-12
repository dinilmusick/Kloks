/**
 * @file UnifiedAuthCore.ts
 * @description Strict Universal Authentication against "ultrst-users" and "ultrst-credentials".
 * Zero offline dummy fallbacks. Runs across Node.js, Vercel, and Cloudflare Workers (< 200 lines).
 */

import bcrypt from 'bcryptjs';

export interface SystemUser {
  id: string;
  email: string;
  username: string;
  name: string;
  role: string;
  status: string;
  appProfiles?: Record<string, any>;
}

export async function loginSystemUser(
  email: string,
  rawPass: string,
  isAdmin: boolean,
  queryDb: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>
): Promise<{ success: boolean; status: number; token?: string; user?: SystemUser; error?: string }> {
  const normEmail = (email || '').trim().toLowerCase();
  const password = (rawPass || '').trim();

  if (!normEmail || !password) {
    return { success: false, status: 400, error: 'Email and password are required' };
  }

  try {
    if (isAdmin) {
      const credRes = await queryDb(`SELECT * FROM "ultrst-credentials" WHERE id = 'system' LIMIT 1`, []);
      if (credRes.rows.length > 0) {
        const cred = credRes.rows[0];
        const matchEmail = (cred.admin_email || '').toLowerCase() === normEmail;
        const matchPass = cred.admin_password === password || (cred.admin_password && bcrypt.compareSync(password, cred.admin_password));
        if (matchEmail && matchPass) {
          return {
            success: true,
            status: 200,
            token: `adm_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            user: { id: 'admin_sys', email: cred.admin_email, username: 'System Admin', name: 'System Admin', role: 'admin', status: 'ACTIVE' },
          };
        }
      }
    }

    const uRes = await queryDb(`SELECT * FROM "ultrst-users" WHERE LOWER(email) = $1 LIMIT 1`, [normEmail]);
    if (uRes.rows.length === 0) {
      return { success: false, status: 401, error: 'Invalid email or password' };
    }

    const user = uRes.rows[0];
    const hash = user.password_hash || '';
    let isMatch = false;

    if (hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
      isMatch = bcrypt.compareSync(password, hash);
    } else {
      isMatch = hash === password;
    }

    if (!isMatch) {
      return { success: false, status: 401, error: 'Invalid email or password' };
    }

    if (isAdmin && user.role !== 'admin') {
      return { success: false, status: 403, error: 'Insufficient administrative privileges' };
    }

    return {
      success: true,
      status: 200,
      token: `usr_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      user: {
        id: user.id,
        email: user.email,
        username: user.username || user.name || user.email.split('@')[0],
        name: user.name || user.username || 'Ecosystem User',
        role: user.role || 'user',
        status: user.status || 'ACTIVE',
        appProfiles: typeof user.app_profiles === 'string' ? JSON.parse(user.app_profiles) : (user.app_profiles || {}),
      },
    };
  } catch (err: any) {
    return { success: false, status: 500, error: err.message };
  }
}

export async function resolveUserFromToken(
  tokenOrUserId: string,
  queryDb: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>
): Promise<SystemUser | null> {
  if (!tokenOrUserId) return null;
  let targetId = tokenOrUserId;

  if (targetId.startsWith('Bearer ')) targetId = targetId.slice(7).trim();
  if (targetId.startsWith('sess::')) {
    const parts = targetId.split('::');
    if (parts[1]) targetId = parts[1];
  }

  const res = await queryDb(`SELECT * FROM "ultrst-users" WHERE id = $1 OR LOWER(email) = LOWER($1) LIMIT 1`, [targetId]);
  if (res.rows.length === 0) return null;

  const u = res.rows[0];
  return {
    id: u.id,
    email: u.email,
    username: u.username || u.name || u.email.split('@')[0],
    name: u.name || u.username || 'Ecosystem User',
    role: u.role || 'user',
    status: u.status || 'ACTIVE',
    appProfiles: typeof u.app_profiles === 'string' ? JSON.parse(u.app_profiles) : (u.app_profiles || {}),
  };
}
