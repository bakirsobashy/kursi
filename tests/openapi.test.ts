import SwaggerParser from '@apidevtools/swagger-parser';
import type { Router } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type {
  ZodOpenApiMediaTypeObject,
  ZodOpenApiOperationObject,
  ZodOpenApiResponseObject,
} from 'zod-openapi';
import { seed } from '../src/db/seed.js';
import { loginExamples } from '../src/docs/examples.js';
import { paths } from '../src/docs/openapi.js';
import { apiRouter } from '../src/routes/api.js';
import { authRouter } from '../src/routes/auth.js';
import { bookingsRouter } from '../src/routes/bookings.js';
import { eventsRouter } from '../src/routes/events.js';
import { healthRouter } from '../src/routes/health.js';
import { usersRouter } from '../src/routes/users.js';
import { api, bearer, resetDb } from './helpers.js';

const operations = Object.entries(paths).flatMap(([path, item]) =>
  Object.entries(item ?? {}).map(([method, operation]) => ({
    method,
    path,
    operation: operation as ZodOpenApiOperationObject,
  })),
);

const documented = operations.map(({ method, path }) => `${method.toUpperCase()} ${path}`);

/** The path with {id} replaced by the example ID that Swagger UI pre-fills. */
function examplePath({ path, operation }: (typeof operations)[number]) {
  const params = operation.requestParams?.path as z.ZodObject | undefined;
  const id: unknown = params?.shape.id?.meta()?.example;
  return path.replace('{id}', String(id));
}

describe('GET /openapi.json', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    const res = await api().get('/openapi.json');

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    // validate() rewrites what it's given while it resolves $refs.
    await expect(SwaggerParser.validate(structuredClone(res.body))).resolves.toBeDefined();
  });

  it('documents every route the app has, and only those', () => {
    // Each router with the prefix it is mounted at in src/app.ts and src/routes/api.ts.
    const mounted: [string, Router][] = [
      ['', healthRouter],
      ['/api/v1/auth', authRouter],
      ['/api/v1/users', usersRouter],
      ['/api/v1/events', eventsRouter],
      ['/api/v1/bookings', bookingsRouter],
    ];
    // If src/routes/api.ts mounts a router that isn't listed above, this list is incomplete.
    expect(apiRouter.stack.map((layer) => layer.handle)).toEqual(
      mounted.slice(1).map(([, router]) => router),
    );

    const routes = mounted.flatMap(([prefix, router]) =>
      router.stack.flatMap((layer) =>
        Object.keys((layer.route as { methods?: object } | undefined)?.methods ?? {}).map(
          (method) =>
            `${method.toUpperCase()} ${prefix}${layer.route!.path}`
              .replace(/\/$/, '')
              .replace(/:(\w+)/g, '{$1}'),
        ),
      ),
    );

    expect(routes.toSorted()).toEqual(documented.toSorted());
  });

  it('describes each operation, and lists errors for anything that can fail', () => {
    for (const { method, path, operation } of operations) {
      const name = `${method.toUpperCase()} ${path}`;
      expect(operation.operationId, name).toBeTruthy();
      expect(operation.summary, name).toBeTruthy();
      expect(operation.tags, name).toHaveLength(1);
      expect(Object.keys(operation.responses ?? {}), name).toContain('default');
    }
  });

  it('has examples that match their own schemas', () => {
    const checkMedia = (where: string, media: ZodOpenApiMediaTypeObject | undefined) => {
      if (!media) return;
      const schema = media.schema as z.ZodType;
      const values = [
        ...(media.example === undefined ? [] : [media.example]),
        ...Object.values(media.examples ?? {}).map(
          (example) => (example as { value: unknown }).value,
        ),
      ];
      for (const value of values) {
        const result = schema.safeParse(value);
        expect(
          result.success,
          `${where}: ${result.error ? z.prettifyError(result.error) : ''}`,
        ).toBe(true);
      }
    };

    let checked = 0;
    for (const { method, path, operation } of operations) {
      const name = `${method.toUpperCase()} ${path}`;
      checkMedia(`${name} request`, operation.requestBody?.content['application/json']);
      for (const [code, response] of Object.entries(
        operation.responses as Record<string, ZodOpenApiResponseObject>,
      )) {
        for (const [type, media] of Object.entries(response.content ?? {})) {
          checkMedia(`${name} ${code} ${type}`, media);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('answers every documented operation, so none of them is a route that is gone', async () => {
    for (const operation of operations) {
      const res = await api()[operation.method as 'get' | 'post' | 'patch'](examplePath(operation));

      expect(res.body.type ?? '', `${operation.method} ${operation.path}`).not.toMatch(
        /#route-not-found$/,
      );
    }
  });
});

describe('the "Try it out" examples, on seeded demo data', () => {
  beforeAll(async () => {
    await resetDb();
    await seed();
  });

  const find = (operationId: string) => {
    const found = operations.find(({ operation }) => operation.operationId === operationId);
    if (!found) throw new Error(`No operation ${operationId}`);
    return found;
  };

  it('logs in with the pre-filled demo account, and then works as it is', async () => {
    const login = await api().post('/api/v1/auth/login').send(loginExamples.alice.value);
    expect(login.status).toBe(200);
    const token = bearer(login.body.accessToken);

    const call = (operationId: string) => {
      const operation = find(operationId);
      return api()
        [operation.method as 'get' | 'post'](examplePath(operation))
        .set('Authorization', token);
    };

    expect((await call('getMe')).body.email).toBe(loginExamples.alice.value.email);
    expect((await call('getEvent')).body.title).toBe('TypeScript Workshop');
    expect((await call('listAttendees')).body.meta.total).toBe(2);
    expect((await call('bookSeat')).status).toBe(201);
    expect((await call('bookSeat')).body.type).toMatch(/#already-booked$/);
    expect((await call('cancelBooking')).status).toBe(200);
  });

  it('logs in with every demo account in the examples list', async () => {
    for (const { value } of Object.values(loginExamples)) {
      expect((await api().post('/api/v1/auth/login').send(value)).status).toBe(200);
    }
  });
});

describe('GET /docs', () => {
  it('serves Swagger UI with no inline script, from this origin only', async () => {
    const res = await api().get('/docs');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(res.headers['content-security-policy']).toMatch(/script-src 'self';/);

    const assets = [...res.text.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]!);
    expect(assets).toEqual([
      '/docs/swagger-ui.css',
      '/docs/favicon-32x32.png',
      '/docs/swagger-ui-bundle.js',
      '/docs/init.js',
    ]);
    for (const asset of assets) {
      const file = await api().get(asset);
      expect(file.status, asset).toBe(200);
      expect(file.headers['content-type'], asset).toMatch(/css|png|javascript/);
    }
  });

  it('serves nothing else from swagger-ui-dist, such as its demo page', async () => {
    for (const path of ['/docs/index.html', '/docs/swagger-initializer.js', '/docs/package.json']) {
      expect((await api().get(path)).status, path).toBe(404);
    }
  });

  it('points Swagger UI at /openapi.json and authorizes it after a login', async () => {
    const init = await api().get('/docs/init.js');

    expect(init.text).toContain("url: '/openapi.json'");
    expect(init.text).toContain("preauthorizeApiKey('bearerAuth'");
  });
});
