import type { OutgoingHttpHeaders, RequestListener } from 'node:http';
import { z } from 'zod';
import type { ZodOpenApiOperationObject, ZodOpenApiResponseObject } from 'zod-openapi';
import { paths } from '../src/docs/openapi.js';
import { problem } from '../src/schemas/problem.js';
import { recordViolation } from './contract-violations.js';

/*
 * Holds every response the tests get to the API docs. Wrapped around the app (see `api` in
 * helpers.ts), it checks each response against the operation the docs give for its method and
 * path: the status must be listed, and the body and headers must match the documented schemas.
 * Mismatches fail the test that caused them, so the docs can't fall behind the code.
 */

interface Route {
  method: string;
  template: string;
  pattern: RegExp;
  operation: ZodOpenApiOperationObject;
}

const routes: Route[] = Object.entries(paths).flatMap(([template, item]) =>
  Object.entries(item ?? {}).map(([method, operation]) => ({
    method: method.toUpperCase(),
    template,
    // Express matches paths case-insensitively and with or without a trailing slash.
    pattern: new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}/?$`, 'i'),
    operation: operation as ZodOpenApiOperationObject,
  })),
);

/** The docs themselves, which answer outside the API description on purpose. */
const DOCS_PAGES = /^\/(docs(\/.*)?|openapi\.json)$/;

const headerValue = (value: OutgoingHttpHeaders[string]) =>
  Array.isArray(value) ? value.join(', ') : value === undefined ? undefined : String(value);

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Returns what is wrong with a response, or undefined if the docs describe it. */
export function check(
  method: string,
  url: string,
  status: number,
  headers: OutgoingHttpHeaders,
  body: string,
): string | undefined {
  // Preflights are answered by the CORS middleware, and HEAD is GET without a body.
  if (method === 'OPTIONS' || method === 'HEAD') return undefined;

  const path = url.split('?', 1)[0]!;
  const route = routes.find((r) => r.method === method && r.pattern.test(path));
  if (!route) {
    if (DOCS_PAGES.test(path)) return undefined;
    // A path the docs don't have may still fail properly: route-not-found, or a body the
    // JSON parser refused before routing. Anything else means a route the docs are missing.
    if (status >= 400 && problem.safeParse(parseJson(body)).success) return undefined;
    return `${method} ${path} answered ${status}, but the API docs have no ${method} ${path}`;
  }

  const label = `${method} ${route.template} answered ${status}`;
  const responses = route.operation.responses as Record<string, ZodOpenApiResponseObject>;
  // `default` documents the unexpected server errors that any route can have.
  const response = responses[String(status)] ?? (status >= 500 ? responses.default : undefined);
  if (!response) return `${label}, a status its docs don't list`;

  const contentType = headerValue(headers['content-type'])?.split(';', 1)[0];
  if (!response.content) {
    if (body !== '') return `${label} with a body, but its docs say it has none`;
  } else {
    const media = contentType === undefined ? undefined : response.content[contentType];
    if (!media) {
      return `${label} as ${contentType ?? 'no content type'}; its docs say ${Object.keys(response.content).join(' or ')}`;
    }
    const result = (media.schema as z.ZodType).safeParse(parseJson(body));
    if (!result.success) {
      return `${label} with a body its docs don't describe:\n${z.prettifyError(result.error)}\n${body}`;
    }
  }

  if (response.headers instanceof z.ZodObject) {
    const values = Object.fromEntries(
      Object.keys(response.headers.shape).map((name) => [
        name,
        headerValue(headers[name.toLowerCase()]),
      ]),
    );
    const result = response.headers.safeParse(values);
    if (!result.success) {
      return `${label} with headers its docs don't describe:\n${z.prettifyError(result.error)}`;
    }
  }
  return undefined;
}

/** The app, with every response it sends checked against the API docs. */
export function withContractCheck(app: RequestListener): RequestListener {
  return (req, res) => {
    // Read now: routers rewrite req.url as they hand the request on.
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    const chunks: Buffer[] = [];
    const collect = (chunk: unknown) => {
      if (typeof chunk === 'string' || chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
    };
    const write = res.write.bind(res);
    const end = res.end.bind(res);

    res.write = ((chunk: unknown, ...rest: unknown[]) => {
      collect(chunk);
      return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof res.write;

    // Checked as the response ends: its status and headers are final by then, and the test
    // can't have seen the response yet, so the verdict is in before the test finishes.
    res.end = ((chunk?: unknown, ...rest: unknown[]) => {
      collect(chunk);
      const violation = check(
        method,
        url,
        res.statusCode,
        res.getHeaders(),
        Buffer.concat(chunks).toString('utf8'),
      );
      if (violation) recordViolation(violation);
      return (end as (...args: unknown[]) => typeof res)(chunk, ...rest);
    }) as typeof res.end;

    app(req, res);
  };
}
