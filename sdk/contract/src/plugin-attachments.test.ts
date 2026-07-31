import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  GIT_REPO_ATTACHMENT_ID,
  GitRepoAttachmentConfigSchema,
  PluginAttachmentValueSchema,
  buildGitRepoAttachment,
  type PluginAttachmentValue,
} from './plugin-attachments.js';

describe('PluginAttachmentValueSchema', () => {
  it('accepts a valid plugin attachment', () => {
    const result = PluginAttachmentValueSchema.safeParse({
      attachmentId: 'att-1',
      pluginName: 'tailscale',
      config: { network: 'my-tailnet' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachmentId).toBe('att-1');
      expect(result.data.pluginName).toBe('tailscale');
      expect(result.data.config).toEqual({ network: 'my-tailnet' });
    }
  });

  it('accepts config as any value (unknown)', () => {
    for (const config of [null, 42, 'a string', [1, 2], { nested: { deep: true } }]) {
      const result = PluginAttachmentValueSchema.safeParse({
        attachmentId: 'att-1',
        pluginName: 'plugin',
        config,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts undefined config', () => {
    const result = PluginAttachmentValueSchema.safeParse({
      attachmentId: 'att-1',
      pluginName: 'plugin',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing attachmentId', () => {
    const result = PluginAttachmentValueSchema.safeParse({
      pluginName: 'tailscale',
      config: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing pluginName', () => {
    const result = PluginAttachmentValueSchema.safeParse({
      attachmentId: 'att-1',
      config: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string attachmentId', () => {
    const result = PluginAttachmentValueSchema.safeParse({
      attachmentId: 123,
      pluginName: 'tailscale',
      config: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string pluginName', () => {
    const result = PluginAttachmentValueSchema.safeParse({
      attachmentId: 'att-1',
      pluginName: 42,
      config: {},
    });
    expect(result.success).toBe(false);
  });

  it('has the expected inferred type', () => {
    expectTypeOf({} as PluginAttachmentValue).toEqualTypeOf<{
      attachmentId: string;
      pluginName: string;
      config?: unknown;
    }>();
  });
});

describe('git-repo attachment helpers', () => {
  it('GitRepoAttachmentConfigSchema accepts repoSlug alone', () => {
    const result = GitRepoAttachmentConfigSchema.safeParse({ repoSlug: 'owner/repo' });
    expect(result.success).toBe(true);
  });

  it('GitRepoAttachmentConfigSchema accepts repoSlug + repoBranch', () => {
    const result = GitRepoAttachmentConfigSchema.safeParse({
      repoSlug: 'owner/repo',
      repoBranch: 'main',
    });
    expect(result.success).toBe(true);
  });

  it('GitRepoAttachmentConfigSchema rejects missing repoSlug', () => {
    const result = GitRepoAttachmentConfigSchema.safeParse({ repoBranch: 'main' });
    expect(result.success).toBe(false);
  });

  it('buildGitRepoAttachment returns undefined for empty slug', () => {
    expect(buildGitRepoAttachment({ repoSlug: '' })).toBeUndefined();
    expect(buildGitRepoAttachment({ repoSlug: null })).toBeUndefined();
    expect(buildGitRepoAttachment({ repoSlug: undefined })).toBeUndefined();
    expect(buildGitRepoAttachment({ repoSlug: '   ' })).toBeUndefined();
  });

  it('buildGitRepoAttachment omits branch when empty', () => {
    const att = buildGitRepoAttachment({ repoSlug: 'owner/repo', repoBranch: '' });
    expect(att).toEqual({
      attachmentId: GIT_REPO_ATTACHMENT_ID,
      pluginName: 'github',
      config: { repoSlug: 'owner/repo' },
    });
  });

  it('buildGitRepoAttachment includes branch when set', () => {
    const att = buildGitRepoAttachment({ repoSlug: 'owner/repo', repoBranch: 'feat/x' });
    expect(att?.config).toEqual({ repoSlug: 'owner/repo', repoBranch: 'feat/x' });
  });

  it('buildGitRepoAttachment trims whitespace', () => {
    const att = buildGitRepoAttachment({ repoSlug: '  owner/repo  ', repoBranch: '  main  ' });
    expect(att?.config).toEqual({ repoSlug: 'owner/repo', repoBranch: 'main' });
  });

  it('GitRepoAttachmentConfigSchema accepts a public repoAccess', () => {
    const result = GitRepoAttachmentConfigSchema.safeParse({
      repoSlug: 'owner/repo',
      repoAccess: 'public',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.repoAccess).toBe('public');
  });

  it('GitRepoAttachmentConfigSchema rejects unknown repoAccess', () => {
    const result = GitRepoAttachmentConfigSchema.safeParse({
      repoSlug: 'owner/repo',
      repoAccess: 'ssh-key',
    });
    expect(result.success).toBe(false);
  });

  it('buildGitRepoAttachment carries public access but omits the connected default', () => {
    const publicAtt = buildGitRepoAttachment({ repoSlug: 'owner/repo', repoAccess: 'public' });
    expect(publicAtt?.config).toEqual({ repoSlug: 'owner/repo', repoAccess: 'public' });

    // The default access mode stays off the config so existing connected
    // attachments serialize byte-for-byte the same as before.
    const connectedAtt = buildGitRepoAttachment({
      repoSlug: 'owner/repo',
      repoAccess: 'connected',
    });
    expect(connectedAtt?.config).toEqual({ repoSlug: 'owner/repo' });
  });
});
