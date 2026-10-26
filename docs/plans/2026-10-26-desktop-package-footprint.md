---
feature_ids: []
topics: [desktop, packaging, offline, performance]
doc_kind: design-proposal
created: 2026-10-26
status: active
---

# Desktop package footprint and bounded release optimization

This candidate implements the contribution scope invited in [#1703](https://github.com/zts212653/clowder-ai/issues/1703#issuecomment-6344242927): retain Next and existing capabilities, increase runtime archive compression, remove audited foreign node-pty prebuilds for Windows x64, and omit two compiler caches. It is independent of the intranet/ACP changes in #1702. Merge, release, static frontend migration, and resource removal remain separate decisions.

## Why the package is large

The earlier Windows 1.14.0 intranet sample at `7615c9eca5fe01be158060fc4d771c5f77c227b0` was 680.81 MB. Its six precompressed runtime archives accounted for 615.35 MB, or 90.38% of the EXE. These archives bypass Inno compression, so the existing gzip level 1 directly affects most download bytes. This historical sample is a mechanism reference, not a measurement of the current public candidate.

| Historical content | File bytes, MB | Ownership and reduction limits |
|---|---:|---|
| Shared dependency tree | 805.28 | Contains the heavy application runtimes; package-level dependency selection already exists |
| Electron payload | 302.80 | Provides Chromium and the desktop host; changing its distribution is separate from page loading |
| Claude SDK Windows native runtime | 243.75 | Part of the shared tree; SDK execution consumes it, so removal changes capability unless a compatible offline carrier is supplied |
| Next and Windows SWC | 222.53 | Part of the shared tree; removal requires verified production tracing or a separately accepted frontend migration |
| Web public resources | 175.99 | Includes ONNX/WASM, images, esbuild, VAD and other offline resources; changing bundlers does not remove their consumers |
| Source maps across archives | 145.64 | Cross-cutting category; cannot add this row to package totals or equate raw bytes with compressed download savings |

All MB are decimal logical file bytes. Nested and cross-cutting rows overlap. The current public build will receive an archive/package/file census and independent compressed-size probes before further reduction is proposed. Download bytes, logical installed bytes, allocated disk space and temporary install space are different measurements.

## Implemented scope

- Keep tar.gz and its integrity/extraction path; use gzip level 9 for the existing Node-generated archives. Keep the separate Node archive producer unchanged.
- For target `win32-x64`, omit only audited foreign platform directories owned by the real node-pty package, including shared/private dependency trees. Retain target binaries, PDB/maps, unknown packages/platforms and all other targets. Preserve external-link rejection before filtering.
- In addition to the existing webpack cache rule, omit only `.next/cache/.tsbuildinfo` and `.next/cache/eslint`. Keep fetch-cache and all production/static/PWA inputs.

No SDK/native capability, image, ONNX variant, runtime source or debugging file is removed by this candidate. Future debug-artifact separation must retain offline diagnosis; image changes need resource/hash and visual validation; ONNX changes need actual backend/browser/fallback evidence. Optional capability bundles change distribution and require a separate decision, even when the executable is large.

## Reproduction and acceptance

The contribution is ported from local candidate `550ad037b18667f3c6e20f32a1c4069dd62f850f`, preserving the original implementation. The public base is `fa1dc90fa9704691121cd90a2aa6be6422c954eb`. Its six modified existing files have the same Git blobs as the earlier candidate's parent; this does not substitute for current dependencies, builds or installation verification.

```sh
node --test --test-concurrency=1 desktop/built-web-assets.test.mjs desktop/frozen-runtime-export.test.mjs desktop/runtime-archive-progress.test.mjs desktop/extract-runtime-archive.test.cjs desktop/verify-runtime-archives.test.mjs desktop/runtime-dependency-selection.test.mjs desktop/workspace-runtime-modules.test.mjs desktop/api-startup-read-ahead.test.mjs desktop/runtime-package-bundle.test.mjs desktop/api-bundle.test.mjs desktop/api-dependency-bundle.test.mjs
pnpm exec biome check desktop/scripts/create-runtime-archive.mjs desktop/scripts/stage-built-web.mjs desktop/scripts/frozen-runtime-export.mjs desktop/scripts/native-runtime-assets.mjs desktop/built-web-assets.test.mjs desktop/frozen-runtime-export.test.mjs desktop/runtime-archive-progress.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File desktop/scripts/build-desktop.ps1 -SkipPortableZip
```

The initial public worktree reproduced behavioral RED before implementation, then passed 58 related tests with zero failures/skips. Biome reports zero errors and existing warnings/info. These are source checks, not installation evidence. Real archive/native/resource probes and same-input baseline/candidate packaging must bind exact source and final hashes; retain raw logs and a per-file allowlist of differences.

Cold offline install, supported upgrade and failure recovery require a separate VM/test machine and real installer execution. Existing user installations/data must not be used as test targets. A Draft PR may expose missing evidence before installation acceptance. Reuse relevant prior model evidence rather than repeating unchanged paid-model journeys. #1606 remains open; package size or HTTP ready alone does not establish startup-performance improvement.
