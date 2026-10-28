import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PROBLEMS } from '../src/lib/errors.js';

// Every error response links to a heading in docs/problems.md. The code can only return the
// problem types in PROBLEMS (anything else doesn't compile), so the doc and that list must match.

/** GitHub's anchor for a heading: lowercase, punctuation dropped, spaces to hyphens. */
const anchor = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

describe('docs/problems.md', () => {
  it('explains every problem type, in the order PROBLEMS lists them, and nothing else', async () => {
    const doc = await readFile('docs/problems.md', 'utf8');
    const headings = [...doc.matchAll(/^## (.+)$/gm)].map((match) => anchor(match[1]!));

    expect(headings).toEqual(Object.keys(PROBLEMS));
  });

  it('states the status that PROBLEMS gives each problem type', async () => {
    const doc = await readFile('docs/problems.md', 'utf8');
    const sections = doc.split(/^## /m).slice(1);

    for (const section of sections) {
      const slug = anchor(section.split('\n', 1)[0]!) as keyof typeof PROBLEMS;
      expect(section, slug).toContain(`**${PROBLEMS[slug].status}.**`);
    }
  });
});
