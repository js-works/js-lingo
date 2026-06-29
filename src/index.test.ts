import { describe, it, expect, vi, afterEach } from "vitest";

import { bundleTexts, createI18n, createNamespace, localize } from "./index.js";

import type {
  ChangeListener,
  LocalizeController,
  Translation,
  Unsubscribe,
} from "./index.js";

// `I18n` and `Localizer` are intentionally not exported; recover them from the
// public function signatures so the tests can type fakes precisely.
type I18n = ReturnType<typeof createI18n>;
type Localizer = ReturnType<I18n["locale"]>;

// A fresh copy of the module with all module-level singleton state reset.
// Needed for getI18n / initI18n tests, which mutate process-wide globals.
type I18nModule = typeof import("./index.js");
async function freshModule(): Promise<I18nModule> {
  vi.resetModules();
  return import("./index.js");
}

// --- shared fixtures ---------------------------------------------------------

type DemoTexts = {
  greeting: Translation;
  itemCount: Translation<{ count: number }>;
};

function demoNamespace(key = "demo") {
  return createNamespace<DemoTexts>({ key });
}

function makeHost() {
  const host = {
    updates: 0,
    controllers: [] as LocalizeController[],
    requestUpdate() {
      host.updates++;
    },
    addController(c: LocalizeController) {
      host.controllers.push(c);
    },
  };
  return host;
}

// A minimal hand-rolled I18n that actually fires locale-change events, so the
// reactive behaviour of the localize controller can be observed. Because it is
// not a DefaultI18n, it is absent from the internal dict registry, which also
// exercises the controller's `?? globalDict` fallback.
function makeReactiveI18n() {
  const backing = createI18n();
  let listeners: ChangeListener[] = [];
  const api = {
    current: "en-US" as string,
    addTexts: backing.addTexts.bind(backing),
    locale: (loc: string) => backing.locale(loc),
    getPrimaryLocale: () => api.current,
    getFallbackLocales: () => [] as string[],
    onLocaleChange(cb: ChangeListener): Unsubscribe {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    fire(next: string) {
      api.current = next;
      for (const l of listeners) l();
    },
    listenerCount: () => listeners.length,
  };
  return api;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- createNamespace ---------------------------------------------------------

describe("createNamespace", () => {
  it("exposes key and defaults group to null", () => {
    const ns = createNamespace({ key: "k" });
    expect(ns.key).toBe("k");
    expect(ns.group).toBeNull();
  });

  it("keeps an explicit group", () => {
    const ns = createNamespace({ key: "k", group: "g" });
    expect(ns.group).toBe("g");
  });

  it("returns frozen namespace and frozen full/partial results", () => {
    const ns = demoNamespace();
    const full = ns.full({ greeting: "Hi", itemCount: () => "" });
    const partial = ns.partial({ greeting: "Hi" });
    expect(Object.isFrozen(ns)).toBe(true);
    expect(Object.isFrozen(full)).toBe(true);
    expect(Object.isFrozen(partial)).toBe(true);
    expect(full.namespace).toBe(ns);
    expect(partial.texts).toEqual({ greeting: "Hi" });
  });
});

// --- bundleTexts -------------------------------------------------------------

describe("bundleTexts", () => {
  it("is an identity pass-through", () => {
    const ns = demoNamespace();
    const bundle = { "en-US": [ns.partial({ greeting: "Hi" })] };
    expect(bundleTexts(bundle)).toBe(bundle);
  });
});

// --- createI18n + Dictionary lookup ------------------------------------------

describe("createI18n / text lookup", () => {
  function withTexts() {
    const ns = demoNamespace();
    const i18n = createI18n();
    i18n.addTexts(
      bundleTexts({
        "en-US": [
          ns.full({
            greeting: "Hello",
            itemCount: ({ count }, l) => `${l.formatNumber(count)} items`,
          }),
        ],
        "de-DE": [
          ns.full({
            greeting: "Hallo",
            itemCount: ({ count }, l) => `${l.formatNumber(count)} Artikel`,
          }),
        ],
      }),
    );
    return { ns, i18n };
  }

  it("resolves static text per locale", () => {
    const { ns, i18n } = withTexts();
    expect(i18n.locale("en-US").getText(ns, "greeting")).toBe("Hello");
    expect(i18n.locale("de-DE").getText(ns, "greeting")).toBe("Hallo");
  });

  it("resolves a parameterized translation with a working localizer", () => {
    const { ns, i18n } = withTexts();
    expect(i18n.locale("en-US").getText(ns, "itemCount", { count: 1234 })).toBe(
      "1,234 items",
    );
    expect(i18n.locale("de-DE").getText(ns, "itemCount", { count: 1234 })).toBe(
      "1.234 Artikel",
    );
  });

  it("returns the key itself when the text is missing", () => {
    const { ns, i18n } = withTexts();
    expect(i18n.locale("en-US").getText(ns as any, "nope")).toBe("nope");
  });

  it("returns the key when a parameterized text is requested without params", () => {
    const { ns, i18n } = withTexts();
    // No params -> dictionary cannot invoke the function -> falls through to key.
    expect(i18n.locale("en-US").getText(ns as any, "itemCount")).toBe(
      "itemCount",
    );
  });

  it("treats a non-string / non-function value as missing", () => {
    const ns = createNamespace<Record<string, any>>({ key: "weird" });
    const i18n = createI18n();
    i18n.addTexts(bundleTexts({ "en-US": [ns.full({ n: 123 as any })] }));
    expect(i18n.locale("en-US").getText(ns as any, "n")).toBe("n");
  });

  it("is null-prototype safe for keys like 'toString'", () => {
    const ns = createNamespace<Record<string, any>>({ key: "proto" });
    const i18n = createI18n();
    // 'toString' is not registered; must report missing, not Object.prototype.toString.
    expect(i18n.locale("en-US").getText(ns as any, "toString")).toBe(
      "toString",
    );
  });

  it("memoizes the localizer per locale", () => {
    const { i18n } = withTexts();
    expect(i18n.locale("en-US")).toBe(i18n.locale("en-US"));
  });
});

// --- locale fallback ---------------------------------------------------------

describe("locale fallback", () => {
  it("falls back from a region locale to the bare language", () => {
    const ns = demoNamespace();
    const i18n = createI18n();
    i18n.addTexts(bundleTexts({ de: [ns.partial({ greeting: "Hallo" })] }));
    // de-CH -> [de-CH, de]; only "de" exists.
    expect(i18n.locale("de-CH").getText(ns, "greeting")).toBe("Hallo");
  });

  it("falls back via reconstructed language-region when a script is present", () => {
    const ns = demoNamespace();
    const i18n = createI18n();
    i18n.addTexts(bundleTexts({ "zh-TW": [ns.partial({ greeting: "haha" })] }));
    // zh-Hant-TW -> [zh-Hant-TW, zh, zh-TW]; only "zh-TW" exists.
    expect(i18n.locale("zh-Hant-TW").getText(ns, "greeting")).toBe("haha");
  });

  it("throws when the queried locale is not a valid BCP-47 tag", () => {
    const ns = demoNamespace();
    const i18n = createI18n();
    expect(() => i18n.locale("de DE").getText(ns as any, "greeting")).toThrow();
  });
});

// --- addTexts / bundle normalization -----------------------------------------

describe("addTexts", () => {
  it("merges multiple bundles with last-write-wins", () => {
    const ns = demoNamespace();
    const i18n = createI18n();
    i18n.addTexts(
      bundleTexts({ "en-US": [ns.partial({ greeting: "A" })] }),
      bundleTexts({ "en-US": [ns.partial({ greeting: "B" })] }),
    );
    expect(i18n.locale("en-US").getText(ns, "greeting")).toBe("B");
  });

  it("merges keys within one bundle that normalize to the same locale", () => {
    const ns = demoNamespace();
    const i18n = createI18n();
    // "de-DE" and "de-de" are distinct object keys that canonicalize identically.
    i18n.addTexts(
      bundleTexts({
        "de-DE": [ns.partial({ greeting: "first" })],
        "de-de": [ns.partial({ itemCount: () => "second" })],
      } as any),
    );
    const loc = i18n.locale("de-DE");
    expect(loc.getText(ns, "greeting")).toBe("first");
    expect(loc.getText(ns, "itemCount", { count: 0 })).toBe("second");
  });

  it("accepts an empty call without throwing", () => {
    const i18n = createI18n();
    expect(() => i18n.addTexts()).not.toThrow();
  });

  it("tolerates an invalid locale key (normalization falls back to raw)", () => {
    const ns = demoNamespace();
    const i18n = createI18n();
    expect(() =>
      i18n.addTexts(bundleTexts({ "de DE": [ns.partial({ greeting: "x" })] })),
    ).not.toThrow();
  });
});

// --- Localizer formatting ----------------------------------------------------

describe("Localizer formatting", () => {
  const ns = demoNamespace();
  const i18n = createI18n();
  i18n.addTexts(bundleTexts({ "en-US": [ns.partial({ greeting: "Hi" })] }));
  const en = i18n.locale("en-US");
  const de = i18n.locale("de-DE");

  it("formatNumber respects the locale", () => {
    expect(en.formatNumber(1234.5)).toBe("1,234.5");
    expect(de.formatNumber(1234.5)).toBe("1.234,5");
  });

  it("numberFormat returns an Intl.NumberFormat", () => {
    expect(en.numberFormat({ style: "percent" })).toBeInstanceOf(
      Intl.NumberFormat,
    );
  });

  it("formatDateTime respects the locale", () => {
    const d = new Date(Date.UTC(2023, 0, 2));
    const opts: Intl.DateTimeFormatOptions = {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    const enOut = en.formatDateTime(d, opts);
    const deOut = de.formatDateTime(d, opts);
    expect(enOut).toBe("01/02/2023");
    expect(deOut).toBe("02.01.2023");
  });

  it("dateTimeFormat returns an Intl.DateTimeFormat", () => {
    expect(en.dateTimeFormat()).toBeInstanceOf(Intl.DateTimeFormat);
  });

  it("locale() switches the active localizer", () => {
    const ns2 = demoNamespace("switch");
    const inst = createI18n();
    inst.addTexts(
      bundleTexts({
        "en-US": [ns2.partial({ greeting: "Hi" })],
        "de-DE": [ns2.partial({ greeting: "Hallo" })],
      }),
    );
    const fromEn = inst.locale("en-US");
    const switched = fromEn.locale("de-DE");
    expect(switched.getText(ns2, "greeting")).toBe("Hallo");
  });
});

// --- localize controller -----------------------------------------------------

describe("localize controller", () => {
  it("binds to a passed instance and reads from its dictionary", () => {
    const ns = demoNamespace("ctrl");
    const inst = createI18n();
    inst.addTexts(
      bundleTexts({ "en-US": [ns.partial({ greeting: "Bound" })] }),
    );

    const host = makeHost();
    const ctrl = localize(host, inst);
    expect(host.controllers).toContain(ctrl);

    ctrl.hostConnected();
    expect(host.updates).toBe(1); // initial sync
    expect(ctrl.getText(ns, "greeting")).toBe("Bound");

    ctrl.hostDisconnected();
  });

  it("reacts to locale-change events and stops after disconnect", () => {
    const reactive = makeReactiveI18n();
    const host = makeHost();
    const ctrl = localize(host, reactive as unknown as I18n);

    ctrl.hostConnected();
    expect(host.updates).toBe(1);
    expect(reactive.listenerCount()).toBe(1);

    reactive.fire("de-DE");
    expect(host.updates).toBe(2);

    ctrl.hostDisconnected();
    expect(reactive.listenerCount()).toBe(0);

    reactive.fire("fr-FR");
    expect(host.updates).toBe(2); // no further updates once unsubscribed
  });

  it("defaults to the global instance when none is passed", () => {
    const host = makeHost();
    const ctrl = localize(host);
    ctrl.hostConnected();
    expect(host.updates).toBe(1);
    ctrl.hostDisconnected();
  });

  it("hostDisconnected is a no-op when never connected", () => {
    const host = makeHost();
    const ctrl = localize(host, createI18n());
    expect(() => ctrl.hostDisconnected()).not.toThrow();
    expect(host.updates).toBe(0);
  });
});

// --- global instance: getI18n -----------------------------------------------

describe("getI18n", () => {
  it("returns a stable singleton", async () => {
    const m = await freshModule();
    expect(m.getI18n()).toBe(m.getI18n());
  });

  it("resolves static and parameterized texts on the global instance", async () => {
    const m = await freshModule();
    const ns = m.createNamespace<DemoTexts>({ key: "global" });
    m.getI18n().addTexts(
      m.bundleTexts({
        "en-US": [
          ns.full({
            greeting: "Hi",
            itemCount: ({ count }, l) => `${l.formatNumber(count)}!`,
          }),
        ],
      }),
    );
    expect(m.getI18n().locale("en-US").getText(ns, "greeting")).toBe("Hi");
    // Exercises the global dictionary's localizer factory.
    expect(
      m.getI18n().locale("en-US").getText(ns, "itemCount", { count: 7 }),
    ).toBe("7!");
  });

  it("reports hardcoded primary/fallback locales and a no-op unsubscribe", async () => {
    const m = await freshModule();
    const i18n = m.getI18n();
    expect(i18n.getPrimaryLocale()).toBe("en-US");
    expect(i18n.getFallbackLocales()).toEqual([]);
    const unsub = i18n.onLocaleChange(() => {});
    expect(() => unsub()).not.toThrow();
  });

  it("installs a document locale monitor on the client side", async () => {
    vi.stubGlobal("window", globalThis);
    const m = await freshModule();
    // Triggers lazy config resolution (the client-side branch).
    expect(() => m.getI18n().locale("en-US")).not.toThrow();
  });

  it("skips the monitor when config already supplies a primary locale", async () => {
    vi.stubGlobal("window", globalThis);
    const m = await freshModule();
    m.initI18n({ getPrimaryLocale: () => "fr-FR" });
    expect(() => m.getI18n().locale("en-US")).not.toThrow();
  });

  it("skips the monitor when not on the client side", async () => {
    vi.stubGlobal("window", undefined);
    const m = await freshModule();
    expect(() => m.getI18n().locale("en-US")).not.toThrow();
  });
});

// --- initI18n ----------------------------------------------------------------

describe("initI18n", () => {
  it("can configure the global instance before first use", async () => {
    const m = await freshModule();
    expect(() =>
      m.initI18n({ getFallbackLocales: () => ["en"] }),
    ).not.toThrow();
    expect(m.getI18n()).toBeDefined();
  });

  it("throws if called more than once", async () => {
    const m = await freshModule();
    m.initI18n({});
    expect(() => m.initI18n({})).toThrow(/only be called once/);
  });

  it("throws if the global instance is already initialized", async () => {
    const m = await freshModule();
    // Force initialization by using the instance first.
    m.getI18n().locale("en-US");
    expect(() => m.initI18n({})).toThrow(/already been initialized/);
  });
});
