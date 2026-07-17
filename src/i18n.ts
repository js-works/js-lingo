/**
 * A lightweight, type-safe i18n facade (also usable as standalone i18n library).
 *
 * The facade type `I18n` fronts a fixed Intl formatting core (the only part that is
 * deliberately NOT configurable) and delegates everything else to two swappable
 * strategies, optionally decorated by middlewares — the config contains nothing else:
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
 * `someTexts` (partial, the normal case) and `allTexts` (completeness compile-checked).
 *
 * Two decoration layers, by concern:
 *   - TextMiddleware wraps the WHOLE resolution (sees texts from any source AND from
 *     namespace defaults, including nested lookups made by translation functions).
 *   - TextSource combinators wrap ONE source (see its misses directly), e.g.
 *     cross-language fallback (`withFallbackLocales`) or per-source miss reporting.
 *
 * Miss policy is owned by the facade: a TextResolver returns a string (including "")
 * for "found" or `undefined` for "miss / not mine". Adapters must do real miss
 * detection — not truthiness.
 *
 * There is no library-owned configurable global state. Instances are created with
 * `createI18n` (zero-config capable) and distributed by the host application — via
 * explicit argument, via the Context Community Protocol, or framework-native DI
 * (e.g. React context). Intl formatters are cached module-globally, but as
 * deterministic values that cache is semantically invisible.
 *
 * The ecosystem roles are strictly separated:
 *   - Component authors ship namespaces with defaults (`createNamespace`).
 *   - Translation authors declare and export TextBundles (`bundleTexts` with
 *     `someTexts`/`allTexts`) — how bundles reach whatever text source an app uses
 *     is none of their concern.
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
  BoundTexts,
  ChangeNotifier,
  DateTimeFormatter,
  DefaultTextSourceOptions,
  I18n,
  I18nConfig,
  ListFormatter,
  Locale,
  LocaleAware,
  LocaleSource,
  Namespace,
  NamespaceKey,
  NamespaceTexts,
  NumberFormatter,
  RelativeTimeFormatter,
  ResolveContext,
  TextAccess,
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
  UnboundTexts,
  Unsubscribe,
};

// # Types ---------------------------------------------------------------------------

// Primitive aliases
type Locale = string; // NOSONAR // a BCP-47 language tag, e.g. "en-US", "de", "zh-Hant-TW"
type TextKey = string; // NOSONAR // a key within a namespace
type NamespaceKey = string; // NOSONAR // a namespace's `key`
type Unsubscribe = () => void; // returned by subscriptions; idempotent to call
type ChangeListener = () => void;

// A parameterized translation: typed params + an I18n facade -> string. The facade is
// bound to the locale the text was FOUND in (source hits, incl. fallback candidates)
// or to the requested locale (namespace defaults).
type TranslationFn<T extends Record<string, unknown>> = (params: T, i18n: I18n) => string;

// Extracts the params object type from a TranslationFn. (internal)
type TranslationParams<T> = T extends TranslationFn<infer P> ? P : never;

// Authoring alias: `Translation` = string (static), `Translation<{n:number}>` = fn (dynamic).
type Translation<T extends Record<string, unknown> = never> = [T] extends [never]
  ? string
  : TranslationFn<T>;

// One namespace's shape: key -> static string | translation fn. A namespace's
// `defaults` object both defines this shape and provides the texts of last resort.
type TextMap = Record<string, Translation | Translation<any>>;

// Translations for one locale, derived from the defaults: same keys (all optional —
// anything missing falls through the pipeline down to the default), same param shapes.
type TextsOf<T extends TextMap> = {
  [K in keyof T]?: T[K] extends TranslationFn<infer P> ? TranslationFn<P> : string;
};

// A typed namespace: pure data — resolution identity (`key`, matched as a string, so
// duplicate module copies in one bundle still interoperate) plus the default texts.
type Namespace<T extends TextMap> = Readonly<{
  key: string;
  defaults: Readonly<T>;
}>;

// A namespace paired with texts for one locale, produced by `allTexts`/`someTexts`.
type NamespaceTexts<T extends TextMap> = Readonly<{
  namespace: Namespace<T>;
  texts: TextsOf<T>;
}>;

// Translations grouped by locale. Each locale maps to one namespace group, or a list
// of them when the locale carries translations for several namespaces at once.
type TextBundle = Record<Locale, NamespaceTexts<any> | NamespaceTexts<any>[]>;

// Partition a TextMap's keys by whether their value is a function.
type TextKeysWithParams<T extends Record<string, unknown>> = {
  [K in keyof T]: T[K] extends TranslationFn<any> ? K : never;
}[keyof T];
type TextKeysWithoutParams<T extends TextMap> = Exclude<keyof T, TextKeysWithParams<T>>;

// `bindTexts()` (no namespace): a fully-qualified lookup, exactly like `text`.
type UnboundTexts = {
  <T extends TextMap, K extends TextKeysWithoutParams<T>>(namespace: Namespace<T>, key: K): string;
  <T extends TextMap, K extends TextKeysWithParams<T>>(
    namespace: Namespace<T>,
    key: K,
    params: TranslationParams<T[K]>,
  ): string;
};

// `bindTexts(namespace)`: scoped to T — call `t(key[, params])` — while still
// accepting a fully-qualified `t(otherNamespace, key[, params])` for any other.
type BoundTexts<T extends TextMap> = {
  <K extends TextKeysWithoutParams<T>>(key: K): string;
  <K extends TextKeysWithParams<T>>(key: K, params: TranslationParams<T[K]>): string;
  <U extends TextMap, K extends TextKeysWithoutParams<U>>(namespace: Namespace<U>, key: K): string;
  <U extends TextMap, K extends TextKeysWithParams<U>>(
    namespace: Namespace<U>,
    key: K,
    params: TranslationParams<U[K]>,
  ): string;
};

// # Strategies ----------------------------------------------------------------------

// Locale strategy: what locale are we in, and notify me when it changes.
type LocaleSource = Readonly<{
  getLocale(): Locale;
  onChange?(listener: ChangeListener): Unsubscribe; // locale changed
}>;

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

// A text strategy = resolver + its own change channel (async resource loads, ...).
// The facade merges this with LocaleSource.onChange into I18n.onChange.
// `resolveExact` is an optional fast path used by `hasText(ns, key, false)`: it checks
// only the current locale (within-language narrowing included) without going through
// any fallback-locale combinator or namespace defaults. Third-party adapters that
// cannot efficiently support it can omit it — `hasText(false)` will return false when
// it is absent.
type TextSource = Readonly<{
  resolve: TextResolver;
  resolveExact?(locale: Locale, namespace: Namespace<any>, key: TextKey): string | undefined;
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

// # The facade ----------------------------------------------------------------------
//
// The facade is assembled from small, single-concern capability types, so a caller
// can depend on only the slice it uses — e.g. a formatting helper takes
// `NumberFormatter & DateTimeFormatter` rather than the whole `I18n`.

// Text resolution: the typed lookup plus its standalone/bound variants.
type TextAccess = Readonly<{
  // Overload 1 — static keys (value is a string): no params.
  text<T extends TextMap, K extends TextKeysWithoutParams<T>>(
    namespace: Namespace<T>,
    key: K,
  ): string;

  // Overload 2 — dynamic keys (value is a TranslationFn): params required, typed to the fn.
  text<T extends TextMap, K extends TextKeysWithParams<T>>(
    namespace: Namespace<T>,
    key: K,
    params: TranslationParams<T[K]>,
  ): string;

  // A standalone text-lookup function: without a namespace exactly `text`
  // (`UnboundTexts`); with one scoped to it, while still accepting a fully-qualified
  // `t(namespace, key[, params])` for any other (`BoundTexts<T>`).
  bindTexts(): UnboundTexts;
  bindTexts<T extends TextMap>(namespace: Namespace<T>): BoundTexts<T>;

  // Check whether a translation exists for the given key.
  // `includeFallback: false` (default) — true only when the textSource has a hit for
  // the current locale (within-language narrowing included, fallback locales and
  // namespace defaults excluded). Use to detect whether a real translation is present.
  // `includeFallback: true` — runs the full pipeline (fallback locales + defaults);
  // true whenever `text()` would return something other than the bare key.
  hasText<T extends TextMap, K extends keyof T>(
    namespace: Namespace<T>,
    key: K,
    includeFallback?: boolean,
  ): boolean;
}>;

// Locale identity and locale-scoped siblings. `locale()` reports the active locale;
// `localize(locale)` returns a sibling statically bound to that locale — same
// pipeline, same caches, same change channel — and `localize()` leads back to the
// dynamic instance.
type LocaleAware = Readonly<{
  locale(): Locale;
  localize(locale?: Locale): I18n;
}>;

// Subscribe to instance-wide change. Fires on locale AND text changes: a statically
// bound sibling notifies on plain locale changes too (over-notification is harmless
// for the intended "re-render yourself" purpose).
type ChangeNotifier = Readonly<{
  onChange(listener: ChangeListener): Unsubscribe;
}>;

// The fixed Intl number-formatting core — deliberately not configurable. Formatter
// instances are cached and shared; Intl formatters are effectively immutable.
type NumberFormatter = Readonly<{
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  formatNumberRange(start: number, end: number, options?: Intl.NumberFormatOptions): string;
  numberFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat;
}>;

// The fixed Intl date/time-formatting core — see NumberFormatter.
type DateTimeFormatter = Readonly<{
  formatDateTime(value: Date, options?: Intl.DateTimeFormatOptions): string;
  formatDateTimeRange(start: Date, end: Date, options?: Intl.DateTimeFormatOptions): string;
  dateTimeFormat(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat;
}>;

// Locale-aware relative time: "3 days ago", "in 2 weeks".
type RelativeTimeFormatter = Readonly<{
  formatRelativeTime(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ): string;
  relativeTimeFormat(options?: Intl.RelativeTimeFormatOptions): Intl.RelativeTimeFormat;
}>;

// Locale-aware list formatting: "apples, bananas, and oranges" / "apples or bananas".
type ListFormatter = Readonly<{
  formatList(list: Iterable<string>, options?: Intl.ListFormatOptions): string;
  listFormat(options?: Intl.ListFormatOptions): Intl.ListFormat;
}>;

// THE central type, assembled from the capability types above. `createI18n` returns
// the dynamic instance (locale follows the LocaleSource); `localize(locale)` returns
// a statically bound sibling.
type I18n = TextAccess &
  LocaleAware &
  ChangeNotifier &
  NumberFormatter &
  DateTimeFormatter &
  RelativeTimeFormatter &
  ListFormatter;

// The config contains strategies and middlewares — nothing else. It neither knows
// nor privileges any concrete implementation.
type I18nConfig = Readonly<{
  // Default: `defaultLocaleSource()` — <html lang> monitor on the client, "en-US" elsewhere.
  localeSource?: LocaleSource;
  // Default: none — resolution falls through to the namespace defaults.
  textSource?: TextSource;
  // Decorates every resolution. Index 0 is outermost.
  middlewares?: TextMiddleware[];
}>;

// One contribution of translations: a bundle, a promise of one (in-flight load), or a
// thunk (invoked lazily on FIRST resolution — loading starts when texts are needed).
type TextBundleInput = TextBundle | Promise<TextBundle> | (() => TextBundle | Promise<TextBundle>);

type DefaultTextSourceOptions = Readonly<{
  textBundles?: TextBundleInput[];
  // Cross-language fallback chain (via `withFallbackLocales`); invalid tags fail loudly at setup.
  fallbackLocales?: Locale[];
}>;

// Internal storage shapes: locale -> namespaceKey -> textKey -> value.
type TextValue = string | TranslationFn<any>;
type NamespaceRecord = Record<string, TextValue>;
type LocaleRecord = Record<string, NamespaceRecord>;
type DictionaryStore = Record<string, LocaleRecord>;

// # Utility functions ---------------------------------------------------------------

function freeze<T extends object>(obj: T): Readonly<T> {
  return Object.freeze(obj);
}

/** Create a null-prototype record so keys like "toString" behave as missing. */
function createRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** A change-listener registry: `add` returns an idempotent unsubscribe. */
function createListeners(): Readonly<{
  add(listener: ChangeListener): Unsubscribe;
  notify(): void;
}> {
  const listeners = new Set<ChangeListener>();
  return freeze({
    add: (listener: ChangeListener): Unsubscribe => {
      listeners.add(listener);
      return () => void listeners.delete(listener); // NOSONAR // idempotent
    },
    // Iterate a copy: listeners may (un)subscribe during notification.
    notify: (): void => {
      for (const listener of [...listeners] /* NOSONAR */) listener();
    },
  });
}

/** Project a parsed tag; on an invalid one (parsing throws) return the raw input. */
function parseLocale(locale: Locale, project: (loc: Intl.Locale) => string): string {
  try {
    return project(new Intl.Locale(locale));
  } catch {
    return locale;
  }
}

/** Storage/de-dup identity: `baseName` (case-normalized, extensions dropped). */
function normalizeLocale(locale: Locale): string {
  return parseLocale(locale, (loc) => loc.baseName);
}

/**
 * Instance-cache identity: the FULL tag case-normalized, extensions preserved —
 * "en-US-u-nu-arab" and "en-US" format differently and must not share a facade.
 */
function canonicalLocale(locale: Locale): string {
  return parseLocale(locale, (loc) => loc.toString());
}

// # Intl formatter cache (module-global) ----------------------------------------------

// Formatters depend ONLY on (kind, locale, options) — deterministic, so sharing them
// across all I18n instances is safe and semantically invisible. Unbounded by design:
// real apps use a handful of option shapes and locales. (Programmatically generated
// option values — e.g. `minimumFractionDigits: i` in a loop — would grow it; don't.)
const formatterCache = new Map<
  string,
  Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat | Intl.ListFormat
>();

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

function cachedFormatter<
  F extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat | Intl.ListFormat,
>(kind: "n" | "d" | "r" | "l", locale: Locale, options: object | undefined, create: () => F): F {
  const cacheKey = `${kind}\u0001${locale}\u0001${stableStringify(options)}`;
  let format = formatterCache.get(cacheKey) as F | undefined;
  if (!format) {
    format = create();
    formatterCache.set(cacheKey, format);
  }
  return format;
}

function cachedNumberFormat(locale: Locale, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cachedFormatter("n", locale, options, () => new Intl.NumberFormat(locale, options));
}

function cachedDateTimeFormat(
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return cachedFormatter("d", locale, options, () => new Intl.DateTimeFormat(locale, options));
}

function cachedRelativeTimeFormat(
  locale: Locale,
  options?: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  return cachedFormatter("r", locale, options, () => new Intl.RelativeTimeFormat(locale, options));
}

function cachedListFormat(locale: Locale, options?: Intl.ListFormatOptions): Intl.ListFormat {
  return cachedFormatter("l", locale, options, () => new Intl.ListFormat(locale, options));
}

// # Default text source — the built-in TextSource -------------------------------------

/**
 * Ordered, de-duplicated chain of normalized tags, most -> least specific, WITHIN the
 * requested language: "de-CH" -> ["de-CH", "de"], "zh-Hant-TW" -> ["zh-Hant-TW",
 * "zh-TW", "zh"]. An invalid tag does NOT throw — it degrades to one opaque candidate
 * that misses the (normalized) store, so a bad requested locale (e.g. a malformed
 * `<html lang>`) falls through to the namespace defaults instead of crashing every
 * lookup. Cross-LANGUAGE fallback is not a store concern — see `withFallbackLocales`.
 */
function buildLanguageTagChain(locale: Locale): Locale[] {
  let loc: Intl.Locale;
  try {
    loc = new Intl.Locale(locale);
  } catch {
    return [locale];
  }
  const tags = [loc.baseName]; // canonical full tag first
  // "<language>-<region>" beats the bare language; a NEW tag only with a script subtag.
  if (loc.language && loc.region) tags.push(`${loc.language}-${loc.region}`);
  if (loc.language) tags.push(loc.language);
  return [...new Set(tags.map(normalizeLocale))];
}

/**
 * Resolve a request against a store, narrowing tags within the requested language.
 * `undefined` on a miss — the pipeline then falls through (e.g. to fallback locales
 * via `withFallbackLocales`, or to the namespace defaults).
 */
function resolveFromStore(
  store: DictionaryStore,
  request: TextRequest,
  context: ResolveContext,
): string | undefined {
  for (const candidate of buildLanguageTagChain(request.locale)) {
    const value = store[candidate]?.[request.namespace.key]?.[request.key];
    if (typeof value === "string") return value;
    if (typeof value === "function" && request.params != null) {
      // Invoke with an I18n bound to the FOUND locale (re-enters the full pipeline).
      return value(request.params, context.localize(candidate));
    }
    // absent or function-without-params -> next candidate
  }
  return undefined;
}

/** Merge one TextBundle into a store (last write wins). Returns whether anything was added. */
function addBundleToStore(store: DictionaryStore, bundle: TextBundle): boolean {
  let added = false;
  for (const rawLocale of Object.keys(bundle)) {
    const localeRecord = (store[normalizeLocale(rawLocale)] ??= createRecord<NamespaceRecord>());
    const entry = bundle[rawLocale];
    for (const { namespace, texts } of Array.isArray(entry) ? entry : [entry]) {
      const nsRecord = (localeRecord[namespace.key] ??= createRecord<TextValue>());
      for (const [key, value] of Object.entries(texts as Record<string, TextValue | undefined>)) {
        if (value === undefined) continue; // explicit undefined must not shadow anything
        nsRecord[key] = value;
        added = true;
      }
    }
  }
  return added;
}

/**
 * The built-in TextSource: a store fed by declaratively provided TextBundles. It has
 * no privileged status — it plugs into `I18nConfig.textSource` exactly like any
 * third-party adapter would.
 *
 * Plain bundles are available immediately; promises register when they settle (until
 * then, namespace defaults show); thunks are invoked lazily on the FIRST resolution —
 * so `() => import(...)` starts loading only when texts are actually needed. Whenever
 * an async bundle lands, the source's `onChange` fires and hosts re-render. A rejected
 * bundle load is reported via console.error and otherwise skipped. Bundles merge
 * last-write-wins in the order given (async ones in settle order) — on a key clash,
 * order decides.
 */
function defaultTextSource(options: DefaultTextSourceOptions = {}): TextSource {
  const store: DictionaryStore = createRecord<LocaleRecord>();
  const listeners = createListeners();
  const pendingThunks: (() => TextBundle | Promise<TextBundle>)[] = [];

  const logLoadError = (reason: unknown): void =>
    console.error("i18n: loading a text bundle failed", reason);
  const accept = (bundle: TextBundle): void => {
    if (addBundleToStore(store, bundle)) listeners.notify();
  };

  for (const input of options.textBundles ?? []) {
    if (typeof input === "function")
      pendingThunks.push(input); // deferred until first resolution
    else if (input instanceof Promise) input.then(accept, logLoadError);
    else addBundleToStore(store, input); // nobody subscribed yet: no notification needed
  }

  const invokePendingThunks = (): void => {
    if (!pendingThunks.length) return;
    for (const thunk of pendingThunks.splice(0)) {
      try {
        const result = thunk();
        if (result instanceof Promise) result.then(accept, logLoadError);
        else accept(result);
      } catch (reason) {
        logLoadError(reason);
      }
    }
  };

  const source: TextSource = freeze({
    resolve: (request, context) => {
      invokePendingThunks(); // first use triggers deferred loads
      return resolveFromStore(store, request, context);
    },
    resolveExact: (locale, namespace, key) => {
      invokePendingThunks();
      // Walk only the within-language chain for this locale — no fallbacks, no defaults.
      for (const candidate of buildLanguageTagChain(locale)) {
        const value = store[candidate]?.[namespace.key]?.[key];
        if (value !== undefined) return typeof value === "string" ? value : "";
      }
      return undefined;
    },
    onChange: listeners.add,
  });

  const fallbacks = options.fallbackLocales;
  return fallbacks?.length ? withFallbackLocales(source, fallbacks) : source;
}

// # TextSource combinators ------------------------------------------------------------

/**
 * Decorate a TextSource with a cross-language fallback chain: the requested locale
 * first, then each fallback in order (candidates normalizing to an already-tried tag
 * are skipped). The found candidate travels as `request.locale`, so dynamic
 * translations get an I18n bound to the locale they were actually found in. Being a
 * SOURCE combinator, the whole chain is exhausted before the namespace defaults apply.
 * Invalid fallback tags fail loudly here, at setup — not at the first miss.
 */
function withFallbackLocales(source: TextSource, fallbackLocales: Locale[]): TextSource {
  for (const tag of fallbackLocales) new Intl.Locale(tag); // throws on an invalid tag
  const fallbacks: readonly Locale[] = freeze([...fallbackLocales]);

  return freeze({
    resolve: (request, context) => {
      const seen = new Set<string>();
      for (const candidate of [request.locale, ...fallbacks]) {
        const normalized = normalizeLocale(candidate);
        if (seen.has(normalized)) continue; // already tried an equivalent tag
        seen.add(normalized);
        const req =
          candidate === request.locale ? request : freeze({ ...request, locale: candidate });
        const hit = source.resolve(req, context);
        if (hit !== undefined) return hit;
      }
      return undefined;
    },
    // Forward the wrapped source's change channel (via a lambda: keeps its receiver).
    ...(source.onChange && {
      onChange: (listener: ChangeListener): Unsubscribe => source.onChange!(listener), // NOSONAR
    }),
    // Forward resolveExact unwrapped — the whole point is to bypass this combinator.
    ...(source.resolveExact && {
      resolveExact: (locale: Locale, namespace: Namespace<any>, key: TextKey) =>
        source.resolveExact!(locale, namespace, key), // NOSONAR
    }),
  });
}

// # Text-resolution pipeline: middlewares -> textSource -> defaults --------------------

/**
 * Terminal resolver of last resort: the namespace's own default texts. Dynamic
 * defaults get an I18n bound to the REQUESTED locale (data formatting in the user's
 * conventions inside default-language text); a default author who needs a fixed
 * locale can use `i18n.localize("en")` inside the function body.
 */
function resolveFromDefaults(request: TextRequest, context: ResolveContext): string | undefined {
  const value = (request.namespace.defaults as Record<string, TextValue | undefined>)[request.key];
  if (typeof value === "string") return value;
  if (typeof value === "function" && request.params != null) {
    return value(request.params, context.localize(request.locale));
  }
  return undefined;
}

/**
 * Compose the middleware chain around the text source and the defaults terminal.
 * Index 0 is outermost; `next(patch)` merges the patch over the current request (last
 * write wins). Because the defaults terminal sits INSIDE the pipeline, middlewares
 * (e.g. pseudo-localization) see default-resolved texts too — `next() === undefined`
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
    const dispatch = (index: number, req: TextRequest): string | undefined =>
      index < middlewares.length
        ? middlewares[index](req, context, (patch) =>
            dispatch(index + 1, patch ? freeze({ ...req, ...patch }) : req),
          )
        : terminal(req, context);
    return dispatch(0, request);
  };
}

// # Translation validation -------------------------------------------------------------

/**
 * Validate a translation against its namespace's defaults — the runtime twin of the
 * compile-time checks, so plain-JS callers get the same guarantees and TypeScript
 * callers get a readable error at the declaration site. Reports (all at once, in one
 * TypeError): keys absent from the defaults, values whose kind disagrees with the
 * default (string vs. function), and — when `full` — missing keys. An explicit
 * `undefined` counts as "not provided", matching the store, which skips it.
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
  if (unknown.length) issues.push(`unknown keys [${quote(unknown)}]`);

  const mismatched = given
    .filter((key) => Object.hasOwn(defaults, key) && typeof texts[key] !== typeof defaults[key])
    .map((key) => `"${key}" (expected ${typeof defaults[key]}, got ${typeof texts[key]})`);
  if (mismatched.length) issues.push(`kind mismatches [${mismatched.sort().join(", ")}]`);

  if (full) {
    const missing = Object.keys(defaults).filter((key) => texts[key] === undefined);
    if (missing.length) issues.push(`missing keys [${quote(missing)}]`);
  }

  if (issues.length)
    throw new TypeError(`i18n: ${fn} for namespace "${namespace.key}": ${issues.join("; ")}`);
}

// # Default locale source: client detection + document-lang monitor ---------------------

/** We are in the browser or a fake testing browser. */
function isClientSide(g = globalThis): boolean {
  return !!g.window?.MutationObserver && !!g.document?.documentElement;
}

/**
 * The client-side locale source: `getLocale` reads the live `<html lang>` attribute
 * (falling back to `defaultLocale` when absent); `onChange` is driven by a
 * MutationObserver on it.
 */
function createDocumentLangMonitor(defaultLocale: Locale, g = globalThis): LocaleSource {
  const listeners = createListeners();
  new g.MutationObserver(listeners.notify).observe(g.document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  return freeze({
    getLocale: () => g.document.documentElement.getAttribute("lang") ?? defaultLocale,
    onChange: listeners.add,
  });
}

/** Accept the shorthand forms of a locale source: a fixed tag or a plain getter. */
function toLocaleSource(input: Locale | (() => Locale) | LocaleSource): LocaleSource {
  if (typeof input === "string") return freeze({ getLocale: () => input });
  return typeof input === "function" ? freeze({ getLocale: input }) : input;
}

/**
 * The default LocaleSource — also used by `createI18n` when none is configured. On
 * the client: the `<html lang>` monitor (not configurable — a client app wanting
 * something else writes its own LocaleSource). Elsewhere (no DOM): `serverSide`,
 * accepted as a fixed tag (SSG), a getter (e.g. per-request via AsyncLocalStorage),
 * or a full LocaleSource (own change channel). `defaultLocale` (default "en-US")
 * answers when nothing is detectable: the `lang` attribute is absent (client) or no
 * `serverSide` was given (elsewhere).
 */
function defaultLocaleSource(
  options: Readonly<{
    defaultLocale?: Locale;
    serverSide?: Locale | (() => Locale) | LocaleSource;
  }> = {},
): LocaleSource {
  const defaultLocale = options.defaultLocale ?? "en-US";
  if (isClientSide()) return createDocumentLangMonitor(defaultLocale);
  return options.serverSide
    ? toLocaleSource(options.serverSide)
    : freeze({ getLocale: () => defaultLocale });
}

// # The facade factory ------------------------------------------------------------------

/**
 * Create an I18n facade. Zero-config works: `defaultLocaleSource()` as the locale,
 * resolution straight to the namespace defaults. Returns the DYNAMIC instance;
 * `localize(locale)` yields statically bound siblings sharing the same pipeline,
 * caches, and change channel.
 */
function createI18n(config: I18nConfig = {}): I18n {
  const localeSource = config.localeSource ?? defaultLocaleSource();
  const textSource = config.textSource;
  const middlewares: readonly TextMiddleware[] = freeze([...(config.middlewares ?? [])]);

  const listeners = createListeners();
  const instanceCache = new Map<string | null, I18n>(); // canonical tag -> facade; null -> dynamic

  // The room every resolution is asked in; re-enters the full pipeline.
  const context: ResolveContext = freeze({
    localize: (locale: Locale) => getOrCreateInstance(locale),
  });
  const runPipeline = composePipeline(textSource, middlewares, context);

  // Bridge BOTH strategies' change channels into the shared listener set.
  localeSource.onChange?.(listeners.notify); // locale changed
  textSource?.onChange?.(listeners.notify); // texts changed (e.g. async resources arrived)

  function getOrCreateInstance(locale: Locale | null): I18n {
    // Keyed by canonical tag so `localize("en-us")` and `localize("en-US")` share one
    // facade — but bound to the EXACT tag requested: formatters must see any unicode
    // extensions the caller passed.
    const cacheKey = locale === null ? null : canonicalLocale(locale);
    let instance = instanceCache.get(cacheKey);
    if (!instance) {
      instance = createFacade(locale === null ? () => localeSource.getLocale() : () => locale);
      instanceCache.set(cacheKey, instance);
    }
    return instance;
  }

  function createFacade(getLocale: () => Locale): I18n {
    // Facade-owned miss policy: `undefined` from the pipeline -> the key itself.
    // (`??`, not `||`: an empty string is a valid translation.) With defaults on the
    // namespace, the bare key only ever appears for keys that have no default —
    // which the `text` overloads rule out at compile time.
    const text: I18n["text"] = (namespace: any, key: any, params?: any) =>
      runPipeline(freeze({ locale: getLocale(), namespace, key: key as string, params })) ??
      (key as string);

    const hasText: I18n["hasText"] = (namespace, key, includeFallback = false) => {
      if (includeFallback) {
        const request = freeze({
          locale: getLocale(),
          namespace,
          key: key as string,
          params: null,
        });
        return runPipeline(request) !== undefined;
      }
      // Source-only, current locale only — bypass fallback combinators and defaults.
      return textSource?.resolveExact?.(getLocale(), namespace, key as string) !== undefined;
    };

    const bindTexts: I18n["bindTexts"] = (boundNs?: Namespace<any>) => {
      const lookup = text as (ns: any, key: any, params?: any) => string;
      return (a: unknown, b?: unknown, c?: unknown): string =>
        boundNs && typeof a === "string" ? lookup(boundNs, a, b) : lookup(a, b, c);
    };

    return freeze({
      text,
      hasText,
      bindTexts,
      formatNumber: (value, options?) => cachedNumberFormat(getLocale(), options).format(value),
      formatNumberRange: (start, end, options?) =>
        cachedNumberFormat(getLocale(), options).formatRange(start, end),
      numberFormat: (options) => cachedNumberFormat(getLocale(), options),
      formatDateTime: (value, options) => cachedDateTimeFormat(getLocale(), options).format(value),
      formatDateTimeRange: (start, end, options?) =>
        cachedDateTimeFormat(getLocale(), options).formatRange(start, end),
      dateTimeFormat: (options) => cachedDateTimeFormat(getLocale(), options),
      formatRelativeTime: (value, unit, options?) =>
        cachedRelativeTimeFormat(getLocale(), options).format(value, unit),
      relativeTimeFormat: (options) => cachedRelativeTimeFormat(getLocale(), options),
      formatList: (list, options?) => cachedListFormat(getLocale(), options).format(list),
      listFormat: (options) => cachedListFormat(getLocale(), options),
      locale: () => getLocale(),
      onChange: listeners.add,
      localize: (locale?: Locale) => getOrCreateInstance(locale ?? null),
    });
  }

  return getOrCreateInstance(null);
}

// # Namespaces and bundles ---------------------------------------------------------------

/**
 * Create a namespace from its default texts. The defaults define the namespace's
 * shape (keys + param types) AND serve as the resolution terminal — a component
 * library shipping a namespace works without any app cooperation. Namespaces are pure
 * data; texts for other locales are attached with the freestanding `allTexts`/`someTexts`.
 */
function createNamespace<T extends TextMap>(params: { key: string; defaults: T }): Namespace<T> {
  return freeze({ key: params.key, defaults: freeze({ ...params.defaults }) });
}

/**
 * Type-safe identity for a standalone-declared TextBundle: errors surface at the
 * declaration site (with precise key/param locations) instead of at a distant
 * consumer. Not needed when passing a literal to `defaultTextSource` directly.
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
