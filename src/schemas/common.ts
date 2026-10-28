import { z } from 'zod';

// Building blocks of the response schemas. Responses are described with z.strictObject, so a
// test that parses a real response fails on a field the docs don't mention, as well as on a
// field they promise and the response lacks.

/** A UTC timestamp as the API returns it, such as 2026-11-20T15:00:00.000Z. */
export const timestamp = z.iso.datetime();

export const pageMeta = z
  .strictObject({
    page: z.int().min(1),
    limit: z.int().min(1).max(100),
    total: z.int().min(0).meta({ description: 'How many items match, across all pages.' }),
  })
  .meta({ id: 'PageMeta' });

/** One page of a list: its items, and where the page sits in the whole list. */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.strictObject({ data: z.array(item), meta: pageMeta });
