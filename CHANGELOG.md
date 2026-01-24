# Changelog

All notable changes to this project will be documented in this file.

## [0.5.0](https://github.com/JackUait/blok/compare/v0.4.1-beta.5...v0.5.0) (2026-01-23)

### ✨ Features

- implement Conflict-Free Replicated Data Type (CRDT) undo/redo ([#33](https://github.com/JackUait/blok/pull/33)) ([98477264](https://github.com/JackUait/blok/commit/984772642af711dcbe23d06f14ed77c003012ecc))

### 🐛 Bug Fixes

- toolbar hover behavior after cross-block selection ([#35](https://github.com/JackUait/blok/pull/35)) ([122a50fc](https://github.com/JackUait/blok/commit/122a50fcdabee2e7003c8f464701ecc35e4fc9af))
- trigger PatternPasteEvent for internal cut/paste operations ([d98fd369](https://github.com/JackUait/blok/commit/d98fd36951cd5824d728ddb006572d071f6e8650))

## [0.4.1-beta.5](https://github.com/JackUait/blok/compare/v0.4.1-beta.4...v0.4.1-beta.5) (2025-12-07)

### 🐛 Bug Fixes

- external plugins may break because of Tailwind ([ee68032](https://github.com/JackUait/blok/commit/ee68032720482dbfba6cf9d3cf3602a6df755226))

### ✨ Features

- add data-blok-header-level to headers in the popover ([d27a758](https://github.com/JackUait/blok/commit/d27a7587803342279a10cbd7fdd317c984119fcd))

## [0.4.1-beta.4](https://github.com/JackUait/blok/compare/v0.4.1-beta.3...v0.4.1-beta.4) (2025-12-07)

### ♻️ Refactoring

- rollback React migration ([#16](https://github.com/JackUait/blok/pull/16)) ([558e620](https://github.com/JackUait/blok/commit/558e6201e1bd2fff6c333827be5cf149551fed3b))

## [0.4.1-beta.3](https://github.com/JackUait/blok/compare/v0.4.1-beta.2...v0.4.1-beta.3) (2025-12-06)

### ✨ Features

- implement undo/redo ([#15](https://github.com/JackUait/blok/pull/15)) ([207a4c1](https://github.com/JackUait/blok/commit/207a4c1fd3d5b65fb97c07e41b0e8933c60ee9ce))

## [0.4.1-beta.2](https://github.com/JackUait/blok/compare/v0.4.1-beta.1...v0.4.1-beta.2) (2025-12-05)

### ♻️ Refactoring

- migrate internals to React ([#14](https://github.com/JackUait/blok/pull/14)) ([ea36157](https://github.com/JackUait/blok/commit/ea3615702597d971171e377e938ee549185b220c))

## [0.4.1-beta.0](https://github.com/JackUait/blok/compare/v0.3.1-beta.0...v0.4.1-beta.0) (2025-12-16)

### ✨ Features

- **i18n** Hebrew, Persian, Urdu, Yiddish, Pashto, Sindhi, Uyghur, Kurdish and Dhivehi ([28191fd](https://github.com/JackUait/blok/commit/28191fd786d9e3ea2fffa4bd32cf99018b60e0cd))
- **i18n** add translations for Czech, Romanian and Hungarian ([8be8c17](https://github.com/JackUait/blok/commit/8be8c177a174606fb6821f7877180fe2439b13b0))
- **i18n** add translations for Thai, Ukrainian and Greek ([24584fe](https://github.com/JackUait/blok/commit/24584feae996f743824686c76cd8dcf376eadbbe))
- **i18n** add translations for Hindi, Bengali, Indonesian and Vietnamese ([e696674](https://github.com/JackUait/blok/commit/e6966745b799ca3d0d71b4c6e2594b0f983a226c))
- **i18n** add translations for Turkish and Azerbaijani ([ce381f6](https://github.com/JackUait/blok/commit/ce381f615c74b989b86866a3f4a21d56b241bb1f))
- **i18n** add translations for Arabic ([c2bd2c4](https://github.com/JackUait/blok/commit/c2bd2c4b358dfc8d21b5b2085341a8a1e7d90e94))
- **i18n** add translations for Dutch, Polish and Swedish ([5a7898e](https://github.com/JackUait/blok/commit/5a7898eec0ff19bc37176e0267611a0ae0cf82ec))
- **i18n** add translations for Korean ([fb0f0d5](https://github.com/JackUait/blok/commit/fb0f0d5b542437e2d21ebe95f866ddad57858f60))
- **i18n** add translations for Japanese ([f71fa79](https://github.com/JackUait/blok/commit/f71fa79eb85e260acae624c89f4faa389be92b86))
- **i18n** add translations for Italian ([f74790e](https://github.com/JackUait/blok/commit/f74790e4d40ab04f591084e7b39116e2e73ad92a))
- **i18n** add translations for Portuguese ([94f5bde](https://github.com/JackUait/blok/commit/94f5bde875875ec416c34a7e5915118cb1208baf))
- **i18n** add translations for German ([1f48c73](https://github.com/JackUait/blok/commit/1f48c73f7482e72e551347cb2220d89825829693))
- **i18n** add translations for French ([8d954f5](https://github.com/JackUait/blok/commit/8d954f51ebd2c298f4f8914efca65480e0833290))
- **i18n** add translation for Spanish ([f06f55b](https://github.com/JackUait/blok/commit/f06f55b2f247d2067525a09b696b55efcdb18a29))
- **i18n** add support for Armenian ([a891b61](https://github.com/JackUait/blok/commit/a891b6124657ad645d900e6048e52b8a5ea9fd42))
- **i18n** add support for Chinese (Mandarin) ([173f44b](https://github.com/JackUait/blok/commit/173f44bb06feba5db15f139a0b8e3600ecff481a))
- **i18n** add translation to Russian ([fc19d28](https://github.com/JackUait/blok/commit/fc19d288fc4f70b90319f809700eca3a27c21bfc))
- rename checklist into to-do list ([931e53c](https://github.com/JackUait/blok/commit/931e53c0f7273f397a22c03ef2f4da4b83bf80c1))
- improve drag&drop ([#26](https://github.com/JackUait/blok/pull/26)) ([b5e48e1](https://github.com/JackUait/blok/commit/b5e48e199cb848df040b8f27f62091b3fe9edea6))
- **lists** move lists to the flat data model ([#25](https://github.com/JackUait/blok/pull/25)) ([4a259b4](https://github.com/JackUait/blok/commit/4a259b46e0f958a7975b5e2b43a97b5f752660e2))
- move to the flat data model ([#24](https://github.com/JackUait/blok/pull/24)) ([931e678](https://github.com/JackUait/blok/commit/931e678bde948b453a784e788641d80298633826))
- improve keyboard navigation ([#22](https://github.com/JackUait/blok/pull/22)) ([a01e2ba](https://github.com/JackUait/blok/commit/a01e2ba1b2aab46ec42b69e1ebc465e588569626))
- add tools for creating numbered lists, ordered lists and checklists ([#21](https://github.com/JackUait/blok/pull/21)) ([6625fe5](https://github.com/JackUait/blok/commit/6625fe536086e8e0249d7b151c6d65c08d55c64a))
- **paragraph tool** add custom configuration ([#20](https://github.com/JackUait/blok/pull/20)) ([30b3a05](https://github.com/JackUait/blok/commit/30b3a056dc73eb921f1dc3ad583bbef0f0c82878))
- **header tool** add custom configuration ([#19](https://github.com/JackUait/blok/pull/19)) ([74a8f72](https://github.com/JackUait/blok/commit/74a8f72b2b21bd8f0b27ecf56c90c9c206771837))
- implement the navigation mode ([#18](https://github.com/JackUait/blok/pull/18)) ([0c7dd77](https://github.com/JackUait/blok/commit/0c7dd772343f4ec7ac22df4e62a9bc068d5bda2c))
- various improvements ([#17](https://github.com/JackUait/blok/pull/17)) ([8a37c4d](https://github.com/JackUait/blok/commit/8a37c4dd7a2ddd418e640e2bd4777e6282b3be13))

### 🐛 Bug Fixes

- update translation keys to be camelCase ([f8858ea](https://github.com/JackUait/blok/commit/f8858eaea9dfbf370891f65f63947327a5d8fc4e))
- parsing translation keys ([ed114f8](https://github.com/JackUait/blok/commit/ed114f817bf9609c8fe0fa312ba80154ad758118))
- **i18n** remove redunant translation keys ([142252c](https://github.com/JackUait/blok/commit/142252c0512fd4209c2e641ebe1217902191f5cb))
- **i18n** add a missing word in the Russian translation ([4c7eb8b](https://github.com/JackUait/blok/commit/4c7eb8b1e43c3dfd20062aa78e2d61c91eb41e0f))
- make the fake selection display correctly ([#23](https://github.com/JackUait/blok/pull/23)) ([b303aea](https://github.com/JackUait/blok/commit/b303aea0727faaddc9d3c28a8bb145f0889bed73))
- close the inline toolbar on a click outside when the convert to menu is open ([0117d14](https://github.com/JackUait/blok/commit/0117d1455652a67594f9acaf91ff94223a69d265))
- keep the toolbar always centered ([888bb1f](https://github.com/JackUait/blok/commit/888bb1f378dc90e5aecb817439dc82120d029f77))

## [0.4.1](https://github.com/JackUait/blok/compare/v0.3.1-beta.0...v0.4.1) (2025-12-16)

> This is the same as 0.4.1-beta.0 but tagged as a stable release.

## [0.3.1-beta.0](https://github.com/JackUait/blok/compare/v0.3.0...v0.3.1-beta.0) (2025-12-03)

### 🧹 Chores

- **codemod** improve migration ([#13](https://github.com/JackUait/blok/pull/13)) ([3514c5b](https://github.com/JackUait/blok/commit/3514c5b34072bdc2788bd934822e1ba9de85f7d4))

## [0.3.0](https://github.com/JackUait/blok/compare/v0.2.0...v0.3.0) (2025-12-02)

### ✨ Features

- bundle tools paragraph and header ([fbf30d5](https://github.com/JackUait/blok/commit/fbf30d57403d3a3c8c0fea7f8d808327d0fcec91))

## [0.2.0](https://github.com/JackUait/blok/compare/v0.1.5...v0.2.0) (2025-12-02)

### ✨ Features

- add drag & drop functionality ([e37fe12](https://github.com/JackUait/blok/commit/e37fe12fbd45ec41cd7b5023cc00f05d84b52c35))

### 🐛 Bug Fixes

- remove console.log statements and performance issue ([e1bd5a17](https://github.com/JackUait/blok/commit/e1bd5a17e13a95ed880ca8f51d581e0b0cfe5d70))

### 🎨 Styling

- rebrand from Editor.js to Blok ([#6](https://github.com/JackUait/blok/pull/6)) ([28a253dc](https://github.com/JackUait/blok/commit/28a253dc6524f74e8855688efcf3c93d9d3d0587))

## [0.1.5](https://github.com/JackUait/blok/compare/v0.1.4...v0.1.5) (2025-11-24)

### 🐛 Bug Fixes

- eslint config ([9f3accba](https://github.com/JackUait/blok/commit/9f3accba9b18a4ff1983a75a423e632b33b8d4ec))

## [0.1.0](https://github.com/JackUait/blok/releases/tag/v0.1.0) (2025-11-24)

### 🎉 Initial Release

- Fork of Editor.js, renamed to Blok
- Initial feature set from Editor.js codebase
