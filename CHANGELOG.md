# Changelog

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
