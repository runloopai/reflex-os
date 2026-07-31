import { z } from 'zod';

/**
 * A plugin-contributed attachment on an agent: which plugin owns it, which
 * attachment kind it is, and an opaque per-kind config the owning plugin
 * parses. The host never interprets `config`.
 */
export const PluginAttachmentValueSchema = z.object({
  attachmentId: z.string(),
  pluginName: z.string(),
  config: z.unknown().optional(),
});
export type PluginAttachmentValue = z.infer<typeof PluginAttachmentValueSchema>;

// The git-repo attachment is defined here rather than in the GitHub plugin so
// every consumer (server, plugins, web, and the SDKs) can read a repo slug and
// branch off an agent's attachments without depending on that plugin.

export const GIT_REPO_ATTACHMENT_ID = 'git-repo';

/**
 * How a GitHub repository is mounted onto a devbox or into a blueprint:
 *
 *   - `connected`: clone through a GitHub App installation token (private or
 *     org repos the caller has connected access to).
 *   - `public`: clone anonymously over HTTPS, no installation required.
 */
export const RepoAccessSchema = z.enum(['connected', 'public']);
export type RepoAccess = z.infer<typeof RepoAccessSchema>;

export const GitRepoAttachmentConfigSchema = z.object({
  /** GitHub repository identifier in 'owner/repo' format (e.g., 'runloop/reflex'). */
  repoSlug: z.string(),
  /** Branch to check out. Omit to use the repository's default branch, resolved at setup time. */
  repoBranch: z.string().optional(),
  /** How the repo is mounted. Defaults to connected GitHub App access. */
  repoAccess: RepoAccessSchema.optional(),
});
export type GitRepoAttachmentConfig = z.infer<typeof GitRepoAttachmentConfigSchema>;

/**
 * Build a `git-repo` plugin attachment value from a raw repoSlug/repoBranch
 * pair. Returns `undefined` when `repoSlug` is empty so callers can drop
 * falsy inputs without an extra null check.
 */
export function buildGitRepoAttachment(input: {
  repoSlug?: string | null;
  repoBranch?: string | null;
  repoAccess?: RepoAccess | null;
}): PluginAttachmentValue | undefined {
  const repoSlug = input.repoSlug?.trim();
  if (!repoSlug) return undefined;
  const repoBranch = input.repoBranch?.trim() || undefined;
  const config: GitRepoAttachmentConfig = {
    repoSlug,
    ...(repoBranch ? { repoBranch } : {}),
    // Only carry a non-default access mode so existing connected configs stay
    // byte-for-byte unchanged (and equality checks against them keep passing).
    ...(input.repoAccess && input.repoAccess !== 'connected'
      ? { repoAccess: input.repoAccess }
      : {}),
  };
  return {
    attachmentId: GIT_REPO_ATTACHMENT_ID,
    pluginName: 'github',
    config,
  };
}
