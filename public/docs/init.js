// Starts Swagger UI on the API's OpenAPI document. A login or refresh made on this page puts
// the new access token into "Authorize", so the protected routes work straight away, and a
// logout takes it out again.
'use strict';

const TOKEN_ROUTES = new Set(['/api/v1/auth/login', '/api/v1/auth/refresh']);

const ui = SwaggerUIBundle({
  url: '/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  // Every operation opens ready to run: press Execute, no "Try it out" first.
  tryItOutEnabled: true,
  displayRequestDuration: true,
  defaultModelsExpandDepth: 0,
  // Swagger UI would otherwise send the document to an outside validator.
  validatorUrl: null,
  responseInterceptor(response) {
    const path = new URL(response.url, window.location.origin).pathname;
    if (response.ok && TOKEN_ROUTES.has(path) && response.body?.accessToken) {
      ui.preauthorizeApiKey('bearerAuth', response.body.accessToken);
    } else if (response.ok && path === '/api/v1/auth/logout') {
      ui.authActions.logout(['bearerAuth']);
    }
    return response;
  },
});
