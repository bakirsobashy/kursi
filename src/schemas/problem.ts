import { z } from 'zod';

/** The RFC 9457 Problem Details body every error response uses. */
export const problem = z
  .strictObject({
    type: z.string().meta({
      description:
        'Links to the explanation of this problem in docs/problems.md. `about:blank` for a rare HTTP error with nothing to add.',
    }),
    title: z.string().meta({ description: 'The same every time this problem happens.' }),
    status: z.int().min(400).max(599),
    detail: z.string().optional().meta({ description: 'What went wrong this time.' }),
    instance: z
      .string()
      .meta({ description: 'The path that was requested, without its query string.' }),
    requestId: z.string().meta({
      description:
        'Matches the X-Request-Id header and the log lines for this request. Quote it when you report a problem.',
    }),
    errors: z
      .array(z.strictObject({ path: z.string(), message: z.string() }))
      .optional()
      .meta({ description: 'Only on `validation-failed`: each invalid field, and why.' }),
  })
  .meta({
    id: 'Problem',
    description: 'An RFC 9457 Problem Details object, sent as `application/problem+json`.',
  });

export type Problem = z.infer<typeof problem>;
