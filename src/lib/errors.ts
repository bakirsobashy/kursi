/**
 * Errors the API returns on purpose. The error handler turns each one into an
 * RFC 9457 Problem Details response; anything else becomes a generic 500.
 */

const PROBLEMS_DOC = 'https://github.com/bakirsobashy/kursi/blob/main/docs/problems.md';

/**
 * Every problem type the API can return, with its status and title: both are the same every
 * time the problem happens, so they live here rather than where it's thrown. Each slug is a
 * heading in docs/problems.md, in the same order (a test checks), and the API docs list the
 * slugs each route can return.
 */
export const PROBLEMS = {
  'validation-failed': { status: 400, title: 'Your request has invalid fields' },
  'malformed-json': { status: 400, title: 'The request body is not valid JSON' },
  'payload-too-large': { status: 413, title: 'The request body is too large' },
  unauthorized: { status: 401, title: 'Authentication required' },
  'invalid-token': { status: 401, title: 'Invalid access token' },
  'invalid-refresh-token': { status: 401, title: 'Invalid refresh token' },
  'invalid-credentials': { status: 401, title: 'Invalid email or password' },
  'email-taken': { status: 409, title: 'Email already registered' },
  forbidden: { status: 403, title: 'Not allowed' },
  'not-found': { status: 404, title: 'Resource not found' },
  'route-not-found': { status: 404, title: 'Route not found' },
  conflict: { status: 409, title: 'Conflict with the current state' },
  'event-not-draft': { status: 409, title: 'Only a draft can be published' },
  'event-started': { status: 409, title: 'Event has already started' },
  'event-cancelled': { status: 409, title: 'Event is cancelled' },
  'capacity-below-bookings': { status: 409, title: 'Capacity is below the seats already booked' },
  'event-sold-out': { status: 409, title: 'Event is sold out' },
  'already-booked': { status: 409, title: 'Already booked' },
  'event-not-bookable': { status: 409, title: "Event can't be booked" },
  'booking-cancelled': { status: 409, title: 'Booking is already cancelled' },
  'too-many-requests': { status: 429, title: 'Too many requests' },
  'internal-error': { status: 500, title: 'Internal server error' },
  'not-ready': { status: 503, title: 'Service not ready' },
  'database-timeout': { status: 503, title: 'The database took too long' },
  'database-busy': { status: 503, title: 'The database was busy' },
} as const satisfies Record<string, { status: number; title: string }>;

export type ProblemSlug = keyof typeof PROBLEMS;

/** The `type` URI of a problem: a heading in docs/problems.md, so each error documents itself. */
export const problemType = (slug: ProblemSlug) => `${PROBLEMS_DOC}#${slug}`;

export interface ProblemOptions {
  /** Specific to this occurrence, safe to show to the caller. */
  detail?: string;
  /** The underlying error. It is logged, never sent to the caller. */
  cause?: unknown;
}

/** `throw new AppError('event-sold-out', { detail: 'All 40 seats are booked.' })` */
export class AppError extends Error {
  readonly slug: ProblemSlug;
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail: string | undefined;

  constructor(slug: ProblemSlug, { detail, cause }: ProblemOptions = {}) {
    const { status, title } = PROBLEMS[slug];
    super(detail ?? title, { cause });
    this.name = 'AppError';
    this.slug = slug;
    this.status = status;
    this.type = problemType(slug);
    this.title = title;
    this.detail = detail;
  }
}
