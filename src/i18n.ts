/**
 * A lightweight, type-safe i18n facade.
 *
 * The facade type `I18n` fronts a fixed Intl formatting core (the only part that is
 * deliberately NOT configurable) and delegates everything else to two swappable
 * strategies, optionally decorated by middlewares. The config contains strategies
 * and middlewares — nothing else:
 *
 *   - localeSource — which locale is active, and when it changes.
 *   - textSource   — how (locale, namespace, key, params) resolve to a string, and
 *                    when the available texts change (e.g. async resource loads).
 *   - middlewares  — decorate EVERY resolution (pseudo-localization, reporting, ...).
 *
 * Resolution order: middlewares -> textSource -> namespace defaults -> bare key.
 *
 * Namespaces are pure data (`createNamespace({ key, defaults })`): the defaults
 * define the namespace's type (keys + param shapes) AND serve as the texts of last
 * resort — components, including standalone component libraries, work with zero
 * setup. Translations for other locales are attached with the freestanding
 * `someTexts`(partial, the normal case) and `allTexts` (completeness compile-checked).
 *
 * Two decoration layers, by concern:
 *   - TextMiddleware wraps the WHOLE resolution (sees texts from any source AND from
 *     namespace defaults, including nested lookups made by translation functions).
 *     Use for pseudo-localization, request rewriting, hard-miss reporting.
 *   - TextSource combinators wrap ONE source (see its misses directly). Use for
 *     cross-language fallback (`withFallbackLocales`) or per-source miss reporting.
 *
 * Miss policy is owned by the facade: a TextResolver returns a string (including "")
 * for "found" or `undefined` for "miss / not mine". Adapters must do real miss
 * detection — not truthiness.
 *
 * There is no library-owned configurable global state. Instances are created with
 * `createI18n` (zero-config capable) and distributed by the host application — via
 * explicit argument, via the Context Community Protocol, or framework-native DI
 * (e.g. React context).
 *
 * Intl formatters (NumberFormat/DateTimeFormat) are cached module-globally by
 * (kind, locale, options); entries are deterministic values, so this cache is
 * semantically invisible.
 *
 * The ecosystem roles are strictly separated:
 *   - Component authors ship namespaces with defaults (`createNamespace`).
 *   - Translation authors declare and export TextBundles (`bundleTexts` with
 *     `texts`/`allTexts`) — their job ends there; how bundles reach whatever text
 *     source an app uses is none of their concern.
 *   - Apps collect bundles into a source (`defaultTextSource`) or replace it with an
 *     adapter for a third-party i18n library — the first two roles never notice.
 *
 * Typical setup:
 *
 *   // component library
 *   export const datePickerTexts = createNamespace({
 *     key: "date-picker",
 *     defaults: {
 *       today: "Today",
 *       dateRange: (p: { from: Date; to: Date }, i18n) =>
 *         `${i18n.formatDateTime(p.from)} – ${i18n.formatDateTime(p.to)}`,
 *     },
 *   });
 *
 *   // translation module (may live in the component library or in the app)
 *   export const datePickerGerman = bundleTexts({
 *     de: [allTexts(datePickerTexts, { today: "Heute", dateRange: (p, i18n) => `...` })],
 *   });
 *
 *   // app
 *   const i18n = createI18n({
 *     textSource: defaultTextSource({
 *       textBundles: [
 *         datePickerGerman,                                       // static
 *         () => import("./locales/fr.js").then((m) => m.french),  // loaded on first use
 *       ],
 *       fallbackLocales: ["en"],
 *     }),
 *   });
 *   // distribution to custom elements: see the i18n-lit companion module
 */

export {
  allTexts,
  bundleTexts,
  createI18n,
  createNamespace,
  defaultLocaleSource,
  defaultTextSource,
  someTexts,
};

export type {
  DefaultTextSourceOptions,
  I18n,
  I18nConfig,
  Locale,
  LocaleSource,
  Namespace,
  NamespaceKey,
  NamespaceTexts,
  ResolveContext,
  TextBundle,
  TextBundleInput,
  TextKey,
  TextMap,
  TextMiddleware,
  TextRequest,
  TextResolver,
  TextSource,
  TextsOf,
  Translation,
  TranslationFn,
  Unsubscribe,
};

// -------------------------------------------------------------------
// # Types
// -------------------------------------------------------------------

// Primitive aliases
type Locale = string; // NOSONAR // a BCP-47 language tag, e.g. "en-US", "de", "zh-Hant-TW"
type TextKey = string; // NOSONAR // a key within a namespace
type NamespaceKey = string; // NOSONAR // a namespace's `key`
type Unsubscribe = () => void; // returned by subscriptions; idempotent to call
type ChangeListener = () => void; // a i18n-change callback (no arguments)

// A parameterized translation: receives typed params and an I18n facade, returns a
// string. The facade is bound to the locale the text was FOUND in (source hits, incl.
// fallback candidates) or to the requested locale (namespace defaults).
type TranslationFn<T extends Record<string, unknown>> = (params: T, i18n: I18n) => string;

// Extracts the params object type from a TranslationFn. (internal)
type TranslationParams<T> = T extends TranslationFn<infer P> ? P : never;

// Convenience authoring alias:
//   Translation             -> string                     (static text)
//   Translation<{n:number}> -> TranslationFn<{n:number}>  (dynamic text)
type Translation<T extends Record<string, unknown> = never> = [T] extends [never]
  ? string
  : TranslationFn<T>;

// # Namespaces and text maps

// The shape of one namespace's translations: key -> static string | translation fn.
// A namespace's `defaults` object both defines this shape and provides the fallback
// texts of last resort.
type TextMap = Record<string, Translation | Translation<any>>;

// Translations for one locale, derived from the defaults: same keys (all optional —
// anything missing falls back through the pipeline down to the default), same param
// shapes for dynamic texts.
type TextsOf<T extends TextMap> = {
  [K in keyof T]?: T[K] extends TranslationFn<infer P> ? TranslationFn<P> : string;
};

// A typed namespace: pure data — resolution identity (`key`, matched as a string, so
// duplicate module copies in one bundle still interoperate) plus the default texts.
// Texts for other locales are attached with the freestanding `allTexts`/`someTexts`.
type Namespace<T extends TextMap> = Readonly<{
  key: string;
  defaults: Readonly<T>;
}>;

// A namespace paired with texts for one locale, produced by `allTexts`/`someTexts`.
type NamespaceTexts<T extends TextMap> = Readonly<{
  namespace: Namespace<T>;
  texts: TextsOf<T>;
}>;

// Translations grouped by locale, each locale mapping to a list of namespace text groups.
type TextBundle = Record<Locale, NamespaceTexts<any>[]>;

// Partition a TextMap's keys by whether their value is a function.
type TextKeysWithParams<T extends Record<string, unknown>> = {
  [K in keyof T]: T[K] extends TranslationFn<any> ? K : never;
}[keyof T];

type TextKeysWithoutParams<T extends TextMap> = Exclude<keyof T, TextKeysWithParams<T>>;

// # Strategy 1: locale

// Locale strategy: what locale are we in, and notify me when it changes.
type LocaleSource = Readonly<{
  getLocale(): Locale;
  onChange?(listener: ChangeListener): Unsubscribe; // locale changed
}>;

// # Strategy 2: text resolution

type TextRequest = Readonly<{
  locale: Locale;
  namespace: Namespace<any>;
  key: TextKey;
  params: unknown;
}>;

// The room the question is asked in. Second growth spot.
// `localize(locale)` re-enters the FULL pipeline (middlewares included), so nested
// lookups made by translation functions are middleware-visible too. Consequently a
// translation function that looks up its own key recurses forever — don't.
type ResolveContext = Readonly<{
  localize(locale: Locale): I18n;
}>;

// Contract: string (including "") = found. `undefined` = miss / not mine.
type TextResolver = (request: TextRequest, context: ResolveContext) => string | undefined;

// A text strategy = resolver + its own change channel (async resource loads, added
// bundles, ...). The facade merges this with LocaleSource.onChange into I18n.onChange.
type TextSource = Readonly<{
  resolve: TextResolver;
  onChange?(listener: ChangeListener): Unsubscribe; // texts changed
}>;

// Decoration, distinct from replacement. Index 0 = outermost (runs first, delegates
// last). `next()` delegates downstream; `next(patch)` delegates with a rewritten
// request; returning without calling `next` short-circuits. `next() === undefined`
// means a HARD miss: neither the source nor the namespace defaults had the key.
type TextMiddleware = (
  request: TextRequest,
  context: ResolveContext,
  next: (patch?: Partial<TextRequest>) => string | undefined,
) => string | undefined;

// # The facade

// THE central type: text resolution + the fixed Intl formatting core + reactivity.
// `createI18n` returns the dynamic instance (locale follows the LocaleSource);
// `localize(locale)` returns a sibling statically bound to that locale — same
// pipeline, same caches, same change channel. `localize()` leads back to the
// dynamic instance.
type I18n = Readonly<{
  // Overload 1 — static keys (value is a string): no params.
  getText<T extends TextMap, K extends TextKeysWithoutParams<T>>(
    namespace: Namespace<T>,
    key: K,
  ): string;

  // Overload 2 — dynamic keys (value is a TranslationFn): params required, typed to the fn.
  getText<T extends TextMap, K extends TextKeysWithParams<T>>(
    namespace: Namespace<T>,
    key: K,
    params: TranslationParams<T[K]>,
  ): string;

  // Return a standalone getText function. With no namespace it is exactly `getText`.
  // With a namespace it is scoped to it — call `t(key[, params])` — while still
  // accepting a fully-qualified `t(namespace, key[, params])` for any other namespace.
  bindTexts(): {
    <T extends TextMap, K extends TextKeysWithoutParams<T>>(
      namespace: Namespace<T>,
      key: K,
    ): string;
    <T extends TextMap, K extends TextKeysWithParams<T>>(
      namespace: Namespace<T>,
      key: K,
      params: TranslationParams<T[K]>,
    ): string;
  };

  bindTexts<T extends TextMap>(
    namespace: Namespace<T>,
  ): {
    <K extends TextKeysWithoutParams<T>>(key: K): string;
    <K extends TextKeysWithParams<T>>(key: K, params: TranslationParams<T[K]>): string;
    <U extends TextMap, K extends TextKeysWithoutParams<U>>(
      namespace: Namespace<U>,
      key: K,
    ): string;
    <U extends TextMap, K extends TextKeysWithParams<U>>(
      namespace: Namespace<U>,
      key: K,
      params: TranslationParams<U[K]>,
    ): string;
  };

  // The fixed Intl formatting core — deliberately not configurable. Formatter
  // instances are cached and shared; Intl formatters are effectively immutable.
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  numberFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat;
  formatDateTime(value: Date, options?: Intl.DateTimeFormatOptions): string;
  dateTimeFormat(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat;

  getLocale(): Locale;

  // Fires on locale AND text changes, instance-wide: a statically bound sibling
  // notifies on plain locale changes too (over-notification is harmless for the
  // intended "re-render yourself" purpose).
  onChange(listener: ChangeListener): Unsubscribe;

  localize(locale?: Locale): I18n;
}>;

// The config contains strategies and middlewares — nothing else. It neither knows
// nor privileges any concrete implementation.
type I18nConfig = Readonly<{
  // Locale strategy. Default: `defaultLocaleSource()` — the <html lang> monitor on
  // the client, fixed "en-US" elsewhere.
  localeSource?: LocaleSource;

  // Text-resolution strategy — e.g. `defaultTextSource({...})`, a composed source.
  // Default: none — resolution falls through to the namespace defaults.
  textSource?: TextSource;

  // Decorates every resolution. Index 0 is outermost.
  middlewares?: TextMiddleware[];
}>;

// # Default text source (the built-in TextSource)

// One contribution of translations: a bundle, a promise of one (in-flight load), or a
// thunk (invoked lazily on FIRST resolution — loading starts when texts are needed).
type TextBundleInput = TextBundle | Promise<TextBundle> | (() => TextBundle | Promise<TextBundle>);

type DefaultTextSourceOptions = Readonly<{
  textBundles?: TextBundleInput[];
  // Cross-language fallback chain, applied around the store (internally via
  // `withFallbackLocales`). Invalid tags fail loudly at setup.
  fallbackLocales?: Locale[];
}>;

// # Internal storage shapes

type TextValue = string | TranslationFn<any>;
type NamespaceRecord = Record<string, TextValue>; // textKey -> value
type LocaleRecord = Record<string, NamespaceRecord>; // namespaceKey -> NamespaceRecord
type DictionaryStore = Record<string, LocaleRecord>; // locale -> LocaleRecord

// -------------------------------------------------------------------
// # Utility functions
// -------------------------------------------------------------------

function freeze<T extends object>(obj: T): Readonly<T> {
  return Object.freeze(obj);
}

/** Create a null-prototype record so keys like "toString" behave as missing. */
function createRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * normalize(locale) = new Intl.Locale(locale).baseName
 * On an invalid tag (constructor throws), returns the raw input unchanged.
 */
function normalizeLocale(locale: Locale): string {
  try {
    return new Intl.Locale(locale).baseName;
  } catch {
    return locale;
  }
}

// --------------------------------------------------------------------
// # Intl formatter cache (module-global)
// --------------------------------------------------------------------

// Formatters depend ONLY on (kind, locale, options) — deterministic, so sharing them
// across all I18n instances is safe and semantically invisible. Unbounded by design:
// real apps use a handful of option shapes and locales. (Programmatically generated
// option values — e.g. `minimumFractionDigits: i` in a loop — would grow it; don't.)
const formatterCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

/** JSON with sorted keys, so semantically equal option objects share a cache entry. */
function stableStringify(options?: object): string {
  if (!options) return "";
  const record = options as Record<string, unknown>;
  return JSON.stringify(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
}

function cachedNumberFormat(locale: Locale, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cacheKey = `n\u0001${locale}\u0001${stableStringify(options)}`;
  let format = formatterCache.get(cacheKey) as Intl.NumberFormat | undefined;
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    formatterCache.set(cacheKey, format);
  }
  return format;
}

function cachedDateTimeFormat(
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cacheKey = `d\u0001${locale}\u0001${stableStringify(options)}`;
  let format = formatterCache.get(cacheKey) as Intl.DateTimeFormat | undefined;
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(cacheKey, format);
  }
  return format;
}

// --------------------------------------------------------------------
// # Within-language tag chain (used by the default text source)
// --------------------------------------------------------------------

/**
 * Build an ordered, de-duplicated chain of normalized tags, most -> least specific,
 * WITHIN the requested language. Parsing `locale` may throw on an invalid tag; that
 * error propagates to the caller. Cross-LANGUAGE fallback is not a store concern —
 * see `withFallbackLocales`.
 *
 *   "de-CH"      -> ["de-CH", "de"]
 *   "en-US"      -> ["en-US", "en"]
 *   "zh-Hant-TW" -> ["zh-Hant-TW", "zh-TW", "zh"]
 */
function buildLanguageTagChain(locale: Locale): Locale[] {
  const loc = new Intl.Locale(locale); // throws on invalid tag -> propagates
  const chain: string[] = [];
  const seen = new Set<string>();

  const push = (tag: string): void => {
    const normalized = normalizeLocale(tag);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      chain.push(normalized);
    }
  };

  // 1. canonical full tag
  push(loc.baseName);
  // 2. "<language>-<region>" when both present — preferred over the bare language so a
  //    region-specific match wins. Contributes a NEW tag only when a script subtag is
  //    present; otherwise it equals the canonical full tag and is dropped by de-dup.
  if (loc.language && loc.region) {
    push(`${loc.language}-${loc.region}`);
  }
  // 3. bare language subtag
  if (loc.language) {
    push(loc.language);
  }

  return chain;
}

// -------------------------------------------------------------------
// # Default text source — the built-in TextSource
// -------------------------------------------------------------------

/**
 * Resolve a request against a store, narrowing tags within the requested language
 * (de-CH -> de). Returns `undefined` on a miss — the pipeline then falls through
 * (e.g. to fallback locales via `withFallbackLocales`, or to the namespace defaults).
 */
function resolveFromStore(
  store: DictionaryStore,
  request: TextRequest,
  context: ResolveContext,
): string | undefined {
  // Building the chain throws on an invalid requested tag (propagates).
  const chain = buildLanguageTagChain(request.locale);

  for (const candidate of chain) {
    const value = store[candidate]?.[request.namespace.key]?.[request.key];

    if (typeof value === "string") {
      // static -> return immediately
      return value;
    }

    if (typeof value === "function" && request.params != null) {
      // dynamic with params -> invoke with an I18n bound to the FOUND locale.
      // Note: context.localize re-enters the full pipeline (middlewares included).
      return value(request.params, context.localize(candidate));
    }

    // absent, function-without-params, or non-string/non-function -> skip
  }

  return undefined;
}

/** Merge one TextBundle into a store. Returns whether anything was actually added. */
function addBundleToStore(store: DictionaryStore, bundle: TextBundle): boolean {
  let added = false;

  // Merge locale keys that normalize equally, concatenating their arrays.
  const merged = createRecord<NamespaceTexts<any>[]>();
  for (const rawLocale of Object.keys(bundle)) {
    const normalized = normalizeLocale(rawLocale);
    (merged[normalized] ??= []).push(...bundle[rawLocale]); // NOSONAR
  }

  for (const normalized of Object.keys(merged)) {
    const localeRecord = (store[normalized] ??= createRecord<NamespaceRecord>());

    for (const { namespace, texts } of merged[normalized]) {
      const nsRecord = (localeRecord[namespace.key] ??= createRecord<TextValue>());
      for (const key of Object.keys(texts)) {
        const value = (texts as Record<string, TextValue | undefined>)[key];
        if (value === undefined) continue; // explicit undefined must not shadow anything
        nsRecord[key] = value; // last write wins
        added = true;
      }
    }
  }

  return added;
}

/**
 * The built-in TextSource: a store fed by declaratively provided TextBundles.
 * It has no privileged status — it plugs into `I18nConfig.textSource` exactly like
 * any third-party adapter would.
 *
 * Bundle inputs:
 *   - plain bundles are available immediately,
 *   - promises register when they settle (until then, namespace defaults show),
 *   - thunks are invoked lazily on the FIRST resolution — so `() => import(...)`
 *     starts loading only when texts are actually needed.
 * Whenever an async bundle lands, the source's `onChange` fires (merged into
 * `I18n.onChange` by every instance using it) and hosts re-render. A rejected
 * bundle load is reported via console.error and otherwise skipped.
 */
function defaultTextSource(options: DefaultTextSourceOptions = {}): TextSource {
  const store: DictionaryStore = createRecord<LocaleRecord>();
  const changeListeners = new Set<ChangeListener>();
  let pendingThunks: (() => TextBundle | Promise<TextBundle>)[] = [];

  const notifyChange = (): void => {
    for (const listener of [...changeListeners] /* NOSONAR */) listener();
  };

  const acceptAsync = (promise: Promise<TextBundle>): void => {
    promise.then(
      (bundle) => {
        if (addBundleToStore(store, bundle)) {
          notifyChange();
        }
      },
      (reason) => console.error("i18n: loading a text bundle failed", reason),
    );
  };

  for (const input of options.textBundles ?? []) {
    if (typeof input === "function") {
      pendingThunks.push(input); // deferred until first resolution
    } else if (input instanceof Promise) {
      acceptAsync(input);
    } else {
      addBundleToStore(store, input); // no notification needed: nobody subscribed yet
    }
  }

  const invokePendingThunks = (): void => {
    if (pendingThunks.length === 0) return;
    const thunks = pendingThunks;
    pendingThunks = [];
    for (const thunk of thunks) {
      try {
        const result = thunk();
        if (result instanceof Promise) {
          acceptAsync(result);
        } else if (addBundleToStore(store, result)) {
          notifyChange();
        }
      } catch (reason) {
        console.error("i18n: loading a text bundle failed", reason);
      }
    }
  };

  const source: TextSource = freeze({
    resolve: (request, context) => {
      invokePendingThunks(); // first use triggers deferred loads
      return resolveFromStore(store, request, context);
    },

    onChange: (listener: ChangeListener): Unsubscribe => {
      changeListeners.add(listener);
      return () => void changeListeners.delete(listener); // NOSONAR // idempotent
    },
  });

  const fallbacks = options.fallbackLocales;
  return fallbacks?.length ? withFallbackLocales(source, fallbacks) : source;
}

// -------------------------------------------------------------------
// # TextSource combinators
// -------------------------------------------------------------------

/**
 * Decorate a TextSource with a cross-language fallback chain: the requested locale is
 * tried first, then each fallback locale in order. The found candidate travels as
 * `request.locale`, so dynamic translations receive an I18n bound to the locale they
 * were actually found in. Being a SOURCE combinator, this runs before the namespace
 * defaults — the whole chain is exhausted before defaults apply.
 *
 * Invalid fallback tags fail loudly here, at setup — not at the first miss.
 */
function withFallbackLocales(source: TextSource, fallbackLocales: Locale[]): TextSource {
  for (const tag of fallbackLocales) {
    new Intl.Locale(tag); // throws on an invalid tag -> setup-time error
  }
  const fallbacks: readonly Locale[] = freeze([...fallbackLocales]);

  return freeze({
    resolve: (request, context) => {
      for (const candidate of [request.locale, ...fallbacks]) {
        const req =
          candidate === request.locale ? request : freeze({ ...request, locale: candidate });
        const hit = source.resolve(req, context);
        if (hit !== undefined) {
          return hit;
        }
      }
      return undefined;
    },

    // Forward the change channel of the wrapped source.
    ...(source.onChange && {
      onChange: (listener: ChangeListener): Unsubscribe => source.onChange!(listener), // NOSONAR
    }),
  });
}

// -------------------------------------------------------------------
// # Text-resolution pipeline: middlewares -> textSource -> defaults
// -------------------------------------------------------------------

/**
 * Terminal resolver of last resort: the namespace's own default texts. Dynamic
 * defaults are invoked with an I18n bound to the REQUESTED locale (data formatting in
 * the user's conventions inside default-language text); a default author who needs a
 * fixed locale can use `i18n.localize("en")` inside the function body.
 */
function resolveFromDefaults(request: TextRequest, context: ResolveContext): string | undefined {
  const value = (request.namespace.defaults as Record<string, TextValue | undefined>)[request.key];

  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "function" && request.params != null) {
    return value(request.params, context.localize(request.locale));
  }
  return undefined;
}

/**
 * Compose the middleware chain around the text source and the defaults terminal.
 * Index 0 is outermost. `next(patch)` merges the patch over the current request
 * (last write wins) before delegating; `next()` delegates with the request unchanged.
 * Because the defaults terminal sits INSIDE the pipeline, middlewares (e.g.
 * pseudo-localization) see default-resolved texts too; `next() === undefined`
 * therefore signals a HARD miss (no source hit AND no default).
 */
function composePipeline(
  textSource: TextSource | undefined,
  middlewares: readonly TextMiddleware[],
  context: ResolveContext,
): (request: TextRequest) => string | undefined {
  const terminal: TextResolver = (request, ctx) => {
    const fromSource = textSource?.resolve(request, ctx);
    return fromSource !== undefined ? fromSource : resolveFromDefaults(request, ctx);
  };

  return (request) => {
    const dispatch = (index: number, req: TextRequest): string | undefined => {
      if (index < middlewares.length) {
        return middlewares[index](req, context, (patch) =>
          dispatch(index + 1, patch ? freeze({ ...req, ...patch }) : req),
        );
      }
      return terminal(req, context);
    };

    return dispatch(0, request);
  };
}

// -------------------------------------------------------------------
// # Translation validation
// -------------------------------------------------------------------

/**
 * Validate a translation against its namespace's defaults — the runtime twin of the
 * compile-time checks, so plain-JS callers get the same guarantees, and TypeScript
 * callers get a readable error at the declaration site instead of a silent no-op.
 *
 * Reports (all at once, in one TypeError): keys absent from the defaults, values whose
 * kind disagrees with the default (string vs. function), and — when `full` — missing
 * keys. An explicit `undefined` counts as "not provided", matching the store, which
 * skips it so it never shadows anything.
 */
function checkTexts(
  fn: string,
  namespace: Namespace<any>,
  texts: Record<string, unknown>,
  full: boolean,
): void {
  const quote = (keys: string[]) =>
    keys
      .sort()
      .map((key) => `"${key}"`)
      .join(", ");

  const defaults = namespace.defaults as Record<string, unknown>;
  const given = Object.keys(texts).filter((key) => texts[key] !== undefined);
  const issues: string[] = [];

  const unknown = given.filter((key) => !Object.hasOwn(defaults, key));
  if (unknown.length) {
    issues.push(`unknown keys [${quote(unknown)}]`);
  }

  const mismatched = given
    .filter((key) => Object.hasOwn(defaults, key) && typeof texts[key] !== typeof defaults[key])
    .map((key) => `"${key}" (expected ${typeof defaults[key]}, got ${typeof texts[key]})`);
  if (mismatched.length) {
    issues.push(`kind mismatches [${mismatched.sort().join(", ")}]`);
  }

  if (full) {
    const missing = Object.keys(defaults).filter((key) => texts[key] === undefined);
    if (missing.length) issues.push(`missing keys [${quote(missing)}]`);
  }

  if (issues.length)
    throw new TypeError(`i18n: ${fn} for namespace "${namespace.key}": ${issues.join("; ")}`);
}

// -------------------------------------------------------------------
// # Default locale source: client detection + document-lang monitor
// -------------------------------------------------------------------

// We are in the browser or a fake testing browser.
function isClientSide(g = globalThis): boolean {
  return !!g.window?.MutationObserver && !!g.document?.documentElement;
}

/**
 * The client-side locale source: watches `<html lang>`. `getLocale` reads the live
 * attribute (falling back to `defaultLocale` when absent); `onChange` is driven by a
 * MutationObserver on it.
 */
function createDocumentLangMonitor(defaultLocale: Locale, g = globalThis): LocaleSource {
  let listeners: ChangeListener[] = [];

  const observer = new g.MutationObserver(() => {
    for (const listener of [...listeners] /* NOSONAR */) {
      listener();
    }
  });

  observer.observe(g.document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });

  return freeze({
    getLocale: () => g.document.documentElement.getAttribute("lang") ?? defaultLocale,
    onChange: (listener: ChangeListener) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((it) => it !== listener);
      };
    },
  });
}

/** Accept the shorthand forms of a locale source: a fixed tag or a plain getter. */
function toLocaleSource(input: Locale | (() => Locale) | LocaleSource): LocaleSource {
  if (typeof input === "string") {
    return freeze({ getLocale: () => input });
  }
  if (typeof input === "function") {
    return freeze({ getLocale: input });
  }
  return input;
}

/**
 * The default LocaleSource — also used by `createI18n` when no `localeSource` is
 * configured. On the client it is the `<html lang>` monitor (not configurable — a
 * client app wanting something else writes its own LocaleSource). Elsewhere (no DOM)
 * it is `serverSide`, accepted as a fixed tag (SSG), a getter (e.g. per-request via
 * AsyncLocalStorage), or a full LocaleSource (own change channel).
 *
 * `defaultLocale` answers when nothing is detectable: the `lang` attribute is absent
 * (client) or no `serverSide` was given (elsewhere). Default: "en-US".
 */
function defaultLocaleSource(
  options: Readonly<{
    defaultLocale?: Locale;
    serverSide?: Locale | (() => Locale) | LocaleSource;
  }> = {},
): LocaleSource {
  const defaultLocale = options.defaultLocale ?? "en-US";

  if (isClientSide()) {
    return createDocumentLangMonitor(defaultLocale);
  }
  return options.serverSide
    ? toLocaleSource(options.serverSide)
    : freeze({ getLocale: () => defaultLocale });
}

// -------------------------------------------------------------------
// # The facade factory
// -------------------------------------------------------------------

/**
 * Create an I18n facade. Zero-config works: `defaultLocaleSource()` as the locale,
 * resolution straight to the namespace defaults.
 * Returns the DYNAMIC instance; `localize(locale)` yields statically bound siblings
 * sharing the same pipeline, caches, and change channel.
 */
function createI18n(config: I18nConfig = {}): I18n {
  const localeSource = config.localeSource ?? defaultLocaleSource();
  const textSource = config.textSource;
  const middlewares: readonly TextMiddleware[] = freeze([...(config.middlewares ?? [])]);

  const changeListeners = new Set<ChangeListener>();
  const instanceCache = new Map<string | null, I18n>(); // null -> the dynamic instance

  // The room every resolution is asked in; re-enters the full pipeline.
  const context: ResolveContext = freeze({
    localize: (locale: Locale) => getOrCreateInstance(locale),
  });

  const runPipeline = composePipeline(textSource, middlewares, context);

  // Bridge BOTH strategies' change channels into the shared listener set.
  const fanOut = (): void => {
    for (const listener of [...changeListeners] /* NOSONAR */) listener();
  };
  localeSource.onChange?.(fanOut); // locale changed
  textSource?.onChange?.(fanOut); // texts changed (e.g. async resources arrived)

  function getOrCreateInstance(locale: Locale | null): I18n {
    let instance = instanceCache.get(locale);
    if (!instance) {
      instance = createFacade(locale ? () => locale : () => localeSource.getLocale());
      instanceCache.set(locale, instance);
    }
    return instance;
  }

  function createFacade(getLocale: () => Locale): I18n {
    // Facade-owned miss policy: `undefined` from the pipeline -> the key itself.
    // (`??`, not `||`: an empty string is a valid translation.) With defaults on the
    // namespace, the bare key only ever appears for keys that have no default —
    // which the getText overloads rule out at compile time.
    const getText: I18n["getText"] = (namespace: any, key: any, params?: any) =>
      runPipeline(freeze({ locale: getLocale(), namespace, key: key as string, params })) ??
      (key as string);

    const bindTexts: I18n["bindTexts"] = (boundNs?: Namespace<any>) => {
      const lookup = getText as (ns: any, key: any, params?: any) => string;

      return (a: unknown, b?: unknown, c?: unknown): string =>
        boundNs && typeof a === "string" ? lookup(boundNs, a, b) : lookup(a, b, c);
    };

    return freeze({
      getText,
      bindTexts,
      formatNumber: (value, options?) => cachedNumberFormat(getLocale(), options).format(value),
      numberFormat: (options) => cachedNumberFormat(getLocale(), options),
      formatDateTime: (value, options) => cachedDateTimeFormat(getLocale(), options).format(value),
      dateTimeFormat: (options) => cachedDateTimeFormat(getLocale(), options),
      getLocale: () => getLocale(),
      onChange: (listener: ChangeListener): Unsubscribe => {
        changeListeners.add(listener);
        return () => void changeListeners.delete(listener); // NOSONAR // idempotent
      },
      localize: (locale?: Locale) => getOrCreateInstance(locale ?? null),
    });
  }

  return getOrCreateInstance(null);
}

// -------------------------------------------------------------------
// # Namespaces and bundles
// -------------------------------------------------------------------

/**
 * Create a namespace from its default texts. The defaults define the namespace's
 * shape (keys + param types) AND serve as the resolution terminal — a component
 * library shipping a namespace works without any app cooperation. Namespaces are
 * pure data; translations for other locales are attached with the freestanding
 * `allTexts` / `someTexts`.
 */
function createNamespace<T extends TextMap>(params: { key: string; defaults: T }): Namespace<T> {
  return freeze({
    key: params.key,
    defaults: freeze({ ...params.defaults }),
  });
}

/**
 * Type-safe identity for a standalone-declared TextBundle: errors surface at the
 * declaration site (with precise key/param locations) instead of at a distant
 * consumer (e.g. a `defaultTextSource({ textBundles: [...] })` call in another
 * module). Not needed when passing a literal there directly.
 */
function bundleTexts<T extends TextBundle>(texts: T): TextBundle {
  return texts;
}

/** Attach texts for one locale — partial (missing keys fall back to the defaults). */
function someTexts<T extends TextMap>(
  namespace: Namespace<T>,
  texts: TextsOf<T>,
): NamespaceTexts<T> {
  checkTexts("someTexts", namespace, texts as Record<string, unknown>, false);
  return freeze({ namespace, texts });
}

/** Like `someTexts`, but every key must be present (checked at compile time AND runtime). */
function allTexts<T extends TextMap>(
  namespace: Namespace<T>,
  texts: Required<TextsOf<T>>,
): NamespaceTexts<T> {
  checkTexts("allTexts", namespace, texts as Record<string, unknown>, true);
  return freeze({ namespace, texts });
}
