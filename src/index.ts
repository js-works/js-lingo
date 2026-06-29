/**
 * Lightweight TypeScript i18n library with typed namespaces and functional translations.
 *
 * Provides a minimal abstraction for managing localized texts without requiring
 * a message format DSL or code generation.
 *
 * ## Core model
 *
 * - Texts are grouped into namespaces created via `createNamespace`.
 * - A namespace is a typed identifier used to register and retrieve translations.
 * - Translations can be either:
 *   - string → static text
 *   - (params, localizer) => string → dynamic text
 *
 * ## Runtime usage
 *
 * - `getI18n()` returns the global i18n instance
 * - `initI18n(config)` initializes/customizes the global instance
 *    (must not be called more than once in the app)
 * - `createI18n(config)` creates an isolated i18n instance
 *
 * - `localize(host)` integrates i18n with reactive UI controllers
 *   (e.g. LitElement) and triggers updates on locale changes
 *
 * - `bundleTexts(texts)` provides type-safe grouping of translations per locale
 *
 * ## Design goals
 *
 * - Fully type-safe without code generation
 * - No custom message syntax (pure TypeScript functions)
 * - Minimal runtime footprint
 * - Works standalone or as a facade over other i18n systems
 */

export {
  bundleTexts,
  createI18n,
  createNamespace,
  getI18n,
  initI18n,
  localize,
};

export type {
  ChangeListener,
  Locale,
  LocalizeController,
  LocalizeControllerHost,
  Namespace,
  NamespaceKey,
  NamespaceTexts,
  TextBundle,
  TextKey,
  TextMap,
  Translation,
  TranslationFn,
  Unsubscribe,
};

// === types ===================================================================

type Locale = string; // NOSONAR
type TextKey = string; // NOSONAR
type NamespaceKey = string; // NOSONAR
type Unsubscribe = () => void;
type ChangeListener = () => void;

type TranslationFn<T extends Record<string, unknown>> = (
  params: T,
  localizer: Localizer,
) => string;

type TranslationParams<T> = T extends TranslationFn<infer P> ? P : never;

// `never` is used as a sentinel value. If no parameter type is supplied,
// a translation is just a string; otherwise it's a parameterized
// translation function.
type Translation<T extends Record<string, unknown> = never> = [T] extends [
  never,
]
  ? string
  : TranslationFn<T>;

type LocalizedText<T extends Record<string, unknown> = Record<string, never>> =
  | string
  | TranslationFn<T>;

type TextMap = Record<string, LocalizedText<any>>;
type TextBundle = Record<Locale, NamespaceTexts<any>[]>;

type AnyTranslationFn = (
  params: Record<string, any>,
  localizer: Localizer,
) => string;

// Keys of a text map whose value is a parameterized translation function.
type TextKeysWithParams<T extends Record<string, unknown>> = {
  [K in keyof T]: T[K] extends TranslationFn<any> ? K : never;
}[keyof T];

// Keys of a text map whose value is a static string.
type TextKeysWithoutParams<T extends TextMap> = Exclude<
  keyof T,
  TextKeysWithParams<T>
>;

type TextParams<T> = T extends AnyTranslationFn ? Parameters<T>[0] : never;

type SimpleTextKey<K, T> = T extends AnyTranslationFn
  ? never
  : K extends string
    ? K
    : never;

type NamespaceTexts<T extends TextMap> = {
  namespace: Namespace<T>;
  texts: Partial<T>;
};

type Namespace<T extends TextMap> = {
  readonly key: string;
  readonly group: string | null;
  full(texts: T): NamespaceTexts<T>;
  partial(texts: Partial<T>): NamespaceTexts<T>;
};

type I18n = {
  addTexts(...textBundles: TextBundle[]): void;
  locale(locale: Locale): Localizer;
  getPrimaryLocale(): Locale;
  getFallbackLocales(): Locale[];
  onLocaleChange(listener: ChangeListener): Unsubscribe;
};

type I18nConfig = {
  getPrimaryLocale?(): Locale;
  getFallbackLocales?(): Locale[];
  onLocaleChange?(listener: ChangeListener): Unsubscribe;
  onAddTexts?(locale: Locale, namespace: Namespace<any>, key: TextKey): void;
  // More to come in future.
};

type Localizer = {
  getText<T extends TextMap, K extends TextKeysWithoutParams<T>>(
    namespace: Namespace<T>,
    key: K,
  ): string;

  getText<T extends TextMap, K extends TextKeysWithParams<T>>(
    namespace: Namespace<T>,
    key: K,
    params: TranslationParams<T[K]>,
  ): string;

  formatNumber(value: number, option?: Intl.NumberFormatOptions): string;
  numberFormat(option?: Intl.NumberFormatOptions): Intl.NumberFormat;
  formatDateTime(value: Date, option?: Intl.DateTimeFormatOptions): string;
  dateTimeFormat(option?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat;
  locale(locale: Locale): Localizer;
};

type LocalizeController = {
  hostConnected(): void;
  hostDisconnected(): void;
  host?: LocalizeControllerHost;
};

type LocalizeControllerHost = {
  requestUpdate(): void;
  addController(controller: LocalizeController): void;
};

// Internal dictionary shape: locale → namespace key → text key → translation.
type NamespaceTextMap = Record<NamespaceKey, TextMap>;
type Params = Record<string, LocalizedText<any>> | null;

// === internal helpers ========================================================

function createRecord(): any {
  return Object.create(null);
}

function freeze<T extends Record<string, any>>(obj: T): Readonly<T> {
  return Object.freeze(obj);
}

function isClientSide(): boolean {
  return (
    globalThis.window === globalThis &&
    typeof document === "object" &&
    globalThis.document === document &&
    typeof document.documentElement === "object" &&
    typeof MutationObserver === "function"
  );
}

function normalizeLocale(locale: string): string {
  try {
    return new Intl.Locale(locale).baseName;
  } catch {
    return locale;
  }
}

// === exported functions ======================================================

function initI18n(config: I18nConfig): void {
  if (globalState.initCalled) {
    throw new Error("Function 'initI18n' can only be called once.");
  }

  if (globalState.initialized) {
    throw new Error(
      "Too late to call function 'initI18n' - i18n has already been initialized.",
    );
  }

  globalState.initCalled = true;
  globalState.config = { ...config };
}

function getI18n(): I18n {
  if (globalState.instance) {
    return globalState.instance;
  }

  let config: I18nConfig | null = null;

  const getConfig = (): I18nConfig => {
    if (config) {
      return config;
    }

    config = globalState.config ?? {};

    if (isClientSide() && !config.getPrimaryLocale && !config.onLocaleChange) {
      const monitor = new DocumentLocaleMonitor(document);
      config.getPrimaryLocale = () => monitor.getLocale() || "en-US";
      config.onLocaleChange = (listener) => monitor.onChange(listener);
    }

    globalState.config = null; // Not needed any longer.
    return config;
  };

  globalState.instance = new DefaultI18n(globalDict, getConfig, true);
  return globalState.instance;
}

function createI18n(config: I18nConfig = {}): I18n {
  const clonedConfig = { ...config };
  let i18n: I18n;
  const dict = new Dictionary((locale) => i18n.locale(locale));
  i18n = new DefaultI18n(dict, () => clonedConfig);
  return i18n;
}

function createNamespace<T extends TextMap>(params: {
  key: string;
  group?: string | null;
}): Namespace<T> {
  const namespace: Namespace<T> = freeze({
    key: params.key,
    group: params.group ?? null,
    full: (texts: T) => freeze({ namespace, texts }),
    partial: (texts: Partial<T>) => freeze({ namespace, texts }),
  });

  return namespace;
}

function localize(
  host: LocalizeControllerHost,
  i18n: I18n = getI18n(),
): DefaultLocalizeController {
  return new DefaultLocalizeController(host, i18n);
}

// For type safety and expressiveness.
function bundleTexts<T extends TextBundle>(texts: T): TextBundle {
  return texts;
}

// === internal classes ========================================================

class Dictionary {
  readonly #data: Record<Locale, NamespaceTextMap> = createRecord();
  readonly #getLocalizer: (locale: Locale) => Localizer;

  constructor(getLocalizer: (locale: Locale) => Localizer) {
    this.#getLocalizer = getLocalizer;
  }

  addTexts(...bundles: TextBundle[]): void {
    for (const bundle of bundles) {
      this.#applyTextBundle(this.#normalizeTextBundle(bundle));
    }
  }

  getText<T extends TextMap, K extends keyof T>(
    locale: Locale,
    namespace: Namespace<T>,
    key: K,
    params: TextParams<T[K]>,
  ): string;

  getText<T extends TextMap, K extends keyof T>(
    locale: Locale,
    namespace: Namespace<T>,
    key: SimpleTextKey<K, T[K]>,
  ): string;

  getText<T extends TextMap>(
    locale: Locale,
    namespace: Namespace<T>,
    key: string,
    params: Params = null,
  ): string {
    const requested = new Intl.Locale(locale);

    for (const tag of this.#fallbackChain(requested)) {
      const entry = this.#data[tag]?.[namespace.key]?.[key];

      // Static translation: usable as-is.
      if (typeof entry === "string") {
        return entry;
      }

      // Dynamic translation: usable only when params were supplied. Without
      // them we cannot invoke it, so we keep probing less specific locales and
      // ultimately fall back to the raw key.
      if (typeof entry === "function" && params !== null) {
        return entry(params, this.#getLocalizer(tag));
      }
    }

    return key;
  }

  // Locale tags to probe, ordered from most to least specific and de-duplicated
  // while preserving that order:
  //   1. the canonical tag             (e.g. "zh-Hant-TW")
  //   2. the bare language             (e.g. "zh")
  //   3. language + region             (e.g. "zh-TW")
  // Step 3 only adds something new when the tag carries a script subtag.
  #fallbackChain(locale: Intl.Locale): NamespaceKey[] {
    const { language, region } = locale;

    const ordered: (string | undefined)[] = [
      locale.baseName,
      language || undefined,
      language && region ? `${language}-${region}` : undefined,
    ];

    const chain = new Set<string>();
    for (const tag of ordered) {
      if (tag) {
        chain.add(normalizeLocale(tag));
      }
    }

    return [...chain];
  }

  #normalizeTextBundle(texts: TextBundle): TextBundle {
    const result: TextBundle = {};

    for (const [locale, namespaceBundles] of Object.entries(texts)) {
      const normalized = normalizeLocale(locale);
      (result[normalized] ??= []).push(...namespaceBundles);
    }

    return result;
  }

  #applyTextBundle(texts: TextBundle): void {
    for (const [locale, namespaceBundles] of Object.entries(texts)) {
      const byNamespace = this.#getOrCreateLocale(locale);
      for (const bundle of namespaceBundles) {
        const target = (byNamespace[bundle.namespace.key] ??= createRecord());
        Object.assign(target, bundle.texts); // Last write wins.
      }
    }
  }

  #getOrCreateLocale(locale: string): NamespaceTextMap {
    return (this.#data[normalizeLocale(locale)] ??= createRecord());
  }
}

class DefaultI18n implements I18n {
  readonly #dict: Dictionary;
  readonly #getConfig: () => I18nConfig;
  readonly #localeListeners: ChangeListener[] = [];
  readonly #localizerByLocale: Record<Locale, Localizer> = createRecord();
  #config: I18nConfig | null = null;
  #textsToAdd: TextBundle[] | null;

  constructor(
    dict: Dictionary,
    getConfig: () => I18nConfig,
    addTextsLazily = false,
  ) {
    this.#dict = dict;
    this.#getConfig = getConfig;
    this.#textsToAdd = addTextsLazily ? [] : null;
    dictByI18n.set(this, dict);
  }

  addTexts(...bundles: TextBundle[]): void {
    this.#dict.addTexts(...bundles);
  }

  locale(locale: Locale): Localizer {
    this.#init();
    return (this.#localizerByLocale[locale] ??= new DefaultLocalizer(
      this,
      this.#dict,
      () => locale,
    ));
  }

  getPrimaryLocale(): Locale {
    return "en-US";
  }

  getFallbackLocales(): Locale[] {
    return [];
  }

  onLocaleChange(listener: ChangeListener): Unsubscribe {
    this.#localeListeners.push(listener);
    return () => {};
  }

  #init(): void {
    if (this === globalState.instance) {
      globalState.initialized = true;
    }

    if (this.#config) {
      return;
    }

    this.#config = this.#getConfig() ?? {};

    if (this.#textsToAdd) {
      const pending = this.#textsToAdd;
      this.#textsToAdd = null;
      for (const texts of pending) {
        this.addTexts(texts);
      }
    }
  }
}

class DefaultLocalizer implements Localizer {
  readonly #i18n: I18n;
  readonly #dict: Dictionary;
  readonly #getLocale: () => Locale;

  constructor(i18n: I18n, dict: Dictionary, getLocale: () => Locale) {
    this.#i18n = i18n;
    this.#dict = dict;
    this.#getLocale = getLocale;
  }

  getText<T extends TextMap, K extends keyof T & string>(
    namespace: Namespace<T>,
    key: K,
    params: TextParams<T[K]>,
  ): string;

  getText<T extends TextMap, K extends keyof T & string>(
    namespace: Namespace<T>,
    key: SimpleTextKey<K, T[K]>,
  ): string;

  getText(
    namespace: Namespace<any>,
    key: string,
    params: Params = null,
  ): string {
    return params
      ? this.#dict.getText(this.#getLocale(), namespace, key, params)
      : this.#dict.getText(this.#getLocale(), namespace, key as any);
  }

  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.#getLocale(), options).format(value);
  }

  numberFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat {
    return new Intl.NumberFormat(this.#getLocale(), options);
  }

  formatDateTime(value: Date, options?: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat(this.#getLocale(), options).format(value);
  }

  dateTimeFormat(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat(this.#getLocale(), options);
  }

  locale(locale: Locale): Localizer {
    return this.#i18n.locale(locale);
  }
}

class DocumentLocaleMonitor {
  readonly #document: Document;
  readonly #defaultLocale: Locale | null;
  readonly #listeners = new Set<ChangeListener>();
  #locale: Locale | null;
  #mutationObserver: MutationObserver | null = null;

  constructor(document: Document, defaultLocale: Locale | null = null) {
    this.#document = document;
    this.#defaultLocale = defaultLocale;
    this.#locale =
      document.documentElement.getAttribute("lang") || defaultLocale;
  }

  getLocale(): Locale | null {
    return this.#locale;
  }

  onChange(listener: ChangeListener): Unsubscribe {
    this.#listeners.add(listener);
    this.#activate();

    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#deactivate();
      }
    };
  }

  #updateLocaleInfo(): void {
    const nextLocale =
      this.#document.documentElement.getAttribute("lang") ||
      this.#defaultLocale;

    if (nextLocale === this.#locale) {
      return;
    }

    this.#locale = nextLocale;

    for (const listener of this.#listeners) {
      listener();
    }
  }

  #activate(): void {
    if (this.#mutationObserver) {
      return;
    }

    this.#updateLocaleInfo();

    this.#mutationObserver = new MutationObserver(() =>
      this.#updateLocaleInfo(),
    );
    this.#mutationObserver.observe(this.#document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });
  }

  #deactivate(): void {
    this.#mutationObserver?.disconnect();
    this.#mutationObserver = null;
  }
}

class DefaultLocalizeController
  extends DefaultLocalizer
  implements LocalizeController
{
  readonly #host: LocalizeControllerHost;
  readonly #i18n: I18n;
  #locale: Locale;
  #unsubscribe: Unsubscribe | null = null;

  constructor(host: LocalizeControllerHost, i18n: I18n) {
    super(i18n, dictByI18n.get(i18n) ?? globalDict, () => this.#locale);
    this.#i18n = i18n;
    this.#locale = i18n.getPrimaryLocale();
    this.#host = host;
    host.addController(this);
  }

  hostConnected(): void {
    const i18n = this.#i18n;

    const syncLocale = () => {
      this.#locale = i18n.getPrimaryLocale();
      this.#host.requestUpdate();
    };

    this.#unsubscribe = i18n.onLocaleChange(syncLocale);
    syncLocale();
  }

  hostDisconnected(): void {
    const unsubscribe = this.#unsubscribe;
    if (unsubscribe) {
      this.#unsubscribe = null;
      unsubscribe();
    }
  }
}

// === global instance state ===================================================

// Mutable singleton state for the global instance and its one-shot setup.
const globalState = {
  instance: null as I18n | null, // created lazily by `getI18n`
  config: null as I18nConfig | null, // stashed by `initI18n`, consumed by `getI18n`
  initCalled: false, // `initI18n` may run at most once
  initialized: false, // set once the instance has resolved its config
};

// The dictionary backing the global instance. Its localizer factory is
// late-bound because the instance itself is created lazily (see `getI18n`).
const globalDict = new Dictionary((locale) =>
  globalState.instance!.locale(locale),
);

// Associates each I18n instance with its own dictionary, so a localize
// controller bound to a specific instance resolves texts against the right one.
const dictByI18n = new WeakMap<I18n, Dictionary>();
