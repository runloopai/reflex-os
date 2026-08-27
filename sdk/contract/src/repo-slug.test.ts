import { describe, expect, it } from 'vitest';
import { blueprintMatchesRepo, normalizeRepoSlug, rankBlueprintsForRepo } from './repo-slug.js';

describe('normalizeRepoSlug', () => {
  it('reduces the forms a repo reference arrives in to one slug', () => {
    for (const input of [
      'acme/web',
      'https://github.com/acme/web',
      'https://github.com/acme/web.git',
      'git@github.com:acme/web.git',
      'https://github.com/acme/web/pull/12#discussion_r1',
      'https://vscode.dev/github/acme/web',
      '  acme/web/  ',
    ]) {
      expect(normalizeRepoSlug(input)).toBe('acme/web');
    }
  });

  it('keeps `github` as an owner on github.com', () => {
    // Only vscode.dev namespaces the provider ahead of the slug.
    expect(normalizeRepoSlug('https://github.com/github/docs')).toBe('github/docs');
  });
});

describe('blueprintMatchesRepo', () => {
  it('matches whichever side stored a URL rather than a bare slug', () => {
    // The two are written by different paths: `metadata.repo` keeps whatever
    // the create form sent, while a git-repo attachment is normalized on save.
    expect(blueprintMatchesRepo({ metadata: { repo: 'acme/web' } }, 'acme/web')).toBe(true);
    expect(
      blueprintMatchesRepo({ metadata: { repo: 'https://github.com/acme/web' } }, 'acme/web'),
    ).toBe(true);
    expect(
      blueprintMatchesRepo({ metadata: { repo: 'acme/web' } }, 'https://github.com/acme/web'),
    ).toBe(true);
  });

  it('does not match a different repo, or a blueprint scoped to none', () => {
    expect(blueprintMatchesRepo({ metadata: { repo: 'acme/web' } }, 'acme/api')).toBe(false);
    expect(blueprintMatchesRepo({ metadata: {} }, 'acme/web')).toBe(false);
    expect(blueprintMatchesRepo({}, 'acme/web')).toBe(false);
  });
});

describe('rankBlueprintsForRepo', () => {
  const web = { name: 'web', metadata: { repo: 'acme/web' } };
  const api = { name: 'api', metadata: { repo: 'acme/api' } };
  // An unscoped blueprint carries the key with nothing in it; `{ name }` alone
  // has no overlap with the parameter type and TS rejects it as a weak type.
  const base = { name: 'base', metadata: {} };

  it('leads with the repo group and keeps each group in its incoming order', () => {
    const web2 = { name: 'web2', metadata: { repo: 'https://github.com/acme/web' } };
    expect(rankBlueprintsForRepo([api, web, base, web2], 'acme/web')).toEqual([
      web,
      web2,
      api,
      base,
    ]);
  });

  it('hides nothing when the repo has no blueprint, and is a no-op without a repo', () => {
    expect(rankBlueprintsForRepo([api, web, base], 'acme/unbuilt')).toEqual([api, web, base]);
    expect(rankBlueprintsForRepo([api, web, base], '')).toEqual([api, web, base]);
  });
});
