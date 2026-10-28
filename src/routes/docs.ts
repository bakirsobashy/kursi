import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { openApiDocument } from '../docs/openapi.js';

/*
 * The API docs: the OpenAPI document as JSON, and Swagger UI rendering it at /docs.
 * Our own page and start-up script come from public/docs; the UI itself from the
 * swagger-ui-dist package, of which only the three files the page loads are served.
 */

const swaggerUi = dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'));
// Two levels up from both src/routes and dist/routes, so it works in development and built.
const page = fileURLToPath(new URL('../../public/docs/', import.meta.url));

const files: Record<string, string> = {
  '/docs': join(page, 'index.html'),
  '/docs/init.js': join(page, 'init.js'),
  '/docs/swagger-ui.css': join(swaggerUi, 'swagger-ui.css'),
  '/docs/swagger-ui-bundle.js': join(swaggerUi, 'swagger-ui-bundle.js'),
  '/docs/favicon-32x32.png': join(swaggerUi, 'favicon-32x32.png'),
};

export const docsRouter = Router();

docsRouter.get('/openapi.json', (_req, res) => {
  res.json(openApiDocument);
});

for (const [path, file] of Object.entries(files)) {
  docsRouter.get(path, (_req, res) => {
    res.sendFile(file);
  });
}
