# reflex-cli command reference

Generated from the command tree by `pnpm --filter @runloop/reflex-cli docs:generate`.
Do not edit by hand; `docs:check` and the test suite fail on drift.

```
reflex-cli [options] [command]
```

Terminal client for Reflex: browse and chat with agents, launch new
ones, and connect this machine as a workstation agents can work on.

The binary also installs as `reflex`; both names run the same CLI. With no
command, `reflex-cli` opens the interactive TUI.

Options:

- `--dir <path>`: directory agents may access in connect mode (default: current directory)
- `--name <name>`: workstation display name (default: hostname)
- `--headless`: connect without the TUI (log to stdout); used by the service
- `--ask`: require per-call approval for commands and file writes
- `--allow-exec`: with --ask: pre-approve commands (writes still ask)
- `--allow-write`: with --ask: pre-approve file writes (commands still ask)
- `--read-only`: deny commands and writes outright (read/list still work)
- `--connect`: also connect this machine while browsing the TUI

## Common options

Every command accepts these. They override the environment variables and
the saved config in `~/.reflex/tui.json`.

- `--url <origin>`: server origin (or REFLEX_BASE_URL; default https://reflex.runloop.ai)
- `--key <key>`: personal API key rfx_... (or REFLEX_API_KEY)
- `--org <org>`: organization id or slug (or REFLEX_ORG)

## activity

```
reflex-cli activity [options]
```

show recent activity across the org

Options:

- `--json`: print the raw JSON response instead of a table

## agents

```
reflex-cli agents [options] [command]
```

browse, inspect, and drive agent runs

### agents archive

```
reflex-cli agents archive [options] <agent>
```

archive the agent

Arguments:

- `<agent>`

Options:

- `--json`: print the raw JSON response instead of a table

### agents archive-all

```
reflex-cli agents archive-all [options]
```

archive every non-pinned agent

Options:

- `--json`: print the raw JSON response instead of a table
- `--yes`: skip the confirmation prompt

### agents complete

```
reflex-cli agents complete [options] <agent>
```

mark the run complete

Arguments:

- `<agent>`

Options:

- `--json`: print the raw JSON response instead of a table

### agents interrupt

```
reflex-cli agents interrupt [options] <agent>
```

interrupt the agent's current turn

Arguments:

- `<agent>`

Options:

- `--json`: print the raw JSON response instead of a table

### agents kill

```
reflex-cli agents kill [options] <agent>
```

kill the run and discard its devbox

Arguments:

- `<agent>`

Options:

- `--json`: print the raw JSON response instead of a table
- `--yes`: skip the confirmation prompt

### agents launch

```
reflex-cli agents launch [options]
```

launch a new agent run (flag-driven; the TUI has the guided wizard)

Options:

- `--json`: print the raw JSON response instead of a table
- `-p, --prompt <text>`: the initial prompt (required)
- `--repo <owner/repo[#branch]>`: git repo to attach
- `--type <agentType>`: agent type (default: org default)
- `--model <model>`: model override
- `--name <name>`: display name
- `--system-prompt <text>`: system prompt
- `--blueprint <name>`: Blueprint to boot from
- `--snapshot <id>`: snapshot to boot from (replaces Blueprint)
- `--size <size>`: devbox resource size (SMALL … XX_LARGE)
- `--env <KEY=VALUE>`: environment variable (repeatable)
- `--attach <path>`: attach a file (repeatable); sent as content blocks like the web composer

### agents list

```
reflex-cli agents list [options]
```

list the agents in the active organization

Options:

- `--json`: print the raw JSON response instead of a table
- `--archived`: archived agents instead of active ones
- `--pinned`: only pinned agents
- `--search <text>`: filter by name
- `--limit <n>`: page size
- `--cursor <cursor>`: page cursor from a previous call

### agents pin

```
reflex-cli agents pin [options] <agent>
```

pin the agent to the top of the list

Arguments:

- `<agent>`

Options:

- `--json`: print the raw JSON response instead of a table

### agents queue

```
reflex-cli agents queue [options] [command]
```

manage the agent's queued messages

#### agents queue add

```
reflex-cli agents queue add [options] <agent> [message]
```

queue a message for the next turn

Arguments:

- `<agent>`
- `[message]`

Options:

- `--json`: print the raw JSON response instead of a table

#### agents queue edit

```
reflex-cli agents queue edit [options] <agent> <msgId> <text>
```

rewrite a queued message

Arguments:

- `<agent>`
- `<msgId>`
- `<text>`

Options:

- `--json`: print the raw JSON response instead of a table

#### agents queue reorder

```
reflex-cli agents queue reorder [options] <agent> <msgIds...>
```

reorder the queue (every message id, in the new order)

Arguments:

- `<agent>`
- `<msgIds>`

Options:

- `--json`: print the raw JSON response instead of a table

#### agents queue rm

```
reflex-cli agents queue rm [options] <agent> <msgId>
```

remove a queued message

Arguments:

- `<agent>`
- `<msgId>`

Options:

- `--json`: print the raw JSON response instead of a table

### agents rename

```
reflex-cli agents rename [options] <agent> <name>
```

rename the agent

Arguments:

- `<agent>`
- `<name>`

Options:

- `--json`: print the raw JSON response instead of a table

### agents resume

```
reflex-cli agents resume [options] <agent>
```

resume a suspended agent

Arguments:

- `<agent>`

Options:

- `--json`: print the raw JSON response instead of a table

### agents send

```
reflex-cli agents send [options] <agent> [message]
```

send a message to the agent (queued automatically mid-turn)

Arguments:

- `<agent>`
- `[message]`

Options:

- `--json`: print the raw JSON response instead of a table
- `--attach <path>`: attach a file (repeatable); sent as content blocks like the web composer

### agents show

```
reflex-cli agents show [options] <agent>
```

show one agent run in full

Arguments:

- `<agent>`

Options:

- `--json`: print the raw JSON response instead of a table

### agents snapshot

```
reflex-cli agents snapshot [options] <agent>
```

save the devbox as a snapshot; this ends the run

Arguments:

- `<agent>`

Options:

- `--json`: print the raw JSON response instead of a table
- `--yes`: skip the confirmation prompt
- `--name <name>`: snapshot name (required)

### agents stop

```
reflex-cli agents stop [options] <agent>
```

stop the run and shut down its devbox (the agent is kept)

Arguments:

- `<agent>`

Options:

- `--json`: print the raw JSON response instead of a table

### agents unarchive

```
reflex-cli agents unarchive [options] <agent>
```

restore an archived agent

Arguments:

- `<agent>`

Options:

- `--json`: print the raw JSON response instead of a table

### agents unpin

```
reflex-cli agents unpin [options] <agent>
```

unpin the agent

Arguments:

- `<agent>`

Options:

- `--json`: print the raw JSON response instead of a table

### agents watch

```
reflex-cli agents watch [options] <agent>
```

stream the agent transcript; exits when the turn completes

Arguments:

- `<agent>`

Options:

- `--json`: print stream events as NDJSON, one JSON event per line
- `--until <condition>`: when to exit: done, pr, or forever

## api

```
reflex-cli api [options] [operation] [args...]
```

call any public API operation by name; output is always JSON

Arguments:

- `[operation]`: operationId from the OpenAPI spec (see --list)
- `[args]`: path parameters, in URL order

Options:

- `--list`: list every operation with its route and summary
- `--param <name=value>`: query parameter (repeatable)
- `--field <name=value>`: request body field, dotted paths allowed (repeatable)
- `--input <file>`: request body from a JSON file, or - for stdin

## blueprints

```
reflex-cli blueprints [options] [command]
```

inspect the org’s repo images

### blueprints list

```
reflex-cli blueprints list [options]
```

list the org’s blueprints

Options:

- `--json`: print the raw JSON response instead of a table

## chat

```
reflex-cli chat [options] <agent>
```

open the interactive chat for one agent

Arguments:

- `<agent>`: agent id

## completion

```
reflex-cli completion [options] <shell>
```

print a completion script for your shell

Arguments:

- `<shell>`: bash, zsh, or fish

## connect

```
reflex-cli connect [options]
```

connect this machine as a workstation, with an activity log

Options:

- `--dir <path>`: directory agents may access in connect mode (default: current directory)
- `--name <name>`: workstation display name (default: hostname)
- `--headless`: connect without the TUI (log to stdout); used by the service
- `--ask`: require per-call approval for commands and file writes
- `--allow-exec`: with --ask: pre-approve commands (writes still ask)
- `--allow-write`: with --ask: pre-approve file writes (commands still ask)
- `--read-only`: deny commands and writes outright (read/list still work)

## doctor

```
reflex-cli doctor [options]
```

diagnose the setup: config, server, key, org, websocket

Options:

- `--json`: print results as JSON

## flags

```
reflex-cli flags [options] [command]
```

inspect and set feature flags

### flags list

```
reflex-cli flags list [options]
```

list all feature flags

Options:

- `--json`: print the raw JSON response instead of a table

### flags overrides

```
reflex-cli flags overrides [options] [command] <key>
```

list a flag's per-user overrides

Arguments:

- `<key>`

Options:

- `--json`: print the raw JSON response instead of a table

#### flags overrides rm

```
reflex-cli flags overrides rm [options] <key> <userId>
```

clear a user's override for a flag

Arguments:

- `<key>`
- `<userId>`

Options:

- `--json`: print the raw JSON response instead of a table

#### flags overrides set

```
reflex-cli flags overrides set [options] <key> <userId> <value>
```

set a user's override for a flag (true/false)

Arguments:

- `<key>`
- `<userId>`
- `<value>`

Options:

- `--json`: print the raw JSON response instead of a table

### flags set

```
reflex-cli flags set [options] <key> <value>
```

enable or disable a feature flag (true/false)

Arguments:

- `<key>`
- `<value>`

Options:

- `--json`: print the raw JSON response instead of a table

## keys

```
reflex-cli keys [options] [command]
```

inspect your personal API keys

### keys create

```
reflex-cli keys create [options]
```

create a personal API key; the token is shown once

Options:

- `--json`: print the raw JSON response instead of a table
- `--name <name>`: key name (required)

### keys list

```
reflex-cli keys list [options]
```

list your personal API keys

Options:

- `--json`: print the raw JSON response instead of a table

### keys revoke

```
reflex-cli keys revoke [options] <id>
```

revoke a personal API key

Arguments:

- `<id>`

Options:

- `--json`: print the raw JSON response instead of a table
- `--yes`: skip the confirmation prompt

## login

```
reflex-cli login [options]
```

sign in; without --key, opens a browser connect link to approve this machine

## open

```
reflex-cli open [options] <agent> [target]
```

open the agent in your browser: its page, its PR, or a daemon

Arguments:

- `<agent>`: agent id
- `[target]`: pr for the pull request, or a daemon name for its tunnel

Options:

- `--print`: print the URL without opening a browser

## orgs

```
reflex-cli orgs [options] [command]
```

inspect the organizations you belong to

### orgs base-image

```
reflex-cli orgs base-image [options] [command]
```

inspect and rebuild the org's base image

#### orgs base-image rebuild

```
reflex-cli orgs base-image rebuild [options]
```

rebuild the base image in the background

Options:

- `--json`: print the raw JSON response instead of a table
- `--yes`: skip the confirmation prompt

#### orgs base-image show

```
reflex-cli orgs base-image show [options]
```

report the org's base image commands and build status

Options:

- `--json`: print the raw JSON response instead of a table

### orgs create

```
reflex-cli orgs create [options]
```

create an organization with you as its owner

Options:

- `--json`: print the raw JSON response instead of a table
- `--name <name>`: organization name (required)
- `--slug <slug>`: URL slug (default: derived from the name)
- `--support-email <email>`: support contact email

### orgs delete

```
reflex-cli orgs delete [options] <org>
```

permanently delete an organization and all of its data

Arguments:

- `<org>`

Options:

- `--json`: print the raw JSON response instead of a table
- `--yes`: skip the confirmation prompt

### orgs invites

```
reflex-cli orgs invites [options] [command]
```

invite people to the active org by email

#### orgs invites create

```
reflex-cli orgs invites create [options]
```

invite a user by email; the link is shown once

Options:

- `--json`: print the raw JSON response instead of a table
- `--email <email>`: email to invite (required)

#### orgs invites list

```
reflex-cli orgs invites list [options]
```

list invites, pending ones by default

Options:

- `--json`: print the raw JSON response instead of a table
- `--status <status>`: filter: pending, consumed, revoked, declined, or all

#### orgs invites revoke

```
reflex-cli orgs invites revoke [options] <inviteId>
```

revoke an invite so its link stops working

Arguments:

- `<inviteId>`

Options:

- `--json`: print the raw JSON response instead of a table

### orgs list

```
reflex-cli orgs list [options]
```

list your organizations

Options:

- `--json`: print the raw JSON response instead of a table

### orgs members

```
reflex-cli orgs members [options] [command]
```

manage who belongs to the active org

#### orgs members add

```
reflex-cli orgs members add [options] <user>
```

add an existing user to the org, by user id or email

Arguments:

- `<user>`

Options:

- `--json`: print the raw JSON response instead of a table

#### orgs members list

```
reflex-cli orgs members list [options]
```

list the members of the active org and their roles

Options:

- `--json`: print the raw JSON response instead of a table

#### orgs members rm

```
reflex-cli orgs members rm [options] <userId>
```

remove a member from the org

Arguments:

- `<userId>`

Options:

- `--json`: print the raw JSON response instead of a table

### orgs plugins

```
reflex-cli orgs plugins [options] [command]
```

manage the org's installed plugins

#### orgs plugins install

```
reflex-cli orgs plugins install [options] <name>
```

install a plugin for the org

Arguments:

- `<name>`

Options:

- `--json`: print the raw JSON response instead of a table

#### orgs plugins list

```
reflex-cli orgs plugins list [options]
```

list installed, available, and system plugins

Options:

- `--json`: print the raw JSON response instead of a table

#### orgs plugins settings

```
reflex-cli orgs plugins settings [options] <name>
```

read plugin settings; with --set pairs, merge and save them

Arguments:

- `<name>`

Options:

- `--json`: print the raw JSON response instead of a table
- `--set <key=value...>`: setting to change (repeatable); values parse as JSON when possible

#### orgs plugins show

```
reflex-cli orgs plugins show [options] <name>
```

report a plugin's installation status for the org

Arguments:

- `<name>`

Options:

- `--json`: print the raw JSON response instead of a table

#### orgs plugins uninstall

```
reflex-cli orgs plugins uninstall [options] <name>
```

uninstall a plugin; dependent plugins are removed with it

Arguments:

- `<name>`

Options:

- `--json`: print the raw JSON response instead of a table
- `--yes`: skip the confirmation prompt

### orgs roles

```
reflex-cli orgs roles [options] [command]
```

inspect and assign roles in the active org

#### orgs roles assign

```
reflex-cli orgs roles assign [options] <userId> <roleId>
```

assign a role to an org member

Arguments:

- `<userId>`
- `<roleId>`

Options:

- `--json`: print the raw JSON response instead of a table

#### orgs roles list

```
reflex-cli orgs roles list [options]
```

list the roles available in the active org

Options:

- `--json`: print the raw JSON response instead of a table

#### orgs roles revoke

```
reflex-cli orgs roles revoke [options] <userId> <roleId>
```

revoke a role from an org member

Arguments:

- `<userId>`
- `<roleId>`

Options:

- `--json`: print the raw JSON response instead of a table

#### orgs roles show

```
reflex-cli orgs roles show [options] <roleId>
```

show a role and its permissions

Arguments:

- `<roleId>`

Options:

- `--json`: print the raw JSON response instead of a table

### orgs sandbox

```
reflex-cli orgs sandbox [options] [command]
```

manage the org's sandbox provider key (platform admin)

#### orgs sandbox health

```
reflex-cli orgs sandbox health [options]
```

report whether the org's stored sandbox key works

Options:

- `--json`: print the raw JSON response instead of a table

#### orgs sandbox set

```
reflex-cli orgs sandbox set [options]
```

validate and save the sandbox provider API key

Options:

- `--json`: print the raw JSON response instead of a table
- `--api-key <key>`: the provider API key (or pipe it on stdin)

#### orgs sandbox show

```
reflex-cli orgs sandbox show [options]
```

report the org's sandbox provider key and account

Options:

- `--json`: print the raw JSON response instead of a table

#### orgs sandbox validate

```
reflex-cli orgs sandbox validate [options]
```

check a sandbox provider API key without saving it

Options:

- `--json`: print the raw JSON response instead of a table
- `--api-key <key>`: the provider API key (or pipe it on stdin)

### orgs secrets

```
reflex-cli orgs secrets [options] [command]
```

manage the org's secrets (platform admin)

#### orgs secrets set

```
reflex-cli orgs secrets set [options] <name>
```

save an org secret; the value comes from --value, stdin, or a hidden prompt

Arguments:

- `<name>`

Options:

- `--json`: print the raw JSON response instead of a table
- `--value <value>`: the secret value (or pipe it on stdin)

#### orgs secrets status

```
reflex-cli orgs secrets status [options]
```

report which of the org's secrets are set

Options:

- `--json`: print the raw JSON response instead of a table

### orgs show

```
reflex-cli orgs show [options] [org]
```

show one organization (defaults to the active org)

Arguments:

- `[org]`

Options:

- `--json`: print the raw JSON response instead of a table

### orgs teams

```
reflex-cli orgs teams [options] [command]
```

list and create teams in the active org

#### orgs teams create

```
reflex-cli orgs teams create [options]
```

create a team and join it as its maintainer

Options:

- `--json`: print the raw JSON response instead of a table
- `--name <name>`: team name (required)
- `--slug <slug>`: URL slug (default: derived from the name)
- `--description <text>`: what the team is for
- `--default-role <roleId>`: role new members get

#### orgs teams list

```
reflex-cli orgs teams list [options]
```

list the teams in the active org

Options:

- `--json`: print the raw JSON response instead of a table

### orgs update

```
reflex-cli orgs update [options] <org>
```

update an organization; complex fields go through `api updateOrganization`

Arguments:

- `<org>`

Options:

- `--json`: print the raw JSON response instead of a table
- `--name <name>`: new name
- `--slug <slug>`: new URL slug
- `--support-email <email>`: support contact email
- `--avatar-url <url>`: avatar image URL
- `--default-sandbox-size <size>`: default devbox size
- `--sandbox-retention-days <n>`: devbox retention in days

### orgs use

```
reflex-cli orgs use [options] <org>
```

set the default organization for every scoped command

Arguments:

- `<org>`

Options:

- `--json`: print the raw JSON response instead of a table

## run

```
reflex-cli run [options]
```

launch an agent and stream it until the turn completes

Options:

- `-p, --prompt <text>`: the initial prompt (required)
- `--repo <owner/repo[#branch]>`: git repo to attach
- `--type <agentType>`: agent type (default: org default)
- `--model <model>`: model override
- `--name <name>`: display name
- `--system-prompt <text>`: system prompt
- `--blueprint <name>`: Blueprint to boot from
- `--snapshot <id>`: snapshot to boot from (replaces Blueprint)
- `--size <size>`: devbox resource size (SMALL … XX_LARGE)
- `--env <KEY=VALUE>`: environment variable (repeatable)
- `--attach <path>`: attach a file (repeatable); sent as content blocks like the web composer
- `--json`: stream events as NDJSON, then print a final result object
- `--until <condition>`: when to exit: done, pr, or forever

## secrets

```
reflex-cli secrets [options] [command]
```

inspect secrets and model provider keys

### secrets providers

```
reflex-cli secrets providers [options] [command]
```

model provider keys you can use

#### secrets providers create

```
reflex-cli secrets providers create [options]
```

add a personal model provider key

Options:

- `--json`: print the raw JSON response instead of a table
- `--provider <provider>`: provider (required): anthropic, openai, xai, google, openrouter, cursor, fireworks-ai, baseten, vercel, nebius
- `--name <name>`: key name (required)
- `--type <type>`: apiKey (default) or subscription
- `--base-url <url>`: custom API base URL
- `--value <value>`: the key value (or pipe it on stdin)

#### secrets providers list

```
reflex-cli secrets providers list [options]
```

list every model provider key you can use, across scopes

Options:

- `--json`: print the raw JSON response instead of a table

## service

```
reflex-cli service [options] [action]
```

manage connect as a boot daemon (launchd on macOS, systemd on Linux)

Arguments:

- `[action]`: install | uninstall | status

Options:

- `--dir <path>`: directory agents may access in connect mode (default: current directory)
- `--name <name>`: workstation display name (default: hostname)
- `--headless`: connect without the TUI (log to stdout); used by the service
- `--ask`: require per-call approval for commands and file writes
- `--allow-exec`: with --ask: pre-approve commands (writes still ask)
- `--allow-write`: with --ask: pre-approve file writes (commands still ask)
- `--read-only`: deny commands and writes outright (read/list still work)

## snapshots

```
reflex-cli snapshots [options] [command]
```

inspect saved devbox snapshots

### snapshots list

```
reflex-cli snapshots list [options]
```

list the org’s devbox snapshots

Options:

- `--json`: print the raw JSON response instead of a table

## stats

```
reflex-cli stats [options]
```

show your profile stats

Options:

- `--json`: print the raw JSON response instead of a table

## teams

```
reflex-cli teams [options] [command]
```

inspect and manage a team by id

### teams delete

```
reflex-cli teams delete [options] <teamId>
```

permanently delete a team, its memberships, and its team secrets

Arguments:

- `<teamId>`

Options:

- `--json`: print the raw JSON response instead of a table
- `--yes`: skip the confirmation prompt

### teams members

```
reflex-cli teams members [options] [command]
```

manage a team's members

#### teams members add

```
reflex-cli teams members add [options] <teamId> <user>
```

add a user to the team, by user id or email

Arguments:

- `<teamId>`
- `<user>`

Options:

- `--json`: print the raw JSON response instead of a table

#### teams members list

```
reflex-cli teams members list [options] <teamId>
```

list the members of a team

Arguments:

- `<teamId>`

Options:

- `--json`: print the raw JSON response instead of a table

#### teams members rm

```
reflex-cli teams members rm [options] <teamId> <userId>
```

remove a member from the team

Arguments:

- `<teamId>`
- `<userId>`

Options:

- `--json`: print the raw JSON response instead of a table

### teams set-role

```
reflex-cli teams set-role [options] <teamId> <userId> <roleId>
```

set a team member's role

Arguments:

- `<teamId>`
- `<userId>`
- `<roleId>`

Options:

- `--json`: print the raw JSON response instead of a table

### teams show

```
reflex-cli teams show [options] <teamId>
```

show a team and its members

Arguments:

- `<teamId>`

Options:

- `--json`: print the raw JSON response instead of a table

### teams update

```
reflex-cli teams update [options] <teamId>
```

update a team's name, slug, description, or default role

Arguments:

- `<teamId>`

Options:

- `--json`: print the raw JSON response instead of a table
- `--name <name>`: new name
- `--slug <slug>`: new URL slug
- `--description <text>`: what the team is for
- `--default-role <roleId>`: role new members get

## users

```
reflex-cli users [options] [command]
```

inspect the users you can see

### users list

```
reflex-cli users list [options]
```

list users (org members; platform admins see every user)

Options:

- `--json`: print the raw JSON response instead of a table
- `--org-only`: only the active org, even as a platform admin

### users show

```
reflex-cli users show [options] <id>
```

show a user and their linked sign-in providers

Arguments:

- `<id>`

Options:

- `--json`: print the raw JSON response instead of a table

## watch

```
reflex-cli watch [options] <agent>
```

stream the agent transcript; exits when the turn completes

Arguments:

- `<agent>`

Options:

- `--json`: print stream events as NDJSON, one JSON event per line
- `--until <condition>`: when to exit: done, pr, or forever

## whoami

```
reflex-cli whoami [options]
```

show the server, key, and organization requests will use

Options:

- `--json`: print as JSON

## workstations

```
reflex-cli workstations [options] [command]
```

inspect connected workstations

### workstations list

```
reflex-cli workstations list [options]
```

list the workstations connected to the org

Options:

- `--json`: print the raw JSON response instead of a table
