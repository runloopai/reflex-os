import { listOrganizations } from '@runloop/reflex-client';
import type { TuiConfig } from '../config.js';
import { renderKv } from '../output/table.js';

/**
 * `reflex whoami`: where requests go and who they authenticate as. The
 * first stop for "why is this 403ing" — shows the resolved server, org
 * (with its name when the key can list orgs), and a masked key.
 */
export async function runWhoami(config: TuiConfig, json: boolean): Promise<void> {
  let organizations: { id: string; slug: string; name: string }[] = [];
  try {
    organizations = (await listOrganizations()).data.organizations.map(
      (membership) => membership.organization,
    );
  } catch {
    // The key may be invalid or the server unreachable; still print the
    // local half so the user can see what would be sent.
  }
  const active =
    organizations.find(
      (org) => org.id === config.organizationId || org.slug === config.organizationId,
    ) ?? null;
  const summary = {
    server: config.baseUrl,
    apiKey: maskKey(config.apiKey),
    organization: active
      ? { id: active.id, slug: active.slug, name: active.name }
      : (config.organizationId ?? null),
    organizations: organizations.map((org) => org.slug),
  };
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(
    renderKv([
      ['server', config.baseUrl],
      ['api key', maskKey(config.apiKey)],
      [
        'org',
        active
          ? `${active.name} (${active.slug}, ${active.id})`
          : (config.organizationId ?? '(server default)'),
      ],
      ['orgs', organizations.map((org) => org.slug).join(', ') || undefined],
    ]),
  );
}

function maskKey(key: string): string {
  return key.length <= 8 ? '****' : `${key.slice(0, 8)}…`;
}
