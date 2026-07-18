# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`js-lingo` is a small, type-safe i18n facade for vanilla JS, web components, and React. Zero-config components ship default texts; translations are attached separately; apps wire it all together. See `README.md` for the full public API tour and `src/core.ts`'s file-level docblock for the internal architecture rationale — both are more detailed than what's summarized below.

## Commands

- `npm run build` — production build via Vite (three entry points, see Architecture below)
- `npm test` — run the full test suite once (Vitest)
- `npm run test:watch` — Vitest in watch mode
- `npm run coverage` — run tests with v8 coverage (thresholds: 95% statements/functions/lines, 90% branches — enforced in `vitest.config.ts`)
- Single test file: `npx vitest run src/core.test.ts`
- Single test by name: `npx vitest run -t "test name substring"`
- `npm run build:release` — build, then zip the exact git-tracked source tree into `dist/source/` (via `scripts/pack-source.mts`)
- `npm run loc` / `npm run loc:src` — line counts (`sloc`)

No lint script is configured; formatting is Prettier (`.prettierrc`: `printWidth: 100`) and `.editorconfig` (2-space indent, LF, trim trailing whitespace).

## Architecture

The core lives entirely in `src/core.ts` (~900 lines, single file by design) and is built from three swappable strategies plus a fixed core:

- **`localeSource`** — which locale is active, and when it changes.
- **`textSource`** — resolves `(locale, namespace, key, params) -> string | undefined`, and signals when available texts change (e.g. an async bundle finishes loading). `undefined` means a genuine miss — adapters must do real miss detection, not a truthiness check, since `""` is a valid translation.
- **`middlewares`** — decorate the *whole* resolution pipeline (see namespace defaults and nested lookups too), e.g. pseudo-localization or miss reporting.
- **Intl formatting** (`formatNumber`, `formatDateTime`, `formatRelativeTime`, `formatList`, and range/raw-formatter variants) is the one deliberately non-configurable part — a fixed, cached-and-shared `Intl` core.

Resolution order: `middlewares -> textSource -> namespace defaults -> bare key`. A string is always returned; `undefined` never escapes to a caller.

Three strictly separated ecosystem roles (see README "Who does what"):
1. **Component author** — defines a `Namespace` via `createNamespace({ key, defaults })`. Defaults define both the TypeScript shape (keys + per-key param types) and the texts of last resort.
2. **Translation author** — produces a `TextBundle` via `bundleTexts(...)`, using `someTexts` (partial, falls through the pipeline) or `allTexts` (complete, checked at compile time *and* runtime).
3. **App author** — wires bundles into a `textSource` (typically `defaultTextSource`), picks a `localeSource`, and calls `createI18n(config?)`. No library-owned global state — instances are created explicitly and distributed by the app (argument passing, React context, or the DOM Context Community Protocol for custom elements).

Package entry points (each independently built and externalized where noted — see `vite.config.ts`):
- `.` → `src/index.ts` → re-exports `src/core.ts` (the dependency-free core; vanilla JS/TS)
- `./message-format` → `src/message-format/index.ts` → `src/message-format/msg.ts` — an ICU MessageFormat `msg` tagged-template helper built on `intl-messageformat`, producing a `TranslationFn` (per-locale formatter instances are cached)
- `./web-components` → `src/web-components/index.ts` — `i18nController` (Lit reactive controller) and `i18nProvider`/`provideI18n`, distributing an instance via the DOM Context Community Protocol; must degrade gracefully with no DOM (see the `.node.test.ts` below)
- `./react` → `src/react/index.ts` → `src/react/context.ts` — `I18nProvider` + `useI18n` (+ `useI18nSuspense`). The provider feeds both React context and the DOM context protocol (for web components rendered inside a React subtree), from one `display: contents` wrapper. `useI18n` is built on `useSyncExternalStore`, minting a fresh statically-bound sibling instance per change since the dynamic instance is reference-stable. Written as JSX-free `.ts` (`createElement as h`) since it's the library's only file that would otherwise need `.tsx`.

The core is bundled as a shared chunk across all three entries (one instance, no duplication); React is kept external (optional peer, owned by the host app).

### Test environments

Vitest defaults to the `node` environment; individual files opt into `jsdom` via a `// @vitest-environment jsdom` docblock comment (not global config), because some behavior must be verified in both:
- `*.dom.test.ts` / files with the jsdom pragma — DOM-dependent behavior (e.g. `<html lang>` `MutationObserver` monitoring, custom element integration).
- `*.node.test.ts` — explicitly verifies isomorphic/SSR-safe behavior (modules must load without a DOM and skip registration gracefully).

When adding tests for DOM-touching code, add both a jsdom-environment test for behavior and consider whether a node-environment import test is needed to guard the isomorphic path.

## TypeScript coding conventions

- Do not use `var`. Use `const` and `let` instead.
- Use arrow function expressions for closures, where possible.
- All modern ECMAScript features are allowed to use.
