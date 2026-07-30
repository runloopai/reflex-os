# reflex-cli

Terminal client for Reflex. Two jobs:

1. **Use Reflex from the terminal** — browse agents, follow their live event
   stream, chat (with file attachments via the same content-block mechanism
   the web composer uses), and launch new agents.
2. **Connect this machine as a workstation** — register over WebSocket so
   agents launched with the **Connect** attachment get `workstation_*` tools
   (run command, read/write file, list directory) that execute here, confined
   to a directory you choose, gated by per-call approval, with every call
   shown in an activity log and recorded in the server-side audit trail.

## Setup

Just run it — the first launch opens an interactive login wizard (server URL
→ API key → org pick) and validates the key before saving:

```bash
reflex-cli
```

The wizard assumes the hosted instance, `https://reflex.runloop.ai` — press
enter to accept it. Self-hosted? Set `REFLEX_BASE_URL` (or pass `--url`) and
that becomes the default instead, or just type your server URL at the prompt.

Mint the API key in the Reflex web app under Settings → API keys.
Credentials land in `~/.reflex/tui.json` (mode 0600). `REFLEX_BASE_URL`,
`REFLEX_API_KEY`, and `REFLEX_ORG` override the file; non-interactive
environments can use `reflex-cli login --key …` (add `--url` for a
self-hosted server).

## Usage

```bash
reflex-cli                        # interactive TUI
reflex-cli --connect --dir ~/dev  # TUI + register this machine as a workstation
reflex-cli connect --dir ~/dev    # connect mode only, with an activity log
```

The binary also installs as `reflex`; both names run the same CLI. The
command tree is built on [Commander](https://github.com/tj/commander.js),
so every command documents itself: `reflex-cli --help`,
`reflex-cli help connect`, `reflex-cli service --help`.

## Scriptable commands

Beyond the TUI, the CLI exposes the API for scripts and pipelines. Read
commands render tables for humans and raw JSON with `--json`:

```bash
reflex-cli agents list --archived     # aligned table; --json for scripts
reflex-cli agents show agt_...        # one agent, key: value
reflex-cli blueprints list
reflex-cli snapshots list
reflex-cli orgs list
reflex-cli keys list
reflex-cli workstations list
reflex-cli whoami                     # server, key, org — first stop for 403s
```

Agent runs are drivable too — launch, message, and manage them without the
TUI:

```bash
reflex-cli agents launch -p "fix the flaky auth test" --repo acme/app#main
reflex-cli agents send agt_123 "also update the changelog"
git diff | reflex-cli agents send agt_123        # message from stdin
reflex-cli agents interrupt agt_123
reflex-cli agents stop agt_123                   # devbox down, agent kept
reflex-cli agents kill agt_123 --yes             # destructive ops confirm;
                                                 # --yes for scripts
reflex-cli agents queue add agt_123 "run the smoke tests after"
reflex-cli agents snapshot agt_123 --name clean-base   # ends the run
```

`launch` accepts `--type`, `--model`, `--name`, `--system-prompt`,
`--blueprint`, `--snapshot`, `--size`, repeatable `--env KEY=VALUE`, and
repeatable `--attach <path>`; it builds the same `AgentConfig` payload the
web form and the TUI wizard submit. Destructive commands (`kill`,
`archive-all`, `snapshot`) prompt on a TTY and require `--yes` in a pipe.

Streaming closes the loop: follow a run from the terminal, or do the whole
launch, watch, exit cycle in one command.

```bash
reflex-cli watch agt_123                  # transcript to stdout, live
reflex-cli watch agt_123 --json           # NDJSON, one stream event per line
reflex-cli watch agt_123 --until pr       # exit 0 when a PR opens
reflex-cli run -p "fix the flaky test" --repo acme/app   # launch + watch
reflex-cli chat agt_123                   # the TUI, straight into this chat
reflex-cli open agt_123                   # agent page in the browser
reflex-cli open agt_123 pr                # its pull request
reflex-cli open agt_123 web --print       # a daemon tunnel URL, printed only
```

`watch` (also `agents watch`) backfills the full history over REST, then
follows the live socket. It renders the same transcript the TUI chat shows,
read-only, and needs no TTY. `--until done` (the default) exits 0 when the
agent's turn completes, `--until pr` when a pull request opens, and
`--until forever` never exits; the exit code is 1 when the agent errors.
`run` is the one-shot for scripts and CI: the same flags as `agents launch`,
then a watch on the new agent. With `--json`, stdout carries NDJSON events
and ends with a final `{agentId, name, status, outcome}` object; the launch
notice goes to stderr.

The admin surface is scriptable too. The server enforces authorization, so
these commands work exactly as far as your role allows and relay 403s with a
hint. `orgs use` saves the default org in `~/.reflex/tui.json`; after that no
scoped command needs `--org`.

```bash
reflex-cli orgs use acme                     # set the default org
reflex-cli orgs show                         # the active org, key: value
reflex-cli orgs members list                 # members and their roles
reflex-cli orgs members add dev@acme.com     # by user id or email
reflex-cli orgs invites create --email dev@acme.com   # link prints once
reflex-cli orgs roles assign usr_123 rol_456
reflex-cli orgs teams create --name Platform
reflex-cli teams set-role tem_123 usr_123 rol_456
reflex-cli orgs plugins uninstall linear     # confirm lists the cascade
reflex-cli orgs plugins settings linear --set syncMode=auto
reflex-cli orgs sandbox set                  # key via --api-key, stdin, or
                                             # a hidden prompt
reflex-cli orgs secrets set ANTHROPIC_API_KEY < key.txt
reflex-cli orgs base-image rebuild --yes     # 202; builds in the background
reflex-cli keys create --name ci             # rfx_ token prints once
reflex-cli secrets providers create --provider anthropic --name work
reflex-cli flags set my-flag true
reflex-cli flags overrides set my-flag usr_123 false
reflex-cli users show usr_123                # includes linked providers
```

Secret values are never positional arguments: pass `--value` (or `--api-key`
for the sandbox provider), pipe the value on stdin, or type it into a hidden
prompt on a TTY. Destructive admin commands (`orgs delete`, `teams delete`,
`orgs plugins uninstall`, `orgs base-image rebuild`, `keys revoke`) confirm
first; `orgs delete` warns that the server hard-deletes the org and
everything in it.

Anything without a dedicated command is still reachable: `reflex-cli api`
calls any operation in the public OpenAPI spec by name. Path params are
positional, query params ride `--param`, and request bodies come from
`--field` (dotted paths allowed) or `--input <file|->`. Output is always
JSON.

```bash
reflex-cli api --list                                     # every operation
reflex-cli api listAgents --param archived=true
reflex-cli api sendAgentMessage agt_123 --field message='Run the tests'
reflex-cli api createAgent --input launch.json
```

The operation table (`src/generated/api-ops.ts`) is generated from
`openapi/openapi.public.json` by `pnpm generate:api-ops` (wired into the
repo root's `pnpm api:generate`); a unit test fails when it drifts from
the committed spec.

## Docs, completion, and doctor

The full command reference lives at [`docs/cli.md`](docs/cli.md), generated
from the command tree by `pnpm --filter reflex-cli docs:generate`;
`docs:check` (and the test suite) fail when it drifts. The same tree walk
powers shell completion:

```bash
source <(reflex-cli completion bash)     # bash; also zsh (after compinit)
reflex-cli completion fish | source      # fish
```

When something misbehaves, `reflex-cli doctor` checks the setup end to end:
config source, server reachability, key and org validity, WebSocket
connectivity, plus the connect daemon and clipboard helpers as
informational lines. Each failure prints a fix hint; the run exits 1 if any
required check fails, and `--json` emits the results for scripts.

In the TUI: `↑/↓` + `enter` opens an agent's chat, `/` filters the list by
name, status, or type, `p` pins/unpins the selected agent, `x` archives it
(or unarchives, in the archived view), `a` flips to the archived agents (and
back), `n` launches a new agent, `q` quits. Pinned agents sort first (marked
`✦`), archived agents stay out of the active list, rows waiting on you
(`needs_input`, `error`) read in their status color, and the terminal bell
rings when any agent starts waiting on input — not just the one whose chat
is open.

The terminal tab title tracks where you are (the open agent's name), and if
the live event stream drops, a `connection lost — reconnecting…` line shows
on every screen until it comes back — the socket reconnects on its own with
backoff.

The layout adapts to the terminal: list rows scale with height, the name
column absorbs width changes, and the agent-type column drops out first in
narrow panes so rows never wrap. Resizes apply live.

## Launching

The launch wizard walks the same surface as the web launch dialog: prompt →
agent type and model (from the server's model-support catalog, org defaults
first) → repo (`owner/repo[#branch]`) → blueprint or snapshot (auto-picks the
blueprint built for the repo, else the org base, exactly like the web) →
workstation. The wizard remembers your last launch: agent type, model, and
repo prefill from `~/.reflex/tui.json` (the model only when the remembered
agent type is still in effect). `enter` on the confirm step launches;
`a` opens the advanced fields: display name, system prompt, env vars
(`KEY=VALUE`, space-separated), and devbox resource size. The prompt step takes attachments too — `ctrl+v`
pastes a clipboard image and dropping a file stages it — sent as content
blocks with the initial prompt, like the web launch composer. Selections
build the identical `AgentConfig` payload the web form submits. Not covered
from the terminal: personas and provider/endpoint route overrides.

## Chat

The chat screen consumes the same event stream as the web chat and renders
the full turn, not just text: devbox setup progress folded into one line,
the agent's thinking (collapsed to `✳ Thought for Ns` once done), tool calls
with live status, duration, and a short output preview (`⎿ …`), TodoWrite
plans as a checklist, streamed text as it arrives, and lifecycle banners
(interrupted, PR opened, agent complete, …). Finished lines are printed to
normal terminal scrollback, so long sessions scroll like any other CLI —
and opening a chat backfills the agent's full event history over REST
before going live, so scrolling up reaches the very first prompt even for
old agents.

`ctrl+o` opens a palette of everything associated with the agent that opens
in a browser: the agent's web page, every pull request it opened (with live
open/merged/closed/checks-failed status), and every daemon registered on
the devbox (tunnel URLs — the same list the web header's Servers chip
shows). The terminal bell rings when the agent asks a question, requests a
permission, or finishes a turn, so you can background the pane while it
works.

The transcript clips each tool result to a few `⎿` lines; `ctrl+t` opens a
scrollable viewer over the full output — pick a recent call, then `↑/↓`,
`u`/`d` (page), and `g`/`G` move through it. Fenced code blocks in agent
answers are syntax highlighted (js/ts, python, bash, sql, json, yaml, go,
rust, c-family, and diffs) by a small built-in scanner — no dependency, and
unknown languages render plain as before.

When the agent asks a question (`AskUserQuestion`), an interactive card takes
over the composer: `↑/↓` or `1-9` pick an option, `space` toggles in
multi-select, `enter` confirms, an **Other** row accepts free text, `esc`
skips, and `ctrl+d` dismisses + interrupts. Multiple questions run one at a
time and submit together — the same control-response payload the web chat
sends, so answers show up everywhere. Permission requests (`can_use_tool`)
prompt the same way: `y` allow once, `a` always allow that tool this session,
`n` deny, `i` deny + interrupt.

Sending follows the web chat's confirmed-delivery model. A sent message
shows as a dim optimistic line until the server echoes it back on the live
stream — the echo is what becomes the transcript line, so a reconnect or a
race can never duplicate it. If no echo arrives within 20 seconds the line
flips to `?` (sent, unconfirmed) or `✗` (not delivered) with `/retry` and
`/dismiss`. While the agent is mid-turn, messages go to the server-owned
queue instead (drained one per turn, shared with the web composer); `⧗`
rows show what's waiting and `/unqueue <n>` removes one.

While the agent works a spinner shows elapsed time; `esc` interrupts. When
idle, `esc` goes back to the agent list. `/attach <path>` stages a file,
`/detach` clears staged files, `/interrupt` also interrupts,
`/rename <name>` renames the agent, and `/help` lists every command and
key.

The composer spans lines like Claude Code's input: `\` + enter continues
onto a new line (the backslash is consumed), ctrl+j or option+enter inserts
a newline directly, and multiline pastes keep their line breaks. A
half-typed draft survives `esc` back to the agent list — reopening the chat
restores it. Inside a multi-line draft, `↑/↓` move the cursor between
lines; on the boundary line they recall previously sent messages,
shell-style, sourced from the transcript — so recall reaches the whole
conversation, including messages sent from the web.

The chat keeps its always-on chrome minimal: the header is the agent's name
and type, and the server endpoint sits in the agent-list footer only.
`/status` shows the rest on demand — server endpoint, org, agent id, model,
status, devbox, blueprint, and the workstation connection state — as a live
block above the composer; `esc` closes it. The exception is a workstation
connection that is not healthy: that stays visible on its own (in the chat
and the list footer), because the agent's workstation tools fail while it
is down. Opening an agent shows a `Loading history…` line until the REST
backfill lands, and on the agent list, `needs_input` and `error` rows read
in their status color so the agents waiting on you stand out.

Images and files attach the same way they do in the web composer (and in
Claude Code's terminal): `ctrl+v` grabs the image on the system clipboard
(macOS via `osascript`; Linux via `wl-paste` or `xclip`; Windows via
PowerShell), and dropping a file onto the terminal — which pastes its path —
stages that file instead of inserting the text. Staged files ride along as
the same content blocks the web sends.

To eyeball the rendering without a server:
`pnpm exec tsx scripts/render-smoke.tsx --question` (also `--permission`,
`--stream`, `--idle`, `--list` for the agent list, `--launch` for the
wizard, or `--markdown` for the Markdown renderer).

## Connect-mode permissions

Read tools (`read_file`, `list_directory`) are always allowed inside the
tool root. Commands and file writes are **allowed by default** — connecting
the machine is the opt-in, and agents shouldn't stall on prompts nobody is
watching. Pass flags for a more restrictive posture:

```bash
reflex-cli connect --ask            # approve commands + writes per call
reflex-cli connect --ask --allow-exec   # only writes ask; commands run freely
reflex-cli connect --read-only      # deny exec + write outright
```

With `--ask`, each command/write prompts in the TUI: `y` allow once, `a`
always allow that category this session, `n` deny (the agent is told the
owner declined). Each new prompt rings the terminal bell — unanswered
prompts deny after 5 minutes, so a backgrounded pane gets nudged.

## Running connect as a boot service

To keep a machine connected without leaving a terminal open, install connect
as a per-user daemon that starts on boot and reconnects on its own:

```bash
reflex-cli login                       # once — the daemon reads saved creds
reflex-cli service install --dir ~/dev # launchd (macOS) or systemd (Linux)
reflex-cli service status              # installed? running?
reflex-cli service uninstall           # stop and remove
```

`service install` accepts the same connect flags as `connect`
(`--dir`, `--name`, `--ask`, `--allow-exec`, `--allow-write`, `--read-only`)
and bakes them into the unit. Notes:

- **Credentials are not written into the unit.** The daemon authenticates from
  `~/.reflex/tui.json`, so you must `reflex-cli login` first; env vars like
  `REFLEX_API_KEY` are not visible to a service manager.
- **`--ask` is honored but effectively denies**, since a daemon has no TTY to
  prompt in — use it only with `--allow-exec`/`--allow-write`, or prefer
  `--read-only` for an inspection-only daemon.
- **Logs:** macOS writes `~/.reflex/logs/connect.{out,err}.log`; Linux uses the
  journal (`journalctl --user -u reflex-connect -f`).
- **Boot before login:** on Linux the installer runs `loginctl enable-linger`
  so the user service starts at boot without an active session.
- **macOS** uses a LaunchAgent at
  `~/Library/LaunchAgents/ai.runloop.reflex-connect.plist`
  (`RunAtLoad` + `KeepAlive`). **Windows is not supported** — run
  `reflex-cli connect` under your own supervisor.

Under the hood the daemon runs `reflex-cli connect --headless`, which serves
the same connection as the TUI but streams a timestamped log instead of
drawing a UI. You can run it directly in any non-interactive context (a pipe,
CI) — connect auto-detects the missing TTY and goes headless on its own.

## Security model for connect mode

- Connecting is an explicit opt-in per machine and per invocation.
- Tool access is confined to `--dir` (default: the cwd); path traversal and
  symlink escapes are rejected client-side, and params are re-validated
  against the shared schemas before executing.
- Exec/write access can be tightened to per-call owner approval (`--ask`)
  or denied outright (`--read-only`).
- Only agents launched by **you** (the API key's user) can target your
  workstation — the server enforces owner + org on every relayed call.
- Every call is visible live in the activity log (with elapsed time while
  running) and recorded server-side in the `workstation_tool_calls` audit
  trail, which the agent's Workstation panel in the web app reads.

## Developing

The TUI lives at `sdk/tui` in the monorepo (workspace package `reflex-cli`).
It is an [Ink](https://github.com/vadimdemedes/ink) 6 + React app behind a
[Commander](https://github.com/tj/commander.js) command tree: the tree and
dispatch in `src/cli.ts`, one runner module per command in `src/commands/`,
config resolution in `src/context.ts`, error formatting in `src/output/`,
screens in `src/ui/`, and connect-mode logic (executor, approval policy,
WebSocket client) in `src/connect/`.

```bash
pnpm install        # once, from the repo root
pnpm dev            # repo root: server :4000 + web :4001 + a tsc watch on the TUI
```

Then iterate from `sdk/tui`:

```bash
cd sdk/tui
pnpm dev                              # run the TUI from source
pnpm dev -- connect --dir /tmp/scratch  # any CLI args after --
pnpm test                             # vitest unit tests
pnpm typecheck
pnpm build                            # bundle to dist/main.js (what bin/reflex-cli.js loads)
```

`pnpm dev` runs `src/main.ts` with `tsx` under `--conditions=@reflex/source`,
so workspace deps (`@reflex/shared`, `@reflex/plugin-workstation`) resolve
straight to their TypeScript sources — no rebuild loop while iterating. The
binary entrypoint is `bin/reflex-cli.js`, which loads the built
`dist/main.js`, so build before testing the binary itself (`pnpm build`, or
`pnpm build:watch` to keep it rebuilding as you edit).

`pnpm build` bundles with esbuild (`build.mjs`): it inlines the monorepo's own
packages from their TypeScript source and leaves third-party deps (react, ink,
zod) as runtime imports. Because the workspace packages are inlined rather than
imported from their sibling `dist/`, a single `reflex-cli` build is always
self-consistent — no separate `@reflex/shared` build to keep in sync, and no
stale-export crashes at runtime.

### Use it like a globally installed CLI

To get a `reflex-cli` on your PATH that tracks your checkout:

```bash
pnpm --filter reflex-cli build   # once, from the repo root (self-contained bundle)
pnpm add -g ./sdk/tui            # from the repo root
reflex-cli
```

`pnpm add -g` with a local path links instead of copying, so the global
command always runs whatever is in your checkout's `dist/`. Pair it with the
repo-root `pnpm dev` (which runs `build:watch` on this package) and edits show
up in the global `reflex-cli` on its next launch — no manual rebuild. If you
are not running the dev stack, `pnpm build:watch` here does the same job on its
own. Because the build inlines workspace packages from source, edits to
`@reflex/shared` or `@reflex/plugin-workstation` are picked up by the watch too
— no separate dependency build needed.

If pnpm complains that its global bin directory is not on PATH, run
`pnpm setup` once and restart your shell. Uninstall with
`pnpm rm -g reflex-cli`.

To point a dev TUI at the local server, either walk through the login wizard
with `http://localhost:4000` (mint a key at
`http://localhost:4001` → Settings → API keys) or skip the wizard:

```bash
REFLEX_BASE_URL=http://localhost:4000 REFLEX_API_KEY=rfx_... pnpm dev
```

Env vars never touch `~/.reflex/tui.json`, so your real credentials survive
local hacking.

Things to know before changing connect mode:

- The wire protocol and tool param schemas live in
  `@reflex/plugin-workstation/shared/types` — change frames there so the
  server and client cannot drift, and bump `WORKSTATION_PROTOCOL_VERSION`
  only for breaking frame changes.
- Path confinement and approval gating are the security boundary. Anything
  touching `src/connect/executor.ts` or `src/connect/policy.ts` needs tests
  in `src/__tests__/` (see `executor.test.ts` and `policy.test.ts` for the
  patterns, including symlink-escape cases).
- Ink renders to the terminal, so `console.log` corrupts the UI mid-render;
  use the on-screen activity log or write tests instead.
