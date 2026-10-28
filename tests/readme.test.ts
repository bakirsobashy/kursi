import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { paths } from '../src/docs/openapi.js';

// The README is what most reviewers read, so it gets the same treatment as the API docs:
// it fails the build when it stops matching the code.

/** GitHub's anchor for a heading: lowercase, punctuation dropped, spaces to hyphens. */
const anchor = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const MARKDOWN_FILES = ['README.md', 'docs/decisions.md', 'docs/problems.md', 'docs/deployment.md'];

describe('README.md', () => {
  it('lists every documented operation in its endpoint table, and nothing else', () => {
    const readme = readFileSync('README.md', 'utf8');
    const table = readme.slice(readme.indexOf('## Endpoints'), readme.indexOf('## Testing'));
    const listed = [...table.matchAll(/^\| `(GET|POST|PATCH|PUT|DELETE) ([^`]+)`/gm)].map(
      (match) => `${match[1]} ${match[2]}`,
    );

    const documented = Object.entries(paths).flatMap(([path, item]) =>
      Object.keys(item ?? {}).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(listed.toSorted()).toEqual(documented.toSorted());
  });
});

describe('links between the docs', () => {
  it('point at files and headings that exist', () => {
    const broken: string[] = [];
    for (const file of MARKDOWN_FILES) {
      const text = readFileSync(file, 'utf8');
      const targets = [
        ...text.matchAll(/\]\(([^)\s]+)\)/g),
        ...text.matchAll(/<img src="([^"]+)"/g),
      ].map((match) => match[1]!);

      for (const target of targets.filter((t) => !/^(https?:|mailto:)/.test(t))) {
        const [path, hash] = target.split('#');
        const linked = path ? join(dirname(file), path) : file;
        if (!existsSync(linked)) {
          broken.push(`${file}: ${target} (no such file)`);
          continue;
        }
        if (hash) {
          const headings = [...readFileSync(linked, 'utf8').matchAll(/^#{1,6} (.+)$/gm)].map(
            (match) => anchor(match[1]!),
          );
          if (!headings.includes(hash)) broken.push(`${file}: ${target} (no such heading)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
