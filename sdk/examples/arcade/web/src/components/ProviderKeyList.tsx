/**
 * The keys behind the selected agent + model, the way Reflex's launch dialog
 * shows them: grouped by tier (yours / team / organization), each row named,
 * badged by kind, and greyed when the provider doesn't accept that kind.
 *
 * Also the picker. Reflex resolves a launch to the first usable key, most
 * specific tier first, which is the right default and the wrong answer when
 * you hold two — a team key you are spending someone else's budget on and a
 * personal one you are not. "Automatic" stays the default and names the key
 * it would land on; picking a row pins that key for the launch
 * (`providerSecretId`).
 *
 * Purely presentational — the caller resolves the provider, passes the
 * catalog's key list, and owns the selection.
 */
import { useId } from 'react';
import { Key, ShieldCheck, Sparkles } from 'lucide-react';
import type { CatalogProvider, ProviderKey } from '../lib/api.ts';
import {
  defaultKeyScope,
  groupProviderKeys,
  KEY_SCOPE_LABEL,
  KEY_TYPE_BADGE,
  KEY_TYPE_LABEL,
} from '../lib/provider-keys.ts';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-widest text-zinc-500 uppercase">
        <Key size={11} aria-hidden />
        Provider keys
      </p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

export function ProviderKeyList({
  provider,
  keys,
  selectedKeyId = null,
  onSelect,
}: {
  /** Provider resolved from the agent + model choice, or `null` if ambiguous. */
  provider: CatalogProvider | null;
  /** The catalog's key list, or `null` when Reflex couldn't be asked for it. */
  keys: ProviderKey[] | null;
  /** Pinned key, or `null` for automatic resolution. */
  selectedKeyId?: string | null;
  /** Omit to render the list read-only (no radios). */
  onSelect?: (keyId: string | null) => void;
}) {
  // Scoped so a second picker on the same page cannot join this group.
  const groupName = useId();

  if (!provider) {
    return (
      <Shell>
        <p className="text-sm text-zinc-500">Pick a model to see which keys it would run under.</p>
      </Shell>
    );
  }

  // A failed lookup is not an empty one: saying "no keys" here would be a
  // confident wrong answer and would hide a failure that a reload may fix.
  if (!keys) {
    return (
      <Shell>
        <p className="text-sm text-zinc-500">
          Couldn&rsquo;t load your {provider.displayName} keys from Reflex.
        </p>
      </Shell>
    );
  }

  if (provider.keyTypes.length === 0) {
    return (
      <Shell>
        <p className="text-sm text-zinc-400">
          {provider.displayName} needs no provider key — it runs on the deployment&rsquo;s own free
          tier.
        </p>
      </Shell>
    );
  }

  const groups = groupProviderKeys(keys, provider);
  const usable = groups.some((group) => group.rows.some((row) => row.supported));

  if (groups.length === 0) {
    return (
      <Shell>
        <p className="text-sm text-amber-400">No {provider.displayName} keys available to you.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Add one in Reflex (Security &gt; Model providers), or pick a model from a provider you
          have a key for.
        </p>
      </Shell>
    );
  }

  const automaticScope = defaultKeyScope(groups);

  const row = (key: ProviderKey, supported: boolean) => {
    const selected = selectedKeyId === key.id;
    const body = (
      <>
        {key.type === 'subscription' ? (
          <Sparkles size={12} aria-hidden className="shrink-0" />
        ) : (
          <ShieldCheck size={12} aria-hidden className="shrink-0" />
        )}
        <span className="truncate">{key.name}</span>
        <span
          className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ${
            key.type === 'subscription'
              ? 'border border-emerald-500/40 text-emerald-400'
              : 'bg-zinc-800 text-zinc-400'
          }`}
        >
          {KEY_TYPE_BADGE[key.type]}
        </span>
        {supported ? null : (
          <span className="shrink-0 text-[10px] text-zinc-500">
            {KEY_TYPE_LABEL[key.type]} not supported
          </span>
        )}
      </>
    );
    const tone = supported ? 'text-zinc-300' : 'text-zinc-600';
    if (!onSelect) {
      return (
        <li key={key.id} className={`flex items-center gap-2 text-sm ${tone}`}>
          {body}
        </li>
      );
    }
    return (
      <li key={key.id} role="none">
        <label
          className={`flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm ${tone} ${
            supported ? 'cursor-pointer hover:bg-white/5' : 'cursor-not-allowed'
          } ${selected ? 'bg-violet-600/15' : ''}`}
        >
          <input
            type="radio"
            name={groupName}
            checked={selected}
            disabled={!supported}
            onChange={() => onSelect(key.id)}
            className="shrink-0 accent-violet-500"
          />
          {body}
        </label>
      </li>
    );
  };

  const choices = (
    <>
      {onSelect ? (
        <label
          className={`flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm ${
            selectedKeyId === null ? 'bg-violet-600/15 text-zinc-200' : 'text-zinc-300'
          } cursor-pointer hover:bg-white/5`}
        >
          <input
            type="radio"
            name={groupName}
            checked={selectedKeyId === null}
            onChange={() => onSelect(null)}
            className="shrink-0 accent-violet-500"
          />
          <span className="truncate">
            Automatic
            {automaticScope ? (
              <span className="text-zinc-500">
                {' '}
                — {KEY_SCOPE_LABEL[automaticScope].toLowerCase()} first
              </span>
            ) : null}
          </span>
        </label>
      ) : null}
      <div role={onSelect ? 'none' : undefined} className={`space-y-3 ${onSelect ? 'mt-2' : ''}`}>
        {groups.map((group) => (
          <div key={group.scope}>
            <p className="text-xs font-medium text-zinc-500">{KEY_SCOPE_LABEL[group.scope]}</p>
            <ul role={onSelect ? 'none' : undefined} className="mt-1 space-y-1">
              {group.rows.map((r) => row(r.key, r.supported))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <Shell>
      {onSelect ? (
        <div role="radiogroup" aria-label="Provider key for this launch">
          {choices}
        </div>
      ) : (
        choices
      )}
      <p className="mt-3 text-xs text-zinc-500">
        {!usable
          ? `None of these keys work with ${provider.displayName}.`
          : selectedKeyId
            ? 'This game launches under the key you picked.'
            : `${provider.displayName} models launch under the first usable key, most specific tier first.`}
      </p>
    </Shell>
  );
}
