# Changelog

## [0.17.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.16.0...reflex-client-v0.17.0) (2026-08-26)


### Features

* **users:** adopt ID-JAG for MCP authorization, inbound and outbound ([#3992](https://github.com/runloopai/reflex/issues/3992)) ([4ddd812](https://github.com/runloopai/reflex/commit/4ddd812ed15512fb0d72d61c017a854181647121))

## [0.16.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.15.2...reflex-client-v0.16.0) (2026-08-26)


### Features

* attach MCP servers to a running session from the chat composer ([#4032](https://github.com/runloopai/reflex/issues/4032)) ([2ffe221](https://github.com/runloopai/reflex/commit/2ffe22164bac13a312bfbfb47655eff3647c0ecd))
* make an attached MCP server usable by the running session ([#4068](https://github.com/runloopai/reflex/issues/4068)) ([e47b007](https://github.com/runloopai/reflex/commit/e47b007682f48b0bf0259b03bfb7cadb7f417e5c))


### Bug Fixes

* **server:** list only org, team, and user secrets in the env-var picker ([#3650](https://github.com/runloopai/reflex/issues/3650)) ([7de361d](https://github.com/runloopai/reflex/commit/7de361d6ead6053065826883e9f5f553905b9fe2))
* **web:** make filtered agent lists show every match, not just page one ([#4045](https://github.com/runloopai/reflex/issues/4045)) ([98a0850](https://github.com/runloopai/reflex/commit/98a0850b617a2fd94c1225b9a249699deb18b167))
* **web:** move a session between groups instead of filing it in several ([#4061](https://github.com/runloopai/reflex/issues/4061)) ([72a1072](https://github.com/runloopai/reflex/commit/72a1072d0e8ab01330a59ed90aca8efaeb57dabb))

## [0.15.2](https://github.com/runloopai/reflex/compare/reflex-client-v0.15.1...reflex-client-v0.15.2) (2026-08-25)


### Bug Fixes

* **server:** keep CLI device sign-in state in Postgres so it survives two replicas ([#3860](https://github.com/runloopai/reflex/issues/3860)) ([7ce67e2](https://github.com/runloopai/reflex/commit/7ce67e2dc22802f81f46270e0b7486ac4d5a51ba))

## [0.15.1](https://github.com/runloopai/reflex/compare/reflex-client-v0.15.0...reflex-client-v0.15.1) (2026-08-24)


### Bug Fixes

* **plugin-agent-persona:** remove vestigial isBuiltIn plumbing ([#3970](https://github.com/runloopai/reflex/issues/3970)) ([8470efb](https://github.com/runloopai/reflex/commit/8470efb08f53aac4d802882de5e15aa93a37e354))

## [0.15.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.14.0...reflex-client-v0.15.0) (2026-08-24)


### Features

* **slack:** share channel-started sessions with thread participants ([#3898](https://github.com/runloopai/reflex/issues/3898)) ([0a5315c](https://github.com/runloopai/reflex/commit/0a5315c8adf7f512dc86e9a2f16935cef32996cc))


### Bug Fixes

* **costs:** price Codex launch models and record ACP session spend ([#3937](https://github.com/runloopai/reflex/issues/3937)) ([365e8da](https://github.com/runloopai/reflex/commit/365e8da020755848cb798ec35ce8ec5c006c492e))

## [0.14.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.13.0...reflex-client-v0.14.0) (2026-08-24)


### Features

* **onboarding:** add a resend button to pending email invites ([#3902](https://github.com/runloopai/reflex/issues/3902)) ([c93d2b4](https://github.com/runloopai/reflex/commit/c93d2b4edc2da9c3d1762b1e5af8921641502d91))


### Bug Fixes

* **costs:** point the sonnet alias at Sonnet 5 and repair Anthropic rates ([#3915](https://github.com/runloopai/reflex/issues/3915)) ([0059efb](https://github.com/runloopai/reflex/commit/0059efb576e6e05f16a3eeb7ecc872dac90ee7db))

## [0.13.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.12.0...reflex-client-v0.13.0) (2026-08-21)


### Features

* **personas:** launch a persona as a different agent type through the API ([#3774](https://github.com/runloopai/reflex/issues/3774)) ([cf1a392](https://github.com/runloopai/reflex/commit/cf1a39221ca35a3149a5f437f58ae065ae53fed6))

## [0.12.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.11.0...reflex-client-v0.12.0) (2026-08-21)


### Features

* add review-only prompt mode for agent personas (REF-142) ([#3842](https://github.com/runloopai/reflex/issues/3842)) ([a08fe3c](https://github.com/runloopai/reflex/commit/a08fe3c76490e18db80fc59ba2836fb8d4d76a61))


### Bug Fixes

* **server:** soft-delete agent rows on DELETE /agents/:id ([#3843](https://github.com/runloopai/reflex/issues/3843)) ([a279323](https://github.com/runloopai/reflex/commit/a279323d042e4c9ffdbb43b4119cff861ca51f3f))

## [0.11.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.10.0...reflex-client-v0.11.0) (2026-08-19)


### Features

* **server:** identity provisioning core with SCIM and Okta sync front doors ([#3764](https://github.com/runloopai/reflex/issues/3764)) ([7392285](https://github.com/runloopai/reflex/commit/7392285e07f927741da81ee123f29b12e2b76b5e))


### Bug Fixes

* watch a slow send's delivery outcome and size the echo deadline for a devbox wake ([#3828](https://github.com/runloopai/reflex/issues/3828)) ([4865f31](https://github.com/runloopai/reflex/commit/4865f31a9c5bf1dec88223c8436dabd09e818241))

## [0.10.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.9.0...reflex-client-v0.10.0) (2026-08-18)


### Features

* **security:** org-level controls over session sharing ([#3656](https://github.com/runloopai/reflex/issues/3656)) ([9b6f8f4](https://github.com/runloopai/reflex/commit/9b6f8f4cd78e5f01a542f45286704c1b1b245b67))

## [0.9.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.8.0...reflex-client-v0.9.0) (2026-08-14)


### Features

* **server:** fence agents and agent groups on owner_id, retire the NULL owner ([#3645](https://github.com/runloopai/reflex/issues/3645)) ([09bad82](https://github.com/runloopai/reflex/commit/09bad82de06952504bb8d4c6746c3c4f76a43531))
* **server:** generalize resource grants through the resource-kind registry ([#3543](https://github.com/runloopai/reflex/issues/3543)) ([42bf64c](https://github.com/runloopai/reflex/commit/42bf64c2236ce139de813b9dc41e39e1e8b9b03d))

## [0.8.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.7.0...reflex-client-v0.8.0) (2026-08-13)


### Features

* **server:** bounded outcome wait for mailbox agent commands ([#3553](https://github.com/runloopai/reflex/issues/3553)) ([f692692](https://github.com/runloopai/reflex/commit/f692692d917ce5f3771d8746493671b0e995d035))

## [0.7.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.6.0...reflex-client-v0.7.0) (2026-08-13)


### Features

* **web:** tell users when self-serve org creation is turned off ([#3461](https://github.com/runloopai/reflex/issues/3461)) ([f44ffe7](https://github.com/runloopai/reflex/commit/f44ffe7a52da0a016d38bec17846a75c8835ea3b))

## [0.6.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.5.0...reflex-client-v0.6.0) (2026-08-11)


### Features

* add Runloop model provider ([#2939](https://github.com/runloopai/reflex/issues/2939)) ([b1c0d36](https://github.com/runloopai/reflex/commit/b1c0d365ccb707469f116070f231a35d3648705e))
* **agents:** pick labels and a group when launching a run ([#3386](https://github.com/runloopai/reflex/issues/3386)) ([3679a96](https://github.com/runloopai/reflex/commit/3679a96745c1c46b45e4b7b57d5d24eb49a00e89))
* **crew:** data-defined AI software teams (M0 + M1 actor runtime) ([#3401](https://github.com/runloopai/reflex/issues/3401)) ([6d6ff59](https://github.com/runloopai/reflex/commit/6d6ff5900866d7d74e8f3d5af3821fc23e436b54))
* **flows:** show what changed when publishing, and title the change with an LLM ([#3166](https://github.com/runloopai/reflex/issues/3166)) ([46cb4f1](https://github.com/runloopai/reflex/commit/46cb4f189bb8f5042dc566ac2edbae9444a6a694))
* **groups:** scope agent groups to each user ([#3365](https://github.com/runloopai/reflex/issues/3365)) ([de6ac5c](https://github.com/runloopai/reflex/commit/de6ac5c109fc2338238c6643186127688bdc6873))


### Bug Fixes

* **server:** keep the sandbox bridge connected and self-heal the daemon list ([#3426](https://github.com/runloopai/reflex/issues/3426)) ([28425f7](https://github.com/runloopai/reflex/commit/28425f7462cfd48c4735b0f2bab02da87e23ed66))

## [0.5.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.4.0...reflex-client-v0.5.0) (2026-08-07)


### Features

* ask to share when an agent run is not shared with you ([#3194](https://github.com/runloopai/reflex/issues/3194)) ([2d61ea0](https://github.com/runloopai/reflex/commit/2d61ea0176381516b334cf34dd7de5a6fa187f7b))
* gate agent write controls on the caller's actual access ([#3239](https://github.com/runloopai/reflex/issues/3239)) ([2a926dd](https://github.com/runloopai/reflex/commit/2a926dd158b43b372c07bbff1b199b7f37525ef4))
* **rbac:** revocable, expiring resource grants with a self-service management API ([#2975](https://github.com/runloopai/reflex/issues/2975)) ([d074755](https://github.com/runloopai/reflex/commit/d07475553c88267d6fde300465b6c63cfd90e642))
* **web:** update a subscription from the model provider picker ([#3156](https://github.com/runloopai/reflex/issues/3156)) ([d251420](https://github.com/runloopai/reflex/commit/d251420f18e21d534b78c76820bea8eeaf50a879))


### Bug Fixes

* **build:** regenerate openapi spec and resync client sha256 ([#3253](https://github.com/runloopai/reflex/issues/3253)) ([1a057fe](https://github.com/runloopai/reflex/commit/1a057feb450e02639132a0fced219e7a38e1cd72))
* **rbac:** harden resource-grant reads, admin shares, and expiry errors ([#3172](https://github.com/runloopai/reflex/issues/3172)) ([9549075](https://github.com/runloopai/reflex/commit/954907509af2d1e19f07337a4c0f8c4c19b9e6dd))
* **web:** show existing shares and the sharer in the agent share dialog ([#3193](https://github.com/runloopai/reflex/issues/3193)) ([b74b77e](https://github.com/runloopai/reflex/commit/b74b77e243905aac867c259362083c72fc556b18))

## [0.4.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.3.0...reflex-client-v0.4.0) (2026-08-05)


### Features

* **onboarding:** make org setup business profile driven & rm plugins sections ([#2819](https://github.com/runloopai/reflex/issues/2819)) ([3a1a6ec](https://github.com/runloopai/reflex/commit/3a1a6ecb5e95af56f2c7a22a66cb2238cd5318a6))

## [0.3.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.2.0...reflex-client-v0.3.0) (2026-08-05)


### Features

* **web:** mark an agent unread from the Mark as picker ([#2995](https://github.com/runloopai/reflex/issues/2995)) ([b212b42](https://github.com/runloopai/reflex/commit/b212b429773188f68badd830eb5cc7a7e3b6eafa))


### Reverts

* Revert "chore(deps): upgrade root tooling dependencies" ([#2988](https://github.com/runloopai/reflex/issues/2988)) ([7cec6d3](https://github.com/runloopai/reflex/commit/7cec6d3ac008151e41b8e7da5237e4cd282c0eb4))

## [0.2.0](https://github.com/runloopai/reflex/compare/reflex-client-v0.1.0...reflex-client-v0.2.0) (2026-08-04)


### Features

* add computer use and browser use capabilities to devboxes ([#2524](https://github.com/runloopai/reflex/issues/2524)) ([beda2b7](https://github.com/runloopai/reflex/commit/beda2b7fa3aab042493854658cb9043672c52068))
* agent groups and work labels ([#2894](https://github.com/runloopai/reflex/issues/2894)) ([701e7e9](https://github.com/runloopai/reflex/commit/701e7e970c448a9e51336133987c474caf40ca05))
* **agent:** originator attribution, Agents/Flows filter, Stop primary action ([#2236](https://github.com/runloopai/reflex/issues/2236)) ([52024a5](https://github.com/runloopai/reflex/commit/52024a5ef10c7cadbcd9408624a59bcfbed3375a))
* **agents:** add per-agent plan mode for Claude, Cursor, and Codex ([#1967](https://github.com/runloopai/reflex/issues/1967)) ([875722f](https://github.com/runloopai/reflex/commit/875722f8eb035bfd2926d7a56bd65eee04961336))
* **agents:** mark runs blocked, in review, or completed ([#2888](https://github.com/runloopai/reflex/issues/2888)) ([9ad26f3](https://github.com/runloopai/reflex/commit/9ad26f392e2ebb778de1d5c81cce1232d995a98d))
* **agents:** switch a running agent's subscription mid-run (Claude Max + Codex, multi-subscription) ([#2518](https://github.com/runloopai/reflex/issues/2518)) ([d7631db](https://github.com/runloopai/reflex/commit/d7631db1b60d235f6d1d3cb22b0820ff6eefddab))
* **agents:** work assessments — structured, reviewable walkthroughs of agent work ([#2918](https://github.com/runloopai/reflex/issues/2918)) ([2731085](https://github.com/runloopai/reflex/commit/2731085041e37ed9af99593c0ec5a933c7ff0fe6))
* **billing:** org billing, usage, and payments via Stripe ([#2635](https://github.com/runloopai/reflex/issues/2635)) ([9d8c12f](https://github.com/runloopai/reflex/commit/9d8c12f9a87e0b5ded2e07a05b3c856de2683021))
* **chat:** remove and preview attachments on a queued message ([#2724](https://github.com/runloopai/reflex/issues/2724)) ([e77a4db](https://github.com/runloopai/reflex/commit/e77a4db28c6a474ecf70a91c0adcd016d224e6e9))
* **codex:** native slash commands, steering, and fast mode ([#2316](https://github.com/runloopai/reflex/issues/2316)) ([1beaac3](https://github.com/runloopai/reflex/commit/1beaac3ffd937e0067dac733a87ba57143b820d4))
* **flows:** filter the flows list by owner (users, teams, org), status, and trigger ([#2845](https://github.com/runloopai/reflex/issues/2845)) ([c8a2cc3](https://github.com/runloopai/reflex/commit/c8a2cc34dd6a8b4d5dce5279ac469344bc7f62a1))
* **model-providers:** add Vercel AI Gateway as a first-class provider ([#2389](https://github.com/runloopai/reflex/issues/2389)) ([458728b](https://github.com/runloopai/reflex/commit/458728b7df98f7dbfe08109ab6d395afd1e0a966))
* **models:** add Nebius as a model provider ([#2528](https://github.com/runloopai/reflex/issues/2528)) ([9503d10](https://github.com/runloopai/reflex/commit/9503d10029f886cb0c483af9816acee509d45fad))
* **onboarding:** derive org plugin set from orgKind server-side ([#2377](https://github.com/runloopai/reflex/issues/2377)) ([6f8fe80](https://github.com/runloopai/reflex/commit/6f8fe801f079cfdcec7ee3345f284c4acb8d1933))
* **onboarding:** gate and rename Runloop provisioning ([#2371](https://github.com/runloopai/reflex/issues/2371)) ([78bb8ee](https://github.com/runloopai/reflex/commit/78bb8eec020d802602f80754f89ce296b852ec49))
* **org:** org-level default and custom sandbox sizes ([#2348](https://github.com/runloopai/reflex/issues/2348)) ([170e608](https://github.com/runloopai/reflex/commit/170e60812b58577548e4b560e76fc8db73aab9f7))
* **org:** route devbox package installs through Runloop artifact mirrors, with an org-level opt-out ([#2584](https://github.com/runloopai/reflex/issues/2584)) ([495a6ad](https://github.com/runloopai/reflex/commit/495a6ad348c9ce2bb291a5aff5055658c9893383))
* **plugins:** per-org plugin settings on org installations ([#2342](https://github.com/runloopai/reflex/issues/2342)) ([0492c0a](https://github.com/runloopai/reflex/commit/0492c0ac26bc36f1c9a71dfcee87f8cf8d651095))
* publish the Reflex SDK to npm from reflex-os ([#2862](https://github.com/runloopai/reflex/issues/2862)) ([20f246d](https://github.com/runloopai/reflex/commit/20f246d0830d93d92a63b4616c63486da9b96f1c))
* **sdk:** agent-activity chat kit, launch-catalog routes, and the Reflex Arcade demo ([#2313](https://github.com/runloopai/reflex/issues/2313)) ([ba398a9](https://github.com/runloopai/reflex/commit/ba398a972fe2d480c98b59f0c57d6587d109fffa))
* **service-accounts:** user-created service accounts with API keys ([#2530](https://github.com/runloopai/reflex/issues/2530)) ([5a1ed9e](https://github.com/runloopai/reflex/commit/5a1ed9e818c71f564c7826c40f0f6e9f3b74597f))
* warn about dependents before deleting gateways, policies, and keys ([#2617](https://github.com/runloopai/reflex/issues/2617)) ([5bc1fd3](https://github.com/runloopai/reflex/commit/5bc1fd31c396551c7182f72fca3f24f4408f6396))
* **web:** custom sandbox size for blueprints + inherit blueprint size at launch ([#2649](https://github.com/runloopai/reflex/issues/2649)) ([98d0014](https://github.com/runloopai/reflex/commit/98d00144e055a8f7e25369182cf91daf1bc13360))


### Bug Fixes

* **agents:** fall back to default branch when launch branch is missing ([#2103](https://github.com/runloopai/reflex/issues/2103)) ([66cc5ca](https://github.com/runloopai/reflex/commit/66cc5ca5efb0971e2f88e6ce5ad340d80f4bc1bb))
* **flows:** retry agent_task turns that fail with transient API errors ([#2712](https://github.com/runloopai/reflex/issues/2712)) ([687816f](https://github.com/runloopai/reflex/commit/687816f361b6bfa9de51c782971127c059ebfb26))
* **server:** summaries for every public OpenAPI operation ([#2431](https://github.com/runloopai/reflex/issues/2431)) ([c52d7a1](https://github.com/runloopai/reflex/commit/c52d7a183b6ddcbe7f30109965c9509371bec371))
* stop the subscription picker from auto-switching a running agent ([#2818](https://github.com/runloopai/reflex/issues/2818)) ([64e17cc](https://github.com/runloopai/reflex/commit/64e17cc176d0ae2b06dfeb655f0be9409303eab6))
