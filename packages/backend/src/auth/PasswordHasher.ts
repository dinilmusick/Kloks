let bcrypt: any = null;
try {
  bcrypt = (await import('bcryptjs')).default;
} catch (e) {
  console.warn('[Skipo] bcryptjs not installed. Using fallback hashing (DEV ONLY).');
}

export class PasswordHasher {
  static async hash(password: string, saltRounds = 10): Promise<string> {
    if (bcrypt) {
      return bcrypt.hash(password, saltRounds);
    }
    return `fallback_hash_${Buffer.from(password).toString('base64')}`;
  }

  static async verify(password: string, hash: string): Promise<boolean> {
    if (bcrypt) {
      return bcrypt.compare(password, hash);
    }
    return hash === `fallback_hash_${Buffer.from(password).toString('base64')}`;
  }
}
