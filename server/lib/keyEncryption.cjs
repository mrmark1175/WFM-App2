// AES-256-GCM at-rest encryption for sensitive secrets stored in the DB
// (currently: ai_settings.api_key).
//
// Stored format:  enc:v1:<base64(iv | authTag | ciphertext)>
//   - iv:        12 bytes (GCM standard nonce length)
//   - authTag:   16 bytes
//   - ciphertext: variable length
//
// The version tag (`v1`) lets us migrate to new key/algorithm later without
// guessing the format of legacy values.

const crypto = require('crypto');

const ALG = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = 'enc:v1:';
const REQUIRED_KEY_BYTES = 32;

let cachedKey = null;

function loadKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.KEY_ENCRYPTION_KEY;
  if (!raw) {
    console.error(
      '[keyEncryption] FATAL: KEY_ENCRYPTION_KEY is required to read or write encrypted secrets (e.g., ai_settings.api_key).\n' +
      '       Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
      '       Then set KEY_ENCRYPTION_KEY=<hex> in .env (or your hosting environment).'
    );
    process.exit(1);
  }
  let buf;
  // Accept either 64-char hex or 44-char base64 (standard for 32 raw bytes).
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) {
    buf = Buffer.from(raw, 'hex');
  } else {
    try { buf = Buffer.from(raw, 'base64'); } catch { buf = Buffer.alloc(0); }
  }
  if (buf.length !== REQUIRED_KEY_BYTES) {
    console.error(
      `[keyEncryption] FATAL: KEY_ENCRYPTION_KEY must decode to exactly ${REQUIRED_KEY_BYTES} bytes.\n` +
      `       Got ${buf.length} bytes after decoding. Use 64 hex chars or a 32-byte base64 value.`
    );
    process.exit(1);
  }
  cachedKey = buf;
  return cachedKey;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encrypt: plaintext must be a non-empty string');
  }
  const key = loadKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(stored) {
  if (!isEncrypted(stored)) {
    throw new Error(
      'decrypt: value is not in the expected encrypted format (missing "enc:v1:" prefix). ' +
      'Refusing to use as plaintext. Re-save the secret via the AI Settings page so it is encrypted at rest.'
    );
  }
  const key = loadKey();
  const blob = Buffer.from(stored.slice(PREFIX.length), 'base64');
  if (blob.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('decrypt: encrypted blob is too short to be valid');
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isEncrypted };
