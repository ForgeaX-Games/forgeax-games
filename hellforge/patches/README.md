# Hellforge SDK patches

## SDK 0.2.1 HF-021-P1/P2/P3 local candidate patches

The active isolated `hellforge-sdk-0.2.1-plugins` candidate keeps the exact
`@forgeax/engine@0.2.1` pin and applies three package-scoped local patches:

- `@forgeax/engine-devkit@0.2.1.patch` passes the DevKit's already-created
  `CatalogSource` into production non-worker `createApp` options. Its CLI and
  package entrypoint HTML generators also put fatal markup directly under
  `body` with fixed viewport positioning; the loading overlay remains in the
  isolated app shell. Development continues to use its runtime binding; the
  Worker branch is unchanged.
- `@forgeax/engine-app@0.2.1.patch` initializes an otherwise-unconfigured
  Registry's `packIndexUrl` from `catalogSource.url`, falling back to the
  declared `/pack-index.json` only when the source has no URL. A caller's
  existing Registry URL and the runtime-binding path remain authoritative.
- `@forgeax/engine-render@0.2.1.patch` excludes explicit GPU scene-index modes
  from both direct-draw runtime selectors, encodes opaque GPU batches before
  CPU geometry and restores the direct view bind group plus dynamic offsets,
  and preserves same-frame shadow observations across coverage-only passes
  without shadow views. It changes exactly two shipped `dist/*.mjs` files and
  their matching three published `src/*.ts` files. `.map` source maps are not
  regenerated.

These patches are deliberately recorded as **SDK 0.2.1 + local patches**. They
are a checkout-local compatibility correction, not an upstream fix, an
unmodified 0.2.1 distribution, or a new release. The published DevKit package
contains `dist`, README, and LICENSE only; the DevKit patch therefore touches
the actually shipped `dist/cli.mjs` rather than an absent authoritative source
tree. P1/P2/P3 evidence records patch SHA-256 values, patched lock fingerprint,
browser network paths, and negative controls. The 0.1.38 entries below remain
historical and are not referenced by the 0.2.1 candidate's `patchedDependencies`.

See the distinct [P1 catalog evidence](../docs/sdk-migration/2026-09-24-hf-021-p1-static-catalog-evidence.md),
[P2 Render evidence](../docs/sdk-migration/2026-09-24-hf-021-p2-render-evidence.md),
and [P3 DevKit fatal-overlay evidence](../docs/sdk-migration/2026-09-24-hf-021-p3-devkit-fatal-overlay-evidence.md).

> The 0.1.38 patches and instructions below are retained as migration history. The isolated
> SDK 0.2.1 candidate does not apply those old patches; its current
> `pnpm-workspace.yaml` references only the three new 0.2.1 patches above.

## SDK upgrade and local-patch retirement gate

For every SDK upgrade, audit each package independently. Check whether App uses
`CatalogSource.url` before falling back to `/pack-index.json`; DevKit passes its
existing `CatalogSource` to production non-worker `createApp` and puts fatal
markup in the body viewport in both published HTML generators; and Render
keeps the three contracts listed above. Retire each package's patch as soon as
that package's own upstream seams are fixed, even if another package still
needs a local patch. Recreate patches only for exact versions whose seams
remain unfixed, and record each package integrity and patch SHA-256. Do not
carry other packages' patches forward because one patch remains necessary.

For the resulting package mix, run frozen install, project/build/asset checks,
and the relevant contracts for each retained patch:
`src/sdk-021-asset-catalog-patch.test.ts`,
`scripts/lib/sdk-devkit-fatal-overlay.test.ts`, and
`scripts/lib/sdk-runtime-variant.test.ts`. Recheck the production static
`/games/hellforge/` flow: child catalog request is 200, app traffic to root
`/pack-index.json` is zero, an explicit root request is a 404 negative control,
and the camp accepts real input. Trigger a no-WebGPU startup failure and check
that fatal diagnostics remain visible and Reload works with pointer and
keyboard input. An npm version change alone proves none of these behaviors.

In the 0.1.38 candidate, these patches were authorized on 2026-09-22 and
applied through that candidate's `pnpm-workspace.yaml` / lockfile. They did not
modify the Engine checkout, Studio pin, or original Hellforge copy. They were
**0.1.38 + local patches**, not an upstream fix or a new SDK release.

For the current 0.2.1 candidate, the Render patch SHA-256 is
`42334c51cd05318b0e4360cc355e5cecd4967469c03bd8011e2d3b30437711d5`; its
`pnpm-lock.yaml` patchedDependencies hash must match. The Render contract test
changed from 3 pass / 8 fail to 11 pass / 0 fail. Four DevKit fatal-overlay
tests remained failing at the P2 checkpoint and were outside that Render patch;
the separate P3 DevKit patch resolves them. See
[`HF-021-P2 Render evidence`](../docs/sdk-migration/2026-09-24-hf-021-p2-render-evidence.md)
for the exact pin, static smoke, same-build negative control and recovery point.

The separate P3 DevKit patch SHA-256 is
`7bd86242a587df931e2a9f86a5a5f2d605a892bcb4a8f415d2ea2c3ec4955644`; the
combined `pnpm-lock.yaml` SHA-256 is
`4b1ca12346a027dc3e0e98c0f5920eaebb0be99ad0d183363701567271465ab3`. Its four
fatal-overlay contracts pass, and the full local P1/P2/P3 candidate suite is
1173 pass / 0 fail. This remains a local patched candidate. For the separate
P3 evidence, see
[`HF-021-P3 DevKit fatal-overlay evidence`](../docs/sdk-migration/2026-09-24-hf-021-p3-devkit-fatal-overlay-evidence.md).

## Historical SDK 0.1.38 patch details

### DevKit startup barrier and fatal surface

`@forgeax/engine-devkit@0.1.38.patch` changes both distributed entrypoints
(`dist/cli.mjs` and `dist/index.mjs`). The generated execution bootstrap installs
an ACTIVE child `gameHostPlugin(host)` before awaiting dependent game plugins.
Directly providing `gameHost` from the still-loading parent allows Loader.await
to return while the game remains PENDING. This can start rendering before the
game camera and detach initialization failures from startup error handling.

The fix uses the public provider API, retains parent-owned cleanup, and does
not touch the separate frontend host branch. `node scripts/audit-sdk-startup.mjs`
after build runs delayed-success and failure cases against the actual generated
host and real Context/CatalogLoader, including unpatched negative controls.

Hellforge separately injects the public main-realm `renderer` service because
the portable execution GameHost intentionally omits a direct Renderer.

The generated HTML also places `#forgeax-fatal` directly under `body` with
`position: fixed`. Inside the isolated `#app-shell`, even its maximum z-index
could not cover Hellforge's body-level intro overlay: a failed renderer left
the error and Reload button invisible. Loading/canvas/game-ui keep their
original shell ownership; backend selection and successful startup are unchanged.
`sdk-devkit-fatal-overlay.test.ts` executes both installed HTML generators,
with startup enabled and disabled, and parses the actual parent hierarchy plus
an old-parent negative control. Browser failure/reload checks remain required.

The historical `@forgeax/engine-render@0.1.33.patch` is retained for audit
history. This 0.1.38 patch replaces it; do not apply both patches.

### Changes

1. The direct runtime shader prewarm selector excludes both GPU scene-index
   modes. Direct draws bind per-material uniforms and must not select an
   indirect scene-index variant by first-match order.
2. Opaque GPU batches are recorded before the sorted CPU geometry remainder,
   which can contain alpha-blended custom geometry. The direct view bind group
   and its dynamic offsets are restored after indirect encoding.
3. Coverage/temporal scene passes preserve the directional and spot shadow
   views observed by the earlier scene-color pass. Per-frame initialization
   still clears both observations; no stale atlas is retained across frames.

The GPU color material-slot issue from 0.1.33 is already absorbed by 0.1.38's
GPU scene allocation plus visible-stream material index. No old color projection
patch is copied into this release.

### Reproduce / verify

```sh
pnpm install --frozen-lockfile
bun test scripts/lib/sdk-runtime-variant.test.ts
bun test scripts/lib/sdk-devkit-fatal-overlay.test.ts
pnpm build
node scripts/audit-sdk-startup.mjs
node scripts/audit-sdk-skin-variants.mjs
node scripts/audit-sdk-fx-temporal.mjs
```

The regression probe reads the actually installed compiled renderer modules and
locates unique function/contract markers; it does not copy SDK predicates. Its
source/contract checks are not pixel acceptance. Browser/WebGPU checks remain a
separate validation gate.

The historical 0.1.38 package ships compiled modules. Its patch edits compiled
modules only; source maps are not regenerated. The same limitation applies to
the 0.2.1 Render patch: matching `src` and `dist` modules are patched, but `.map`
files are untouched, so mapped stack locations may still point at pre-patch
source lines.

For rollback, remove this project's `@forgeax/engine-render@0.1.38` patched
dependency entry and regenerate its lock/install with pnpm. The historical
0.1.33 patch is not part of the 0.1.38 install.
