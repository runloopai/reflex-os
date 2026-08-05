import { defineConfig } from 'orval';

/**
 * Generate the typed React Query clients from the committed OpenAPI specs.
 *
 *   pnpm openapi:generate   # (re)write openapi/openapi.json + openapi.public.json from the server
 *   pnpm client:generate    # run this config → both generated client dirs
 *
 * Three clients are emitted from the two specs, all owned by the publishable
 * SDK (`@runloop/reflex-client`) except the internal admin client:
 *   - `reflex`  → public spec  → `sdk/client/src/react/`  (react-query hooks;
 *     consumed by web/plugins through the `@reflex/ui/client/generated/*`
 *     re-export shims and published as `@runloop/reflex-client/react/*`)
 *   - `reflexSdk` → public spec → `sdk/client/src/generated/`  (plain typed
 *     functions, no react-query — the SDK's framework-agnostic surface)
 *   - `reflexInternal` → full spec → `ui/src/client/generated-internal/`
 *     (+ admin; stays in ui so the admin surface never ships in the SDK)
 *
 * Public is the default surface every consumer reaches for; internal adds the
 * platform-admin / admin-console endpoints under `/admin/*`. Both generate
 * every tag in their respective specs, so the only difference is the `admin`
 * tag (present only in the full spec). One file is emitted per tag
 * (`mode: 'tags'`). The
 * generated fetchers/hooks delegate to the SDK transport
 * (`sdk/client/src/http.ts`) via the custom mutators, and org safety is
 * layered on top in `ui/src/client/api/*` (branded `OrgId`).
 *
 * Every registered operation is generated, even routes that don't yet declare
 * a response schema — those return `unknown` until their `responses:` are
 * filled in (see api-contract.md). Referenced components (Agent, Blueprint,
 * Snapshot, User, AvailableSecret, ...) are pulled in automatically.
 *
 * The generated dirs are local artifacts: `pnpm install` creates them from
 * the committed specs and Git ignores them. No prettier pass runs over them;
 * `.prettierignore` and ESLint also exclude them so quality checks only cover
 * the hand-authored client surfaces. `client:check` verifies that generation
 * succeeds and every public tag has its required package exports.
 */

// Shared output knobs. `httpClient: 'axios'` selects the classic mutator
// contract — the mutator is called with a config object and returns the parsed
// body (`Promise<T>`), not fetch's `{ data, status, headers }` envelope. No
// axios runtime is pulled in: the custom mutator replaces it entirely (it
// delegates to the SDK transport) and prepends the runtime API base, so
// generated URLs stay bare. `mode: 'tags'` → one file per tag.
//
// The default mutator here serves the internal (ui-hosted) client; the two
// SDK-hosted outputs override it with the SDK's own mutators so the published
// package never imports across the workspace boundary.
const sharedOutput = {
  mode: 'tags',
  client: 'react-query',
  httpClient: 'axios',
  baseUrl: '',
  // OpenAPI path parameters are URI components, not raw path fragments. Keep
  // this enabled for every generated surface so ids containing `/`, spaces,
  // or other reserved characters cannot change the requested route.
  urlEncodeParameters: true,
  prettier: false,
  indexFiles: false,
  override: {
    mutator: {
      path: './ui/src/client/api/mutator.ts',
      name: 'apiFetch',
    },
  },
} as const;

export default defineConfig({
  // Publishable SDK client (`@runloop/reflex-client`, sdk/client). Same public
  // spec and tag filter as `reflex`, but `client: 'axios'` emits plain typed
  // functions (no react-query hooks) and the mutator is the SDK's own
  // transport (`sdk/client/src/http.ts`), which takes ALL configuration from
  // `configureReflex(...)` — no localStorage, no Vite env vars. No axios
  // runtime is pulled in: the custom mutator replaces it entirely.
  reflexSdk: {
    input: {
      target: './openapi/openapi.public.json',
    },
    output: {
      ...sharedOutput,
      client: 'fetch',
      httpClient: 'fetch',
      // Unlike the ui outputs, emit index files so the SDK's entry point can
      // re-export every generated function and model type from one place.
      indexFiles: true,
      target: './sdk/client/src/generated/reflex.ts',
      schemas: './sdk/client/src/generated/model',
      clean: ['./sdk/client/src/generated'],
      override: {
        mutator: {
          path: './sdk/client/src/http.ts',
          name: 'apiFetch',
        },
      },
    },
    // The SDK is published as native ESM, so relative imports must be fully
    // specified. orval emits extensionless specifiers; this hook appends
    // `.js` (idempotently) so the local output is Node-ESM ready.
    hooks: {
      afterAllFilesWrite: 'node ./sdk/client/scripts/add-js-extensions.mjs',
    },
  },
  // The public react-query client, published as `@runloop/reflex-client/react/*`
  // and re-exported for web/plugins through the `@reflex/ui/client/generated/*`
  // shims. Its mutator is the SDK's react adapter (`react-mutator.ts`), which
  // delegates to the shared SDK transport — so the hooks work both in the
  // Reflex web app (session auth via `getToken`) and in external apps
  // (personal API key).
  reflex: {
    input: {
      target: './openapi/openapi.public.json',
    },
    output: {
      ...sharedOutput,
      target: './sdk/client/src/react/reflex.ts',
      schemas: './sdk/client/src/react/model',
      clean: ['./sdk/client/src/react'],
      override: {
        mutator: {
          path: './sdk/client/src/react-mutator.ts',
          name: 'apiFetch',
        },
      },
    },
    // Same Node-ESM rewrite as `reflexSdk` (the script covers both dirs).
    hooks: {
      afterAllFilesWrite: 'node ./sdk/client/scripts/add-js-extensions.mjs',
    },
  },
  reflexInternal: {
    input: {
      target: './openapi/openapi.json',
    },
    output: {
      ...sharedOutput,
      target: './ui/src/client/generated-internal/reflex.ts',
      schemas: './ui/src/client/generated-internal/model',
      clean: ['./ui/src/client/generated-internal'],
    },
  },
});
