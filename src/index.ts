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

// === types =========================================================

type Locale = string; // NOSONAR
type TextKey = string; // NOSONAR
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

type TextKeysWithParams<T extends Record<string, unknown>> = {
  [K in keyof T]: T[K] extends TranslationFn<any> ? K : never;
}[keyof T];

type TextKeysWithoutParams<T extends TextMap> = Exclude<
  keyof T,
  TextKeysWithParams<T>
>;

type LocalizedText<T extends Record<string, unknown> = Record<string, never>> =
  | string
  | TranslationFn<T>;

type TextMap = Record<string, LocalizedText<any>>;
type TextBundle = Record<Locale, NamespaceTexts<any>[]>;

type TextParams<T> = T extends (
  params: Record<string, any>,
  localizer: Localizer,
) => string
  ? Parameters<T>[0]
  : never;

type SimpleTextKey<K, T> = T extends (
  params: Record<string, any>,
  localizer: Localizer,
) => string
  ? never
  : K extends string
    ? K
    : never;

type NamespaceTexts<T extends TextMap> = {
  namespace: Namespace<T>;
  texts: Partial<T>;
};

type NamespaceKey = string; // NOSONAR

type Namespace<T extends TextMap> = {
  readonly key: string;
  readonly group: string | null;
  full(texts: T): NamespaceTexts<T>;
  partial(texts: Partial<T>): NamespaceTexts<T>;
};

const x = createNamespace<{
  name: string;
  status: (params: { status: string }) => string;
}>({
  key: "some-namespace-key",
});

type I18n = {
  addTexts(...textBundles: TextBundle[]): void;
  locale(locale: Locale): Localizer;
  getPrimaryLocale(): Locale;
  onPrimaryLocaleChange(listener: ChangeListener): Unsubscribe;
  getFallbackLocales(): Locale[];
  onFallbackLocalesChange(listener: ChangeListener): Unsubscribe;
};

type I18nConfig = {
  getPrimaryLocale?(): Locale;
  onPrimaryLocaleChange?(listener: ChangeListener): Unsubscribe;
  getFallbackLocales?(): Locale[];
  onFallbackLocalesChange?(listener: ChangeListener): Unsubscribe;
  onAddTexts?(locale: Locale, namespace: Namespace<any>, key: TextKey): void;
  // More to come in futue.
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

type ExactKeys<T, Shape> = T extends Shape
  ? Shape extends T
    ? T
    : never
  : never;

// === internal functions ======================================================

function createRecord() {
  return Object.create(null);
}

function freeze<T extends Record<string, any>>(obj: T): Readonly<T> {
  return Object.freeze(obj);
}

function isClientSide() {
  return (
    globalThis.window === globalThis &&
    typeof document === "object" &&
    globalThis.document === document &&
    typeof document.documentElement === "object" &&
    typeof MutationObserver === "function"
  );
}

// === exported functions ============================================

function initI18n(config: I18nConfig) {
  if (initI18nHasAlreadyBeenCalled) {
    throw new Error("Function 'initI18n' can only be called once.");
  }

  if (globalI18nHasAlreadyBeenInitialized) {
    throw new Error(
      "Too late to call function 'initI18n' - i18n has already been initialized.",
    );
  }

  initI18nHasAlreadyBeenCalled = true;
  globalI18nConfig = { ...config };
}

function getI18n() {
  let config: I18nConfig | null = null;

  if (!globalI18n) {
    const getConfig = () => {
      if (config) {
        return config;
      }

      config = globalI18nConfig ?? {};

      if (
        isClientSide() &&
        !config.getPrimaryLocale &&
        !config.onPrimaryLocaleChange
      ) {
        const monitor = new DocumentLocaleMonitor(document);
        config.getPrimaryLocale = () => monitor.getLocale() || "en-US";
        config.onPrimaryLocaleChange = (listener) => monitor.onChange(listener);
      }

      globalI18nConfig = null; // Not needed any longer.
      return config;
    };

    globalI18n = new DefaultI18n(globalDict, getConfig, true);
  }

  return globalI18n;
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
  const namespace = freeze({
    key: params.key,
    group: params.group ?? null,
    full: (texts: T) =>
      freeze({
        namespace,
        texts,
      }),
    partial: (texts: Partial<T>) =>
      freeze({
        namespace,
        texts,
      }),
  });

  return namespace;
}

function localize(host: LocalizeControllerHost) {
  return new DefaultLocalizeController(host);
}

// For type safety and expressiveness.
function bundleTexts<T extends TextBundle>(texts: T): TextBundle {
  return texts;
}

// === internal classes ========================================================

class Dictionary {
  readonly #data: Record<
    Locale,
    Record<NamespaceKey, Record<string, LocalizedText<any>>>
  > = createRecord();

  readonly #getLocalizer: (locale: Locale) => Localizer;

  constructor(getLocalizer: (locale: Locale) => Localizer) {
    this.#data = {};
    this.#getLocalizer = getLocalizer;
  }

  addTexts(...bundles: TextBundle[]): void {
    if (bundles.length === 0) {
      return;
    }

    if (bundles.length > 1) {
      for (const bundle of bundles) {
        this.addTexts(bundle);
      }
      return;
    }

    const textBundle = bundles[0];
    const normalizedBundle = this.#normalizeTextBundle(textBundle);
    this.#applyTextBundle(normalizedBundle);
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
    params: Record<string, LocalizedText<any>> | null = null,
  ) {
    return this.#getText(
      new Intl.Locale(locale),
      namespace.key,
      key,
      params ?? null,
    );
  }

  #getText(
    locale: Intl.Locale,
    namespaceKey: NamespaceKey,
    key: TextKey,
    params: Record<string, LocalizedText<any>> | null,
  ): string {
    const localesToTry: string[] = [locale.baseName];

    const add = (value?: string | null) => {
      if (!value) return;

      let normalized: string;
      try {
        normalized = new Intl.Locale(value).baseName;
      } catch {
        normalized = value;
      }

      if (!localesToTry.includes(normalized)) {
        localesToTry.push(normalized);
      }
    };

    if (locale.language) {
      add(locale.language.toLowerCase());

      if (locale.region) {
        add(`${locale.language}-${locale.region}`);
      }
    }

    let ret: string | null = null;

    for (const localeToTry of localesToTry) {
      ret = this.#getTextByExactLocale(localeToTry, namespaceKey, key, params);

      if (ret !== null) {
        break;
      }
    }

    return ret ?? key;
  }

  #getTextByExactLocale(
    locale: string,
    namespaceKey: NamespaceKey,
    key: TextKey,
    params: Record<string, LocalizedText<any>> | null,
  ): string | null {
    const byNamespace = this.#data[locale];
    if (!byNamespace) return null;

    const entries = byNamespace[namespaceKey];
    if (!entries) return null;

    const value = entries[key];

    if (value == null) {
      return null;
    }

    // Static text
    if (typeof value === "string") {
      return value;
    }

    // Dynamic text
    if (typeof value === "function") {
      if (params === null) {
        return null;
      }

      const localizer = this.#getLocalizer(locale);
      return value(params, localizer);
    }

    return null;
  }

  #normalizeTextBundle(texts: TextBundle): TextBundle {
    const result: TextBundle = {};

    for (const [locale, namespaceBundles] of Object.entries(texts)) {
      const normalizedLocale = this.#normalizeLocaleKey(locale);

      result[normalizedLocale] ??= [];

      result[normalizedLocale].push(...namespaceBundles);
    }

    return result;
  }

  #normalizeLocaleKey(locale: string): string {
    try {
      return new Intl.Locale(locale).baseName;
    } catch {
      return locale;
    }
  }

  #applyTextBundle(texts: TextBundle): void {
    for (const [locale, namespaceBundles] of Object.entries(texts)) {
      const byNamespace = this.#getOrCreateLocale(locale);

      for (const bundle of namespaceBundles) {
        this.#applyNamespaceBundle(locale, byNamespace, bundle);
      }
    }
  }

  #applyNamespaceBundle(
    locale: string,
    byNamespace: Record<NamespaceKey, Record<string, LocalizedText<any>>>,
    bundle: NamespaceTexts<any>,
  ): void {
    const namespaceKey = bundle.namespace.key;

    let texts = byNamespace[namespaceKey];

    if (!texts) {
      texts = createRecord();
      byNamespace[namespaceKey] = texts;
    }

    for (const key in bundle.texts) {
      const value = bundle.texts[key];
      texts[key] = value; // Last write wins.
    }
  }

  #getOrCreateLocale(
    locale: string,
  ): Record<NamespaceKey, Record<string, LocalizedText<any>>> {
    const normalizedLocale = this.#normalizeLocaleKey(locale);

    let byNamespace = this.#data[normalizedLocale];

    if (!byNamespace) {
      byNamespace = createRecord();
      this.#data[normalizedLocale] = byNamespace;
    }

    return byNamespace;
  }
}

class DefaultI18n implements I18n {
  #dict: Dictionary;
  #config: I18nConfig | null = null;
  readonly #getConfig: () => I18nConfig;
  readonly #primaryLocaleListners: ChangeListener[] = [];
  readonly #fallbackLocalesListners: ChangeListener[] = [];
  #localizerByLocale: Record<Locale, Localizer> = createRecord();
  #textsToAdd: Record<Locale, NamespaceTexts<any>[]>[] | null;

  constructor(
    dict: Dictionary,
    getConfig: () => I18nConfig,
    addTextsLazily = false,
  ) {
    this.#dict = dict;
    this.#getConfig = getConfig;
    this.#textsToAdd = addTextsLazily ? [] : null;
  }

  addTexts(...bundles: TextBundle[]): void {
    this.#dict.addTexts(...bundles);
  }

  locale(locale: Locale): Localizer {
    this.#init();
    let localizer = this.#localizerByLocale[locale];

    if (!localizer) {
      localizer = new DefaultLocalizer(this, this.#dict, () => locale);
      this.#localizerByLocale[locale] = localizer;
    }

    return localizer;
  }

  getPrimaryLocale(): Locale {
    return "en-US";
  }

  onPrimaryLocaleChange(listener: ChangeListener): Unsubscribe {
    this.#primaryLocaleListners.push(listener);
    return () => {};
  }

  getFallbackLocales(): Locale[] {
    return [];
  }

  onFallbackLocalesChange(listener: ChangeListener): Unsubscribe {
    this.#fallbackLocalesListners.push(listener);
    return () => {};
  }

  #init() {
    if (this === globalI18n) {
      globalI18nHasAlreadyBeenInitialized = true;
    }

    if (this.#config) {
      return;
    }

    this.#config = this.#getConfig() ?? {};

    if (this.#textsToAdd) {
      const textsToAdd = this.#textsToAdd;
      this.#textsToAdd = null;
      for (const texts of textsToAdd) {
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
    params: Record<string, LocalizedText<any>> | null = null,
  ) {
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

  constructor(document: Document, defaultLocale = null) {
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

    if (this.#listeners.size > 0) {
      this.#activate();
    }

    return () => {
      this.#listeners.delete(listener);

      if (this.#listeners.size === 0) {
        this.#deactivate();
      }
    };
  }

  #updateLocaleInfo() {
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

  #activate() {
    let mutationObserver: MutationObserver | null = null;
    this.#updateLocaleInfo();

    this.#mutationObserver = new MutationObserver(() =>
      this.#updateLocaleInfo(),
    );

    this.#mutationObserver.observe(this.#document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });
  }

  #deactivate() {
    if (!this.#mutationObserver) {
      return;
    }

    this.#mutationObserver.disconnect();
    this.#mutationObserver = null;
  }
}

class DefaultLocalizeController
  extends DefaultLocalizer
  implements LocalizeController
{
  readonly #host: LocalizeControllerHost;
  #locale = getI18n().getPrimaryLocale();
  #unsubscribe: Unsubscribe | null = null;

  constructor(host: LocalizeControllerHost) {
    super(getI18n(), globalDict, () => this.#locale);
    this.#host = host;
    host.addController(this);
  }

  hostConnected(): void {
    const i18n = getI18n();

    const syncLocale = () => {
      this.#locale = i18n.getPrimaryLocale();
      this.#host.requestUpdate();
    };

    const unsub1 = i18n.onPrimaryLocaleChange(syncLocale);
    const unsub2 = i18n.onFallbackLocalesChange(syncLocale);

    this.#unsubscribe = () => {
      unsub1();
      unsub2();
    };

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

// === local state =============================================================

// Dictionary for the global I18n instance.
const globalDict = new Dictionary((locale) => globalI18n!.locale(locale));

// Will be created lazily (see: getI18n).
let globalI18n: I18n | null = null;

// State used by function `initI18n` - shall only be callable once.
let initI18nHasAlreadyBeenCalled = false;
let globalI18nHasAlreadyBeenInitialized = false;

// Shared state betweeen functions `initI18n` and `getI18n`.
let globalI18nConfig: I18nConfig | null = null;
