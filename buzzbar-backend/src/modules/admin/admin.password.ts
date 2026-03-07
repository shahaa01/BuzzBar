import bcrypt from 'bcryptjs';

const COST = 12;

export async function hashPassword(plain: string) {
  const salt = await bcrypt.genSalt(COST);
  return bcrypt.hash(plain, salt);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

