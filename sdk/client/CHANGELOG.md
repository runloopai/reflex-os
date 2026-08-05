# Changelog

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
