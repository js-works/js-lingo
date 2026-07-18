# js-lingo

![npm](https://img.shields.io/npm/v/js-lingo)
![GitHub License](https://img.shields.io/github/license/js-works/js-lingo)
![GitHub Last Commit](https://img.shields.io/github/last-commit/js-works/js-lingo)
![GitHub Repo Size](https://img.shields.io/github/repo-size/js-works/js-lingo)

Every app has things to say. **js-lingo** is the friend who repeats them perfectly in whatever language the room is speaking. Components ship with something sensible to say out of the box, translators retell it, and your app just relays the current version to whoever's listening.

No global config to wrestle. No mystery singletons. No "why is this string suddenly `undefined`." Just a tiny, strongly-typed facade you create once and hand around.

```ts
import { createI18n, createNamespace } from "js-lingo";

const greetingTexts = createNamespace({
  key: "greeting",
  defaults: {
    hello: "Hello",
    welcome: (params: { name: string }, i18n) => `Welcome, ${params.name}!`,
  },
});

const i18n = createI18n(); // zero config — the defaults already work

i18n.text(greetingTexts, "hello"); // "Hello"
i18n.text(greetingTexts, "welcome", { name: "Ada" }); // "Welcome, Ada!"
```

That's a fully working, fully typed component library. No locale files required until someone actually wants another language.

---

## Table of contents

- [Why js-lingo](#why-js-lingo)
- [Install](#install)
- [The 90-second tour](#the-90-second-tour)
- [Who does what: the three roles](#who-does-what-the-three-roles)
- [Adding translations](#adding-translations)
- [Loading translations (including lazily)](#loading-translations-including-lazily)
- [Falling back gracefully](#falling-back-gracefully)
- [Formatting numbers, dates, and more](#formatting-numbers-dates-and-more)
- [Staying in sync](#staying-in-sync)
- [Does this key exist? `hasText`](#does-this-key-exist-hastext)
- [Dynamic keys](#dynamic-keys)
- [Middlewares: the friend who embellishes every story](#middlewares-the-friend-who-embellishes-every-story)
- [Bring your own backend](#bring-your-own-backend)
- [Async sources: `isLoading` and `whenReady`](#async-sources-isloading-and-whenready)
- [Ask for only what you need](#ask-for-only-what-you-need)
- [Message Format (ICU)](#message-format-icu)
- [React](#react)
- [Web Components](#web-components)
- [Resolution order, in one breath](#resolution-order-in-one-breath)
- [TypeScript setup](#typescript-setup)
- [API cheat sheet](#api-cheat-sheet)
- [License](#license)

---

## Why js-lingo

- **Zero-config components.** A namespace ships with its own default texts. A component library works the moment it's imported — no app cooperation, no setup step, no empty-string surprises.
- **Type-safe to the core.** Keys are checked. Parameters are checked, per key. `text(greetingTexts, "welcome")` won't compile without `{ name }`; `text(greetingTexts, "helo")` won't compile at all.
- **No hidden global state.** You create an instance with `createI18n` and hand it around however you like. Nothing lurks in a module singleton.
- **Pluggable everything.** Locale detection and text resolution are swappable strategies. Keep the batteries-included defaults, compose them, or replace them with an adapter for any third-party i18n backend.
- **Batteries included.** A client `<html lang>` monitor, an async-and-lazy-capable text store, cross-language fallback, and the full `Intl` formatting suite — all cached and shared.
- **Reactive.** Locale changes and late-arriving translations both fire one `onChange`. Wire it to your renderer once and forget about it.
- **Tiny and dependency-free.** It's a facade and a few strategies. That's the whole thing.

---

## Install

```bash
npm install js-lingo
# or
pnpm add js-lingo
# or
yarn add js-lingo
```

That's the whole install — everything below lives in this one package as separate **entry points** (subpath imports), so you only pull in the code you actually use:

```ts
import { createI18n } from "js-lingo"; // the core — dependency-free, always available
import { msg } from "js-lingo/message-format"; // ICU MessageFormat helper (bundles intl-messageformat)
import { I18nProvider, useI18n } from "js-lingo/react"; // React bindings (react is an optional peer)
import { i18nController } from "js-lingo/web-components"; // custom-element / Lit bindings (dependency-free)
```

Nothing to install separately for `./message-format` or `./web-components` — both are dependency-free and bundle whatever they need. `./react` is the only entry point with an external dependency: `react` (`>=18`), declared as an optional peer.

---

## The 90-second tour

```ts
import {
  createI18n,
  createNamespace,
  defaultTextSource,
  bundleTexts,
  allTexts,
  someTexts,
} from "js-lingo";

// 1. A component author defines a text namespace with default text (in en-US).
const greetingTexts = createNamespace({
  key: "greeting",
  defaults: {
    hello: "Hello",
    welcome: (p: { name: string }) => `Welcome, ${p.name}!`,
  },
});

// 2. Translation authors retell it — English (the defaults, made explicit) and German,
//    each shipped as its own bundle.
const greetingEnglish = bundleTexts({
  en: allTexts(greetingTexts, greetingTexts.defaults),
});

const greetingGerman = bundleTexts({
  de: [
    allTexts(greetingTexts, {
      hello: "Hallo",
      welcome: (params) => `Willkommen, ${params.name}!`,
    }),
  ],
  "de-CH": [
    someTexts(greetingTexts, {
      hello: "Grüezi", // just the one word differs; the rest narrows to `de`
    }),
  ],
});

// 3. The app collects the bundles and creates one instance.
const i18n = createI18n({
  textSource: defaultTextSource({
    textBundles: [greetingEnglish, greetingGerman],
    fallbackLocales: ["en"],
  }),
});

i18n.text(greetingTexts, "hello"); // "Hello"  (or "Hallo" when the locale is German)
i18n.text(greetingTexts, "welcome", { name: "Ada" }); // parameters are typed to the key

// Prefer not to repeat the namespace? Bind it once.
const t = i18n.bindTexts(greetingTexts);
t("hello"); // scoped to `greetingTexts`
t("welcome", { name: "Ada" });
t(otherTexts, "key"); // still fully-qualified for anything else

// The Intl formatting core comes for free, always in the active locale.
i18n.formatNumber(1234.56); // "1,234.56" (de: "1.234,56", de-CH: "1'234.56")
i18n.formatDateTime(new Date(), { dateStyle: "long" }); // "July 17, 2026" (de/de-CH: "17. Juli 2026")
```

---

## Who does what: the three roles

js-lingo keeps three jobs strictly separate — so a component library, a translation pack, and an app can each evolve without stepping on the others.

| Role                   | Ships                                                                  | Tool                                     |
| ---------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| **Component author**   | A namespace with default texts                                         | `createNamespace`                        |
| **Translation author** | A `TextBundle` of translations, grouped by locale                      | `bundleTexts` + `someTexts` / `allTexts` |
| **App author**         | The wiring: collect bundles, pick a locale source, create the instance | `defaultTextSource` + `createI18n`       |

The translation author's job ends at "here is a bundle." How that bundle reaches whatever text source the app uses is none of their concern — and the component author never has to know translations exist at all.

---

## Adding translations

A **namespace** defines both the _shape_ (which keys exist and what parameters they take) and the _texts of last resort_. Translations for other locales are attached separately, and there are two ways to do it:

```ts
import { someTexts, allTexts } from "js-lingo";

// `someTexts` — partial. Missing keys fall back through the pipeline to the default.
someTexts(greetingTexts, { hello: "Bonjour" });

// `allTexts` — complete. Every key must be present, checked at compile time AND runtime.
allTexts(greetingTexts, {
  hello: "Bonjour",
  welcome: (params) => `Bienvenue, ${params.name} !`,
});
```

Group them by locale into a bundle. Each locale takes a single namespace group — or an array of them, when one locale carries translations for several namespaces:

```ts
export const greetingFrench = bundleTexts({
  fr: someTexts(greetingTexts, { hello: "Bonjour" }),
  // multiple namespaces for one locale? pass an array:
  // fr: [someTexts(greetingTexts, { hello: "Bonjour" }), someTexts(datePickerTexts, { today: "Aujourd'hui" })],
});
```

> **Heads up — the errors are on your side.** Pass a key that doesn't exist, or a string where a function was expected, and you get one readable `TypeError` listing every problem at once — at the declaration site, not at some distant call. TypeScript catches it first; the runtime check catches plain-JS callers too.

---

## Loading translations (including lazily)

`defaultTextSource` accepts three flavors of contribution, and you can mix them freely:

```ts
const i18n = createI18n({
  textSource: defaultTextSource({
    textBundles: [
      greetingGerman, // 1. ready now
      fetchRemoteBundle(), // 2. a Promise<TextBundle>, registered when it settles
      () => import("./locales/fr.js").then((m) => m.french), // 3. a thunk — loads on FIRST use
    ],
    fallbackLocales: ["en"],
  }),
});
```

The thunk is the good part: `() => import(...)` doesn't run until someone actually asks for a text, so a locale nobody visits is never downloaded. When an async bundle lands, `onChange` fires and your UI re-renders with the freshly arrived strings. Until then, the namespace defaults quietly hold the fort.

A rejected load is reported to the console and skipped — one broken locale file never takes down the rest.

---

## Falling back gracefully

Two kinds of fallback happen automatically, in order:

1. **Within a language** — a request for `de-CH` narrows to `de` if there's no Swiss-specific text. `zh-Hant-TW` → `zh-TW` → `zh`. You don't configure this; it just happens.
2. **Across languages** — the `fallbackLocales` chain. Missed everywhere in the requested language? Try the fallbacks in order.

Only when _both_ come up empty does the namespace default answer. And if even that's missing (only possible for a dynamically-keyed namespace), you get the bare key back instead of `undefined` — so a string is a string is a string.

A dynamic translation is always handed an `i18n` bound to the locale it was **actually found in**, so numbers and dates inside a German string format the German way even when German arrived via fallback.

---

## Formatting numbers, dates, and more

The full `Intl` suite, cached and shared across every instance, always bound to the current locale:

```ts
i18n.formatNumber(1234.5); // "1,234.5"
i18n.formatNumberRange(10, 20); // "10–20"
i18n.formatDateTime(new Date(), { dateStyle: "medium" }); // "Jul 17, 2026"
i18n.formatDateTimeRange(from, to, { dateStyle: "medium" });
i18n.formatRelativeTime(-3, "day"); // "3 days ago"
i18n.formatRelativeTime(2, "week", { numeric: "auto" }); // "in 2 weeks"
i18n.formatList(["apples", "bananas", "oranges"]); // "apples, bananas, and oranges"
i18n.formatList(["cash", "card"], { type: "disjunction" }); // "cash or card"
```

Need the raw formatter for `formatToParts` or anything the shortcuts don't cover? Every kind has an accessor: `numberFormat()`, `dateTimeFormat()`, `relativeTimeFormat()`, `listFormat()`. Working with `Temporal`? Pass the value straight to `formatDateTime` — `Intl.DateTimeFormat` handles it natively.

> Formatting is the one thing that's **deliberately not configurable** — it's a fixed, correct `Intl` core. Everything else is a swappable strategy.

---

## Staying in sync

One instance, one change channel — for both locale changes _and_ newly-arrived translations:

```ts
const unsubscribe = i18n.onChange(() => rerender());
// ...later
unsubscribe(); // idempotent — call it as many times as you like
```

Ask the current locale, or get a sibling instance pinned to another one:

```ts
i18n.locale(); // "en-US"
const de = i18n.localize("de"); // a sibling statically bound to German
de.localize(); // ...and back to the dynamic instance
```

Siblings share the same pipeline, caches, and change channel — they're cheap, and identical tags (`"en-US"` and `"en-us"`) return the very same instance.

---

## Does this key exist? `hasText`

```ts
// Default: is there a REAL translation from the text source, for the current locale?
// (within-language narrowing counts; fallback locales and namespace defaults do NOT.)
i18n.hasText(greetingTexts, "hello"); // boolean

// includeFallback: run the full pipeline — true whenever `text()` would return
// something meaningful rather than the bare key.
i18n.hasText(greetingTexts, "hello", true); // boolean
```

Use the first to ask "has a translator actually done this one yet?"; use the second to ask "will the user see something sensible?"

---

## Dynamic keys

Sometimes the key set is open-ended — HTTP status codes, error codes, that sort of thing. Type the namespace's `defaults` with a template literal and you keep typo-protection without enumerating every value:

```ts
const httpTexts = createNamespace({
  key: "http",
  defaults: {
    "httpError.404": "Not Found",
    "httpError.500": "Internal Server Error",
  } as Record<`httpError.${number}`, string>,
});

i18n.text(httpTexts, `httpError.${code}`); // typed; unknown codes gracefully return the bare key
```

Your real defaults still work as fallbacks exactly as always — the cast only widens the _type_, never the runtime object. Want to reject nonsense like `httpError.-2.35`? Tighten the pattern to a fixed digit count:

```ts
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type HttpKey = `httpError.${Digit}${Digit}${Digit}`; // exactly three digits
```

---

## Middlewares: the friend who embellishes every story

A middleware wraps the **whole** resolution — including namespace defaults and nested lookups. That's the layer for cross-cutting concerns:

```ts
import type { TextMiddleware } from "js-lingo";

// Pseudo-localization: wrap every resolved string, defaults included, for testing.
const pseudo: TextMiddleware = (req, ctx, next) => {
  const result = next();
  return result === undefined ? undefined : `⟦${result}⟧`;
};

// Hard-miss reporting: next() === undefined means nothing had the key — not even a default.
const reportMisses: TextMiddleware = (req, ctx, next) => {
  const result = next();
  if (result === undefined) console.warn(`i18n miss: ${req.namespace.key}/${req.key}`);
  return result;
};

const i18n = createI18n({ middlewares: [pseudo, reportMisses] }); // index 0 is outermost
```

`next(patch)` can even rewrite the request on its way down — redirect a key, swap a namespace, anything. Short-circuit by returning without calling `next` at all.

---

## Bring your own backend

Already invested in another i18n library? A **text source** is just an object with a `resolve` function and an optional change channel:

```ts
import type { TextSource } from "js-lingo";

const myAdapter: TextSource = {
  resolve: (request, context) => lookInMyBackend(request) ?? undefined, // string ("" ok) = hit, undefined = miss
  onChange: (listener) => myBackend.subscribe(listener), // optional
};

const i18n = createI18n({ textSource: myAdapter });
```

The one rule: return `undefined` for a genuine miss — do _real_ miss detection, not a truthiness check, because `""` is a perfectly valid translation. The built-in `defaultTextSource` has no special privileges; it plugs in exactly the same way your adapter does.

---

## Async sources: `isLoading` and `whenReady`

The built-in `defaultTextSource` is _reconcile-later_: `text()` always returns something right now (a default until the real translation lands), and `onChange` fires when late bundles arrive so your UI re-renders. That's perfect when a brief flash of default text is fine — and it's why `defaultTextSource` needs no async API at all.

But a source that fetches bundles from a backend on demand can do better: it can let a caller **wait** for exactly the texts it needs. That's the optional async-loading capability. Implement two more methods on your `TextSource`, both scoped to a `(locale, namespace)` pair:

```ts
import type { TextSource } from "js-lingo";

// Sketch of an adapter over i18next, which already loads by namespace and exposes promises.
function i18nextSource(i18next: import("i18next").i18n): TextSource {
  return {
    resolve: (request) =>
      i18next.exists(request.key, { ns: request.namespace.key, lng: request.locale })
        ? i18next.t(request.key, { ns: request.namespace.key, lng: request.locale, ...(request.params as object) })
        : undefined,
    // NEW — the async-loading capability:
    isLoading: (locale, namespace) => !i18next.hasResourceBundle(locale, namespace.key),
    whenReady: (locale, namespace) =>
      // loadLanguages fetches the locale (and its namespaces) WITHOUT switching the active
      // language — never call changeLanguage here, that's a global side effect.
      i18next.loadLanguages(locale).then(() => i18next.loadNamespaces(namespace.key)),
    onChange: (listener) => {
      i18next.on("loaded", listener);
      return () => i18next.off("loaded", listener);
    },
  };
}
```

This capability lives on the **`TextSource`**, not on the `I18n` facade — deliberately. `I18n` is the component-facing type, and it stays lean and synchronous; loading is a source-and-app concern. So you consume the capability through the **source you own** (the one you passed to `createI18n`), typed as `TextSource & LoadingAware`:

```ts
const source = i18nextSource(myI18next); // TextSource & LoadingAware
const i18n = createI18n({ textSource: source });

source.isLoading("de", greetingTexts); // boolean: is this (locale, namespace) still being fetched?
await source.whenReady("de", greetingTexts); // resolves once that load has settled
```

Two contract points make this safe to build on:

- **`whenReady` resolves on _settle_, success or failure — it never rejects.** A failed load simply falls through to the namespace defaults (one broken locale never wedges the app), and anything waiting on it — a React Suspense boundary, say — always eventually un-suspends.
- **`whenReady(locale, namespace)` resolves once `isLoading(locale, namespace)` would be `false`.** So "wait, then read" is race-free.

`LoadingAware` is optional: a source may implement both methods or neither (`defaultTextSource` implements neither). A component doing plain `text()` / `useI18n` never sees any of this — it renders defaults and reconciles later regardless. The capability only matters when the app chooses to *wait*: at an app-level gate, or via [`useI18nSuspense`](#react) for the React binding that turns it into flash-free rendering.

---

## Ask for only what you need

`I18n` is assembled from small, single-concern capability types, so a helper can depend on just the slice it uses instead of the whole facade:

```ts
import type { NumberFormatter, DateTimeFormatter } from "js-lingo";

function priceLine(fmt: NumberFormatter & DateTimeFormatter, price: number, when: Date) {
  return `${fmt.formatNumber(price)} — ${fmt.formatDateTime(when)}`;
}
```

The pieces: `TextAccess`, `LocaleAware`, `ChangeNotifier`, `NumberFormatter`, `DateTimeFormatter`, `RelativeTimeFormatter`, `ListFormatter`. Pass a full `I18n` wherever any combination is expected — it satisfies them all. (`LoadingAware` is deliberately _not_ part of `I18n` — it's an optional `TextSource` capability; see [Async sources](#async-sources-isloading-and-whenready).)

---

## Message Format (ICU)

`js-lingo/message-format` gives you `msg`, a tagged template that turns an ICU MessageFormat pattern into a `TranslationFn` — a drop-in value anywhere a namespace default or a translation is expected (defaults, `someTexts`, `allTexts`).

```ts
import { createNamespace } from "js-lingo";
import { msg } from "js-lingo/message-format";

const cartTexts = createNamespace({
  key: "cart",
  defaults: {
    itemCount: msg<{ count: number }>`{count, plural, one {# item} other {# items}}`,
    greeting: msg<{ name: string }>`Hello, {name}!`,
  },
});

i18n.text(cartTexts, "itemCount", { count: 1 }); // "1 item"
i18n.text(cartTexts, "itemCount", { count: 3 }); // "3 items"
```

A few things worth knowing:

- The ICU syntax lives **in the string itself** — `{name}`, `{count, plural, ...}`, `{count, number}`, `{date, date, long}`, and so on go directly in the template. `${expr}` interpolation is deliberately not supported (and not needed — ICU already has its own placeholder syntax); `msg` only accepts a fully static pattern.
- The params type can't be inferred from the pattern (it's just a string to TypeScript), so name it explicitly: `` msg<{ count: number }>`...` ``.
- Formatting follows the same locale rule as everywhere else: a message resolved via cross-language fallback formats numbers/plurals/dates in the locale it was **actually found in**, not the one originally requested.
- Compiled `IntlMessageFormat` instances are cached per `(locale, pattern)` pair and reused for the life of the process.
- This entry point bundles `intl-messageformat` itself — no extra install, no peer dependency.

Anything ICU doesn't cover is still just a plain `(params, i18n) => string` — a hand-written `TranslationFn` works exactly the same way; `msg` is a convenience for the ICU dialect specifically, not a replacement for it.

---

## React

`js-lingo/react` distributes the instance through context and re-renders on every change for you. One hook — `useI18n` — hands you a lookup function `t` and the full `i18n` facade. Pass a namespace to scope `t` to it; pass nothing and `t` stays fully-qualified.

```tsx
import { I18nProvider, useI18n } from "js-lingo/react";
import { greetingTexts } from "./greeting";

function App({ i18n }) {
  return (
    <I18nProvider i18n={i18n}>
      <Greeting name="Ada" />
    </I18nProvider>
  );
}

// Scoped: t is bound to `greetingTexts` — call t("key"[, params]) directly.
function Greeting({ name }: { name: string }) {
  const { t } = useI18n(greetingTexts);
  return <h1>{t("welcome", { name })}</h1>;
}

// Unscoped: t is fully-qualified, and i18n gives you formatting, locale(), etc.
function Clock() {
  const { t, i18n } = useI18n();
  return (
    <figure>
      <figcaption>{t(greetingTexts, "hello")}</figcaption>
      <time>{i18n.formatDateTime(new Date(), { timeStyle: "short" })}</time>
    </figure>
  );
}
```

Locale switch, lazy French bundle finishing its download — either way, the components that called `useI18n` update automatically.

`I18nProvider` does double duty from one `display: contents` wrapper: it feeds React context (for `useI18n`) **and** bridges the same instance onto the DOM Context Community Protocol, so any web component from `js-lingo/web-components` rendered inside the subtree (e.g. a Lit element using `i18nController`) picks it up automatically — no separate wiring needed when React merely hosts custom elements. Pass a **stable** instance (module scope, or memoized) — one created inline on every render resets the change-tracking machinery and thrashes re-rendering.

### Suspense: never render the wrong text

`useI18n` shows the default text for one render, then re-renders with the real translation when it arrives. When you'd rather show a fallback and render **only** real translations — no flash of default — reach for `useI18nSuspense`. It's `useI18n(namespace)` that suspends while the source is still loading that namespace. Because loading lives on the source (not the facade — see [Async sources](#async-sources-isloading-and-whenready)), you pass the **source you own** as the first argument:

```tsx
import { Suspense } from "react";
import { useI18nSuspense } from "js-lingo/react";
import { greetingTexts } from "./greeting";
import { appTextSource } from "./i18n-setup"; // your TextSource & LoadingAware

function Greeting({ name }: { name: string }) {
  const { t } = useI18nSuspense(appTextSource, greetingTexts); // suspends until ready
  return <h1>{t("welcome", { name })}</h1>;
}

function App({ i18n }) {
  return (
    <I18nProvider i18n={i18n}>
      <Suspense fallback={<Spinner />}>
        <Greeting name="Ada" />
      </Suspense>
    </I18nProvider>
  );
}
```

It requires a source that implements the [async-loading capability](#async-sources-isloading-and-whenready) — the `TextSource & LoadingAware` type enforces this at compile time, so `defaultTextSource` (which doesn't implement it) isn't a valid argument; with a sync source you'd just use plain `useI18n`. Under the hood it throws `source.whenReady(locale, namespace)` while `source.isLoading(locale, namespace)`; because `whenReady` resolves even on a failed load, the boundary always un-suspends (a failure falls through to the namespace defaults).

Passing the source into every suspending component is app-author work by design — the same role that owns the source and the `<Suspense>` boundaries. A reusable component that knows nothing about the app should use plain `useI18n` and let the app gate it from the outside.

---

## Web Components

`js-lingo/web-components` brings the same facade to custom elements, dependency-free (works with, but does not require, Lit), built on the [Context Community Protocol](https://github.com/webcomponents-cg/community-protocols) for distribution. Standalone elements work with zero setup thanks to namespace defaults; when you _do_ want to distribute a shared instance, `i18nController` attaches a Lit reactive controller that keeps each element subscribed and re-rendering:

```ts
import { LitElement, html } from "lit";
import { i18nController } from "js-lingo/web-components";
import { greetingTexts } from "./greeting";

class GreetingBanner extends LitElement {
  #i18n = i18nController(this); // finds the ambient instance; triggers re-render on change

  render() {
    return html`<h1>${this.#i18n.text(greetingTexts, "hello")}</h1>`;
  }
}
customElements.define("greeting-banner", GreetingBanner);
```

Because every namespace carries its defaults, a `greeting-banner` dropped onto any page renders correct English immediately — even with no i18n instance provided at all. Provide one and it upgrades in place. `i18nController` resolves its instance in three stages, first match wins:

1. an explicit `i18n` argument — `i18nController(this, myInstance)`, for tests or special cases
2. a context provider up the tree — re-requested on every connect, and re-subscribed live if the provider swaps instances
3. the internal zero-config fallback — so the element never breaks, translated or not

`localize(locale)` on the controller hands out a facade of the CURRENT instance; if a provider swaps the instance later, previously returned facades keep pointing at the old one — prefer calling through the controller itself in render code.

### Distributing an instance

Two ways to answer a controller's context request:

**Imperative** — `provideI18n(target, i18n)` on any `EventTarget`, typically mounted once at the app root:

```ts
import { provideI18n } from "js-lingo/web-components";

const stopProviding = provideI18n(document.body, appI18n); // app-wide
// later, if you ever need to: stopProviding();
```

**Declarative** — the `<i18n-provider>` custom element, registered automatically the first time `js-lingo/web-components` is imported (guarded against double registration and non-browser environments):

```ts
import "js-lingo/web-components"; // registers <i18n-provider>
import { html } from "lit";

html`
  <i18n-provider .i18n=${appI18n}>
    <greeting-banner></greeting-banner>
  </i18n-provider>
`;
```

`<i18n-provider>` is layout-neutral (`display: contents`), so it never affects your page layout. Setting `.i18n` to a new instance re-notifies every subscribed consumer; setting it to `null` goes quiet until a value arrives again — consumers just keep waiting, they don't need to be re-mounted. A request that arrives before `.i18n` is ever set is left unclaimed, so an outer provider further up the tree can still answer it in the meantime.

Because the protocol's only identity mechanism is the context key (`Symbol.for("i18n-facade.I18n")`, exported as `i18nContext`), this interoperates with any protocol-compliant counterpart — e.g. an `@lit/context` provider using the same key — across separate bundle copies and versions. Building your own provider or consumer against the raw protocol? `i18nContext` and the `ContextRequestEvent` class are exported for exactly that.

---

## Resolution order, in one breath

```
middlewares  →  text source  →  namespace defaults  →  bare key
```

- **middlewares** wrap the _entire_ thing (they see defaults, and nested lookups).
- **text source** may itself be decorated — cross-language fallback, per-source reporting — before it ever reports a miss.
- **namespace defaults** are the terminal, so they sit _inside_ the pipeline: middlewares see them too.
- **bare key** is the floor. A string always comes back; `undefined` never escapes.

---

## TypeScript setup

js-lingo is written in TypeScript and ships its types. Two `tsconfig` notes:

```jsonc
{
  "compilerOptions": {
    // "es2024" provides the Intl range-formatting types (formatNumberRange / formatDateTimeRange);
    // "dom" provides MutationObserver for the client <html lang> locale source.
    "lib": ["ES2024", "DOM"],
  },
}
```

Runtime support for everything used here is solid in all current engines — the `lib` bump is purely so the _type_ definitions line up.

---

## API cheat sheet

**Create & configure**

| Function                                       | Purpose                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `createI18n(config?)`                          | Build the instance. Zero-config works.                           |
| `createNamespace({ key, defaults })`           | Define a namespace + its default texts.                          |
| `defaultTextSource(options?)`                  | The built-in text store (bundles, lazy loads, fallback locales). |
| `defaultLocaleSource(options?)`                | Client `<html lang>` monitor, or a server-side tag/getter.       |
| `bundleTexts(texts)`                           | Type-checked `TextBundle`, grouped by locale.                    |
| `someTexts(ns, texts)` / `allTexts(ns, texts)` | Attach partial / complete translations for one locale.           |

**On the `I18n` instance**

| Member                                                      | Purpose                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `text(ns, key[, params])`                                   | Resolve a translation. Params are typed per key.                     |
| `hasText(ns, key, includeFallback?)`                        | Does a translation exist?                                            |
| `bindTexts([ns])`                                           | A standalone lookup, optionally scoped to a namespace.               |
| `formatNumber` · `formatNumberRange` · `numberFormat`       | Number formatting.                                                   |
| `formatDateTime` · `formatDateTimeRange` · `dateTimeFormat` | Date/time formatting.                                                |
| `formatRelativeTime` · `relativeTimeFormat`                 | Relative time ("3 days ago").                                        |
| `formatList` · `listFormat`                                 | List formatting ("a, b, and c").                                     |
| `locale()`                                                  | The active locale tag.                                               |
| `localize(locale?)`                                         | A sibling bound to another locale (or back to dynamic).              |
| `onChange(listener)`                                        | Subscribe to locale/text changes. Returns an idempotent unsubscribe. |

**`js-lingo/message-format`**

| Export             | Purpose                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `` msg`pattern` `` | ICU MessageFormat pattern → `TranslationFn<P>`. Specify `P` explicitly: `` msg<{ count: number }>`...` ``. |

**`js-lingo/react`**

| Export                | Purpose                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `<I18nProvider i18n>` | Provides the instance via React context, and bridges it to any web components in the subtree.   |
| `useI18n(namespace?)` | `{ i18n, t }` — `t` scoped to `namespace` if given, else fully-qualified. Re-renders on change. |
| `useI18nSuspense(source, namespace)` | Like `useI18n(namespace)`, but suspends while `source` (a `TextSource & LoadingAware`) is loading that namespace. |

**`js-lingo/web-components`**

| Export                                | Purpose                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `i18nController(host, i18n?)`         | Lit-style reactive controller — IS an `I18n`, re-renders `host` on change.         |
| `provideI18n(target, i18n)`           | Imperative context-request provider on any `EventTarget`. Returns an unsubscribe.  |
| `<i18n-provider .i18n=${...}>`        | Declarative provider custom element (registered on import). Layout-neutral.        |
| `i18nContext` / `ContextRequestEvent` | Context Community Protocol primitives, for a custom provider/consumer of your own. |

---

## License

MIT © the js-lingo contributors
