import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  addOrgMember,
  addTeamMember,
  assignOrgRole,
  createMyModelProviderSecret,
  createOrgInvite,
  createOrgTeam,
  createOrganization,
  createPersonalApiKey,
  deleteFeatureFlagOverride,
  deleteOrganization,
  deleteTeam,
  getBaseImage,
  getFeatureFlagOverrides,
  getOrgPlugin,
  getOrgPluginSettings,
  getOrgRole,
  getOrgSecretsStatus,
  getOrganization,
  getReflexConfig,
  getSandboxProvider,
  getSandboxProviderHealth,
  getTeam,
  getUser,
  getUserProviders,
  installOrgPlugin,
  listAccessibleModelProviderSecrets,
  listFeatureFlags,
  listOrgInvites,
  listOrgMembers,
  listOrgPlugins,
  listOrgRoles,
  listOrgTeams,
  listOrganizations,
  listTeamMembers,
  listUsers,
  previewOrgPluginUninstall,
  rebuildBaseImage,
  removeOrgMember,
  removeTeamMember,
  revokeOrgInvite,
  revokeOrgRole,
  revokePersonalApiKey,
  setFeatureFlag,
  setFeatureFlagOverride,
  setOrgPluginSettings,
  setOrgSecret,
  setSandboxProvider,
  setTeamMemberRole,
  uninstallOrgPlugin,
  updateOrganization,
  updateTeam,
  validateSandboxProvider,
  CreateMyModelProviderSecretBodyProvider,
  CreateMyModelProviderSecretBodyType,
  type CreateMyModelProviderSecretBody,
  type CreateOrgTeamBody,
  type CreatePersonalApiKey201,
  type FeatureFlag,
  type FlagUserOverride,
  type ListUsersParams,
  type ModelProviderSecret,
  type Organization,
  type UpdateOrganizationBody,
  type UpdateTeamBody,
  type User,
} from '@runloop/reflex-client';
import { defaultConfigPath, updateSavedConfig } from '../config.js';
import { UsageError } from '../output/errors.js';
import { colorStatus, formatRelativeTime, renderKv, renderTable } from '../output/table.js';
import type { CommandGroup } from './define.js';

/**
 * The admin surface: org, team, role, plugin, sandbox, secret, key, flag,
 * and user management, declared through define.ts like every other command.
 * The server enforces authorization; these commands relay 403s (with the
 * shared error hint) instead of pre-checking roles.
 *
 * Several org endpoints do not declare an OpenAPI response schema yet, so
 * the generated client types their data as `void`. The local *View types
 * below mirror what the server actually sends and keep the renders honest;
 * they go away as slice 2 backfills `responses:` on those routes.
 */

// ── Server response views (routes without a response schema yet) ─────

interface RoleView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  permissions: string[];
}

interface OrgMemberView {
  userId: string;
  memberId: string;
  roles: RoleView[];
}

interface TeamView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  defaultRoleId?: string | null;
  createdAt: number;
}

interface TeamMemberView {
  userId: string;
  memberId: string;
  role: RoleView | null;
}

interface InviteView {
  id: string;
  email: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  tokenLast4: string;
}

interface PluginView {
  pluginName: string;
  status: string;
  version: string;
  description?: string;
  installedAt: number | null;
  dependencies: string[];
  dependents: string[];
  lastError: string | null;
  unavailableReason?: string;
}

interface SecretStatusItemView {
  key: string;
  label: string;
  required: boolean;
  isSet: boolean;
  source: string;
}

interface SandboxAccountView {
  id: string;
  name: string;
  tier?: string;
  tierLabel?: string;
}

// ── Pure helpers (exported for tests) ────────────────────────────────

/** Parse a boolean CLI value: true/false, on/off, 1/0, yes/no. */
export function parseBooleanValue(value: string, label: string): boolean {
  const v = value.trim().toLowerCase();
  if (['true', 'on', '1', 'yes', 'enabled'].includes(v)) return true;
  if (['false', 'off', '0', 'no', 'disabled'].includes(v)) return false;
  throw new UsageError(`${label} expects true or false, got: ${value}`);
}

/**
 * Parse repeated `key=value` pairs into a settings patch. Values parse as
 * JSON when they can (numbers, booleans, null, objects) and stay strings
 * otherwise, so `--set retries=3` and `--set channel=beta` both do what
 * they look like.
 */
export function parseSettingPairs(pairs: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new UsageError(`--set expects key=value, got: ${pair}`);
    const key = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    try {
      out[key] = JSON.parse(raw) as unknown;
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

/** The question `orgs plugins uninstall` asks, with the cascade spelled out. */
export function formatUninstallConfirm(name: string, cascaded: string[]): string {
  const extra = cascaded.length
    ? ` This also uninstalls the plugins that depend on it: ${cascaded.join(', ')}.`
    : '';
  return `Uninstall ${name} from the org?${extra}`;
}

// ── Input helpers ────────────────────────────────────────────────────

/** Read one line from a TTY without echoing it (for secret values). */
function promptHidden(label: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    // Readline echoes keystrokes through _writeToOutput; muting it keeps
    // the secret off the terminal while input still works.
    (rl as unknown as { _writeToOutput: (chunk: string) => void })._writeToOutput = () => {};
    process.stderr.write(label);
    rl.question('', (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer.trim());
    });
  });
}

/**
 * Resolve a secret value without ever taking it as a positional argument
 * (positionals land in shell history and process lists): an explicit flag
 * first, then piped stdin, then a hidden prompt on a TTY.
 */
async function resolveSecretValue(
  flagValue: unknown,
  flagName: string,
  promptLabel: string,
): Promise<string> {
  if (typeof flagValue === 'string' && flagValue.trim() !== '') return flagValue.trim();
  if (!process.stdin.isTTY) {
    const piped = readFileSync(0, 'utf8').trim();
    if (piped !== '') return piped;
    throw new UsageError(`Provide the value with ${flagName} or pipe it on stdin.`);
  }
  const typed = await promptHidden(promptLabel);
  if (typed === '') throw new UsageError('Empty value; nothing saved.');
  return typed;
}

/**
 * Resolve the org id for a path-scoped operation: an explicit argument
 * first, then the active org from `--org` / config. Slugs resolve to ids
 * through the membership list, since the org routes take ids only.
 */
async function resolveOrgId(explicit?: string): Promise<string> {
  const raw = explicit && explicit.trim() !== '' ? explicit : getReflexConfig().organizationId;
  if (!raw) {
    throw new UsageError(
      'No organization selected. Pass --org <org> or run `reflex-cli orgs use <org>`.',
    );
  }
  if (raw.startsWith('org_')) return raw;
  const { organizations } = (await listOrganizations()).data;
  const match = organizations.find((m) => m.organization.id === raw || m.organization.slug === raw);
  return match ? match.organization.id : raw;
}

/** Accept a user id as-is; resolve an email through the visible user list. */
async function resolveUserId(arg: string): Promise<string> {
  if (!arg.includes('@')) return arg;
  const users = (await listUsers()).data;
  const matches = users.filter((u) => u.email.toLowerCase() === arg.toLowerCase());
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) {
    throw new UsageError(`No visible user has the email ${arg}. Pass a user id (usr_...).`);
  }
  throw new UsageError(`Several users share ${arg}. Pass a user id (usr_...).`);
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

// ── Shared renders ───────────────────────────────────────────────────

function renderRolesCell(roles: RoleView[]): string {
  return roles.map((role) => role.name).join(', ');
}

function renderTeamMembers(members: TeamMemberView[]): string {
  if (!members.length) return 'No members.';
  return renderTable(
    [
      { key: 'user', header: 'user' },
      { key: 'role', header: 'role' },
    ],
    members.map((m) => ({ user: m.userId, role: m.role?.name ?? '' })),
  );
}

function renderTeams(teams: TeamView[]): string {
  if (!teams.length) return 'No teams.';
  return renderTable(
    [
      { key: 'id', header: 'id' },
      { key: 'slug', header: 'slug' },
      { key: 'name', header: 'name' },
      { key: 'description', header: 'description' },
    ],
    teams.map((team) => ({
      id: team.id,
      slug: team.slug,
      name: team.name,
      description: team.description ?? '',
    })),
  );
}

function renderOrg(org: Organization): string {
  return renderKv([
    ['id', org.id],
    ['slug', org.slug],
    ['name', org.name],
    ['personal', org.isPersonal ? 'yes' : undefined],
    ['status', org.status],
    ['support email', org.supportEmail ?? undefined],
    ['capabilities', org.capabilities.length ? org.capabilities.join(', ') : undefined],
    ['default sandbox size', org.defaultSandboxSize ?? undefined],
    [
      'sandbox retention days',
      org.sandboxRetentionDays != null ? String(org.sandboxRetentionDays) : undefined,
    ],
    ['created', formatRelativeTime(org.createdAt)],
  ]);
}

function pluginRow(view: PluginView, kind: string): Record<string, string> {
  return {
    name: view.pluginName,
    kind,
    status: colorStatus(view.status),
    version: view.version,
    description: view.description ?? '',
  };
}

// ── Command declarations ─────────────────────────────────────────────

export function adminCommandGroups(): CommandGroup[] {
  return [
    {
      noun: 'orgs',
      summary: 'inspect and administer your organizations',
      commands: [
        {
          name: 'show [org]',
          summary: 'show one organization (defaults to the active org)',
          fetch: async ([org]) => (await getOrganization(await resolveOrgId(org))).data,
          render: (data) => renderOrg(data as Organization),
        },
        {
          name: 'use <org>',
          summary: 'set the default organization for every scoped command',
          fetch: async ([org]) => {
            const { organizations } = (await listOrganizations()).data;
            const match = organizations.find(
              (m) => m.organization.id === org || m.organization.slug === org,
            );
            if (!match) {
              const slugs = organizations.map((m) => m.organization.slug).join(', ');
              throw new UsageError(
                `You do not belong to an organization "${org}".${slugs ? ` Yours: ${slugs}.` : ''}`,
              );
            }
            const path = defaultConfigPath();
            updateSavedConfig({ organizationId: match.organization.id }, path);
            return { organization: match.organization, configPath: path };
          },
          render: (data) => {
            const { organization: org, configPath } = data as {
              organization: Organization;
              configPath: string;
            };
            return `Active organization is now ${org.name} (${org.slug}). Saved to ${configPath}.`;
          },
        },
        {
          name: 'create',
          summary: 'create an organization with you as its owner',
          options: [
            { flags: '--name <name>', description: 'organization name (required)' },
            { flags: '--slug <slug>', description: 'URL slug (default: derived from the name)' },
            { flags: '--support-email <email>', description: 'support contact email' },
          ],
          fetch: async (_args, opts) => {
            const name = optString(opts.name);
            if (!name) throw new UsageError('Organizations need a name: --name <name>.');
            return (
              await createOrganization({
                name,
                ...(optString(opts.slug) ? { slug: opts.slug as string } : {}),
                ...(optString(opts.supportEmail)
                  ? { supportEmail: opts.supportEmail as string }
                  : {}),
              })
            ).data;
          },
          render: (data) => {
            const org = data as unknown as Organization;
            return `Created ${org.name} (${org.slug}, ${org.id}).`;
          },
        },
        {
          name: 'update <org>',
          summary: 'update an organization; complex fields go through `api updateOrganization`',
          options: [
            { flags: '--name <name>', description: 'new name' },
            { flags: '--slug <slug>', description: 'new URL slug' },
            { flags: '--support-email <email>', description: 'support contact email' },
            { flags: '--avatar-url <url>', description: 'avatar image URL' },
            { flags: '--default-sandbox-size <size>', description: 'default devbox size' },
            { flags: '--sandbox-retention-days <n>', description: 'devbox retention in days' },
          ],
          fetch: async ([org], opts) => {
            const body: UpdateOrganizationBody = {
              ...(optString(opts.name) ? { name: opts.name as string } : {}),
              ...(optString(opts.slug) ? { slug: opts.slug as string } : {}),
              ...(optString(opts.supportEmail)
                ? { supportEmail: opts.supportEmail as string }
                : {}),
              ...(optString(opts.avatarUrl) ? { avatarUrl: opts.avatarUrl as string } : {}),
              ...(optString(opts.defaultSandboxSize)
                ? { defaultSandboxSize: opts.defaultSandboxSize as string }
                : {}),
            };
            if (optString(opts.sandboxRetentionDays)) {
              const days = Number(opts.sandboxRetentionDays);
              if (!Number.isInteger(days)) {
                throw new UsageError('--sandbox-retention-days expects a whole number.');
              }
              body.sandboxRetentionDays = days;
            }
            if (Object.keys(body).length === 0) {
              throw new UsageError('Nothing to update: pass at least one field flag.');
            }
            return (await updateOrganization(await resolveOrgId(org), body)).data;
          },
          render: (data) => renderOrg(data as unknown as Organization),
        },
        {
          name: 'delete <org>',
          summary: 'permanently delete an organization and all of its data',
          confirm: ([org]) =>
            `Permanently delete organization ${org} and every org-scoped record with it ` +
            '(teams, members, roles, secrets, agents, invites, plugin data)? This cannot be undone.',
          fetch: async ([org]) => (await deleteOrganization(await resolveOrgId(org))).data,
          render: (_data, [org]) => `Deleted ${org}.`,
        },
      ],
    },
    {
      noun: 'orgs members',
      summary: 'manage who belongs to the active org',
      commands: [
        {
          name: 'list',
          summary: 'list the members of the active org and their roles',
          fetch: async () => (await listOrgMembers(await resolveOrgId())).data,
          render: (data) => {
            const { members } = data as unknown as { members: OrgMemberView[] };
            if (!members.length) return 'No members.';
            return renderTable(
              [
                { key: 'user', header: 'user' },
                { key: 'member', header: 'member' },
                { key: 'roles', header: 'roles' },
              ],
              members.map((m) => ({
                user: m.userId,
                member: m.memberId,
                roles: renderRolesCell(m.roles),
              })),
            );
          },
        },
        {
          name: 'add <user>',
          summary: 'add an existing user to the org, by user id or email',
          fetch: async ([user]) =>
            (await addOrgMember(await resolveOrgId(), { userId: await resolveUserId(user) })).data,
          render: (_data, [user]) => `Added ${user}.`,
        },
        {
          name: 'rm <userId>',
          summary: 'remove a member from the org',
          fetch: async ([userId]) => (await removeOrgMember(await resolveOrgId(), userId)).data,
          render: (_data, [userId]) => `Removed ${userId}.`,
        },
      ],
    },
    {
      noun: 'orgs invites',
      summary: 'invite people to the active org by email',
      commands: [
        {
          name: 'list',
          summary: 'list invites, pending ones by default',
          options: [
            {
              flags: '--status <status>',
              description: 'filter: pending, consumed, revoked, declined, or all',
            },
          ],
          fetch: async (_args, opts) =>
            (
              await listOrgInvites(
                await resolveOrgId(),
                optString(opts.status) ? { status: opts.status as string } : undefined,
              )
            ).data,
          render: (data) => {
            const { invites } = data as unknown as { invites: InviteView[] };
            if (!invites.length) return 'No invites.';
            return renderTable(
              [
                { key: 'id', header: 'id' },
                { key: 'email', header: 'email' },
                { key: 'status', header: 'status' },
                { key: 'created', header: 'created' },
                { key: 'expires', header: 'expires' },
              ],
              invites.map((invite) => ({
                id: invite.id,
                email: invite.email,
                status: colorStatus(invite.status),
                created: formatRelativeTime(invite.createdAt),
                expires: new Date(invite.expiresAt).toISOString().slice(0, 10),
              })),
            );
          },
        },
        {
          name: 'create',
          summary: 'invite a user by email; the link is shown once',
          options: [{ flags: '--email <email>', description: 'email to invite (required)' }],
          fetch: async (_args, opts) => {
            const email = optString(opts.email);
            if (!email) throw new UsageError('Invites need an email: --email <email>.');
            return (await createOrgInvite(await resolveOrgId(), { email })).data;
          },
          render: (data) => {
            const { invite, redeemUrl } = data as unknown as {
              invite: InviteView;
              redeemUrl: string;
            };
            return [
              `Invited ${invite.email} (${invite.id}).`,
              '',
              `  ${redeemUrl}`,
              '',
              'The link is shown only once and cannot be retrieved again. Copy it now.',
            ].join('\n');
          },
        },
        {
          name: 'revoke <inviteId>',
          summary: 'revoke an invite so its link stops working',
          fetch: async ([inviteId]) => (await revokeOrgInvite(await resolveOrgId(), inviteId)).data,
          render: (_data, [inviteId]) => `Revoked ${inviteId}.`,
        },
      ],
    },
    {
      noun: 'orgs teams',
      summary: 'list and create teams in the active org',
      commands: [
        {
          name: 'list',
          summary: 'list the teams in the active org',
          fetch: async () => (await listOrgTeams(await resolveOrgId())).data,
          render: (data) => renderTeams((data as unknown as { teams: TeamView[] }).teams),
        },
        {
          name: 'create',
          summary: 'create a team and join it as its maintainer',
          options: [
            { flags: '--name <name>', description: 'team name (required)' },
            { flags: '--slug <slug>', description: 'URL slug (default: derived from the name)' },
            { flags: '--description <text>', description: 'what the team is for' },
            { flags: '--default-role <roleId>', description: 'role new members get' },
          ],
          fetch: async (_args, opts) => {
            const name = optString(opts.name);
            if (!name) throw new UsageError('Teams need a name: --name <name>.');
            const body: CreateOrgTeamBody = {
              name,
              ...(optString(opts.slug) ? { slug: opts.slug as string } : {}),
              ...(optString(opts.description) ? { description: opts.description as string } : {}),
              ...(optString(opts.defaultRole) ? { defaultRoleId: opts.defaultRole as string } : {}),
            };
            return (await createOrgTeam(await resolveOrgId(), body)).data;
          },
          render: (data) => {
            const team = data as unknown as TeamView;
            return `Created team ${team.name} (${team.id}).`;
          },
        },
      ],
    },
    {
      noun: 'teams',
      summary: 'inspect and manage a team by id',
      commands: [
        {
          name: 'show <teamId>',
          summary: 'show a team and its members',
          fetch: async ([teamId]) => (await getTeam(teamId)).data,
          render: (data) => {
            const { team, members } = data as unknown as {
              team: TeamView;
              members: TeamMemberView[];
            };
            return [
              renderKv([
                ['id', team.id],
                ['slug', team.slug],
                ['name', team.name],
                ['description', team.description ?? undefined],
                ['default role', team.defaultRoleId ?? undefined],
                ['created', formatRelativeTime(team.createdAt)],
              ]),
              '',
              renderTeamMembers(members),
            ].join('\n');
          },
        },
        {
          name: 'update <teamId>',
          summary: "update a team's name, slug, description, or default role",
          options: [
            { flags: '--name <name>', description: 'new name' },
            { flags: '--slug <slug>', description: 'new URL slug' },
            { flags: '--description <text>', description: 'what the team is for' },
            { flags: '--default-role <roleId>', description: 'role new members get' },
          ],
          fetch: async ([teamId], opts) => {
            const body: UpdateTeamBody = {
              ...(optString(opts.name) ? { name: opts.name as string } : {}),
              ...(optString(opts.slug) ? { slug: opts.slug as string } : {}),
              ...(optString(opts.description) ? { description: opts.description as string } : {}),
              ...(optString(opts.defaultRole) ? { defaultRoleId: opts.defaultRole as string } : {}),
            };
            if (Object.keys(body).length === 0) {
              throw new UsageError('Nothing to update: pass at least one field flag.');
            }
            return (await updateTeam(teamId, body)).data;
          },
          render: (_data, [teamId]) => `Updated ${teamId}.`,
        },
        {
          name: 'delete <teamId>',
          summary: 'permanently delete a team, its memberships, and its team secrets',
          confirm: ([teamId]) =>
            `Permanently delete team ${teamId}, its memberships, and its team secrets?`,
          fetch: async ([teamId]) => (await deleteTeam(teamId)).data,
          render: (_data, [teamId]) => `Deleted ${teamId}.`,
        },
        {
          name: 'set-role <teamId> <userId> <roleId>',
          summary: "set a team member's role",
          fetch: async ([teamId, userId, roleId]) =>
            (await setTeamMemberRole(teamId, userId, { roleId })).data,
          render: (_data, [, userId, roleId]) => `Set ${userId} to role ${roleId}.`,
        },
      ],
    },
    {
      noun: 'teams members',
      summary: "manage a team's members",
      commands: [
        {
          name: 'list <teamId>',
          summary: 'list the members of a team',
          fetch: async ([teamId]) => (await listTeamMembers(teamId)).data,
          render: (data) =>
            renderTeamMembers((data as unknown as { members: TeamMemberView[] }).members),
        },
        {
          name: 'add <teamId> <user>',
          summary: 'add a user to the team, by user id or email',
          fetch: async ([teamId, user]) =>
            (await addTeamMember(teamId, { userId: await resolveUserId(user) })).data,
          render: (_data, [, user]) => `Added ${user}.`,
        },
        {
          name: 'rm <teamId> <userId>',
          summary: 'remove a member from the team',
          fetch: async ([teamId, userId]) => (await removeTeamMember(teamId, userId)).data,
          render: (_data, [, userId]) => `Removed ${userId}.`,
        },
      ],
    },
    {
      noun: 'orgs roles',
      summary: 'inspect and assign roles in the active org',
      commands: [
        {
          name: 'list',
          summary: 'list the roles available in the active org',
          fetch: async () => (await listOrgRoles(await resolveOrgId())).data,
          render: (data) => {
            const { roles } = data as unknown as { roles: RoleView[] };
            if (!roles.length) return 'No roles.';
            return renderTable(
              [
                { key: 'id', header: 'id' },
                { key: 'slug', header: 'slug' },
                { key: 'name', header: 'name' },
                { key: 'builtin', header: 'builtin' },
                { key: 'description', header: 'description' },
              ],
              roles.map((role) => ({
                id: role.id,
                slug: role.slug,
                name: role.name,
                builtin: role.isBuiltin ? 'yes' : '',
                description: role.description ?? '',
              })),
            );
          },
        },
        {
          name: 'show <roleId>',
          summary: 'show a role and its permissions',
          fetch: async ([roleId]) => (await getOrgRole(await resolveOrgId(), roleId)).data,
          render: (data) => {
            const role = data as unknown as RoleView;
            return renderKv([
              ['id', role.id],
              ['slug', role.slug],
              ['name', role.name],
              ['description', role.description ?? undefined],
              ['builtin', role.isBuiltin ? 'yes' : 'no'],
              ['permissions', role.permissions.join(', ')],
            ]);
          },
        },
        {
          name: 'assign <userId> <roleId>',
          summary: 'assign a role to an org member',
          fetch: async ([userId, roleId]) =>
            (await assignOrgRole(await resolveOrgId(), { userId, roleId })).data,
          render: (_data, [userId, roleId]) => `Assigned ${roleId} to ${userId}.`,
        },
        {
          name: 'revoke <userId> <roleId>',
          summary: 'revoke a role from an org member',
          fetch: async ([userId, roleId]) =>
            (await revokeOrgRole(await resolveOrgId(), { userId, roleId })).data,
          render: (_data, [userId, roleId]) => `Revoked ${roleId} from ${userId}.`,
        },
      ],
    },
    {
      noun: 'orgs plugins',
      summary: "manage the org's installed plugins",
      commands: [
        {
          name: 'list',
          summary: 'list installed, available, and system plugins',
          fetch: async () => (await listOrgPlugins(await resolveOrgId())).data,
          render: (data) => {
            const { installed, available, system } = data as unknown as {
              installed: PluginView[];
              available: PluginView[];
              system: PluginView[];
            };
            const rows = [
              ...installed.map((p) => pluginRow(p, 'installed')),
              ...available.map((p) => pluginRow(p, 'available')),
              ...system.map((p) => pluginRow(p, 'system')),
            ];
            if (!rows.length) return 'No plugins.';
            return renderTable(
              [
                { key: 'name', header: 'name' },
                { key: 'kind', header: 'kind' },
                { key: 'status', header: 'status' },
                { key: 'version', header: 'version' },
                { key: 'description', header: 'description' },
              ],
              rows,
            );
          },
        },
        {
          name: 'show <name>',
          summary: "report a plugin's installation status for the org",
          fetch: async ([name]) => (await getOrgPlugin(await resolveOrgId(), name)).data,
          render: (data) => {
            const view = data as unknown as PluginView;
            return renderKv([
              ['name', view.pluginName],
              ['status', colorStatus(view.status)],
              ['version', view.version],
              ['description', view.description ?? undefined],
              ['installed', view.installedAt ? formatRelativeTime(view.installedAt) : undefined],
              ['dependencies', view.dependencies.length ? view.dependencies.join(', ') : undefined],
              ['dependents', view.dependents.length ? view.dependents.join(', ') : undefined],
              ['unavailable', view.unavailableReason],
              ['last error', view.lastError ?? undefined],
            ]);
          },
        },
        {
          name: 'install <name>',
          summary: 'install a plugin for the org',
          fetch: async ([name]) => (await installOrgPlugin(await resolveOrgId(), name)).data,
          render: (_data, [name]) => `Installed ${name}.`,
        },
        {
          name: 'uninstall <name>',
          summary: 'uninstall a plugin; dependent plugins are removed with it',
          confirm: async ([name]) => {
            const { cascaded } = (await previewOrgPluginUninstall(await resolveOrgId(), name))
              .data as unknown as { cascaded: string[] };
            return formatUninstallConfirm(name, cascaded);
          },
          fetch: async ([name]) => (await uninstallOrgPlugin(await resolveOrgId(), name)).data,
          render: (data, [name]) => {
            const { cascaded } = data as unknown as { cascaded?: { pluginName: string }[] };
            const extra = cascaded?.length
              ? ` Also uninstalled: ${cascaded.map((row) => row.pluginName).join(', ')}.`
              : '';
            return `Uninstalled ${name}.${extra}`;
          },
        },
        {
          name: 'settings <name>',
          summary: 'read plugin settings; with --set pairs, merge and save them',
          options: [
            {
              flags: '--set <key=value...>',
              description: 'setting to change (repeatable); values parse as JSON when possible',
            },
          ],
          fetch: async ([name], opts) => {
            const orgId = await resolveOrgId();
            const pairs = Array.isArray(opts.set)
              ? (opts.set as string[])
              : typeof opts.set === 'string'
                ? [opts.set]
                : [];
            if (!pairs.length) return (await getOrgPluginSettings(orgId, name)).data;
            const current = (await getOrgPluginSettings(orgId, name)).data as unknown as {
              values: Record<string, unknown>;
            };
            const values = { ...current.values, ...parseSettingPairs(pairs) };
            return (await setOrgPluginSettings(orgId, name, { values })).data;
          },
          render: (data) => {
            const { pluginName, values } = data as unknown as {
              pluginName: string;
              values: Record<string, unknown>;
            };
            return `${pluginName} settings:\n${JSON.stringify(values, null, 2)}`;
          },
        },
      ],
    },
    {
      noun: 'orgs sandbox',
      summary: "manage the org's sandbox provider key",
      commands: [
        {
          name: 'show',
          summary: "report the org's sandbox provider key and account",
          fetch: async () => (await getSandboxProvider(await resolveOrgId())).data,
          render: (data) => {
            const view = data as unknown as {
              provider: string;
              label: string;
              hasKey: boolean;
              source: string;
              account: SandboxAccountView | null;
              pinnedAccountId: string | null;
            };
            return renderKv([
              ['provider', `${view.label} (${view.provider})`],
              ['key', view.hasKey ? `set (source: ${view.source})` : 'not set'],
              [
                'account',
                view.account
                  ? `${view.account.name}${view.account.tierLabel ? ` (${view.account.tierLabel})` : ''}`
                  : undefined,
              ],
              ['pinned account', view.pinnedAccountId ?? undefined],
            ]);
          },
        },
        {
          name: 'set',
          summary: 'validate and save the sandbox provider API key',
          options: [
            {
              flags: '--api-key <key>',
              description: 'the provider API key (or pipe it on stdin)',
            },
          ],
          fetch: async (_args, opts) => {
            const apiKey = await resolveSecretValue(
              opts.apiKey,
              '--api-key',
              'Sandbox provider API key (hidden): ',
            );
            return (await setSandboxProvider(await resolveOrgId(), { apiKey })).data;
          },
          render: (data) => {
            const { account } = data as unknown as { account?: SandboxAccountView };
            return account
              ? `Saved. Sandbox account: ${account.name}${account.tierLabel ? ` (${account.tierLabel})` : ''}.`
              : 'Saved.';
          },
        },
        {
          name: 'health',
          summary: "report whether the org's stored sandbox key works",
          fetch: async () => (await getSandboxProviderHealth(await resolveOrgId())).data,
          render: (data) => {
            const { status, account } = data as unknown as {
              status: string;
              account?: SandboxAccountView;
            };
            return renderKv([
              ['status', colorStatus(status)],
              [
                'account',
                account
                  ? `${account.name}${account.tierLabel ? ` (${account.tierLabel})` : ''}`
                  : undefined,
              ],
            ]);
          },
        },
        {
          name: 'validate',
          summary: 'check a sandbox provider API key without saving it',
          options: [
            {
              flags: '--api-key <key>',
              description: 'the provider API key (or pipe it on stdin)',
            },
          ],
          fetch: async (_args, opts) => {
            const apiKey = await resolveSecretValue(
              opts.apiKey,
              '--api-key',
              'Sandbox provider API key (hidden): ',
            );
            return (await validateSandboxProvider(await resolveOrgId(), { apiKey })).data;
          },
          render: (data) => {
            const { account } = data as unknown as { account?: SandboxAccountView };
            return account
              ? `Key is valid for account ${account.name}${account.tierLabel ? ` (${account.tierLabel})` : ''}.`
              : 'Key is valid.';
          },
        },
      ],
    },
    {
      noun: 'orgs base-image',
      summary: "inspect and rebuild the org's base image",
      commands: [
        {
          name: 'show',
          summary: "report the org's base image commands and build status",
          fetch: async () => (await getBaseImage(await resolveOrgId())).data,
          render: (data) => {
            const view = data as unknown as {
              architecture: string;
              resourceSize: string;
              currentStatus?: string;
              rebuildPending: boolean;
              orgOverrideCommands: string[];
            };
            return renderKv([
              ['status', view.currentStatus ? colorStatus(view.currentStatus) : 'unknown'],
              ['architecture', view.architecture],
              ['resource size', view.resourceSize],
              ['rebuild pending', view.rebuildPending ? 'yes' : 'no'],
              [
                'override commands',
                view.orgOverrideCommands.length
                  ? `\n  ${view.orgOverrideCommands.join('\n  ')}`
                  : '(none)',
              ],
            ]);
          },
        },
        {
          name: 'rebuild',
          summary: 'rebuild the base image in the background',
          confirm: () => "Rebuild the org's base image?",
          fetch: async () => (await rebuildBaseImage(await resolveOrgId())).data,
          render: () =>
            'Rebuild accepted. It runs in the background; child blueprints rebuild after the ' +
            'base completes. Track it with `reflex-cli orgs base-image show`.',
        },
      ],
    },
    {
      noun: 'orgs secrets',
      summary: "manage the org's secrets",
      commands: [
        {
          name: 'set <name>',
          summary: 'save an org secret; the value comes from --value, stdin, or a hidden prompt',
          options: [
            { flags: '--value <value>', description: 'the secret value (or pipe it on stdin)' },
          ],
          fetch: async ([name], opts) => {
            const value = await resolveSecretValue(
              opts.value,
              '--value',
              `Value for ${name} (hidden): `,
            );
            return (await setOrgSecret(await resolveOrgId(), name, { value })).data;
          },
          render: (_data, [name]) => `Saved ${name}.`,
        },
        {
          name: 'status',
          summary: "report which of the org's secrets are set",
          fetch: async () => (await getOrgSecretsStatus(await resolveOrgId())).data,
          render: (data) => {
            const { secrets } = data as unknown as { secrets: SecretStatusItemView[] };
            if (!secrets.length) return 'No secrets.';
            return renderTable(
              [
                { key: 'key', header: 'key' },
                { key: 'label', header: 'label' },
                { key: 'required', header: 'required' },
                { key: 'set', header: 'set' },
                { key: 'source', header: 'source' },
              ],
              secrets.map((item) => ({
                key: item.key,
                label: item.label,
                required: item.required ? 'yes' : '',
                set: item.isSet ? 'yes' : 'no',
                source: item.source === 'unset' ? '' : item.source,
              })),
            );
          },
        },
      ],
    },
    {
      noun: 'keys',
      summary: 'manage your personal API keys',
      commands: [
        {
          name: 'create',
          summary: 'create a personal API key; the token is shown once',
          options: [{ flags: '--name <name>', description: 'key name (required)' }],
          fetch: async (_args, opts) => {
            const name = optString(opts.name);
            if (!name) throw new UsageError('API keys need a name: --name <name>.');
            return (await createPersonalApiKey({ name })).data;
          },
          render: (data) => {
            const { key, token } = data as CreatePersonalApiKey201;
            return [
              `Created API key ${key.name} (${key.id}).`,
              '',
              `  ${token}`,
              '',
              'The token is shown once at creation. After that, only the token prefix ' +
                `(${key.tokenPrefix}…) is visible.`,
            ].join('\n');
          },
        },
        {
          name: 'revoke <id>',
          summary: 'revoke a personal API key',
          confirm: ([id]) => `Revoke API key ${id}? Anything using it stops working immediately.`,
          fetch: async ([id]) => (await revokePersonalApiKey(id)).data,
          render: (_data, [id]) => `Revoked ${id}.`,
        },
      ],
    },
    {
      noun: 'secrets',
      summary: 'inspect secrets and model provider keys',
      commands: [],
    },
    {
      noun: 'secrets providers',
      summary: 'model provider keys you can use',
      commands: [
        {
          name: 'list',
          summary: 'list every model provider key you can use, across scopes',
          fetch: async () => (await listAccessibleModelProviderSecrets()).data,
          render: (data) => {
            const { secrets } = data as { secrets: ModelProviderSecret[] };
            if (!secrets.length) return 'No model provider keys.';
            return renderTable(
              [
                { key: 'id', header: 'id' },
                { key: 'name', header: 'name' },
                { key: 'provider', header: 'provider' },
                { key: 'type', header: 'type' },
                { key: 'scope', header: 'scope' },
                { key: 'age', header: 'age' },
              ],
              secrets.map((secret) => ({
                id: secret.id,
                name: secret.name,
                provider: secret.provider,
                type: secret.type,
                scope: secret.scope,
                age: formatRelativeTime(secret.createdAt),
              })),
            );
          },
        },
        {
          name: 'create',
          summary: 'add a personal model provider key',
          options: [
            {
              flags: '--provider <provider>',
              description: `provider (required): ${Object.values(CreateMyModelProviderSecretBodyProvider).join(', ')}`,
            },
            { flags: '--name <name>', description: 'key name (required)' },
            { flags: '--type <type>', description: 'apiKey (default) or subscription' },
            { flags: '--base-url <url>', description: 'custom API base URL' },
            { flags: '--value <value>', description: 'the key value (or pipe it on stdin)' },
          ],
          fetch: async (_args, opts) => {
            const provider = optString(opts.provider);
            const name = optString(opts.name);
            if (!provider || !name) {
              throw new UsageError('Provider keys need --provider and --name.');
            }
            const providers = Object.values(CreateMyModelProviderSecretBodyProvider) as string[];
            if (!providers.includes(provider)) {
              throw new UsageError(`--provider expects one of: ${providers.join(', ')}`);
            }
            const type = optString(opts.type) ?? CreateMyModelProviderSecretBodyType.apiKey;
            const types = Object.values(CreateMyModelProviderSecretBodyType) as string[];
            if (!types.includes(type)) {
              throw new UsageError(`--type expects one of: ${types.join(', ')}`);
            }
            const value = await resolveSecretValue(
              opts.value,
              '--value',
              `Key value for ${provider} (hidden): `,
            );
            const body: CreateMyModelProviderSecretBody = {
              provider: provider as CreateMyModelProviderSecretBody['provider'],
              type: type as CreateMyModelProviderSecretBody['type'],
              name,
              value,
              ...(optString(opts.baseUrl) ? { baseUrl: opts.baseUrl as string } : {}),
            };
            return (await createMyModelProviderSecret(body)).data;
          },
          render: (data) => {
            const secret = data as ModelProviderSecret;
            return `Added ${secret.provider} key ${secret.name} (${secret.id}).`;
          },
        },
      ],
    },
    {
      noun: 'flags',
      summary: 'inspect and set feature flags',
      commands: [
        {
          name: 'list',
          summary: 'list all feature flags',
          fetch: async () => (await listFeatureFlags()).data,
          render: (data) => {
            const flags = data as FeatureFlag[];
            if (!flags.length) return 'No flags.';
            return renderTable(
              [
                { key: 'key', header: 'key' },
                { key: 'enabled', header: 'enabled' },
                { key: 'scope', header: 'scope' },
                { key: 'label', header: 'label' },
              ],
              flags.map((flag) => ({
                key: flag.key,
                enabled: flag.enabled ? 'yes' : 'no',
                scope: flag.scope,
                label: flag.label,
              })),
            );
          },
        },
        {
          name: 'set <key> <value>',
          summary: 'enable or disable a feature flag (true/false)',
          fetch: async ([key, value]) =>
            (await setFeatureFlag(key, { enabled: parseBooleanValue(value, '<value>') })).data,
          render: (data, [key]) => {
            const flag = (data as FeatureFlag[]).find((f) => f.key === key);
            return flag
              ? `${key} is now ${flag.enabled ? 'enabled' : 'disabled'}.`
              : `Updated ${key}.`;
          },
        },
        {
          name: 'overrides <key>',
          summary: "list a flag's per-user overrides",
          fetch: async ([key]) => (await getFeatureFlagOverrides(key)).data,
          render: (data) => {
            const overrides = data as FlagUserOverride[];
            if (!overrides.length) return 'No overrides.';
            return renderTable(
              [
                { key: 'user', header: 'user' },
                { key: 'email', header: 'email' },
                { key: 'enabled', header: 'enabled' },
              ],
              overrides.map((override) => ({
                user: override.userId,
                email: override.user.email,
                enabled: override.enabled ? 'yes' : 'no',
              })),
            );
          },
        },
      ],
    },
    {
      noun: 'flags overrides',
      summary: 'per-user overrides for account-scoped flags',
      commands: [
        {
          name: 'set <key> <userId> <value>',
          summary: "set a user's override for a flag (true/false)",
          fetch: async ([key, userId, value]) =>
            (
              await setFeatureFlagOverride(key, userId, {
                enabled: parseBooleanValue(value, '<value>'),
              })
            ).data,
          render: (_data, [key, userId, value]) => `Set ${key}=${value} for ${userId}.`,
        },
        {
          name: 'rm <key> <userId>',
          summary: "clear a user's override for a flag",
          fetch: async ([key, userId]) => (await deleteFeatureFlagOverride(key, userId)).data,
          render: (_data, [key, userId]) => `Cleared ${key} override for ${userId}.`,
        },
      ],
    },
    {
      noun: 'users',
      summary: 'inspect the users you can see',
      commands: [
        {
          name: 'list',
          summary: 'list users (org members; platform admins see every user)',
          options: [
            { flags: '--org-only', description: 'only the active org, even as a platform admin' },
          ],
          fetch: async (_args, opts) => {
            const params: ListUsersParams = opts.orgOnly ? { scope: 'org' } : {};
            return (await listUsers(params)).data;
          },
          render: (data) => {
            const users = data as User[];
            if (!users.length) return 'No users.';
            return renderTable(
              [
                { key: 'id', header: 'id' },
                { key: 'login', header: 'login' },
                { key: 'email', header: 'email' },
                { key: 'name', header: 'name' },
                { key: 'status', header: 'status' },
              ],
              users.map((user) => ({
                id: user.id,
                login: user.login,
                email: user.email,
                name: user.name ?? '',
                status: user.status ?? '',
              })),
            );
          },
        },
        {
          name: 'show <id>',
          summary: 'show a user and their linked sign-in providers',
          fetch: async ([id]) => {
            const user = (await getUser(id)).data;
            const providers = (await getUserProviders(id)).data as unknown as {
              provider: string;
              providerUserId: string;
              createdAt: number;
            }[];
            return { user, providers };
          },
          render: (data) => {
            const { user, providers } = data as {
              user: User;
              providers: { provider: string; providerUserId: string; createdAt: number }[];
            };
            const kv = renderKv([
              ['id', user.id],
              ['login', user.login],
              ['email', user.email],
              ['name', user.name ?? undefined],
              ['status', user.status],
              ['super admin', user.isSuperAdmin ? 'yes' : undefined],
              ['created', formatRelativeTime(user.createdAt)],
            ]);
            if (!providers.length) return kv;
            const table = renderTable(
              [
                { key: 'provider', header: 'provider' },
                { key: 'providerUserId', header: 'provider user' },
                { key: 'linked', header: 'linked' },
              ],
              providers.map((p) => ({
                provider: p.provider,
                providerUserId: p.providerUserId,
                linked: formatRelativeTime(p.createdAt),
              })),
            );
            return `${kv}\n\n${table}`;
          },
        },
      ],
    },
  ];
}
