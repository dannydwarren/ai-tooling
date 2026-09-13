import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { USER_HOME } from './paths.mjs';

export const KEY_FILE = process.env.AI_TOOLING_MEMORY_KEY
  ? path.resolve(process.env.AI_TOOLING_MEMORY_KEY)
  : path.join(USER_HOME, '.ai-tooling', 'memory-key');

export const FORMAT = 'ai-tooling-sealed-v1';
const KDF = { N: 2 ** 15, r: 8, p: 1, keylen: 32 };
const MAXMEM = 128 * 1024 * 1024;

export function passphrase() {
  if (process.env.AI_TOOLING_MEMORY_PASSPHRASE) return process.env.AI_TOOLING_MEMORY_PASSPHRASE;
  if (fs.existsSync(KEY_FILE)) {
    const text = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (text) return text;
  }
  throw new Error(
    `No passphrase. Set AI_TOOLING_MEMORY_PASSPHRASE, or put one in ${KEY_FILE}.\n` +
    '  That file lives outside the working tree on purpose and must never be committed.',
  );
}

function deriveKey(secret, salt) {
  return crypto.scryptSync(secret, salt, KDF.keylen, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: MAXMEM });
}

export function seal(plaintext, secret) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    format: FORMAT,
    kdf: { name: 'scrypt', ...KDF },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    body: body.toString('base64'),
  };
}

export function open(envelope, secret) {
  if (envelope?.format !== FORMAT) {
    throw new Error(`Not a sealed bundle (format ${JSON.stringify(envelope?.format)})`);
  }
  const kdf = envelope.kdf ?? KDF;
  const key = crypto.scryptSync(secret, Buffer.from(envelope.salt, 'base64'), kdf.keylen, {
    N: kdf.N, r: kdf.r, p: kdf.p, maxmem: MAXMEM,
  });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.body, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Could not decrypt. Wrong passphrase, or the bundle has been altered.');
  }
}
