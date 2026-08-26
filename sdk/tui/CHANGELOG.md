# Changelog

## [0.11.0](https://github.com/runloopai/reflex/compare/reflex-cli-v0.10.1...reflex-cli-v0.11.0) (2026-08-26)


### Features

* attach MCP servers to a running session from the chat composer ([#4032](https://github.com/runloopai/reflex/issues/4032)) ([2ffe221](https://github.com/runloopai/reflex/commit/2ffe22164bac13a312bfbfb47655eff3647c0ecd))


### Bug Fixes

* **web:** make filtered agent lists show every match, not just page one ([#4045](https://github.com/runloopai/reflex/issues/4045)) ([98a0850](https://github.com/runloopai/reflex/commit/98a0850b617a2fd94c1225b9a249699deb18b167))
* **web:** move a session between groups instead of filing it in several ([#4061](https://github.com/runloopai/reflex/issues/4061)) ([72a1072](https://github.com/runloopai/reflex/commit/72a1072d0e8ab01330a59ed90aca8efaeb57dabb))

## [0.10.1](https://github.com/runloopai/reflex/compare/reflex-cli-v0.10.0...reflex-cli-v0.10.1) (2026-08-25)


### Bug Fixes

* **server:** keep CLI device sign-in state in Postgres so it survives two replicas ([#3860](https://github.com/runloopai/reflex/issues/3860)) ([7ce67e2](https://github.com/runloopai/reflex/commit/7ce67e2dc22802f81f46270e0b7486ac4d5a51ba))

## [0.10.0](https://github.com/runloopai/reflex/compare/reflex-cli-v0.9.0...reflex-cli-v0.10.0) (2026-08-24)


### Features

* **onboarding:** add a resend button to pending email invites ([#3902](https://github.com/runloopai/reflex/issues/3902)) ([c93d2b4](https://github.com/runloopai/reflex/commit/c93d2b4edc2da9c3d1762b1e5af8921641502d91))

## [0.9.0](https://github.com/runloopai/reflex/compare/reflex-cli-v0.8.1...reflex-cli-v0.9.0) (2026-08-21)


### Features

* **personas:** launch a persona as a different agent type through the API ([#3774](https://github.com/runloopai/reflex/issues/3774)) ([cf1a392](https://github.com/runloopai/reflex/commit/cf1a39221ca35a3149a5f437f58ae065ae53fed6))

## [0.8.1](https://github.com/runloopai/reflex/compare/reflex-cli-v0.8.0...reflex-cli-v0.8.1) (2026-08-21)


### Bug Fixes

* **server:** soft-delete agent rows on DELETE /agents/:id ([#3843](https://github.com/runloopai/reflex/issues/3843)) ([a279323](https://github.com/runloopai/reflex/commit/a279323d042e4c9ffdbb43b4119cff861ca51f3f))

## [0.8.0](https://github.com/runloopai/reflex/compare/reflex-cli-v0.7.1...reflex-cli-v0.8.0) (2026-08-19)


### Features

* **server:** identity provisioning core with SCIM and Okta sync front doors ([#3764](https://github.com/runloopai/reflex/issues/3764)) ([7392285](https://github.com/runloopai/reflex/commit/7392285e07f927741da81ee123f29b12e2b76b5e))


### Bug Fixes

* watch a slow send's delivery outcome and size the echo deadline for a devbox wake ([#3828](https://github.com/runloopai/reflex/issues/3828)) ([4865f31](https://github.com/runloopai/reflex/commit/4865f31a9c5bf1dec88223c8436dabd09e818241))

## [0.7.1](https://github.com/runloopai/reflex/compare/reflex-cli-v0.7.0...reflex-cli-v0.7.1) (2026-08-14)


### Bug Fixes

* **chat:** stop counting an overwritten file as all-new lines ([#3486](https://github.com/runloopai/reflex/issues/3486)) ([6dec82e](https://github.com/runloopai/reflex/commit/6dec82eb9e877f0cff1780e9b4781e178e9accea))

## [0.7.0](https://github.com/runloopai/reflex/compare/reflex-cli-v0.6.0...reflex-cli-v0.7.0) (2026-08-14)


### Features

* **server:** fence agents and agent groups on owner_id, retire the NULL owner ([#3645](https://github.com/runloopai/reflex/issues/3645)) ([09bad82](https://github.com/runloopai/reflex/commit/09bad82de06952504bb8d4c6746c3c4f76a43531))
* **server:** generalize resource grants through the resource-kind registry ([#3543](https://github.com/runloopai/reflex/issues/3543)) ([42bf64c](https://github.com/runloopai/reflex/commit/42bf64c2236ce139de813b9dc41e39e1e8b9b03d))

## [0.6.0](https://github.com/runloopai/reflex/compare/reflex-cli-v0.5.0...reflex-cli-v0.6.0) (2026-08-11)


### Features

* add Runloop model provider ([#2939](https://github.com/runloopai/reflex/issues/2939)) ([b1c0d36](https://github.com/runloopai/reflex/commit/b1c0d365ccb707469f116070f231a35d3648705e))
* **groups:** scope agent groups to each user ([#3365](https://github.com/runloopai/reflex/issues/3365)) ([de6ac5c](https://github.com/runloopai/reflex/commit/de6ac5c109fc2338238c6643186127688bdc6873))

## [0.5.0](https://github.com/runloopai/reflex/compare/reflex-cli-v0.4.0...reflex-cli-v0.5.0) (2026-08-07)


### Features

* ask to share when an agent run is not shared with you ([#3194](https://github.com/runloopai/reflex/issues/3194)) ([2d61ea0](https://github.com/runloopai/reflex/commit/2d61ea0176381516b334cf34dd7de5a6fa187f7b))
* **opencode:** add Baseten provider ([#2390](https://github.com/runloopai/reflex/issues/2390)) ([5b1ceac](https://github.com/runloopai/reflex/commit/5b1ceac9443ce3d57ebe9272ca2b0b330d63e91c))
* **rbac:** revocable, expiring resource grants with a self-service management API ([#2975](https://github.com/runloopai/reflex/issues/2975)) ([d074755](https://github.com/runloopai/reflex/commit/d07475553c88267d6fde300465b6c63cfd90e642))


### Bug Fixes

* **rbac:** harden resource-grant reads, admin shares, and expiry errors ([#3172](https://github.com/runloopai/reflex/issues/3172)) ([9549075](https://github.com/runloopai/reflex/commit/954907509af2d1e19f07337a4c0f8c4c19b9e6dd))
* **web:** show existing shares and the sharer in the agent share dialog ([#3193](https://github.com/runloopai/reflex/issues/3193)) ([b74b77e](https://github.com/runloopai/reflex/commit/b74b77e243905aac867c259362083c72fc556b18))

## [0.4.0](https://github.com/runloopai/reflex/compare/reflex-cli-v0.3.0...reflex-cli-v0.4.0) (2026-08-05)


### Features

* **onboarding:** make org setup business profile driven & rm plugins sections ([#2819](https://github.com/runloopai/reflex/issues/2819)) ([3a1a6ec](https://github.com/runloopai/reflex/commit/3a1a6ecb5e95af56f2c7a22a66cb2238cd5318a6))

## [0.3.0](https://github.com/runloopai/reflex/compare/reflex-cli-v0.2.0...reflex-cli-v0.3.0) (2026-08-05)


### Features

* **web:** mark an agent unread from the Mark as picker ([#2995](https://github.com/runloopai/reflex/issues/2995)) ([b212b42](https://github.com/runloopai/reflex/commit/b212b429773188f68badd830eb5cc7a7e3b6eafa))


### Reverts

* Revert "chore(deps): upgrade root tooling dependencies" ([#2988](https://github.com/runloopai/reflex/issues/2988)) ([7cec6d3](https://github.com/runloopai/reflex/commit/7cec6d3ac008151e41b8e7da5237e4cd282c0eb4))

## [0.2.0](https://github.com/runloopai/reflex/compare/reflex-cli-v0.1.0...reflex-cli-v0.2.0) (2026-08-04)


### Features

* agent groups and work labels ([#2894](https://github.com/runloopai/reflex/issues/2894)) ([701e7e9](https://github.com/runloopai/reflex/commit/701e7e970c448a9e51336133987c474caf40ca05))
* **agents:** mark runs blocked, in review, or completed ([#2888](https://github.com/runloopai/reflex/issues/2888)) ([9ad26f3](https://github.com/runloopai/reflex/commit/9ad26f392e2ebb778de1d5c81cce1232d995a98d))
* **agents:** switch a running agent's subscription mid-run (Claude Max + Codex, multi-subscription) ([#2518](https://github.com/runloopai/reflex/issues/2518)) ([d7631db](https://github.com/runloopai/reflex/commit/d7631db1b60d235f6d1d3cb22b0820ff6eefddab))
* **chat:** remove and preview attachments on a queued message ([#2724](https://github.com/runloopai/reflex/issues/2724)) ([e77a4db](https://github.com/runloopai/reflex/commit/e77a4db28c6a474ecf70a91c0adcd016d224e6e9))
* **cli:** generated docs, shell completion, and doctor ([#2445](https://github.com/runloopai/reflex/issues/2445)) ([2f93d95](https://github.com/runloopai/reflex/commit/2f93d95f88edba3b26a95b24929382d17ddd7acd))
* **cli:** notify and one-key install when a newer reflex-cli is published ([#2922](https://github.com/runloopai/reflex/issues/2922)) ([8f62766](https://github.com/runloopai/reflex/commit/8f62766f38d5079513b1aa99126a6ecfaa9e4b98))
* **model-providers:** launch Claude Code and Codex through the Vercel AI Gateway ([#2457](https://github.com/runloopai/reflex/issues/2457)) ([a2f5a28](https://github.com/runloopai/reflex/commit/a2f5a28e0fc822518ccedf148350e636171d2f91))
* **onboarding:** gate and rename Runloop provisioning ([#2371](https://github.com/runloopai/reflex/issues/2371)) ([78bb8ee](https://github.com/runloopai/reflex/commit/78bb8eec020d802602f80754f89ce296b852ec49))
* publish the Reflex SDK to npm from reflex-os ([#2862](https://github.com/runloopai/reflex/issues/2862)) ([20f246d](https://github.com/runloopai/reflex/commit/20f246d0830d93d92a63b4616c63486da9b96f1c))
