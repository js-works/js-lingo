# js-lingo

A lightweight, type-safe i18n **facade** for TypeScript — plain values instead of a
message DSL, swappable strategies instead of a built-in framework, and `Intl` as the
one thing that is deliberately not configurable.

```ts
const datePickerTexts = createNamespace({
  key: "date-picker",
  defaults: {
    today: "Today",
    dateRange: (p: { from: Date; to: Date }, i18n) =>
      `${i18n.formatDateTime(p.from)} – ${i18n.formatDateTime(p.to)}`,
  },
});

const i18n = createI18n();
i18n.getText(datePickerTexts, "today"); // "Today"
i18n.getText(datePickerTexts, "dateRange", { from, to }); // typed params, checked at compile time
i18n.formatNumber(1234.5); // Intl, in the active locale
```

No setup was needed for the code above: with zero configuration, the active locale
follows `<html lang>` (on the client) and every namespace carries its own default
texts. Everything beyond that — where the locale comes from, where translations come
from — is a strategy you plug in.

## Why a facade?

Most i18n libraries want to _be_ your internationalization layer. This one fronts it:

- **A fixed `Intl` core.** `formatNumber`, `numberFormat`, `formatDateTime`,
  `dateTimeFormat` — thin, cached wrappers over `Intl.NumberFormat` and
  `Intl.DateTimeFormat`. Using `Intl` (directly or indirectly) is the only reasonable
  choice in JavaScript, so this part is intentionally not configurable.
- **Two swappable strategies.** _Where am I?_ (`localeSource`) and _what do texts
  resolve to?_ (`textSource`). The built-in implementations have no privileged
  status — an adapter for i18next, FormatJS, or your backend plugs into the exact
  same slots.
- **One decoration slot.** `middlewares` wrap every resolution — pseudo-localization,
  missing-text reporting, request rewriting — regardless of which source is active.

The config is the whole architecture:

```ts
type I18nConfig = Readonly<{
  localeSource?: LocaleSource; // strategy 1 — default: <html lang> monitor
  textSource?: TextSource; // strategy 2 — default: none (namespace defaults apply)
  middlewares?: TextMiddleware[]; // decoration — index 0 is outermost
}>;
```

Resolution order: `middlewares → textSource → namespace defaults → bare key`.

There is **no library-owned global state**. You create instances with `createI18n`
and distribute them yourself — via argument, framework DI (React context and friends),
or the Context Community Protocol for custom elements (see below).

## Three roles, strictly separated

The API is shaped around who does what:

**Component authors** ship a namespace whose defaults define both the type (keys and
parameter shapes) and the texts of last resort. A component works in any app with
zero cooperation — untranslated, but never broken:

```ts
export const datePickerTexts = createNamespace({
  key: "date-picker",
  defaults: {
    today: "Today",
    dateRange: (p: { from: Date; to: Date }, i18n) =>
      `${i18n.formatDateTime(p.from)} – ${i18n.formatDateTime(p.to)}`,
  },
});
```

**Translation authors** declare and export bundles. Their job ends there — how
bundles reach whatever text source an app uses is none of their concern:

```ts
export const datePickerGerman = bundleTexts({
  de: [
    allTexts(datePickerTexts, {
      today: "Heute",
      dateRange: (p, i18n) => `${i18n.formatDateTime(p.from)} – ${i18n.formatDateTime(p.to)}`,
    }),
  ],
});
```

`texts(namespace, {...})` is the normal, _partial_ form — anything missing falls back
to the defaults. `allTexts(namespace, {...})` additionally makes the compiler verify
completeness; use it for translations that claim to cover everything, e.g. the locale
bundles a component library ships. `bundleTexts` is a type-checking identity so that
errors surface at the declaration site instead of at a distant consumer.

**Apps** collect bundles into a source — or replace the source entirely:

```ts
const i18n = createI18n({
  textSource: defaultTextSource({
    textBundles: [
      datePickerGerman, // available immediately
      fetchTenantTexts(), // a promise — registers when it settles
      () => import("./locales/fr.js").then((m) => m.french), // a thunk — loaded on first use
    ],
    fallbackLocales: ["en"],
  }),
});
```

While an async bundle is in flight, the namespace defaults show; when it lands, the
instance's `onChange` fires and subscribed hosts re-render. Nothing is ever broken,
only briefly untranslated.

## The facade at a glance

`createI18n` returns the _dynamic_ instance — its locale follows the `localeSource`.
`i18n.localize("de")` returns a memoized sibling statically bound to `de`, sharing the
same pipeline, caches, and change channel; `sibling.localize()` leads back to the
dynamic instance.

```ts
i18n.getLocale(); // active locale
i18n.onChange(() => rerender()); // fires on locale AND text changes
const t = i18n.bindTexts(datePickerTexts);
t("today"); // scoped shorthand
t(otherTexts, "someKey"); // fully-qualified escape hatch
```

Miss policy is owned by the facade: a resolver returns a string (the empty string is
a valid translation!) or `undefined` for "miss". Because defaults live on the
namespace, a bare key can only ever appear for keys that have no default — which the
`getText` overloads already rule out at compile time.

## Locale sources

The default locale source watches `<html lang>` on the client (live, via
MutationObserver). Where there is no DOM, you tell it what to do instead:

```ts
createI18n({
  localeSource: defaultLocaleSource({
    serverSide: () => requestContext.getStore()?.locale ?? "en-US", // per-request
    defaultLocale: "en-US",
  }),
});
```

`serverSide` accepts a fixed tag (static builds), a getter (per-request, e.g. via
`AsyncLocalStorage`), or a full `LocaleSource` with its own change channel. Any other
behavior — language negotiation, user preferences, query parameters — is a
`LocaleSource` you write yourself: it is just `{ getLocale, onChange? }`.

Note the separation this enforces: **fallback never changes where the user _is_** —
if a German translation is missing and English text substitutes, dates and numbers
still format German. Cross-language fallback is a _text_ concern, not a _locale_
concern.

## Text sources, combinators, adapters

A text source is `{ resolve, onChange? }` where `resolve` returns a string or
`undefined`. That is the entire integration contract. An i18next adapter, sketched:

```ts
const i18n = createI18n({
  localeSource: {
    getLocale: () => i18next.language,
    onChange: (listener) => {
      i18next.on("languageChanged", listener);
      return () => i18next.off("languageChanged", listener);
    },
  },
  textSource: {
    resolve: ({ locale, namespace, key, params }) =>
      i18next.exists(`${namespace.key}:${key}`, { lng: locale })
        ? i18next.t(`${namespace.key}:${key}`, { lng: locale, ...(params as object) })
        : undefined, // real miss detection — falls through to the namespace defaults
    onChange: (listener) => {
      i18next.store.on("added", listener); // async resources -> re-render
      return () => i18next.store.off("added", listener);
    },
  },
});
```

Sources compose. `withFallbackLocales(source, ["en", "fr"])` wraps _any_ source with a
cross-language fallback chain: the requested locale is tried first, then each
fallback; the found candidate travels on as `request.locale`, so dynamic translations
format with the locale they were actually found in. The chain is exhausted before
namespace defaults apply. (`defaultTextSource` uses this combinator internally for
its `fallbackLocales` option.)

## Middlewares

Middlewares decorate the whole pipeline — they see texts from any source _and_ from
namespace defaults, including nested lookups made by translation functions:

```ts
createI18n({
  textSource,
  middlewares: [
    // pseudo-localization for UI testing
    (request, context, next) => (pseudo ? toPseudo(next()) : next()),
    // hard-miss reporting (`undefined` = neither source nor defaults had the key)
    (request, context, next) => {
      const resolved = next();
      if (resolved === undefined) report(request);
      return resolved;
    },
    // request rewriting
    (request, context, next) => next(request.locale === "nb" ? { locale: "no" } : undefined),
  ],
});
```

Rule of thumb for the two decoration layers: middlewares wrap the _pipeline_
(everything, uniformly), source combinators wrap _one source_ (and see its misses
directly — the right place for "translated vs. defaulted" coverage reporting).

## Custom elements (Lit-friendly, Lit-free)

The companion module distributes instances to web components via the
[Context Community Protocol](https://github.com/webcomponents-cg/community-protocols/blob/main/proposals/context.md) —
dependency-free, interoperable with any protocol-compliant counterpart such as
`@lit/context` (consumers and providers only share the `context-request` event and
the exported `i18nContext` key).

Inside a component, the reactive controller _is_ an `I18n` and re-renders its host on
locale or text changes:

```ts
class FancyDatePicker extends LitElement {
  private i18n = i18nController(this);

  render() {
    return html`<button>${this.i18n.getText(datePickerTexts, "today")}</button>`;
  }
}
```

It resolves its instance in three stages — explicit argument, then a provider up the
tree, then an internal zero-config fallback — so the component works in every app,
provider or not.

The app provides its instance declaratively or imperatively:

```html
<i18n-provider .i18n="${appI18n}">
  <fancy-date-picker></fancy-date-picker>
</i18n-provider>
```

```ts
provideI18n(document.body, appI18n); // app-wide
```

Late providers are handled gracefully: a value-less `<i18n-provider>` does not claim
requests (an outer provider may serve meanwhile) but remembers subscribers and
answers as soon as its value arrives — consumers keep the latest answer.

## Server-side rendering

The core has no DOM dependency. Instances are cheap; the module-global `Intl`
formatter cache and your text sources are shared across them, so per-request
instances are a natural fit:

```ts
const i18nForRequest = createI18n({
  localeSource: { getLocale: () => request.locale },
  textSource: sharedTextSource,
});
```

Alternatively, keep one shared instance and use `defaultLocaleSource({ serverSide })`
with an `AsyncLocalStorage`-backed getter. The custom-element module also imports
cleanly without a DOM (element registration is skipped).

## Type safety

The namespace defaults are the single source of truth. From them, the compiler
derives everything:

```ts
i18n.getText(datePickerTexts, "today"); // ok — static key, no params
i18n.getText(datePickerTexts, "today", { x: 1 }); // error — static keys take no params
i18n.getText(datePickerTexts, "dateRange"); // error — params required
i18n.getText(datePickerTexts, "dateRange", { from: 1 }); // error — wrong param shape
i18n.getText(datePickerTexts, "tdoay"); // error — unknown key
texts(datePickerTexts, { today: "Heute" }); // ok — partial by design
allTexts(datePickerTexts, { today: "Heute" }); // error — completeness required
```

No codegen, no message DSL, no string parsing: translations are plain strings and
plain functions.

## Design principles

- **The config contains strategies and middlewares — nothing else.** It neither
  knows nor privileges any concrete implementation; the built-in source and locale
  monitor plug into the same slots an adapter would.
- **No configurable global state.** The only module-level state is a deterministic
  `Intl` formatter cache and an immutable zero-config fallback instance.
- **Defaults make components self-sufficient.** A component library needs no app
  cooperation to function, and no registration step for its source language.
- **Found-locale formatting.** A translation found via fallback formats with the
  locale it was found in; the user's locale governs everything else.
- **Pure data at the boundaries.** Namespaces, bundles, and requests are frozen
  values; behavior lives in the facade, sources, and combinators around them.

## Development

```sh
npm test               # vitest, node + jsdom environments
npm test -- --coverage # enforced thresholds; currently at 100 % on both modules
```

## License

MIT
