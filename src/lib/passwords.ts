import argon2 from 'argon2';

/*
 * Argon2id is OWASP's first choice for password hashing. It is slow and memory-hungry on purpose
 * (64 MiB and 3 passes with these defaults), so guessing passwords from a stolen hash is expensive.
 * The hash string carries its own salt and settings, so changing them later doesn't break old hashes.
 */

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

/** True when the password matches. A malformed hash counts as a mismatch, never as an error. */
export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// A real hash of a random password, made once with the same settings as every other hash.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(crypto.randomUUID()));

/**
 * Builds the dummy hash ahead of time. The server calls this at startup, so the first login
 * for an unknown email isn't slower than the rest, which would itself be a timing signal.
 */
export async function prepareDummyHash() {
  await getDummyHash();
}

/**
 * Does the same work as verifyPassword for an email that has no account, so a login for an
 * unknown email takes as long as one with a wrong password. Otherwise the response time alone
 * would reveal which emails are registered.
 */
export async function verifyAgainstDummy(password: string) {
  await verifyPassword(await getDummyHash(), password);
  return false;
}
