import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  createDocument,
  type CreateDocumentOptions,
  type ZodOpenApiExamplesObject,
  type ZodOpenApiMediaTypeObject,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponseObject,
} from 'zod-openapi';
import { DEMO_EMAILS, DEMO_IDS, DEMO_PASSWORD } from '../db/demo.js';
import { PROBLEMS, problemType, type ProblemSlug } from '../lib/errors.js';
import { REFRESH_COOKIE } from '../lib/refresh-cookie.js';
import { fieldErrors } from '../middleware/error-handler.js';
import { PRODUCTION_RATE_LIMITS } from '../middleware/rate-limits.js';
import { loginBody, registerBody, tokenResponse } from '../schemas/auth.js';
import { bookingListResponse, bookingParams, bookingResponse } from '../schemas/bookings.js';
import {
  attendeeListResponse,
  createEventBody,
  eventListResponse,
  eventParams,
  eventResponse,
  listEventsQuery,
  pagination,
  updateEventBody,
} from '../schemas/events.js';
import { healthResponse, readyResponse } from '../schemas/health.js';
import { problem, type Problem } from '../schemas/problem.js';
import { userResponse } from '../schemas/users.js';
import * as examples from './examples.js';

/*
 * The OpenAPI 3.1 description of the API, built from the same Zod schemas that validate
 * requests and type the responses. /openapi.json serves it and /docs renders it.
 *
 * The tests hold every response they get to `paths` below: a status, body or header that the
 * docs don't describe fails the test that caused it (see tests/contract.ts).
 */

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

const REPO = 'https://github.com/bakirsobashy/kursi';
const PROBLEM_JSON = 'application/problem+json';

// --- Building blocks ------------------------------------------------------------------------

const json = (schema: z.ZodType, example: unknown): Record<string, ZodOpenApiMediaTypeObject> => ({
  'application/json': { schema, example },
});

/**
 * An error response whose Problem Details `type` is one of `slugs`. The schema lists them, so
 * a test fails when a route returns a problem type its docs don't mention.
 */
function problems(
  description: string,
  slugs: [ProblemSlug, ...ProblemSlug[]],
  extra: Partial<ZodOpenApiResponseObject> = {},
): ZodOpenApiResponseObject {
  const types = slugs.map(problemType) as [string, ...string[]];
  const links = slugs.map((slug) => `[${slug}](${problemType(slug)})`).join(', ');
  const [first] = slugs;
  const example: Problem = {
    type: problemType(first),
    title: PROBLEMS[first].title,
    status: PROBLEMS[first].status,
    instance: '/', // endpoint() puts in the operation's own path
    requestId: '6f1c9e0a-4b0e-4a8e-9a43-0c7a2f6d1e55',
  };
  return {
    description: `${description}\n\nProblem types: ${links}.`,
    content: {
      [PROBLEM_JSON]: {
        schema: z.intersection(problem, z.looseObject({ type: z.enum(types) })),
        example,
      },
    },
    ...extra,
  };
}

const locationHeader = z.object({
  Location: z.string().startsWith('/api/v1/').meta({ description: 'Where the new resource is.' }),
});

const setCookieHeader = (description: string) =>
  z.object({ 'Set-Cookie': z.string().startsWith(`${REFRESH_COOKIE}=`).meta({ description }) });

const refreshCookie = z.object({
  [REFRESH_COOKIE]: z.string().optional().meta({
    description:
      'Set by login and by each refresh. Your browser sends it by itself; this page has no way to type one in.',
  }),
});

/** Swagger UI pre-fills "Try it out" with this ID, one of the seeded demo rows. */
const withExampleId = (schema: typeof eventParams, example: string) =>
  schema.extend({ id: schema.shape.id.meta({ example }) });

const unexpectedError = problems(
  'Something failed on our side, or the database was too slow or too busy to answer. Safe to retry; quote the requestId if it keeps happening.',
  ['internal-error', 'database-timeout', 'database-busy'],
);

const tooManyRequests = problems(
  'Too many requests from your IP address in the last minute.',
  ['too-many-requests'],
  {
    headers: z.object({
      'Retry-After': z.coerce
        .number()
        .int()
        .positive()
        .meta({ description: 'Seconds to wait before trying again.' }),
    }),
  },
);

const authenticateHeader = z.object({
  'WWW-Authenticate': z
    .string()
    .startsWith('Bearer ')
    .meta({ description: 'How to authenticate, per RFC 6750.' }),
});

const notLoggedIn = problems(
  'No access token, or one that is invalid or expired. Log in, or refresh, for a new one.',
  ['unauthorized', 'invalid-token'],
  { headers: authenticateHeader },
);

const badToken = problems(
  "The access token is invalid or expired. Send none to see what's public.",
  ['invalid-token'],
  { headers: authenticateHeader },
);

const notOrganizer = problems('Only the organizer of this event or an admin can do this.', [
  'forbidden',
]);

const eventNotFound = problems(
  "No event has this ID, or it's someone else's draft: drafts stay hidden from everyone but their organizer and admins.",
  ['not-found'],
);

type Method = 'get' | 'post' | 'patch';

interface Endpoint extends Omit<ZodOpenApiOperationObject, 'responses' | 'requestParams'> {
  operationId: string;
  summary: string;
  tags: [string];
  /** Who may call it. `optional`: anyone, but a token, if sent, must be valid. */
  auth?: 'required' | 'optional';
  path?: z.ZodObject;
  query?: z.ZodObject;
  cookie?: z.ZodObject;
  body?: { schema: z.ZodType; example?: unknown; examples?: ZodOpenApiExamplesObject };
  responses: Record<number, ZodOpenApiResponseObject>;
}

/**
 * What this endpoint really answers to a typical mistake, for the 400 example: the `errors`
 * its schemas produce, and the ID in the path when the mistake is in the path.
 */
function invalidRequestExample({ body, path, query }: Endpoint) {
  const id = 'not-a-uuid';
  const result = body
    ? body.schema.safeParse({})
    : (path?.safeParse({ id }) ?? query?.safeParse({ limit: '1000' }));
  if (!result || result.success) return undefined;
  return { errors: fieldErrors(result.error), id: !body && path ? id : undefined };
}

/**
 * Sets each error example's `instance` to the path that was requested, the way the API does,
 * with the operation's example ID in place of {id}. Copies as it goes: the shared responses
 * above appear in many operations.
 */
function withInstances(path: string, endpoint: Endpoint, responses: Record<string, unknown>) {
  const exampleId: unknown = endpoint.path?.shape.id?.meta()?.example;
  const invalid = invalidRequestExample(endpoint);

  return Object.fromEntries(
    Object.entries(responses as Record<string, ZodOpenApiResponseObject>).map(
      ([code, response]) => {
        const media = response.content?.[PROBLEM_JSON];
        if (!media) return [code, response];
        const badRequest = code === '400' ? invalid : undefined;
        const example = {
          ...(media.example as Problem),
          instance: path.replace('{id}', String(badRequest?.id ?? exampleId)),
          ...(badRequest && { errors: badRequest.errors }),
        };
        return [code, { ...response, content: { [PROBLEM_JSON]: { ...media, example } } }];
      },
    ),
  );
}

/** An operation, with the error responses that follow from its inputs, its auth and its path. */
function endpoint(method: Method, path: string, spec: Endpoint) {
  const { auth, path: pathParams, query, cookie, body, responses, ...operation } = spec;
  const hasInput = Boolean(pathParams ?? query ?? body);

  const all: Record<string, ZodOpenApiResponseObject> = {
    ...(hasInput && {
      400: problems(
        body
          ? 'The body is not valid JSON, or some fields are invalid: `errors` lists each one.'
          : 'Some parameters are invalid: `errors` lists each one.',
        body ? ['validation-failed', 'malformed-json'] : ['validation-failed'],
      ),
    }),
    ...(auth === 'required' && { 401: notLoggedIn }),
    ...(auth === 'optional' && { 401: badToken }),
    ...(body && { 413: problems('The body is larger than 100 kB.', ['payload-too-large']) }),
    // Everything under /api/v1 is rate limited; the health checks and the docs are not.
    ...(path.startsWith('/api/v1/') && { 429: tooManyRequests }),
    ...responses,
    default: unexpectedError,
  };

  const built: ZodOpenApiOperationObject = {
    ...operation,
    ...(auth === 'required' && { security: [{ bearerAuth: [] }] }),
    // {} first: calling it without a token is fine too.
    ...(auth === 'optional' && { security: [{}, { bearerAuth: [] }] }),
    ...((pathParams ?? query ?? cookie) && {
      requestParams: {
        ...(pathParams && { path: pathParams }),
        ...(query && { query }),
        ...(cookie && { cookie }),
      },
    }),
    ...(body && { requestBody: { required: true, content: { 'application/json': body } } }),
    responses: withInstances(path, spec, all),
  };
  return { method, path, operation: built };
}

// --- The API ----------------------------------------------------------------------------------

const eventIdParams = withExampleId(eventParams, DEMO_IDS.workshop);
const bookingIdParams = withExampleId(bookingParams, DEMO_IDS.aliceAtPostgres);

const endpoints = [
  endpoint('post', '/api/v1/auth/register', {
    operationId: 'register',
    tags: ['Auth'],
    summary: 'Create an account',
    description:
      'New accounts get the `user` role. The password is stored only as an Argon2id hash.',
    body: { schema: registerBody, example: examples.registerExample },
    responses: {
      201: {
        description: 'The account was created. Log in to get a token.',
        headers: locationHeader,
        content: json(userResponse, examples.userExample),
      },
      409: problems('An account with this email already exists.', ['email-taken']),
    },
  }),

  endpoint('post', '/api/v1/auth/login', {
    operationId: 'login',
    tags: ['Auth'],
    summary: 'Log in',
    description: [
      'Returns an access token, and sets the refresh cookie that **Get a new access token** trades for the next one: HttpOnly, SameSite=Strict, and sent to `/api/v1/auth` only.',
      '',
      'On this page, a successful login also fills in **Authorize**, so the protected routes work straight away. Pick another demo account in the **Examples** list.',
      '',
      `Only failed attempts count toward the limit of ${PRODUCTION_RATE_LIMITS.login} a minute.`,
    ].join('\n'),
    body: { schema: loginBody, examples: examples.loginExamples },
    responses: {
      200: {
        description: 'Logged in.',
        headers: setCookieHeader('The refresh token for this new session.'),
        content: json(tokenResponse, examples.tokenExample),
      },
      401: problems(
        'The email or the password is wrong. The answer is the same either way, so nobody can find out which emails have accounts.',
        ['invalid-credentials'],
        { headers: authenticateHeader },
      ),
    },
  }),

  endpoint('post', '/api/v1/auth/refresh', {
    operationId: 'refresh',
    tags: ['Auth'],
    summary: 'Get a new access token',
    description:
      'Trades the refresh cookie for a new access token and a new cookie. Each refresh token works once: sending one that was already used ends the whole session, because it means someone copied it. This page fills in **Authorize** with the new token, like login.',
    cookie: refreshCookie,
    responses: {
      200: {
        description: 'A new access token, and the next refresh token in the cookie.',
        headers: setCookieHeader('The next refresh token. The one you sent no longer works.'),
        content: json(tokenResponse, examples.tokenExample),
      },
      401: problems(
        'No refresh cookie, or one that is unknown, expired, already used, or logged out. The cookie is cleared: log in again.',
        ['invalid-refresh-token'],
        { headers: setCookieHeader('Clears the cookie.') },
      ),
    },
  }),

  endpoint('post', '/api/v1/auth/logout', {
    operationId: 'logout',
    tags: ['Auth'],
    summary: 'Log out',
    description:
      'Ends the session the refresh cookie belongs to, and clears the cookie. Access tokens already issued work until they expire. Answers 204 even without a cookie, so it is safe to call twice.',
    cookie: refreshCookie,
    responses: {
      204: { description: 'Logged out.', headers: setCookieHeader('Clears the cookie.') },
    },
  }),

  endpoint('get', '/api/v1/users/me', {
    operationId: 'getMe',
    tags: ['Users'],
    summary: 'Get my account',
    auth: 'required',
    responses: {
      200: { description: 'Your account.', content: json(userResponse, examples.userExample) },
    },
  }),

  endpoint('get', '/api/v1/users/me/bookings', {
    operationId: 'listMyBookings',
    tags: ['Users'],
    summary: 'List my bookings',
    description: 'Confirmed and cancelled, newest first, each with its event.',
    auth: 'required',
    query: pagination,
    responses: {
      200: {
        description: 'One page of your bookings.',
        content: json(bookingListResponse, examples.bookingListExample),
      },
    },
  }),

  endpoint('get', '/api/v1/events', {
    operationId: 'listEvents',
    tags: ['Events'],
    summary: 'List upcoming events',
    description: "Published events that haven't started yet, soonest first. No login needed.",
    query: listEventsQuery,
    responses: {
      200: {
        description: 'One page of events.',
        content: json(eventListResponse, examples.eventListExample),
      },
    },
  }),

  endpoint('post', '/api/v1/events', {
    operationId: 'createEvent',
    tags: ['Events'],
    summary: 'Create an event',
    description:
      'Anyone logged in can organize. A new event is a draft that only you and admins can see; publish it to list it and open bookings.',
    auth: 'required',
    body: { schema: createEventBody, example: examples.newEventExample },
    responses: {
      201: {
        description: 'The draft was created.',
        headers: locationHeader,
        content: json(eventResponse, { ...examples.eventExample, status: 'draft' }),
      },
    },
  }),

  endpoint('get', '/api/v1/events/{id}', {
    operationId: 'getEvent',
    tags: ['Events'],
    summary: 'Get an event',
    description:
      'Published and cancelled events are public. A draft is visible to its organizer and admins only: send their token to see one.',
    auth: 'optional',
    path: eventIdParams,
    responses: {
      200: { description: 'The event.', content: json(eventResponse, examples.eventExample) },
      404: eventNotFound,
    },
  }),

  endpoint('patch', '/api/v1/events/{id}', {
    operationId: 'updateEvent',
    tags: ['Events'],
    summary: 'Update an event',
    description:
      'Organizer or admin only. Send just the fields to change. Times are checked as they end up, so you can move one end of the event on its own.',
    auth: 'required',
    path: eventIdParams,
    body: { schema: updateEventBody, example: examples.eventChangesExample },
    responses: {
      200: {
        description: 'The updated event.',
        content: json(eventResponse, {
          ...examples.eventExample,
          ...examples.eventChangesExample,
          seatsLeft: examples.eventChangesExample.capacity - examples.eventExample.seatsBooked,
        }),
      },
      403: notOrganizer,
      404: eventNotFound,
      409: problems('The event is cancelled, or the new capacity is below the seats booked.', [
        'event-cancelled',
        'capacity-below-bookings',
      ]),
    },
  }),

  endpoint('post', '/api/v1/events/{id}/publish', {
    operationId: 'publishEvent',
    tags: ['Events'],
    summary: 'Publish a draft',
    description: 'Organizer or admin only. Lists the event and opens it for booking.',
    auth: 'required',
    path: eventIdParams,
    responses: {
      200: {
        description: 'The published event.',
        content: json(eventResponse, examples.eventExample),
      },
      403: notOrganizer,
      404: eventNotFound,
      409: problems("The event isn't a draft, or its start time has passed.", [
        'event-not-draft',
        'event-started',
      ]),
    },
  }),

  endpoint('post', '/api/v1/events/{id}/cancel', {
    operationId: 'cancelEvent',
    tags: ['Events'],
    summary: 'Cancel an event',
    description:
      'Organizer or admin only. Cancels every confirmed booking with it, in one transaction: all of it happens, or none of it.',
    auth: 'required',
    path: eventIdParams,
    responses: {
      200: {
        description: 'The cancelled event.',
        content: json(eventResponse, {
          ...examples.eventExample,
          seatsBooked: 0,
          seatsLeft: examples.eventExample.capacity,
          status: 'cancelled',
        }),
      },
      403: notOrganizer,
      404: eventNotFound,
      409: problems('The event is already cancelled.', ['event-cancelled']),
    },
  }),

  endpoint('get', '/api/v1/events/{id}/bookings', {
    operationId: 'listAttendees',
    tags: ['Events'],
    summary: 'List attendees',
    description: 'Organizer or admin only. The confirmed bookings, in the order they were made.',
    auth: 'required',
    path: eventIdParams,
    query: pagination,
    responses: {
      200: {
        description: 'One page of attendees.',
        content: json(attendeeListResponse, examples.attendeeListExample),
      },
      403: notOrganizer,
      404: eventNotFound,
    },
  }),

  endpoint('post', '/api/v1/events/{id}/bookings', {
    operationId: 'bookSeat',
    tags: ['Bookings'],
    summary: 'Book a seat',
    description:
      'One seat per person per event, while the event is published and upcoming. Safe under any number of simultaneous requests: an event is never oversold.',
    auth: 'required',
    path: eventIdParams,
    responses: {
      201: { description: 'Your seat.', content: json(bookingResponse, examples.bookingExample) },
      404: eventNotFound,
      409: problems(
        'Every seat is taken, you already hold one, or the event is cancelled or has started.',
        ['event-sold-out', 'already-booked', 'event-not-bookable'],
      ),
    },
  }),

  endpoint('post', '/api/v1/bookings/{id}/cancel', {
    operationId: 'cancelBooking',
    tags: ['Bookings'],
    summary: 'Cancel my booking',
    description: 'Frees the seat for someone else. Only before the event starts.',
    auth: 'required',
    path: bookingIdParams,
    responses: {
      200: {
        description: 'The cancelled booking.',
        content: json(bookingResponse, {
          ...examples.bookingExample,
          status: 'cancelled',
          cancelledAt: '2026-10-20T10:00:00.000Z',
        }),
      },
      404: problems("You have no booking with this ID. Someone else's booking answers the same.", [
        'not-found',
      ]),
      409: problems('The booking is already cancelled, or its event has started.', [
        'booking-cancelled',
        'event-started',
      ]),
    },
  }),

  endpoint('get', '/health', {
    operationId: 'health',
    tags: ['Health'],
    summary: 'Liveness',
    description:
      "Answers while the process is up. It checks nothing else, so a database outage doesn't get the app restarted.",
    responses: { 200: { description: 'Up.', content: json(healthResponse, { status: 'ok' }) } },
  }),

  endpoint('get', '/ready', {
    operationId: 'ready',
    tags: ['Health'],
    summary: 'Readiness',
    description:
      'Answers 200 when the database answers a query, and 503 when it does not, so a load balancer sends traffic elsewhere until it recovers.',
    responses: {
      200: { description: 'Ready for traffic.', content: json(readyResponse, { status: 'ready' }) },
      503: problems("The database didn't answer.", ['not-ready']),
    },
  }),
];

/** Every operation, by path and then method, as OpenAPI lists them. */
export const paths: ZodOpenApiPathsObject = {};
for (const { method, path, operation } of endpoints) {
  paths[path] = { ...paths[path], [method]: operation };
}

const limits = PRODUCTION_RATE_LIMITS;

const description = `
Book seats at events. Organizers publish events with a fixed number of seats, and people book them. An event is never oversold, however many requests arrive at once.

## Try it on this page

1. Seed the demo data: \`npm run db:seed\`.
2. Open **Log in** below and press **Execute**. It is pre-filled with Alice's demo account: \`${DEMO_EMAILS.alice}\` / \`${DEMO_PASSWORD}\`.
3. This page puts the access token into **Authorize** for you. Every request below is pre-filled with demo data, such as the TypeScript Workshop Alice organizes (one seat left) and her booking for the PostgreSQL intro.

Access tokens last 15 minutes. **Get a new access token** uses the refresh cookie that login set, and this page picks up the new token too.

## Errors

Every error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details object, sent as \`application/problem+json\`. Each response below lists the problem types it can have, and each type links to its explanation in [docs/problems.md](${REPO}/blob/main/docs/problems.md).

## Rate limits

Per IP address, per minute: ${limits.login} failed logins, ${limits.register} registrations, ${limits.refresh} refreshes, and ${limits.api} requests under \`/api/v1\` in all. A refused request gets a 429 with a \`Retry-After\` header. Every response under \`/api/v1\` carries \`RateLimit\` and \`RateLimit-Policy\` headers (IETF draft 8).

## Request IDs

Every response has an \`X-Request-Id\` header. Error bodies repeat it as \`requestId\`, and the server logs it with every line about the request.
`.trim();

const STANDARD_FORMATS = new Set(['date-time', 'uuid', 'email']);

/**
 * Trims what Zod's JSON Schema output adds for machines but makes the docs harder to read:
 * long regexes next to a standard format that says the same, the "safe integer" bounds it
 * puts on every whole number, and `additionalProperties: {}`, which is the default anyway.
 */
const readable: CreateDocumentOptions['override'] = ({ jsonSchema }) => {
  if (typeof jsonSchema.format === 'string' && STANDARD_FORMATS.has(jsonSchema.format)) {
    delete jsonSchema.pattern;
  }
  // z.string().startsWith() says "format: starts_with", which no OpenAPI tool knows; the
  // pattern it also sets carries the rule.
  if (jsonSchema.format === 'starts_with') delete jsonSchema.format;
  if (jsonSchema.maximum === Number.MAX_SAFE_INTEGER) delete jsonSchema.maximum;
  if (jsonSchema.minimum === Number.MIN_SAFE_INTEGER) delete jsonSchema.minimum;
  const extra = jsonSchema.additionalProperties;
  if (typeof extra === 'object' && Object.keys(extra).length === 0) {
    delete jsonSchema.additionalProperties;
  }
};

export const openApiDocument = createDocument(
  {
    openapi: '3.1.0',
    info: {
      title: 'Kursi API',
      version,
      description,
      license: { name: 'MIT', identifier: 'MIT' },
    },
    externalDocs: { description: 'Source code', url: REPO },
    tags: [
      {
        name: 'Auth',
        description:
          'Accounts and sessions. Login gives a 15-minute access token, plus a refresh cookie that trades for the next one.',
      },
      { name: 'Users', description: 'Your account and your bookings.' },
      { name: 'Events', description: 'Browse events, and manage the ones you organize.' },
      { name: 'Bookings', description: 'Take a seat, and give it back.' },
      { name: 'Health', description: 'For load balancers and container orchestrators.' },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'The `accessToken` from **Log in** or **Get a new access token**.',
        },
      },
    },
  },
  { override: readable },
);
