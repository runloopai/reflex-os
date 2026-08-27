/**
 * Canonical `owner/repo` normalization, and the blueprint-to-repo match built
 * on it.
 *
 * This lives in the contract package because `repoSlug` is a contract field
 * (`GitRepoAttachmentConfigSchema` in `plugin-attachments.ts`) and because
 * every surface that compares one against a blueprint's `metadata.repo` — the
 * web picker, the launch surfaces, and the CLI — must agree on the answer. Two
 * implementations of this comparison is what let a blueprint rank for a repo
 * on one surface and go unselected on another.
 */

/**
 * Normalize a git-repo reference to its bare `owner/repo` slug.
 *
 * The slug is the repo's identity, so everything a reference carries around it
 * is dropped: the scheme and host (`https://github.com/`, an SSH remote's
 * `git@host:`), a `?query`, a `#fragment`, a clone-only `.git` suffix, trailing
 * slashes, and any path past `owner/repo`, since a deep link like
 * `github.com/acme/web/pull/12#discussion_r1` addresses a page inside the repo
 * rather than a different one. The browser editors resolve the same way,
 * including vscode.dev's `/github/` provider prefix. Short, uniform labels fall
 * out of this as a side benefit.
 */
export function normalizeRepoSlug(repo: string): string {
  const withoutUrlTail = repo.trim().split(/[?#]/, 1)[0];
  // `https://github.com/…` and other web URLs; the host is captured because a
  // couple of them route differently below.
  const web = /^[a-z][a-z0-9+.-]*:\/\/([^/]+)\//i.exec(withoutUrlTail);
  let path = web
    ? withoutUrlTail.slice(web[0].length)
    : // `git@github.com:owner/repo.git` SSH remotes. Both character classes
      // exclude `@` so the user and host parts can't both match the same run of
      // characters — an ambiguity that makes backtracking superlinear on a
      // pathological input like `!@!@!@…`.
      withoutUrlTail.replace(/^[^\s/@]+@[^\s/:@]+:/, '');
  // vscode.dev namespaces the provider ahead of the slug
  // (`vscode.dev/github/acme/web`), so that `github` belongs to the host's
  // routing rather than being the owner. Conditioning on the host matters:
  // `github` is a real owner on github.com (`github.com/github/docs`).
  if (/(^|\.)vscode\.dev$/i.test(web?.[1] ?? '')) path = path.replace(/^github\//i, '');
  return (
    path
      .split('/')
      .filter(Boolean)
      .slice(0, 2)
      .map((segment) => segment.replace(/\.git$/i, ''))
      // Stripping the suffix can empty a segment (`owner/.git` -> `owner`), so
      // drop empties again rather than leaving a dangling separator.
      .filter(Boolean)
      .join('/')
  );
}

/**
 * Whether a blueprint was built for `repoSlug`.
 *
 * Takes the metadata structurally rather than the full `Blueprint` type, the
 * same way {@link isBaseBlueprint} does: the blueprint record stays private to
 * the server and this only ever reads one metadata tag.
 *
 * Both sides normalize because neither is guaranteed to be a bare slug: the
 * repo pickers emit `owner/repo` and the persona service canonicalizes what it
 * stores, but a value that arrives from the API, an import, or a hand-typed
 * URL is kept verbatim on both sides.
 *
 * Normalization drops the host, so `gitlab.com/acme/web` matches a blueprint
 * built for `acme/web`. Nothing but a blueprint suggestion rides on this, so
 * the collision is not worth a host check.
 */
export function blueprintMatchesRepo(
  bp: { metadata?: { repo?: string | null } | null },
  repoSlug: string,
): boolean {
  const bpRepo = bp.metadata?.repo;
  return bpRepo ? normalizeRepoSlug(bpRepo) === normalizeRepoSlug(repoSlug) : false;
}

/**
 * Blueprints built for `repoSlug` first, everything else after, each group
 * keeping its incoming order. Pass an already-deduplicated, already-sorted
 * list; this only re-groups it.
 *
 * The repo ranks the list rather than scoping it — a blueprint built for
 * another repo launches perfectly well, so hiding it only made it unpickable.
 * Shared with the CLI so the two pickers cannot drift on that policy.
 */
export function rankBlueprintsForRepo<T extends { metadata?: { repo?: string | null } | null }>(
  blueprints: T[],
  repoSlug: string,
): T[] {
  if (!repoSlug) return blueprints;
  const forRepo: T[] = [];
  const rest: T[] = [];
  for (const bp of blueprints) {
    (blueprintMatchesRepo(bp, repoSlug) ? forRepo : rest).push(bp);
  }
  return [...forRepo, ...rest];
}
