import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

// short on purpose -- this is a birthday present for a kid, not a bank.
// NIST 800-63B: length is what actually matters, not composition rules.
export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function isPasswordStrongEnough(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;
}
