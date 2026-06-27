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
  LocalizedText,
  Namespace,
  NamespaceKey,
  NamespaceTexts,
  TextBundle,
  TextKey,
  TextMap,
  Unsubscribe,
};

// === types =========================================================

type Locale = string; // NOSONAR
type TextKey = string; // NOSONAR
type Unsubscribe = () => void;
type ChangeListener = () => void;

type LocalizedText =
  | string
  | (<T extends Record<string, unknown>>(
      param: T,
      localizer: Localizer,
    ) => string);

type TextMap = Record<string, LocalizedText>;
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

type Namespace<T extends TextMap> = Readonly<{
  key: NamespaceKey;
  group: string | null;
  full(texts: T): NamespaceTexts<T>;
  partial(texts: Partial<T>): NamespaceTexts<T>;
}>;

type I18n = {
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

  getLocalizer(locale: Locale): Localizer;
  addTexts(...textBundles: TextBundle[]): void;
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
  getText<T extends TextMap>(namespace: Namespace<T>, key: keyof T): string;
  formatNumber(value: number, option?: Intl.NumberFormatOptions): string;
  numberFormat(option?: Intl.NumberFormatOptions): Intl.NumberFormat;
  formatDateTime(value: Date, option?: Intl.DateTimeFormatOptions): string;
  dateTimeFormat(option?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat;
  getLocalizer(locale: Locale): Localizer;
  getI18n(): I18n;
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

// === local state =============================================================

// Will be created lazily (see: getI18n)
let i18n: I18n | null = null;

// State used by function `initI18n` - shall only be callable once.
let initI18nHasAlreadyBeenCalled = false;

// Shared state betweeen functions `initI18n` and `getI18n`.
let i18nConfig: I18nConfig | null = null;
let i18nHasAlreadyBeenInitialized = false;

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

  if (i18nHasAlreadyBeenInitialized) {
    throw new Error(
      "Too late to call function 'initI18n' - i18n has already been initialized.",
    );
  }

  initI18nHasAlreadyBeenCalled = true;
  i18nConfig = { ...config };
}

function getI18n() {
  let config: I18nConfig | null = null;

  if (!i18n) {
    const getConfig = () => {
      if (config) {
        return config;
      }

      config = i18nConfig ?? {};

      if (
        isClientSide() &&
        !config.getPrimaryLocale &&
        !config.onPrimaryLocaleChange
      ) {
        const monitor = new DocumentLocaleMonitor(document);
        config.getPrimaryLocale = () => monitor.getLocale() || "en-US";
        config.onPrimaryLocaleChange = (listener) => monitor.onChange(listener);
      }

      i18nConfig = null; // Not needed any longer.
      return config;
    };

    i18n = new DefaultI18n(getConfig, true);
  }

  return i18n;
}

function createI18n(config: I18nConfig = {}): I18n {
  const clonedConfig = { ...config };
  return new DefaultI18n(() => clonedConfig);
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

function localize(host: LocalizeControllerHost, i18n?: I18n) {
  return new DefaultLocalizeController(host, i18n);
}

// For type safety and expressiveness.
function bundleTexts<T extends TextBundle>(texts: T): TextBundle {
  return texts;
}

// === internal classes ========================================================

class DefaultI18n implements I18n {
  #config: I18nConfig | null = null;
  readonly #getConfig: () => I18nConfig;
  readonly #primaryLocaleListners: ChangeListener[] = [];
  readonly #fallbackLocalesListners: ChangeListener[] = [];
  #dict: Record<Locale, Record<NamespaceKey, Record<string, LocalizedText>>> =
    createRecord();
  #localizerByLocale: Record<Locale, Localizer> = createRecord();
  #textsToAdd: Record<Locale, NamespaceTexts<any>[]>[] | null;

  constructor(getConfig: () => I18nConfig, addTextsLazily = false) {
    this.#getConfig = getConfig;
    this.#textsToAdd = addTextsLazily ? [] : null;
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

    // normalize BEFORE buffering
    const normalizedBundle = this.#normalizeTextBundle(textBundle);

    if (this.#textsToAdd) {
      this.#textsToAdd.push(normalizedBundle);
      return;
    }

    this.#applyTextBundle(normalizedBundle);
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
    byNamespace: Record<NamespaceKey, Record<string, LocalizedText>>,
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

      // last-write-wins
      texts[key] = value;

      this.#notifyAddText(locale, bundle.namespace, key);
    }
  }

  #getOrCreateLocale(
    locale: string,
  ): Record<NamespaceKey, Record<string, LocalizedText>> {
    const normalizedLocale = this.#normalizeLocaleKey(locale);

    let byNamespace = this.#dict[normalizedLocale];

    if (!byNamespace) {
      byNamespace = createRecord();
      this.#dict[normalizedLocale] = byNamespace;
    }

    return byNamespace;
  }

  #notifyAddText(locale: string, namespace: Namespace<any>, key: string): void {
    const config = this.#getConfig();

    if (config.onAddTexts) {
      config.onAddTexts(locale, namespace, key);
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

  getText(
    locale: Locale,
    namespace: Namespace<any>,
    key: string,
    params: Record<string, LocalizedText> | null = null,
  ) {
    this.#init();

    return this.#getText(
      new Intl.Locale(locale),
      namespace.key,
      key,
      params ?? null,
    );
  }

  getLocalizer(locale: Locale): Localizer {
    this.#init();
    let localizer = this.#localizerByLocale[locale];

    if (!localizer) {
      localizer = new DefaultLocalizer(this, () => locale);
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

  #getText(
    locale: Intl.Locale,
    namespaceKey: NamespaceKey,
    key: TextKey,
    params: Record<string, LocalizedText> | null,
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
    params: Record<string, LocalizedText> | null,
  ): string | null {
    const byNamespace = this.#dict[locale];
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

      const localizer = this.getLocalizer(locale);
      return value(params, localizer);
    }

    return null;
  }

  #init() {
    if (this === i18n) {
      i18nHasAlreadyBeenInitialized = true;
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
  readonly #getLocale: () => Locale;

  constructor(i18n: I18n, getLocale: () => Locale) {
    this.#i18n = i18n;
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
    params: Record<string, LocalizedText> | null = null,
  ) {
    return this.#i18n.getText(
      this.#getLocale(),
      namespace,
      key,
      params || null,
    );
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

  getLocalizer(locale: Locale): Localizer {
    return this.#i18n.getLocalizer(locale);
  }

  getI18n(): I18n {
    return this.#i18n;
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

  constructor(host: LocalizeControllerHost, i18n: I18n = getI18n()) {
    super(i18n, () => this.#locale);
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
