import crypto from 'crypto';

const algorithm = 'aes-256-cbc';
let warnedLegacyKey = false;

/**
 * Clave AES-256 desde ENCRYPTION_KEY. Formato recomendado: 64 caracteres hex (32 bytes),
 * p. ej. `openssl rand -hex 32` (aporte de #27). Las instalaciones previas usaban cualquier
 * texto completado a 32 caracteres: se sigue aceptando para poder descifrar lo ya guardado.
 * Se lee en cada llamada para no depender del orden en que se cargue dotenv.
 */
function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY environment variable is not set');
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  if (!warnedLegacyKey) {
    warnedLegacyKey = true;
    console.warn(
      '⚠️ ENCRYPTION_KEY no es hex de 64 caracteres: se usa el formato heredado. Genere una con `openssl rand -hex 32`.',
    );
  }
  return Buffer.from(raw.padEnd(32, '0').slice(0, 32), 'utf8');
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(data: string): string {
  const [ivHex, encryptedHex] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encryptedText = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, key(), iv);
  const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  return decrypted.toString('utf8');
}
