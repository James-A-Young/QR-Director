import { randomInt } from 'node:crypto';

/** Lower-case letters and digits without look-alikes (0/o, 1/l/i) so printed codes can be typed. */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
export const GENERATED_CODE_LENGTH = 6;

export const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Paths used by the app itself which can never be short codes. */
export const RESERVED_CODES = new Set([
  'api',
  'app',
  'auth',
  'assets',
  'healthz',
  'readyz',
  'favicon.ico',
  'robots.txt',
  'login',
  'logout',
  'admin',
  'static',
  'not-found',
]);

export function generateCode(length = GENERATED_CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export function normaliseCode(input: string): string {
  return input.trim().toLowerCase();
}

export type CodeProblem = 'invalid' | 'reserved';

export function validateCode(code: string): CodeProblem | null {
  if (!CODE_PATTERN.test(code)) return 'invalid';
  if (RESERVED_CODES.has(code)) return 'reserved';
  return null;
}
