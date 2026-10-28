import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every error response links to a heading in docs/problems.md. This fails when code
// starts returning a problem type that the doc doesn't explain.

/** GitHub's anchor for a heading: lowercase, punctuation dropped, spaces to hyphens. */
const anchor = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('docs/problems.md', () => {
  it('has a heading for every problem type the code can return', async () => {
    const doc = await readFile('docs/problems.md', 'utf8');
    const headings = new Set([...doc.matchAll(/^## (.+)$/gm)].map((match) => anchor(match[1]!)));

    const slugs = new Set<string>();
    for (const file of await sourceFiles('src')) {
      const code = await readFile(file, 'utf8');
      for (const match of code.matchAll(/slug: '([a-z0-9-]+)'|problemType\('([a-z0-9-]+)'\)/g)) {
        slugs.add((match[1] ?? match[2])!);
      }
    }

    expect(slugs.size).toBeGreaterThan(5);
    expect([...slugs].filter((slug) => !headings.has(slug))).toEqual([]);
  });
});
