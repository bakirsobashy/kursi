import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { events, users } from '../src/db/schema.js';
import { prepareDatabase } from '../src/db/setup.js';
import { resetDb } from './helpers.js';

// What Docker Compose's migrate service runs before the API starts (node dist/db/setup.js).

describe('prepareDatabase', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('migrates without adding the demo data unless asked, as a real deployment would', async () => {
    await prepareDatabase({ seedDemoData: false });

    expect(await db.$count(users)).toBe(0);
  });

  it('adds the demo data when asked, once however often it runs', async () => {
    await prepareDatabase({ seedDemoData: true });
    await prepareDatabase({ seedDemoData: true });

    expect(await db.$count(users)).toBe(3);
    expect(await db.$count(events)).toBe(5);
  });

  it('leaves the demo data out by default, since SEED_DEMO_DATA is unset', async () => {
    await prepareDatabase();

    expect(await db.$count(users)).toBe(0);
  });
});
