/**
 * A lightweight, type-safe i18n library.
 *
 * Translations are plain TypeScript values (static strings or functions), grouped
 * into typed namespaces, with no message DSL and no code generation.
 *
 * Single module. Exports six functions (`bundleTexts`, `createI18n`,
 * `createNamespace`, `getI18n`, `initI18n`, `localize`) plus a set of types.
 *
 * Config is resolved lazily on first use of any locale method for the global instance
 * (whose config arrives later, via `initI18n`); instances from `createI18n` resolve
 * their config eagerly at construction.
 */

export { bundleTexts, createI18n, createNamespace, getI18n, initI18n, localize };

export type {
  I18n,
  I18nConfig,
  Locale,
  LocalizeController,
  LocalizeControllerHost,
  Localizer,
  Namespace,
  NamespaceKey,
  NamespaceTexts,
  TextBundle,
  TextKey,
  TextMap,
  Translation,
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

// A parameterized translation: receives typed params and a Localizer, returns a string.
type TranslationFn<T extends Record<string, unknown>> = (params: T, localizer: Localizer) => string;

// Extracts the params object type from a TranslationFn. (internal)
type TranslationParams<T> = T extends TranslationFn<infer P> ? P : never;

// Convenience authoring alias:
//   Translation             -> string                     (static text)
//   Translation<{n:number}> -> TranslationFn<{n:number}>  (dynamic text)
type Translation<T extends Record<string, unknown> = never> = [T] extends [never] ? string : TranslationFn<T>;

/* Namespaces and text maps */

// The shape of one namespace's translations: key -> static string | translation fn.
type TextMap = Record<string, Translation | Translation<any>>;

// A typed namespace identifier. Immutable (frozen at runtime).
type Namespace<T extends TextMap> = Readonly<{
  key: string;
  group: string | null;
  full: (texts: T) => NamespaceTexts<T>; // requires every key of T
  partial: (texts: Partial<T>) => NamespaceTexts<T>; // allows a subset of keys
}>;

// A namespace paired with (some of) its texts, produced by namespace `full`/`partial`.
type NamespaceTexts<T extends TextMap> = Readonly<{
  namespace: Namespace<T>;
  texts: Partial<T>;
}>;

// Translations grouped by locale, each locale mapping to a list of namespace text groups.
type TextBundle = Record<Locale, NamespaceTexts<any>[]>;

// Partition a TextMap's keys by whether their value is a function.
type TextKeysWithParams<T extends Record<string, unknown>> = {
  [K in keyof T]: T[K] extends TranslationFn<any> ? K : never;
}[keyof T];

type TextKeysWithoutParams<T extends TextMap> = Exclude<keyof T, TextKeysWithParams<T>>;

// A Localizer resolves and formats text for one active locale. (internal)
type Localizer = Readonly<{
  // Overload 1 — static keys (value is a string): no params.
  getText<T extends TextMap, K extends TextKeysWithoutParams<T>>(namespace: Namespace<T>, key: K): string;

  // Overload 2 — dynamic keys (value is a TranslationFn): params required, typed to the fn.
  getText<T extends TextMap, K extends TextKeysWithParams<T>>(
    namespace: Namespace<T>,
    key: K,
    params: TranslationParams<T[K]>,
  ): string;

  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  numberFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat;
  formatDateTime(value: Date, options?: Intl.DateTimeFormatOptions): string;
  dateTimeFormat(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat;
  localize(locale: Locale): Localizer; // a Localizer for a different locale on the same I18n instance

  // Return a standalone getText function. With no namespace it is exactly `getText`.
  // With a namespace it is scoped to it — call `t(key[, params])` — while still
  // accepting a fully-qualified `t(namespace, key[, params])` for any other namespace.
  bindTexts(): {
    <T extends TextMap, K extends TextKeysWithoutParams<T>>(namespace: Namespace<T>, key: K): string;
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
    <U extends TextMap, K extends TextKeysWithoutParams<U>>(namespace: Namespace<U>, key: K): string;
    <U extends TextMap, K extends TextKeysWithParams<U>>(key: K, params: TranslationParams<U[K]>): string;
  };
}>;

// # I18n and its config

type I18n = {
  addTexts(...textBundles: TextBundle[]): void;
  getLocale(): Locale;
  onChange(listener: ChangeListener): Unsubscribe;
  localize(locale?: Locale): Localizer; // a static Localizer bound to `locale` or a dynamic one
};

type I18nConfig = Readonly<{
  getLocale?(): Locale;
  getFallbackLocales?(): Locale[];
  onChange?(listener: ChangeListener): Unsubscribe;
  onAddTexts?(locale: Locale, namespace: Namespace<any>, key: TextKey): void;
  getText?(locale: Locale, namespace: Namespace<any>, key: TextKey, params: unknown, next: () => string): string;
}>;

// # Reactive controller integration

type LocalizeController = Localizer & {
  hostConnected(): void;
  hostDisconnected(): void;
};

type LocalizeControllerHost = {
  requestUpdate(): void;
  addController(controller: LocalizeController): void;
};

// # Internal storage shapes

type TextValue = string | TranslationFn<any>;
type NamespaceRecord = Record<string, TextValue>; // textKey -> value
type LocaleRecord = Record<string, NamespaceRecord>; // namespaceKey -> NamespaceRecord
type Dictionary = Record<string, LocaleRecord>; // locale -> LocaleRecord

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
// # Fallback locale chain
// --------------------------------------------------------------------

/**
 * Build an ordered, de-duplicated chain of normalized tags, most -> least specific.
 * Parsing `locale` may throw on an invalid tag; that error propagates to the caller.
 *
 *   "de-CH"      -> ["de-CH", "de"]
 *   "en-US"      -> ["en-US", "en"]
 *   "zh-Hant-TW" -> ["zh-Hant-TW", "zh-TW", "zh"]
 */
function buildFallbackLocaleChain(locale: Locale): Locale[] {
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

/**
 * Ordered, de-duplicated resolution chain: the requested locale's own tag chain
 * (most -> least specific) followed by each configured fallback locale's tag chain.
 * The requested tag is parsed first and an invalid tag propagates (as before); an
 * invalid fallback tag is skipped rather than aborting resolution.
 */
function buildResolutionChain(locale: Locale, fallbackLocales: Locale[]): Locale[] {
  const chain: string[] = [];
  const seen = new Set<string>();

  const merge = (tags: string[]): void => {
    for (const tag of tags) {
      if (!seen.has(tag)) {
        seen.add(tag);
        chain.push(tag);
      }
    }
  };

  // requested locale first (an invalid requested tag still propagates)
  merge(buildFallbackLocaleChain(locale));

  // then each configured fallback locale, expanded the same way
  for (const fallback of fallbackLocales) {
    try {
      merge(buildFallbackLocaleChain(fallback));
    } catch {
      // skip an invalid fallback tag without breaking resolution
    }
  }

  return chain;
}

/* ------------------------------------------------------------------ *
 * # Text resolution
 * ------------------------------------------------------------------ */

function resolveText(
  dictionary: Dictionary,
  i18n: I18n,
  locale: Locale,
  fallbackLocales: Locale[],
  namespace: Namespace<any>,
  key: string,
  params: unknown,
): string {
  // Requested locale's tag chain, then each configured fallback locale's tag chain.
  // Building the requested locale's chain throws on an invalid tag (propagates).
  const chain = buildResolutionChain(locale, fallbackLocales);

  for (const candidate of chain) {
    const value = dictionary[candidate]?.[namespace.key]?.[key];

    if (typeof value === "string") {
      // static -> return immediately
      return value;
    }

    if (typeof value === "function" && params != null) {
      // dynamic with params -> invoke with a localizer for the FOUND locale
      return value(params, i18n.localize(candidate));
    }

    // absent, function-without-params, or non-string/non-function -> skip
  }

  // nothing usable -> return the key string itself
  return key;
}

// -------------------------------------------------------------------
// # I18n factory
// -------------------------------------------------------------------

function createI18n(config: I18nConfig) {
  return createI18nInstance(createRecord(), () => config, false);
}

/**
 * Build an I18n instance backed by the given dictionary. `resolveConfig` runs at most
 * once. When `lazy` is true (the global instance, whose config is supplied later via
 * `initI18n`) it runs on first use of any locale method; otherwise it runs eagerly at
 * construction, so `addTexts` notifies `onAddTexts` directly rather than buffering.
 */
function createI18nInstance(dictionary: Dictionary, getConfig: () => I18nConfig, lazy: boolean): I18n {
  const localizerCache = new Map<string | null, Localizer>();
  const changeListeners = new Set<ChangeListener>();
  // Add-notifications recorded while `initialized === false`. Replayed to
  // `config.onAddTexts` once the config is resolved. Only fills for the global
  // instance, since non-global instances are initialized eagerly below.
  const pendingAddNotifications: {
    locale: Locale;
    namespace: Namespace<any>;
    key: TextKey;
  }[] = [];
  let initialized = false;

  // Buffer before init (config/onAddTexts unknown), notify directly after.
  // MUST NOT call ensureInitialized — addTexts has to stay callable before initI18n.
  function notifyAddText(locale: Locale, namespace: Namespace<any>, key: TextKey): void {
    if (initialized) {
      getConfig().onAddTexts?.(locale, namespace, key);
    } else {
      pendingAddNotifications.push({ locale, namespace, key });
    }
  }

  // Lazy one-time initialization (§3.4): resolve the config, then bridge the config's
  // locale-change source to this instance's own listeners so they actually fire.
  function ensureInitialized(): void {
    if (initialized) return;
    initialized = true;
    const config = getConfig();
    config.onChange?.(() => {
      for (const listener of [...changeListeners] /* NOSONAR */) listener();
    });
    // Replay add-notifications recorded before init, in registration order.
    if (config.onAddTexts) {
      for (const { locale, namespace, key } of pendingAddNotifications) {
        config.onAddTexts(locale, namespace, key);
      }
    }
    pendingAddNotifications.length = 0;
  }

  // Non-global instances resolve config now (lazy === false), so addTexts notifies
  // `onAddTexts` directly instead of buffering (notifyAddText sees `initialized`).
  if (!lazy) {
    ensureInitialized();
  }

  const i18n: I18n = {
    addTexts(...textBundles: TextBundle[]): void {
      for (const bundle of textBundles) {
        // Merge locale keys that normalize equally, concatenating their arrays.
        const merged = createRecord<NamespaceTexts<any>[]>();
        for (const rawLocale of Object.keys(bundle)) {
          const normalized = normalizeLocale(rawLocale);
          (merged[normalized] ??= []).push(...bundle[rawLocale]); // NOSONAR
        }

        for (const normalized of Object.keys(merged)) {
          const localeRecord = (dictionary[normalized] ??= createRecord<NamespaceRecord>());

          for (const { namespace, texts } of merged[normalized]) {
            const nsRecord = (localeRecord[namespace.key] ??= createRecord<TextValue>());
            // Object.assign semantics: last write wins.
            Object.assign(nsRecord, texts);
            for (const key of Object.keys(texts)) {
              notifyAddText(normalized, namespace, key);
            }
          }
        }
      }
    },

    localize(locale?) {
      ensureInitialized(); // first touch triggers one-time initialization

      // Memoize one Localizer per distinct `locale` string argument.
      let localizer = localizerCache.get(locale ?? null);
      if (!localizer) {
        localizer = createLocalizer(i18n, getConfig(), dictionary, locale ? () => locale : () => i18n.getLocale());
        localizerCache.set(locale ?? null, localizer);
      }
      return localizer;
    },

    getLocale(): Locale {
      ensureInitialized();
      return getConfig().getLocale?.() ?? "en-US";
    },

    onChange(listener) {
      ensureInitialized();
      changeListeners.add(listener);
      return () => void changeListeners.delete(listener); // NOSONAR // idempotent
    },
  };

  return i18n;
}

function createLocalizer(
  i18n: I18n,
  i18nConfig: I18nConfig,
  dictionary: Dictionary,
  getLocale: () => Locale,
): Localizer {
  const getText: Localizer["getText"] = (namespace: any, key: any, params?: any) => {
    const custom = i18nConfig.getText;

    if (!custom) {
      return resolveText(
        dictionary,
        i18n,
        getLocale(),
        i18nConfig.getFallbackLocales?.() ?? [],
        namespace,
        key as string,
        params,
      );
    }
    const next = (): string =>
      resolveText(
        dictionary,
        i18n,
        getLocale(),
        i18nConfig.getFallbackLocales?.() ?? [],
        namespace,
        key as string,
        params,
      );
    return custom(getLocale(), namespace, key as string, params, next);
  };

  const bindTexts: Localizer["bindTexts"] = (boundNs?: Namespace<any>) => {
    // Loose view for internal dispatch. Callers are still fully type-checked
    // against the overloads declared on `Localizer["bindTexts"]`.
    const lookup = getText as (ns: any, key: any, params?: any) => string;

    // One closure serves every form. A key is a string and a namespace is an
    // object, so the first argument disambiguates:
    //   scoped:    t(key, params?)            -> resolve `key` in `boundNs`
    //   qualified: t(namespace, key, params?) -> look up in another namespace
    //   unscoped:  t(namespace, key, params?) -> `boundNs` undefined, forward as-is
    return (a: unknown, b?: unknown, c?: unknown): string =>
      boundNs && typeof a === "string" ? lookup(boundNs, a, b) : lookup(a, b, c);
  };

  return freeze({
    getText,
    bindTexts,
    formatNumber: (value, options) => new Intl.NumberFormat(getLocale(), options).format(value),
    numberFormat: (options) => new Intl.NumberFormat(getLocale(), options),
    formatDateTime: (value, options) => new Intl.DateTimeFormat(getLocale(), options).format(value),
    dateTimeFormat: (options) => new Intl.DateTimeFormat(getLocale(), options),
    localize: (locale) => i18n.localize(locale),
  });
}

// -------------------------------------------------------------------
// # Client detection + document-lang monitor
// -------------------------------------------------------------------

// We are in the browser or a fake testing browser.
function isClientSide(g = globalThis): boolean {
  return !!g.window?.MutationObserver && !!g.document?.documentElement;
}

/**
 * Construct the default locale source that watches `<html lang>`. It exposes
 * `getLocale` (reading the live attribute) and `onChange` (driven by a
 * MutationObserver on the `lang` attribute), and becomes the global instance's config
 * on the client.
 */
function createDocumentLangMonitor(g = globalThis): I18nConfig {
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

  return {
    getLocale: () => g.document.documentElement.getAttribute("lang") ?? "en-US",
    onChange: (listener) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((it) => it !== listener);
      };
    },
  };
}

// -------------------------------------------------------------------
// # Module-level global state
// -------------------------------------------------------------------

let globalI18n: I18n | undefined;
let globalI18nConfig: I18nConfig | undefined; // stashed by initI18n
let globalDict: Dictionary | undefined;
let initI18nCalled = false; // guards single-call
let globalI18nInitialized = false; // guards "too late"

/**
 * Lazy config resolution for the global instance. Runs once, on the global instance's
 * first use of any locale method. Resolves config (installing the document-lang monitor
 * on the client when appropriate) and marks the global instance initialized, so a later
 * `initI18n` correctly reports "too late".
 */
function getGlobalConfig(): I18nConfig {
  let config: I18nConfig = globalI18nConfig ?? {};

  if (isClientSide() && !config.getLocale && !config.onChange) {
    // Install the default <html lang> monitor as the locale source.
    config = { ...config, ...createDocumentLangMonitor() };
  }

  globalI18nInitialized = true;
  return config;
}

// -------------------------------------------------------------------
// # Public functions
// -------------------------------------------------------------------

function createNamespace<T extends TextMap>(params: { key: string; group?: string | null }): Namespace<T> {
  const namespace: Namespace<T> = freeze({
    key: params.key,
    group: params.group ?? null,
    full: (texts): NamespaceTexts<T> => freeze({ namespace, texts }),
    partial: (texts): NamespaceTexts<T> => freeze({ namespace, texts }),
  });

  return namespace;
}

function bundleTexts<T extends TextBundle>(texts: T): TextBundle {
  return texts; // Type-safe identity function: returns its argument unchanged.
}

function getI18n(): I18n {
  if (!globalI18n) {
    globalDict = createRecord<LocaleRecord>();
    globalI18n = createI18nInstance(globalDict, getGlobalConfig, true);
  }
  return globalI18n;
}

function initI18n(config: I18nConfig): void {
  // "already called" check takes precedence over "too late".
  if (initI18nCalled) {
    throw new Error("Function 'initI18n' can only be called once.");
  } else if (globalI18nInitialized) {
    throw new Error("Too late to call function 'initI18n' - i18n has already been initialized.");
  }

  globalI18nConfig = freeze({ ...config }); // shallow clone, consumed lazily by getI18n init
  initI18nCalled = true;
}

function localize(host: LocalizeControllerHost, i18n: I18n = getI18n()): LocalizeController {
  const localizer = i18n.localize();
  let unsubscribe: Unsubscribe | null = null;

  const controller: LocalizeController = {
    ...localizer,

    hostConnected() {
      unsubscribe = i18n.onChange(() => host.requestUpdate());
    },

    hostDisconnected() {
      unsubscribe?.();
      unsubscribe = null;
    },
  };

  host.addController(controller);
  return freeze(controller);
}
