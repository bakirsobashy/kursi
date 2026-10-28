// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'coverage/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // The docs page's start-up script runs in the browser, after Swagger UI's bundle.
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { window: 'readonly', URL: 'readonly', SwaggerUIBundle: 'readonly' },
    },
  },
  // Last, so it switches off any style rule that would fight Prettier.
  prettier,
);
