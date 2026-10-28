import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The layering rules from the build plan, checked on every run so they can't quietly erode:
// routes parse input and send responses, services hold the rules and the SQL.

async function filesIn(dir: string) {
  const names = await readdir(dir);
  return Promise.all(
    names
      .filter((name) => name.endsWith('.ts'))
      .map(async (name) => ({ name, code: await readFile(join(dir, name), 'utf8') })),
  );
}

describe('architecture', () => {
  it('keeps SQL and the database out of route files', async () => {
    for (const { name, code } of await filesIn('src/routes')) {
      expect(code, `src/routes/${name}`).not.toMatch(/from ['"]drizzle-orm|db\/client|db\/schema/);
    }
  });

  it('keeps req and res out of services', async () => {
    for (const { name, code } of await filesIn('src/services')) {
      expect(code, `src/services/${name}`).not.toMatch(/from ['"]express['"]|\breq\.|\bres\./);
    }
  });
});
