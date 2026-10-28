import argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { events, users } from '../src/db/schema.js';
import { DEMO_PASSWORD, seed } from '../src/db/seed.js';
import { resetDb } from './helpers.js';

describe('seed', () => {
  let firstRun: Awaited<ReturnType<typeof seed>>;
  let secondRun: Awaited<ReturnType<typeof seed>>;

  beforeAll(async () => {
    await resetDb();
    firstRun = await seed();
    secondRun = await seed();
  });

  it('adds three users, five events and four bookings to an empty database', () => {
    expect(firstRun).toEqual({ users: 3, events: 5, bookings: 4 });
  });

  it('adds nothing when run a second time', () => {
    expect(secondRun).toEqual({ users: 0, events: 0, bookings: 0 });
  });

  it('covers every kind of event the later phases need', async () => {
    const rows = await db
      .select({ status: events.status, capacity: events.capacity, seatsBooked: events.seatsBooked })
      .from(events);

    expect(rows.filter((e) => e.status === 'published')).toHaveLength(3);
    expect(rows.filter((e) => e.status === 'draft')).toHaveLength(1);
    expect(rows.filter((e) => e.status === 'cancelled')).toHaveLength(1);
    expect(rows.some((e) => e.capacity - e.seatsBooked === 1)).toBe(true);
  });

  it("keeps each event's seats_booked equal to its confirmed bookings", async () => {
    const { rows } = await db.execute<{
      title: string;
      seats_booked: number;
      confirmed: number;
    }>(sql`
      select e.title, e.seats_booked,
             count(b.id) filter (where b.status = 'confirmed')::int as confirmed
      from events e left join bookings b on b.event_id = e.id
      group by e.id
    `);

    for (const row of rows) expect(row.seats_booked, row.title).toBe(row.confirmed);
  });

  it('gives the demo admin the admin role and a working Argon2id password', async () => {
    const [admin] = await db.select().from(users).where(eq(users.email, 'admin@kursi.test'));

    expect(admin?.role).toBe('admin');
    expect(admin?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(admin!.passwordHash, DEMO_PASSWORD)).toBe(true);
  });
});
