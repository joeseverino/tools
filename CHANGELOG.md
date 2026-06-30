# Changelog

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
