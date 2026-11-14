const FORMAT = "pyme360-encrypted-backup";
const ITERATIONS = 600_000;
const CHUNK = 0x8000;

interface EncryptedBackup {
  format: typeof FORMAT;
  version: 1;
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usage: KeyUsage,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

function parseEncrypted(content: string): EncryptedBackup | null {
  try {
    const parsed = JSON.parse(content) as Partial<EncryptedBackup> | null;
    return parsed?.format === FORMAT ? (parsed as EncryptedBackup) : null;
  } catch {
    return null;
  }
}

export function isEncryptedBackup(content: string): boolean {
  return parseEncrypted(content) !== null;
}

/** Cifra el respaldo con AES-GCM; la clave sale de la contraseña y nunca se guarda. */
export async function encryptBackup(content: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS, "encrypt");
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(content),
  );
  const backup: EncryptedBackup = {
    format: FORMAT,
    version: 1,
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(data)),
  };
  return JSON.stringify(backup);
}

export async function decryptBackup(content: string, password: string): Promise<string> {
  const backup = parseEncrypted(content);
  if (!backup) throw new Error("Este archivo no es un respaldo protegido de Pyme360.");
  try {
    const key = await deriveKey(password, fromBase64(backup.salt), backup.iterations, "decrypt");
    const data = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(backup.iv) },
      key,
      fromBase64(backup.data),
    );
    return new TextDecoder().decode(data);
  } catch {
    throw new Error("La contraseña no es correcta o el archivo está dañado.");
  }
}
