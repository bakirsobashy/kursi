/*
 * The fixed IDs and logins of the demo data that src/db/seed.ts inserts. They live apart from
 * the seed, which connects to the database, so the API docs can use them as examples: on a
 * seeded database, "Try it out" works with the values it is pre-filled with.
 */

export const DEMO_PASSWORD = 'demo-password';

export const DEMO_EMAILS = {
  admin: 'admin@kursi.test',
  alice: 'alice@kursi.test',
  bob: 'bob@kursi.test',
} as const;

export const DEMO_IDS = {
  admin: '0199a3c2-0000-7000-8000-000000000001',
  alice: '0199a3c2-0000-7000-8000-000000000002',
  bob: '0199a3c2-0000-7000-8000-000000000003',
  meetup: '0199a3c2-0000-7000-8000-000000000101',
  workshop: '0199a3c2-0000-7000-8000-000000000102',
  postgres: '0199a3c2-0000-7000-8000-000000000103',
  docker: '0199a3c2-0000-7000-8000-000000000104',
  gameNight: '0199a3c2-0000-7000-8000-000000000105',
  bobAtWorkshop: '0199a3c2-0000-7000-8000-000000000201',
  adminAtWorkshop: '0199a3c2-0000-7000-8000-000000000202',
  aliceAtPostgres: '0199a3c2-0000-7000-8000-000000000203',
  bobAtGameNight: '0199a3c2-0000-7000-8000-000000000204',
} as const;
