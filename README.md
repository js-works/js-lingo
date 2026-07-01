# js-lingo

A lightweight, **type-safe** internationalization library for TypeScript. Translations are plain TypeScript values — static strings or functions — grouped into typed namespaces. There is **no message DSL, no code generation, and no build step**, and the only runtime dependency is the platform's built-in [`Intl`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl).

The whole library is a single module that exports six functions and a handful of types.

```ts
const l = getI18n().locale("de");

l.getText(common, "greeting"); // "Hallo"   — static, no params
l.getText(common, "itemCount", { count: 1000 }); // "1.000 Artikel" — dynamic, typed params
l.getText(common, "greeting", { count: 1 }); // ✗ compile error: this key takes no params
l.getText(common, "itemCount"); // ✗ compile error: this key requires params
```

---

## Table of contents

- [Why js-lingo](#why-js-lingo)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
  - [Namespaces](#namespaces)
  - [Static and dynamic translations](#static-and-dynamic-translations)
  - [Text bundles](#text-bundles)
  - [The Localizer (the read side)](#the-localizer-the-read-side)
- [Type safety](#type-safety)
- [Locale resolution and fallback](#locale-resolution-and-fallback)
- [The global instance and its lifecycle](#the-global-instance-and-its-lifecycle)
- [Standalone instances](#standalone-instances)
- [Reactive UI integration](#reactive-ui-integration)
- [Formatting numbers and dates](#formatting-numbers-and-dates)
- [Configuration reference](#configuration-reference)
- [API reference](#api-reference)
- [Patterns and recipes](#patterns-and-recipes)
- [Behavior notes and gotchas](#behavior-notes-and-gotchas)
- [Testing](#testing)
- [Design philosophy](#design-philosophy)
- [License](#license)

---

## Why js-lingo

Most i18n tooling asks you to learn a message format (ICU MessageFormat, gettext, custom YAML/JSON dialects), then run a code generator or a runtime parser to turn those messages into functions. js-lingo takes the opposite stance: **a translation is just a value your compiler already understands.**

- A static translation is a `string`.
- A dynamic translation is a function `(params, localizer) => string` — ordinary TypeScript, with ordinary control flow, ordinary string templates, and full type inference on its parameters.

Because translations are typed values, TypeScript checks your call sites for free: unknown keys, missing parameters, and wrong parameter types are all compile errors, with zero generated code to keep in sync.

**Highlights**

- **End-to-end type safety** — keys, parameter presence, and parameter types are all checked at the call site.
- **Tiny and dependency-free** — one module; formatting delegates to `Intl`.
- **No DSL, no codegen** — translations are static strings or plain functions.
- **Smart locale fallback** — BCP-47 tag chains plus configurable cross-language fallbacks.
- **Reactive** — a controller integration re-renders your components on locale change.
- **Namespaced** — translations are grouped and addressed through typed namespace handles, never magic string paths.
- **SSR-friendly** — works without a DOM; on the client it can track `<html lang>` automatically.

---

## Installation

```bash
npm install js-lingo
```

js-lingo is a single module. The examples below import from `js-lingo`; if you vendor the file directly, adjust the import path accordingly.

**Requirements**

- TypeScript (for the type safety; the compiled JavaScript runs anywhere).
- A runtime with `Intl.Locale`, `Intl.NumberFormat`, and `Intl.DateTimeFormat` (modern browsers, Node 14+).
- For the optional client-side `<html lang>` auto-tracking: a DOM with `MutationObserver`.

---

## Quick start

```ts
import {
  bundleTexts,
  createNamespace,
  getI18n,
  initI18n,
  type Translation,
} from "js-lingo";

// 1. Declare a typed namespace.
const common = createNamespace<{
  greeting: Translation; // static  -> string
  itemCount: Translation<{ count: number }>; // dynamic -> (params, localizer) => string
}>({ key: "common" });

// 2. Author translations, grouped by locale.
const commonTexts = bundleTexts({
  en: [
    common.full({
      greeting: "Hello",
      itemCount: ({ count }, lz) => `${lz.formatNumber(count)} items`,
    }),
  ],
  de: [
    common.full({
      greeting: "Hallo",
      itemCount: ({ count }, lz) => `${lz.formatNumber(count)} Artikel`,
    }),
  ],
});

// 3. Configure the global instance once, then register translations.
initI18n({
  getPrimaryLocale: () => "de",
  getFallbackLocales: () => ["en"],
});
getI18n().addTexts(commonTexts);

// 4. Read.
const l = getI18n().locale("de");
l.getText(common, "greeting"); // "Hallo"
l.getText(common, "itemCount", { count: 1000 }); // "1.000 Artikel"
```

---

## Core concepts

### Namespaces

A **namespace** is a typed handle that identifies a group of related translations. You create one with `createNamespace`, parameterized by the shape of its texts:

```ts
const checkout = createNamespace<{
  title: Translation;
  total: Translation<{ amount: number }>;
}>({ key: "checkout", group: "shop" });
```

- `key` uniquely identifies the namespace in the dictionary.
- `group` is optional organizational metadata (defaults to `null`); it is not used during resolution but is available for your own tooling.

Namespace objects are frozen at runtime. You read and write translations by passing the namespace handle — never a stringly-typed path — which is what lets the compiler verify keys and parameters.

Each namespace exposes two authoring helpers:

| Method           | Requires                       | Use for                                   |
| ---------------- | ------------------------------ | ----------------------------------------- |
| `full(texts)`    | **every** key of the namespace | a complete locale                         |
| `partial(texts)` | **any subset** of keys         | incremental or lazily loaded translations |

```ts
checkout.full({
  title: "Checkout",
  total: ({ amount }, lz) => lz.formatNumber(amount),
}); // OK
checkout.full({ title: "Checkout" }); // ✗ compile error: `total` is missing
checkout.partial({ title: "Checkout" }); // OK: subset allowed
```

### Static and dynamic translations

Use the exported `Translation` alias to declare a namespace's shape:

- `Translation` resolves to `string` — a **static** translation.
- `Translation<{ … }>` resolves to a function `(params, localizer) => string` — a **dynamic** translation.

```ts
const ns = createNamespace<{
  ok: Translation; // static
  greet: Translation<{ name: string }>; // dynamic
  cartTotal: Translation<{ items: number; sum: number }>;
}>({ key: "ns" });
```

A dynamic translation is just a function. It receives its typed parameters as the first argument and a `Localizer` (bound to the resolved locale) as the second, so it can format numbers and dates and even read other keys:

```ts
ns.full({
  ok: "OK",
  greet: ({ name }) => `Hello, ${name}!`,
  cartTotal: ({ items, sum }, lz) =>
    `${lz.formatNumber(items)} items — ${lz.formatNumber(sum, { style: "currency", currency: "EUR" })}`,
});
```

> The second parameter is typed as js-lingo's internal `Localizer`, which is not exported. You never need to name it — let TypeScript infer it, as in `({ name }, lz) => …`. This is also why dynamic translations must be declared with `Translation<T>` rather than a hand-written function type.

### Text bundles

A **text bundle** maps locales to lists of namespace texts. `bundleTexts` is a typed identity helper — it returns its argument unchanged, but gives you inference and a stable `TextBundle` type for sharing bundles across modules:

```ts
export const checkoutTexts = bundleTexts({
  en: [checkout.partial({ title: "Checkout" })],
  de: [checkout.partial({ title: "Kasse" })],
});
```

Bundles are registered with `addTexts`, which is variadic and additive — later writes win on a per-key basis:

```ts
getI18n().addTexts(commonTexts, checkoutTexts);
```

Locale keys are normalized (via `Intl.Locale().baseName`) before merging, so `"EN-US"` and `"en-us"` land in the same bucket.

### The Localizer (the read side)

Calling `i18n.locale(tag)` returns a **`Localizer`** — the read-only surface bound to one active locale. Localizers are memoized per distinct locale string on each instance.

```ts
const l = getI18n().locale("de-DE");

l.getText(ns, "ok"); // resolve a static key
l.getText(ns, "greet", { name: "Mara" }); // resolve a dynamic key
l.formatNumber(1234.5); // "1.234,5"
l.formatDateTime(new Date()); // locale-formatted date/time
l.locale("en-US"); // a sibling Localizer for another locale
```

---

## Type safety

The `getText` signature is overloaded so the compiler knows, per key, whether parameters are allowed and what their shape must be:

```ts
const l = getI18n().locale("en");

l.getText(ns, "ok"); // ✓ static key, no params
l.getText(ns, "greet", { name: "Ada" }); // ✓ dynamic key, correct params

l.getText(ns, "ok", { name: "Ada" }); // ✗ static key takes no params
l.getText(ns, "greet"); // ✗ dynamic key requires params
l.getText(ns, "greet", { name: 42 }); // ✗ wrong param type
l.getText(ns, "nope"); // ✗ unknown key
```

The same checking applies when authoring: `full` demands a complete key set, `partial` permits a subset, and every value is checked against its declared `Translation` shape.

---

## Locale resolution and fallback

When you ask for a key, js-lingo builds an ordered, de-duplicated **resolution chain** and returns the first match. The chain is:

1. The requested locale's own tag chain, **most → least specific**.
2. Then each configured fallback locale's tag chain, in order.

Within a single tag, the chain expands the canonical tag, then `language-region`, then the bare `language` — so a region-specific translation is preferred over a generic one:

| Requested    | Tag chain                     |
| ------------ | ----------------------------- |
| `de-CH`      | `de-CH` → `de`                |
| `en-US`      | `en-US` → `en`                |
| `zh-Hant-TW` | `zh-Hant-TW` → `zh-TW` → `zh` |

With `getFallbackLocales: () => ["en"]` configured, a request for `de` that misses every `de*` tag continues into the `en` chain:

```ts
const i18n = createI18n({
  getPrimaryLocale: () => "de",
  getFallbackLocales: () => ["en"],
});

i18n.addTexts(bundleTexts({ en: [ns.partial({ ok: "OK" })] }));

i18n.locale("de").getText(ns, "ok"); // "OK" — resolved from the English fallback
```

A few rules worth knowing:

- **Missing keys never throw.** If nothing in the chain matches, `getText` returns the **key string itself**, which makes missing translations visible without crashing the UI.
- **A dynamic value resolved via fallback** is invoked with a `Localizer` for the locale it was _found_ in, so its `formatNumber`/`formatDateTime` calls match the language of the text.
- **Fallback tags are expanded too** — a fallback of `en-GB` also matches `en`.
- **Invalid tags:** an invalid _requested_ locale throws (it's a programming error at the call site); an invalid _fallback_ tag is skipped so one bad entry can't break resolution.

---

## The global instance and its lifecycle

`getI18n()` returns a lazily-created, module-level **singleton**. Its configuration is supplied once via `initI18n` and resolved lazily, the first time any locale method is used.

```ts
initI18n({ getPrimaryLocale: () => "de", getFallbackLocales: () => ["en"] });
getI18n().addTexts(commonTexts);
getI18n().locale("de").getText(common, "greeting");
```

**Lifecycle rules**

- `initI18n` may be called **at most once**. A second call throws.
- `initI18n` must run **before the global instance is first used** (before the first `locale()`, `getPrimaryLocale()`, etc.). Calling it too late throws `"Too late to call function 'initI18n'…"`.
- **`getI18n().addTexts(...)` may be called before `initI18n`.** Translations registered early are remembered and resolve normally after init — so modules can register their texts at import time, regardless of where app startup calls `initI18n`.
- **Constructing a `localize` controller does not force initialization**, so a controller created in a class field (which can run before app startup) will not lock out a later `initI18n`.

**Client-side default locale source**

In a browser, if you do not supply `getPrimaryLocale` / `onLocaleChange`, the global instance installs a `<html lang>` monitor automatically: `getPrimaryLocale()` reads the live `lang` attribute, and `onLocaleChange` fires via a `MutationObserver` whenever it changes.

```ts
// Browser, no explicit locale source configured:
document.documentElement.lang = "fr";
getI18n().getPrimaryLocale(); // "fr"
// Later, changing <html lang> notifies onLocaleChange listeners.
```

A partial config still benefits from this: if you supply only `getFallbackLocales`, the `<html lang>` monitor still provides the primary locale and the change source.

---

## Standalone instances

`createI18n(config)` builds an independent instance with its own dictionary. Unlike the global instance it initializes **eagerly** at construction, which makes it the right choice when you need isolation — most importantly **server-side rendering**, where a module-level singleton would leak one request's locale into another.

```ts
function handleRequest(acceptLanguage: string) {
  const i18n = createI18n({
    getPrimaryLocale: () => pickLocale(acceptLanguage),
    getFallbackLocales: () => ["en"],
  });
  i18n.addTexts(commonTexts);
  return renderWith(i18n);
}
```

Standalone instances expose the same `I18n` surface as the global one.

---

## Reactive UI integration

`localize(host, i18n?)` returns a reactive controller that is **also a `Localizer`**. It binds to a host that implements `requestUpdate()` and `addController()` — most notably a Lit `ReactiveControllerHost`, but any object with those two methods works.

```ts
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { localize } from "js-lingo";
import { common } from "./namespaces";

@customElement("greeting-label")
export class GreetingLabel extends LitElement {
  readonly #loc = localize(this);

  render() {
    return html`
      <p>${this.#loc.getText(common, "greeting")}</p>
      <p>${this.#loc.getText(common, "itemCount", { count: 1234 })}</p>
    `;
  }
}
```

The controller:

- resolves its locale **lazily** (it reads the locale on connect or on first use, not at construction);
- on `hostConnected`, subscribes to the bound instance's locale changes and triggers exactly one `requestUpdate`;
- on each locale change, refreshes its active locale and calls `host.requestUpdate()`, re-rendering with the new language;
- on `hostDisconnected`, unsubscribes (and is safe to call when never connected or called twice).

You can bind a controller to a specific instance by passing it explicitly: `localize(this, myInstance)`. Omitting it binds to the global instance.

---

## Formatting numbers and dates

Every `Localizer` exposes `Intl`-backed formatting bound to its active locale:

```ts
const l = getI18n().locale("de-DE");

l.formatNumber(1234567.89); // "1.234.567,89"
l.formatNumber(0.42, { style: "percent" }); // "42 %"
l.numberFormat({ style: "currency", currency: "EUR" }); // a reusable Intl.NumberFormat

l.formatDateTime(new Date(), { dateStyle: "long" }); // "1. Juni 2026"
l.dateTimeFormat({ timeStyle: "short", timeZone: "UTC" }); // a reusable Intl.DateTimeFormat
```

Use the `formatX` helpers for one-off formatting, and the `numberFormat` / `dateTimeFormat` factories when you want to reuse a configured formatter across many values.

---

## Configuration reference

Both `createI18n(config)` and `initI18n(config)` accept the same shape. Every field is optional.

| Field                | Type                               | Purpose                                                                                                                     |
| -------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `getPrimaryLocale`   | `() => Locale`                     | The active locale. Defaults to `"en-US"` if omitted (and, on the client global instance, to the `<html lang>` monitor).     |
| `getFallbackLocales` | `() => Locale[]`                   | Cross-language fallbacks appended to the resolution chain.                                                                  |
| `onLocaleChange`     | `(listener) => Unsubscribe`        | The locale-change source. The instance subscribes once and fans out to `onLocaleChange` listeners / `localize` controllers. |
| `onAddTexts`         | `(locale, namespace, key) => void` | Invoked once per key registered through `addTexts`. Useful for telemetry, coverage tracking, or warming caches.             |

`onAddTexts` notifications behave according to the instance's initialization:

- **Standalone instances** (eager) notify immediately as `addTexts` runs.
- **The global instance** buffers notifications from any `addTexts` calls made before `initI18n`, then replays them in registration order once the config is resolved; later calls notify directly.

---

## API reference

### Functions

| Function          | Signature                                                              | Description                                           |
| ----------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| `createNamespace` | `<T>(params: { key: string; group?: string \| null }) => Namespace<T>` | Define a typed namespace handle.                      |
| `bundleTexts`     | `<T extends TextBundle>(texts: T) => TextBundle`                       | Typed identity helper for authoring bundles.          |
| `createI18n`      | `(config?: I18nConfig) => I18n`                                        | Create a standalone, eagerly-initialized instance.    |
| `getI18n`         | `() => I18n`                                                           | Get the lazily-created global singleton.              |
| `initI18n`        | `(config: I18nConfig) => void`                                         | Configure the global instance once, before first use. |
| `localize`        | `(host, i18n?) => LocalizeController & Localizer`                      | Reactive controller bound to a UI host.               |

### `I18n` (instance)

| Method                     | Description                                                            |
| -------------------------- | ---------------------------------------------------------------------- |
| `addTexts(...bundles)`     | Register one or more text bundles (additive; last write wins per key). |
| `locale(tag)`              | Return a `Localizer` bound to `tag`.                                   |
| `getPrimaryLocale()`       | The current primary locale.                                            |
| `getFallbackLocales()`     | A copy of the configured fallback locales (or `[]`).                   |
| `onLocaleChange(listener)` | Subscribe to locale changes; returns an idempotent `Unsubscribe`.      |

### `Localizer` (read side)

| Method                            | Description                                                    |
| --------------------------------- | -------------------------------------------------------------- |
| `getText(ns, key)`                | Resolve a **static** key.                                      |
| `getText(ns, key, params)`        | Resolve a **dynamic** key with typed params.                   |
| `formatNumber(value, options?)`   | Locale-formatted number.                                       |
| `numberFormat(options?)`          | A reusable `Intl.NumberFormat`.                                |
| `formatDateTime(value, options?)` | Locale-formatted date/time.                                    |
| `dateTimeFormat(options?)`        | A reusable `Intl.DateTimeFormat`.                              |
| `locale(tag)`                     | A sibling `Localizer` for another locale on the same instance. |

### Exported types

`Locale`, `TextKey`, `NamespaceKey`, `Unsubscribe`, `Translation`, `TextMap`, `Namespace`, `NamespaceTexts`, `TextBundle`, `LocalizeController`, `LocalizeControllerHost`.

---

## Patterns and recipes

**Register translations at the point of use (code splitting).** Because `addTexts` is additive and may run before `initI18n`, a feature module can ship and register its own bundle on import:

```ts
// feature/checkout/texts.ts
import { getI18n } from "js-lingo";
import { checkoutTexts } from "./bundles";
getI18n().addTexts(checkoutTexts);
```

**Lazy-load a locale.** Fetch a locale's bundle on demand and merge it in:

```ts
async function loadLocale(locale: string) {
  const mod = await import(`./locales/${locale}.ts`);
  getI18n().addTexts(mod.default);
}
```

**Custom locale source.** Drive the locale from a store, a cookie, or a router instead of `<html lang>`:

```ts
initI18n({
  getPrimaryLocale: () => store.getState().locale,
  onLocaleChange: (listener) => store.subscribe(listener),
});
```

**Track translation registration.** Use `onAddTexts` to detect coverage gaps or log additions:

```ts
const seen = new Set<string>();
createI18n({
  onAddTexts: (locale, ns, key) => seen.add(`${locale}:${ns.key}:${key}`),
});
```

---

## Behavior notes and gotchas

- **Missing keys return the key string** rather than throwing. Treat the key text appearing in your UI as a signal of a missing translation.
- **Server-side, the singleton is shared.** On a server, prefer a per-request `createI18n` instance over the global one to avoid leaking a locale between requests.
- **The resolution chain is rebuilt per `getText` call.** This is inexpensive for normal use; if you resolve keys in a tight hot loop, cache the `Localizer` and consider memoizing.
- **The config locale-change subscription is established once and not torn down.** Instances are expected to be long-lived (a singleton or a per-request object), so this is intentional rather than a leak.
- **`Localizer` is internal.** Author dynamic translations with `Translation<T>` and let the second parameter's type be inferred.

---

## Testing

js-lingo is plain TypeScript with no globals beyond `Intl` and the optional DOM monitor, so it tests cleanly with any runner. For the `<html lang>` monitor and the module-level singleton, a DOM environment plus fresh module imports work well:

```ts
// @vitest-environment jsdom
import { vi } from "vitest";

async function freshModule() {
  vi.resetModules();
  return import("js-lingo"); // fresh global state per test
}
```

Standalone behavior (resolution, fallback, formatting, `onAddTexts`) can be tested directly through `createI18n` without any DOM.

---

## Design philosophy

- **Translations are values, not a language.** If TypeScript can already express and check it, there is no reason to invent a parallel message format.
- **The type system is the schema.** Keys, parameter presence, and parameter types are enforced at the call site, with no generated artifacts to drift out of date.
- **Lean on the platform.** Locale parsing and number/date formatting come from `Intl`; js-lingo adds structure, typing, and resolution, not its own formatters.
- **Predictable resolution.** A single, ordered, de-duplicated chain decides every lookup, and a miss degrades gracefully to the key.

---

## License

MIT — see `LICENSE`.
