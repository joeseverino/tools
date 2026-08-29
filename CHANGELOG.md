# Changelog

## Unreleased

- Add the lightweight Tools SDK: narrow shell modules, argument-safe Node
  process/JSON helpers, versioned result envelopes, and shared vault-governance
  adapters. `common.sh` remains a compatibility aggregator.
- Add a validated fleet capability manifest that derives sibling describe and
  Brief emitters plus vault-engine consumers from one declaration.
- Add `tools new --agent` for a Cordon-described result-v1 utility scaffold.
- Bind `site manage` saves to the dashboard source fingerprint and route its MCP
  calls through the shared Node adapter, preventing stale-session overwrites
  when paired with severino-vault-mcp's stale-plan guard.

## 1.0.0 (2026-08-29)


### Features

* add document provenance to PDFs ([7094c25](https://github.com/joeseverino/tools/commit/7094c25b2af42ceed882574e6b916a00e294579e))
* add hq life-sync ([#83](https://github.com/joeseverino/tools/issues/83)) ([a1f943c](https://github.com/joeseverino/tools/commit/a1f943cc67982ecd666ff7394cd8660b1dc676c6))
* add repos TUI workflow dashboard ([090d3ae](https://github.com/joeseverino/tools/commit/090d3ae5f4ba5931c70ceb33b8d07ea6828291c3))
* add repos TUI workflow dashboard ([b1be593](https://github.com/joeseverino/tools/commit/b1be593a750ecb8b2f1b92d3b40329fe1b96f63d))
* add resync and ship CI/PR management (--check, --watch, PR sync) ([1c3d4bf](https://github.com/joeseverino/tools/commit/1c3d4bf9a58fcbd61f01de24de465508cf17d06e))
* add resync and ship CI/PR management (--check, --watch, PR sync) ([82afe9c](https://github.com/joeseverino/tools/commit/82afe9c1c773ff58fe5a66ff160813a3c3ac0a12))
* apply brand tokens to Mermaid ([f425ab3](https://github.com/joeseverino/tools/commit/f425ab3205d5f78f656bc9d55fcda7b93a877bd0))
* branch-safety engine — start verb, stale recovery, one branch-state ladder ([#37](https://github.com/joeseverino/tools/issues/37)) ([8bb722d](https://github.com/joeseverino/tools/commit/8bb722de903fab8cbe4c2420114b4210c0d93c1f))
* brand doc-to-pdf artifacts ([812e550](https://github.com/joeseverino/tools/commit/812e550b2c892eea8a290e16e49a8b9afceb3d80))
* **brand:** add `brand figure` for designed graphics ([238d5dd](https://github.com/joeseverino/tools/commit/238d5dd47518f7f6259518e0ebf87939296e3c8f))
* brief surfaces the backlog (open + stale debt) from the vault brief ([#40](https://github.com/joeseverino/tools/issues/40)) ([869f22c](https://github.com/joeseverino/tools/commit/869f22c81612774434efcd0d4afb576e18621ad9))
* command-surface SOT — one spec, one intercept, derived everywhere ([796affe](https://github.com/joeseverino/tools/commit/796affe45ddfd0c25a059593145bc792034bdceb))
* **cordon:** pin cordon-spec from npm — the schema check verifies everywhere ([#62](https://github.com/joeseverino/tools/issues/62)) ([151c3ba](https://github.com/joeseverino/tools/commit/151c3ba01b5baff331dd2c3873491a78f0b956e3))
* describe v3 — per-command effect (blast radius) + scoped command lookup ([ac52bde](https://github.com/joeseverino/tools/commit/ac52bde4fb6222542193241958d8cf6ba129c2a8))
* doc-to-pdf GitHub links + brand figure graphics ([9979cad](https://github.com/joeseverino/tools/commit/9979cad8b8722b9e2c2b2ce1b3a4768996347e48))
* **doc-to-pdf:** rewrite relative links to absolute GitHub URLs ([ca127ea](https://github.com/joeseverino/tools/commit/ca127eae398cd7e583c185ea25393bdabe497e4e))
* doctor --all, section-scoped mirror writer, sync-state, cache fixes ([85acc15](https://github.com/joeseverino/tools/commit/85acc151fb92fe1c87bd48cd2385d975ab0e0b5f))
* **drift:** json-cache data-store model via the MCP; retire legacy block path ([9522ebe](https://github.com/joeseverino/tools/commit/9522ebe1fcceb4b1910d16df0db48a70b3804ff7))
* **drift:** json-file data-store model alongside legacy blocks ([43b3c63](https://github.com/joeseverino/tools/commit/43b3c63021e344525d4fbddf31b0fc3a54e65345))
* **drift:** migrate nginx, ts-acl, cf-dns to the json-file data store ([99d0148](https://github.com/joeseverino/tools/commit/99d0148cbff1614b19acf1fb64fe23edd42c0a6d))
* emit-once command-surface contract (tools describe) ([510a2d7](https://github.com/joeseverino/tools/commit/510a2d7f141a157ddcdecc106b1817397112c834))
* establish a reusable tools SDK ([#69](https://github.com/joeseverino/tools/issues/69)) ([1fb429b](https://github.com/joeseverino/tools/commit/1fb429b4d01b74c9c865e186bd9e0fd253a56bc8))
* establish contract-driven Tools control plane ([#80](https://github.com/joeseverino/tools/issues/80)) ([6b0dcc3](https://github.com/joeseverino/tools/commit/6b0dcc338b69ceae8f475b3a24d7fd6e89c398f1))
* extract shared pdf-engine; fix brand-font drift in doc-to-pdf and diagram ([#72](https://github.com/joeseverino/tools/issues/72)) ([16e15ea](https://github.com/joeseverino/tools/commit/16e15eacc3277f673a51c4868ec9187dd74c50cd))
* gate-preview — a cordon change's fleet blast radius before merge ([#56](https://github.com/joeseverino/tools/issues/56)) ([62e6838](https://github.com/joeseverino/tools/commit/62e6838a50a64e230e8cf9bc1c73fb093c615719))
* guard the vendored cordon schema against drift ([abe6c8a](https://github.com/joeseverino/tools/commit/abe6c8ac2df91787060b8b58b8e959dc157beb33))
* hq dev and hq env-diff ([886e2c8](https://github.com/joeseverino/tools/commit/886e2c8d368946306b9f98516b8a3daf0cca0dd0))
* **hq:** env-diff/env-apply — prod env renders from 1Password via severino-hq-secrets.service ([#74](https://github.com/joeseverino/tools/issues/74)) ([c97ac76](https://github.com/joeseverino/tools/commit/c97ac76aae645df67c29aca03c4e625a830410e4))
* **hq:** make Tools a schema-driven HQ MCP client ([#77](https://github.com/joeseverino/tools/issues/77)) ([53dd516](https://github.com/joeseverino/tools/commit/53dd516f0e4f940c6bb92490b980c6d1cfd0bb42))
* mark intentional local repos in fleet status ([d724bfb](https://github.com/joeseverino/tools/commit/d724bfb183c64821436e2beca81c0abd3bf0d86f))
* mark intentional local repos in fleet status ([ae9ca2d](https://github.com/joeseverino/tools/commit/ae9ca2d63b51f61caa2d17c916be9af092f98eae))
* one fleet classification consumed by repos tui and brief (emit-once) ([8577cd7](https://github.com/joeseverino/tools/commit/8577cd7cef1f33563249c53e5e4d4b56b201938f))
* refine branded diagram theme (layered cards, anchor pivot, 3x) ([33a2007](https://github.com/joeseverino/tools/commit/33a2007e323ee4739896a8fbbe7c212400950ee2))
* **repo:** fleet entry as one verb — new bootstraps from cordon-starter, register backfills the vault + HQ registry ([#68](https://github.com/joeseverino/tools/issues/68)) ([c18eb5a](https://github.com/joeseverino/tools/commit/c18eb5afc1dac01a5b7105cba17111eda9fe8075))
* require explicit command effects ([aecb0ef](https://github.com/joeseverino/tools/commit/aecb0ef7ac8d1cf727acac7b9ef338ee8e690b70))
* runtime deploy gate + validate sibling describe contracts ([#7](https://github.com/joeseverino/tools/issues/7)) ([5ba0acb](https://github.com/joeseverino/tools/commit/5ba0acbc3fd4d5247ce5d2d507a8e8a720a8f0d7))
* **secrets:** shared 1Password-backed secrets layer for the drift guards ([#76](https://github.com/joeseverino/tools/issues/76)) ([556cffb](https://github.com/joeseverino/tools/commit/556cffb2f40a029ea108acdd6e0efcad4f15d338))
* ship-flow gate, fleet contracts, and shared drift/mcp seams ([#43](https://github.com/joeseverino/tools/issues/43)) ([2f88745](https://github.com/joeseverino/tools/commit/2f887454d6841126dc5bf32089a0360f3644661d))
* site CLI + describe cohesion (validate-writeup, reinstall-mcp --yes, federate obsidian contract) ([4469646](https://github.com/joeseverino/tools/commit/44696469c360f81c7c67d49ce05e97cd210f8329))
* site CLI + describe cohesion (validate-writeup, reinstall-mcp --yes, federate obsidian contract) ([3e70254](https://github.com/joeseverino/tools/commit/3e70254199bddbab75aaf727d4b7fdb409f5e18d))
* site CLI + describe cohesion (validate-writeup, reinstall-mcp --yes, federate obsidian contract) ([759d80b](https://github.com/joeseverino/tools/commit/759d80ba50864f92fa09802e71040785a2816f45))
* site CLI + describe cohesion (validate-writeup, reinstall-mcp --yes, federate obsidian contract) ([d441eed](https://github.com/joeseverino/tools/commit/d441eedb36e83c217896d69034468fbb975e307d))
* site manage TUI with bats + PTY test coverage ([4f1e7c9](https://github.com/joeseverino/tools/commit/4f1e7c991b3a51f3aa7007b27c43434820159cc4))
* **site:** add site dev --drafts for local draft preview, document in README ([06f3836](https://github.com/joeseverino/tools/commit/06f38364aaea58220b9bc48887b63cab8af8e65d))
* **site:** auto-commit on publish-all, add og command, document in README ([c4a89be](https://github.com/joeseverino/tools/commit/c4a89be6551b19f4de02eacd0834c063110f4669))
* **site:** name published/edited/removed slugs in publish-all commit ([beb6ff0](https://github.com/joeseverino/tools/commit/beb6ff03261978d2fbbaa1066c35f04813d47c56))
* **site:** PR-based publish flow + `site land` ([b33513c](https://github.com/joeseverino/tools/commit/b33513c8a17c3c10e51d897967112d6d86f8b93c))
* **site:** PR-based publish flow + `site land` ([3561e50](https://github.com/joeseverino/tools/commit/3561e509271f26ebb74b2635ebe9cf01a16b8475))
* standardize branded diagram rendering ([9578e68](https://github.com/joeseverino/tools/commit/9578e68a11d7d7261576ca5e416f43b389daf06e))
* streamline site delivery workflows ([#71](https://github.com/joeseverino/tools/issues/71)) ([c0fe6bd](https://github.com/joeseverino/tools/commit/c0fe6bd5e1bb670e53de3f9ca739a25a36c413f0))
* tools describe --tui + focused per-command help from one spec ([c1ad3ab](https://github.com/joeseverino/tools/commit/c1ad3ab855795edb23064b49e07904bfe8642b3e))
* **tools:** bump-engine + engine lock parity doctor check ([#54](https://github.com/joeseverino/tools/issues/54)) ([0b8413c](https://github.com/joeseverino/tools/commit/0b8413ccd9b4472a76899defaac78c039d61a2a1))
* unify branded document rendering ([a0cc13f](https://github.com/joeseverino/tools/commit/a0cc13f68c17681353817ad9f64aa66c12df9db4))
* **vault:** add 'vault daily' — populate the daily note's brief region ([#44](https://github.com/joeseverino/tools/issues/44)) ([801f18e](https://github.com/joeseverino/tools/commit/801f18e11568ac0285e82fe551984d90df4e58a9))
* **vault:** daily note lists the actual open work, not just counts ([#46](https://github.com/joeseverino/tools/issues/46)) ([6618304](https://github.com/joeseverino/tools/commit/6618304f35ed1489788c412127821a9ea30bfb0d))
* **vault:** daily note logs what you DID, not pending work ([#47](https://github.com/joeseverino/tools/issues/47)) ([300f61d](https://github.com/joeseverino/tools/commit/300f61dfe5ec67072f00cf39f40f8099c0113c5e))
* workspace loop — land verb, brief/repos cockpits, one PR-state owner ([5fbefff](https://github.com/joeseverino/tools/commit/5fbefff78b4d359658d161a9e8d306fd2c6c1761))
* workspace loop (land + brief/repos cockpits) + brand Cordon delegate ([71c91a9](https://github.com/joeseverino/tools/commit/71c91a96012613f56d2bf656fcffc705443fccc6))


### Bug Fixes

* -h/--describe must work without env (the contract); harden tests ([d388891](https://github.com/joeseverino/tools/commit/d38889184f5e0dca197f31b8c56bbd4dcf43837a))
* **common:** route die() to stderr; drop the per-call &gt;&2 workarounds ([#45](https://github.com/joeseverino/tools/issues/45)) ([8add6ce](https://github.com/joeseverino/tools/commit/8add6ce45012f85dd1b74ed80307352c3ecf7798))
* disable the catalog bats run — tools check --ci is the one bats gate ([#57](https://github.com/joeseverino/tools/issues/57)) ([86eee8a](https://github.com/joeseverino/tools/commit/86eee8a31e6f999ca650e1a1aa0fdde3399237cd))
* doc-to-pdf -h/--describe work without node_modules (lazy markdown-it) ([7a5507b](https://github.com/joeseverino/tools/commit/7a5507b8ca7a5dcb1c2b6123ed090f10f8ae4b45))
* **git:** a start-cut branch is current, not zombie — ship commits on it ([#58](https://github.com/joeseverino/tools/issues/58)) ([d70ba0c](https://github.com/joeseverino/tools/commit/d70ba0c0c9bf8833b4744f0efcf2c6f8e01b8448))
* guard sdk core seams, port seam rationale, bootstrap remember first write ([#70](https://github.com/joeseverino/tools/issues/70)) ([7ef09e4](https://github.com/joeseverino/tools/commit/7ef09e4509423b1704df5992e7ac60370d6277c9))
* **hq:** include 07 Backlog so cross-cutting tasks reach HQ ([#52](https://github.com/joeseverino/tools/issues/52)) ([9f9070f](https://github.com/joeseverino/tools/commit/9f9070f2c551a33abfbd4dc2cb2f216c626906fb))
* **land:** don't count failed merges as landed in the summary ([#75](https://github.com/joeseverino/tools/issues/75)) ([5e8895a](https://github.com/joeseverino/tools/commit/5e8895ac18fc8355fd6f6d681235b5496d1d0cef))
* **ship:** a skip is not a ship — honest tally, and push failures speak ([#60](https://github.com/joeseverino/tools/issues/60)) ([21e56f9](https://github.com/joeseverino/tools/commit/21e56f9ea345969f47cb2b076d1bd4d1f9d53134))
* white anchor text on htmlLabels:false (SVG text fill, not just color) ([690e24b](https://github.com/joeseverino/tools/commit/690e24b8543aaaea5a5cfb834bdaac8e322c8f14))
* white anchor text on htmlLabels:false diagrams ([524fbba](https://github.com/joeseverino/tools/commit/524fbba3efb82a70818a468231537484e2aa3af6))
* **workspace:** resync clears squash-merged current branch; exact-name scope; reaper ([#39](https://github.com/joeseverino/tools/issues/39)) ([fdc056c](https://github.com/joeseverino/tools/commit/fdc056c4155a2fc3f363feabbc970824825d24a5))


### Performance Improvements

* **repos:** one git_repo_snapshot call replaces 6 plumbing calls/repo ([#50](https://github.com/joeseverino/tools/issues/50)) ([01d89c5](https://github.com/joeseverino/tools/commit/01d89c539d60888df3c2636bf2f32bbf95761cbf))
* **repos:** parallel scan + scoped filter; in-TUI diff overlay; raw-mode fix ([#42](https://github.com/joeseverino/tools/issues/42)) ([3887f69](https://github.com/joeseverino/tools/commit/3887f69d6ec96da5f64aa339c27ae10f31c0a7a7))

## [1.5.0](https://github.com/joeseverino/tools/compare/v1.4.0...v1.5.0) (2026-08-11)


### Features

* establish contract-driven Tools control plane ([#80](https://github.com/joeseverino/tools/issues/80)) ([0e65f5c](https://github.com/joeseverino/tools/commit/0e65f5c21d0e570fcea29049654eb12573fe3046))

## [1.4.0](https://github.com/joeseverino/tools/compare/v1.3.1...v1.4.0) (2026-07-26)


### Features

* **cordon:** pin cordon-spec from npm — the schema check verifies everywhere ([#62](https://github.com/joeseverino/tools/issues/62)) ([2b78d36](https://github.com/joeseverino/tools/commit/2b78d36b384b62e802cfced257ca281fb8e8e8ba))
* establish a reusable tools SDK ([#69](https://github.com/joeseverino/tools/issues/69)) ([7d8de2e](https://github.com/joeseverino/tools/commit/7d8de2e78af9e252f297e4f34cdd1b0a12cb09cb))
* extract shared pdf-engine; fix brand-font drift in doc-to-pdf and diagram ([#72](https://github.com/joeseverino/tools/issues/72)) ([047a0fc](https://github.com/joeseverino/tools/commit/047a0fc024600271c84898490178c1428a8b0a16))
* gate-preview — a cordon change's fleet blast radius before merge ([#56](https://github.com/joeseverino/tools/issues/56)) ([208f90c](https://github.com/joeseverino/tools/commit/208f90c9c084f4a026816bc49afaa53baf926f4e))
* **hq:** env-diff/env-apply — prod env renders from 1Password via severino-hq-secrets.service ([#74](https://github.com/joeseverino/tools/issues/74)) ([1c32da2](https://github.com/joeseverino/tools/commit/1c32da23edaedc270d3c16bc628e9d14c0faf1b1))
* **hq:** make Tools a schema-driven HQ MCP client ([#77](https://github.com/joeseverino/tools/issues/77)) ([6236fcd](https://github.com/joeseverino/tools/commit/6236fcd37c2bd83c2c647a612b1645c3e98b199a))
* **repo:** fleet entry as one verb — new bootstraps from cordon-starter, register backfills the vault + HQ registry ([#68](https://github.com/joeseverino/tools/issues/68)) ([82e31e4](https://github.com/joeseverino/tools/commit/82e31e43bd4489f15b747d8a6ef2cfa025d885f7))
* **secrets:** shared 1Password-backed secrets layer for the drift guards ([#76](https://github.com/joeseverino/tools/issues/76)) ([7ad02c7](https://github.com/joeseverino/tools/commit/7ad02c7dcb63d916382f28b70219f9b934b5cb56))
* streamline site delivery workflows ([#71](https://github.com/joeseverino/tools/issues/71)) ([f1df118](https://github.com/joeseverino/tools/commit/f1df1183f803afdd313ea357262908d878c962c6))
* **tools:** bump-engine + engine lock parity doctor check ([#54](https://github.com/joeseverino/tools/issues/54)) ([7951e80](https://github.com/joeseverino/tools/commit/7951e80dc2d7e487e857a397ad8489de6b88e9dc))


### Bug Fixes

* disable the catalog bats run — tools check --ci is the one bats gate ([#57](https://github.com/joeseverino/tools/issues/57)) ([a1d84b8](https://github.com/joeseverino/tools/commit/a1d84b8111a10a2a8767c54886f25ba3469a0c10))
* **git:** a start-cut branch is current, not zombie — ship commits on it ([#58](https://github.com/joeseverino/tools/issues/58)) ([66b8346](https://github.com/joeseverino/tools/commit/66b83466fa4ba248b914b8ffc68c7238d8cb1e01))
* guard sdk core seams, port seam rationale, bootstrap remember first write ([#70](https://github.com/joeseverino/tools/issues/70)) ([3bd08c2](https://github.com/joeseverino/tools/commit/3bd08c29cb370bb5ed6938fd1b543e476246e335))
* **land:** don't count failed merges as landed in the summary ([#75](https://github.com/joeseverino/tools/issues/75)) ([12cb03a](https://github.com/joeseverino/tools/commit/12cb03a24d75aa12e08255298158145f3083cf2a))
* **ship:** a skip is not a ship — honest tally, and push failures speak ([#60](https://github.com/joeseverino/tools/issues/60)) ([cc184b8](https://github.com/joeseverino/tools/commit/cc184b896d97de7252747720817cce7539cafb23))

## [1.3.1](https://github.com/joeseverino/tools/compare/v1.3.0...v1.3.1) (2026-07-01)


### Bug Fixes

* **hq:** include 07 Backlog so cross-cutting tasks reach HQ ([#52](https://github.com/joeseverino/tools/issues/52)) ([5050ddf](https://github.com/joeseverino/tools/commit/5050ddf78cae36c5a4af914ac8f18ec891929d1a))


### Performance Improvements

* **repos:** one git_repo_snapshot call replaces 6 plumbing calls/repo ([#50](https://github.com/joeseverino/tools/issues/50)) ([fd9ce9b](https://github.com/joeseverino/tools/commit/fd9ce9be06b2232ed017192223b616fc5928e24b))

## [1.3.0](https://github.com/joeseverino/tools/compare/v1.2.0...v1.3.0) (2026-06-30)


### Features

* branch-safety engine — start verb, stale recovery, one branch-state ladder ([#37](https://github.com/joeseverino/tools/issues/37)) ([f5b1351](https://github.com/joeseverino/tools/commit/f5b13510394ffe2f91b25f1af2b891022f56d200))
* brief surfaces the backlog (open + stale debt) from the vault brief ([#40](https://github.com/joeseverino/tools/issues/40)) ([4bfe8ba](https://github.com/joeseverino/tools/commit/4bfe8ba09a17cacb860b1ad895d793699e2888f3))
* **drift:** json-cache data-store model via the MCP; retire legacy block path ([a09e307](https://github.com/joeseverino/tools/commit/a09e307b18408139f295eb9464840b230745197d))
* **drift:** json-file data-store model alongside legacy blocks ([516b7e9](https://github.com/joeseverino/tools/commit/516b7e9ea067317ff4ca9fab8b4a0004229eb44d))
* **drift:** migrate nginx, ts-acl, cf-dns to the json-file data store ([876d5c1](https://github.com/joeseverino/tools/commit/876d5c1164da3608e989408d7ccee4d9f5704488))
* ship-flow gate, fleet contracts, and shared drift/mcp seams ([#43](https://github.com/joeseverino/tools/issues/43)) ([cfd7137](https://github.com/joeseverino/tools/commit/cfd713749aa6c056861d5c95861d104f82e7e7fb))
* site CLI + describe cohesion (validate-writeup, reinstall-mcp --yes, federate obsidian contract) ([367f798](https://github.com/joeseverino/tools/commit/367f7983969709fc65f5e78d8b43b06369c369b8))
* site CLI + describe cohesion (validate-writeup, reinstall-mcp --yes, federate obsidian contract) ([e4a8339](https://github.com/joeseverino/tools/commit/e4a8339f887c83ed538b7d256db743ca9c3cea4b))
* site CLI + describe cohesion (validate-writeup, reinstall-mcp --yes, federate obsidian contract) ([899997f](https://github.com/joeseverino/tools/commit/899997f79a368b9062e91b35ac8af035604d0d7b))
* site CLI + describe cohesion (validate-writeup, reinstall-mcp --yes, federate obsidian contract) ([57e9d09](https://github.com/joeseverino/tools/commit/57e9d09d255fa98249ee69d090b10f6fa243df48))
* **vault:** add 'vault daily' — populate the daily note's brief region ([#44](https://github.com/joeseverino/tools/issues/44)) ([cf463b2](https://github.com/joeseverino/tools/commit/cf463b276d8ab809f46855d99e7fe2df9c7b7b6b))
* **vault:** daily note lists the actual open work, not just counts ([#46](https://github.com/joeseverino/tools/issues/46)) ([a178f52](https://github.com/joeseverino/tools/commit/a178f52451421f36f3a739673b2b7a8606171ac7))
* **vault:** daily note logs what you DID, not pending work ([#47](https://github.com/joeseverino/tools/issues/47)) ([0058077](https://github.com/joeseverino/tools/commit/00580772d0de1922cf92734c5bc296e7365c995f))
* workspace loop — land verb, brief/repos cockpits, one PR-state owner ([dc761ee](https://github.com/joeseverino/tools/commit/dc761ee6d40e6559929a6102553cba5de98a1fe9))
* workspace loop (land + brief/repos cockpits) + brand Cordon delegate ([276d5da](https://github.com/joeseverino/tools/commit/276d5da4b658bc5dd7625c590275ab12d0ea461d))


### Bug Fixes

* **common:** route die() to stderr; drop the per-call &gt;&2 workarounds ([#45](https://github.com/joeseverino/tools/issues/45)) ([0a6cd9d](https://github.com/joeseverino/tools/commit/0a6cd9d767438fbf45c42f67353b193cadc739d7))
* **workspace:** resync clears squash-merged current branch; exact-name scope; reaper ([#39](https://github.com/joeseverino/tools/issues/39)) ([c706dfc](https://github.com/joeseverino/tools/commit/c706dfc205d0c4c318ae47bd22c08b4eca155e63))


### Performance Improvements

* **repos:** parallel scan + scoped filter; in-TUI diff overlay; raw-mode fix ([#42](https://github.com/joeseverino/tools/issues/42)) ([2c3248b](https://github.com/joeseverino/tools/commit/2c3248b9fabed035bd95991a1f890156517cf03b))

## [1.2.0](https://github.com/joeseverino/tools/compare/v1.1.0...v1.2.0) (2026-06-20)


### Features

* add repos TUI workflow dashboard ([c5ba2bf](https://github.com/joeseverino/tools/commit/c5ba2bfeb48d6225b8b8c657106a2f619e4f559e))
* add repos TUI workflow dashboard ([5e7bbb1](https://github.com/joeseverino/tools/commit/5e7bbb1293bf2a567aa99c640ecc0d042d4c5e12))
* mark intentional local repos in fleet status ([1017102](https://github.com/joeseverino/tools/commit/1017102dfa0115aa93d225676679c167c5cb841e))
* mark intentional local repos in fleet status ([29615d6](https://github.com/joeseverino/tools/commit/29615d6661d2a95d9962c2c0aa7fd0e572501d82))
* one fleet classification consumed by repos tui and brief (emit-once) ([fb742ed](https://github.com/joeseverino/tools/commit/fb742ed47564305c96359245579a6e563e362dd9))

## [1.1.0](https://github.com/joeseverino/tools/compare/v1.0.0...v1.1.0) (2026-06-20)


### Features

* add document provenance to PDFs ([ec47dcb](https://github.com/joeseverino/tools/commit/ec47dcbe28d1c7be571cf8e74cc5a73bc57d6f05))
* add resync and ship CI/PR management (--check, --watch, PR sync) ([7353c81](https://github.com/joeseverino/tools/commit/7353c8103ea49e106c6c33d1a830973c3ba2f0a2))
* add resync and ship CI/PR management (--check, --watch, PR sync) ([d9b9e9f](https://github.com/joeseverino/tools/commit/d9b9e9f29f84b963c5377ce4c3f85c689cae95e1))
* apply brand tokens to Mermaid ([266efdc](https://github.com/joeseverino/tools/commit/266efdc68a74da5a702a6b6b48c0cbda268fda09))
* brand doc-to-pdf artifacts ([98134c0](https://github.com/joeseverino/tools/commit/98134c075bcdda06c7eba15eb16fb75b95172448))
* **brand:** add `brand figure` for designed graphics ([277b453](https://github.com/joeseverino/tools/commit/277b4532763e7f0577c64c45d7faf548ba41ef23))
* command-surface SOT — one spec, one intercept, derived everywhere ([be3dc26](https://github.com/joeseverino/tools/commit/be3dc26e2f0f4b9061f2b2a884bf99074a758770))
* describe v3 — per-command effect (blast radius) + scoped command lookup ([d6cda71](https://github.com/joeseverino/tools/commit/d6cda71e711975d6bb601fa056b8a21b34956fc8))
* doc-to-pdf GitHub links + brand figure graphics ([7e2adb3](https://github.com/joeseverino/tools/commit/7e2adb3e736eab4ed229d402ce55d8b4ce30fa2e))
* **doc-to-pdf:** rewrite relative links to absolute GitHub URLs ([f53cd43](https://github.com/joeseverino/tools/commit/f53cd43cc8c4ee4895ed4dbfa40ceaee4461dc96))
* doctor --all, section-scoped mirror writer, sync-state, cache fixes ([b6197dd](https://github.com/joeseverino/tools/commit/b6197dd350e324b6d60418a0bc7049e139ba79cb))
* emit-once command-surface contract (tools describe) ([d553562](https://github.com/joeseverino/tools/commit/d553562e7a970d7afe58ec9c6e9fdfc98fba4d65))
* guard the vendored cordon schema against drift ([14c999f](https://github.com/joeseverino/tools/commit/14c999fefdf82efef204d4de39b664fffeaf5dbf))
* refine branded diagram theme (layered cards, anchor pivot, 3x) ([bdd1d5c](https://github.com/joeseverino/tools/commit/bdd1d5cc4cd6af8a659ebba7f45f30dd77d21a48))
* require explicit command effects ([a507aab](https://github.com/joeseverino/tools/commit/a507aabe2a2824e5d4bf6ca12970bbca1c657156))
* runtime deploy gate + validate sibling describe contracts ([#7](https://github.com/joeseverino/tools/issues/7)) ([81224cf](https://github.com/joeseverino/tools/commit/81224cf4960f66a10abcb2e0a9fdd059df69d87a))
* site manage TUI with bats + PTY test coverage ([901d77f](https://github.com/joeseverino/tools/commit/901d77f169d448810aca4f0797744d3f7b741371))
* **site:** add site dev --drafts for local draft preview, document in README ([0df0b13](https://github.com/joeseverino/tools/commit/0df0b130866d62bb48b1fb43f88b576fe17f40d5))
* **site:** auto-commit on publish-all, add og command, document in README ([4a56618](https://github.com/joeseverino/tools/commit/4a566188d7dc479978e1f3e52b510970fa258e85))
* **site:** name published/edited/removed slugs in publish-all commit ([c37c1d7](https://github.com/joeseverino/tools/commit/c37c1d72cabb7bd2ec799c3cd3715c895128a0de))
* **site:** PR-based publish flow + `site land` ([3116bd5](https://github.com/joeseverino/tools/commit/3116bd5b112d299711fcb760712ecbd45ea2166c))
* **site:** PR-based publish flow + `site land` ([12c2a1e](https://github.com/joeseverino/tools/commit/12c2a1e77b8a11c9f78664fa2018aef7799691a3))
* standardize branded diagram rendering ([8db9444](https://github.com/joeseverino/tools/commit/8db9444e1555fa04c8d512d58c85c7cd6f509260))
* tools describe --tui + focused per-command help from one spec ([763179b](https://github.com/joeseverino/tools/commit/763179b0d7ad120232c38ae143df437c737102d1))
* unify branded document rendering ([cb6daf8](https://github.com/joeseverino/tools/commit/cb6daf83da54ee400b257f4794485bc7bc5ddf1c))


### Bug Fixes

* -h/--describe must work without env (the contract); harden tests ([5eb303e](https://github.com/joeseverino/tools/commit/5eb303e411e79056868d7b40656a445ccc9a78dc))
* doc-to-pdf -h/--describe work without node_modules (lazy markdown-it) ([e821af1](https://github.com/joeseverino/tools/commit/e821af133f9a85536b0fe25790b4591d755a345a))
* white anchor text on htmlLabels:false (SVG text fill, not just color) ([73defcf](https://github.com/joeseverino/tools/commit/73defcf9a9d312b3acd3e136a60e242fded2a9fe))
* white anchor text on htmlLabels:false diagrams ([18179bf](https://github.com/joeseverino/tools/commit/18179bf6bfe5f2dfda6347d108cee64f751a6b7f))
