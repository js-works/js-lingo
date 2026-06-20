export {
  createI18n,
  createNamespace,
  defineTranslations,
  getI18n,
  initI18n,
  localize,
};

export type {
  ChangeListener,
  Locale,
  LocalizeController,
  LocalizeControllerHost,
  LocaleTranslations,
  Translation,
  TranslationKey,
  TranslationMap,
  NamespaceId,
  NamespaceTranslations,
  Unsubscribe,
};

// === types =========================================================

type Locale = string;
type TranslationKey = string;
type Unsubscribe = () => void;
type ChangeListener = () => void;
type Translation =
  | string
  | (<T extends Record<string, unknown>>(param: T) => string);
type TranslationMap = Record<string, Translation>;
type LocaleTranslations = Record<Locale, NamespaceTranslations[]>;

type TranslationParams<T> = T extends (
  params: Record<string, any>,
  localizer: Localizer,
) => string
  ? Parameters<T>[0]
  : never;

type SimpleTranslationKey<K, T> = T extends (
  params: Record<string, any>,
  localizer: Localizer,
) => string
  ? never
  : K extends string
    ? K
    : never;

type NamespaceTranslations = {
  namespaceId: NamespaceId;
  translations: TranslationMap;
  partial: boolean;
};

type NamespaceId = string;

type TranslationNamespace<T extends TranslationMap> = Readonly<{
  id: NamespaceId;
  full(translations: T): NamespaceTranslations;
  partial(translations: Partial<T>): NamespaceTranslations;
}>;

type I18n = {
  getText<T extends TranslationMap, K extends keyof T>(
    locale: Locale,
    namespace: TranslationNamespace<T>,
    key: K,
    params: TranslationParams<T[K]>,
  ): string;

  getText<T extends TranslationMap, K extends keyof T>(
    locale: Locale,
    namespace: TranslationNamespace<T>,
    key: SimpleTranslationKey<K, T[K]>,
  ): string;

  getLocalizer(locale: Locale): Localizer;
  registerTranslations(texts: Record<Locale, NamespaceTranslations[]>): void;
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
  onAddTranslations?(
    locale: Locale,
    namespace: NamespaceId,
    key: TranslationKey,
  ): void;
  // More to come in futue.
};

type Localizer = {
  getText<T extends TranslationMap>(
    namespace: TranslationNamespace<T>,
    key: keyof T,
  ): string;
  formatNumber(value: number, option?: Intl.NumberFormatOptions): string;
  numberFormat(option?: Intl.NumberFormatOptions): Intl.NumberFormat;
  formatDateTime(value: Date, option?: Intl.DateTimeFormatOptions): string;
  dateTimeFormat(option?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat;
  getLocalizer(locale: Locale): Localizer;
  getI18n(): I18n;
};

type LocalizeController = {
  hostConnected?(): void;
  hostDisconnected?(): void;
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
let i18nHasAlreadyBeenInitialized = false; // TODO: Has to be set somewhere :-)

// === internal functions ============================================

function createRecord() {
  return Object.create(null);
}

function freeze<T extends Record<string, any>>(obj: T): Readonly<T> {
  return Object.freeze(obj);
}

function isClientSide() {
  return (
    typeof window === "object" &&
    globalThis === window &&
    typeof document === "object" &&
    typeof document.documentElement === "object" &&
    typeof MutationObserver === "function"
  );
}

// === exported functions ======================================================

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

    i18n = new I18nImpl(getConfig, true);
  }

  return i18n;
}

function createI18n(config: I18nConfig = {}): I18n {
  const clonedConfig = { ...config };
  return new I18nImpl(() => clonedConfig);
}

function createNamespace<T extends TranslationMap>(
  id: NamespaceId,
): TranslationNamespace<T> {
  return freeze({
    id,
    full: (translations) =>
      freeze({ namespaceId: id, translations, partial: false }),
    partial: (translations) =>
      freeze({
        namespaceId: id,
        translations: translations as TranslationMap,
        partial: true,
      }),
  });
}

function localize(host: LocalizeControllerHost, i18n?: I18n) {
  return new DefaultLocalizeController(host, i18n);
}

// For type safety and expressiveness.
function defineTranslations<T extends LocaleTranslations>(
  translations: T,
): LocaleTranslations {
  return translations;
}

// === internal classes ========================================================

class I18nImpl implements I18n {
  #config: I18nConfig | null = null;
  readonly #getConfig: () => I18nConfig;
  #primaryLocaleListners: ChangeListener[] = [];
  #fallbackLocalesListners: ChangeListener[] = [];
  #dict: Record<Locale, Record<NamespaceId, Record<string, Translation>>> =
    createRecord();
  #localizerByLocale: Record<Locale, Localizer> = createRecord();
  #translationsToAdd: Record<Locale, NamespaceTranslations[]>[] | null;

  constructor(getConfig: () => I18nConfig, addTranslationsLazily = false) {
    this.#getConfig = getConfig;
    this.#translationsToAdd = addTranslationsLazily ? [] : null;
  }

  registerTranslations(...bundles: LocaleTranslations[]): void {
    if (bundles.length === 0) {
      return;
    }

    if (bundles.length > 1) {
      for (const bundle of bundles) {
        this.registerTranslations(bundle);
      }

      return;
    }

    const texts = bundles[0];

    if (this.#translationsToAdd) {
      this.#translationsToAdd.push(texts);
      return;
    }

    for (const [locale, bundles] of Object.entries(texts)) {
      let byNamespace = this.#dict![locale];

      if (!byNamespace) {
        byNamespace = createRecord();
        this.#dict[locale] = byNamespace;
      }

      for (const bundle of bundles) {
        const namespaceKey = bundle.namespaceId;

        for (const [key, value] of Object.entries(bundle.translations)) {
          let translations = byNamespace[namespaceKey];

          if (!translations) {
            translations = createRecord();
            byNamespace[namespaceKey] = translations;
          }

          translations[key] = value;
          const config = this.#getConfig();

          if (config.onAddTranslations) {
            config.onAddTranslations(locale, namespaceKey, key);
          }
        }
      }
    }
  }

  getText<T extends TranslationMap, K extends keyof T>(
    locale: Locale,
    namespace: TranslationNamespace<T>,
    key: K,
    params: TranslationParams<T[K]>,
  ): string;

  getText<T extends TranslationMap, K extends keyof T>(
    locale: Locale,
    namespace: TranslationNamespace<T>,
    key: SimpleTranslationKey<K, T[K]>,
  ): string;

  getText(
    locale: Locale,
    namespace: TranslationNamespace<any>,
    key: string,
    params: Record<string, Translation> | null = null,
  ) {
    this.#init();
    console.log(this.#dict);
    return this.#getText(
      new Intl.Locale(locale),
      namespace.id,
      key,
      params ?? null,
    );
  }

  getLocalizer(locale: Locale): Localizer {
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
    namespaceKey: NamespaceId,
    key: TranslationKey,
    params: Record<string, Translation> | null,
  ): string {
    const base = locale.baseName;
    const language = locale.language.toLowerCase() ?? "";
    const region = locale.region?.toLowerCase() ?? "";
    const languageAndRegion = language + (region ? "-" : "") + region;
    const localesToTry: Locale[] = [base];

    if (languageAndRegion !== base) {
      localesToTry.push(languageAndRegion);
    }

    if (language != languageAndRegion) {
      localesToTry.push(language);
    }

    let ret: string | null = null;

    for (const localeToTry of localesToTry) {
      ret = this.#getTextByExactLocale(localeToTry, namespaceKey, key, params);

      if (ret !== null) {
        break;
      }
    }

    return ret != null ? ret : key;
  }

  #getTextByExactLocale(
    locale: string,
    namespaceKey: NamespaceId,
    key: TranslationKey,
    params: Record<string, Translation> | null,
  ): string | null {
    let rec: Record<string, any> = this.#dict[locale]; // TODO
    if (!rec) {
      return null;
    }

    rec = rec[namespaceKey];

    if (!rec) {
      return null;
    }

    const translation = rec[key];

    if (params === null) {
      if (typeof translation === "string") {
        return translation;
      }

      return key;
    }

    return translation(params);
  }

  #init() {
    if (this.#config) {
      return;
    }

    this.#config = this.#getConfig() ?? {};
    console.log(this.#translationsToAdd?.length);

    if (this.#translationsToAdd) {
      const translationsToAdd = this.#translationsToAdd;
      this.#translationsToAdd = null;
      for (const translations of translationsToAdd) {
        this.registerTranslations(translations);
      }
    }
  }
}

class DefaultLocalizer implements Localizer {
  #i18n: I18n;
  #getLocale: () => Locale;

  constructor(i18n: I18n, getLocale: () => Locale) {
    this.#i18n = i18n;
    this.#getLocale = getLocale;
  }

  getText<T extends TranslationMap, K extends keyof T & string>(
    namespace: TranslationNamespace<T>,
    key: K,
    params: TranslationParams<T[K]>,
  ): string;

  getText<T extends TranslationMap, K extends keyof T & string>(
    namespace: TranslationNamespace<T>,
    key: SimpleTranslationKey<K, T[K]>,
  ): string;

  getText(
    namespace: TranslationNamespace<any>,
    key: string,
    params: Record<string, Translation> | null = null,
  ) {
    return this.#i18n.getText(
      this.#getLocale(),
      namespace,
      key as string,
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
  #document: Document;
  #defaultLocale: Locale | null;
  #locale: Locale | null;
  #listeners = new Set<ChangeListener>();
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
    this.#locale =
      this.#document.documentElement.getAttribute("lang") ||
      this.#defaultLocale;
  }

  #activate() {
    let mutationObserver: MutationObserver | null = null;
    this.#updateLocaleInfo();

    this.#mutationObserver = new MutationObserver(() =>
      this.#updateLocaleInfo(),
    );

    this.#mutationObserver.observe(document.getRootNode(), {
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
  #host: LocalizeControllerHost;
  #locale = getI18n().getPrimaryLocale();
  #unsubscribe: Unsubscribe | null = null;

  constructor(host: LocalizeControllerHost, i18n: I18n = getI18n()) {
    super(i18n, () => this.#locale);
    this.#host = host;
    host.addController(this);
  }

  hostConnected(): void {
    const unsubscribe = this.#unsubscribe;

    if (unsubscribe) {
      this.#unsubscribe = null;
      unsubscribe();
    }

    const update = () => this.#host.requestUpdate();
    const unsubscribe1 = getI18n().onPrimaryLocaleChange(update);
    const unsubscribe2 = getI18n().onFallbackLocalesChange(update);

    this.#unsubscribe = () => {
      unsubscribe1();
      unsubscribe2();
    };
  }

  hostDisconnected(): void {
    const unsubscribe = this.#unsubscribe;

    if (unsubscribe) {
      this.#unsubscribe = null;
      unsubscribe();
    }
  }
}
