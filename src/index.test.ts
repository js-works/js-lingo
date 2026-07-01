// @vitest-environment jsdom
//
// Single-file unit-test suite for the i18n library.
//
// Runner: vitest, jsdom environment (for the <html lang> monitor + MutationObserver).
//   npm i -D vitest jsdom @vitest/coverage-v8
//   npx vitest run --coverage
//
// The library keeps module-level singleton state (global instance, initI18n guards).
// Any test touching that state imports a FRESH copy via `freshModule()` so the tests
// stay independent and order-free.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { bundleTexts, createI18n, createNamespace, localize } from "./index.js";
import type { Translation } from "./index.js";

type Mod = typeof import("./index.js");

/** Re-evaluate the module so module-level globals reset between tests that need it. */
async function freshModule(): Promise<Mod> {
  vi.resetModules();
  return import("./index.js");
}

/** A minimal Lit-like host that records requestUpdate() calls. */
function makeHost() {
  const controllers: any[] = [];
  let updates = 0;
  return {
    controllers,
    get updates() {
      return updates;
    },
    requestUpdate() {
      updates++;
    },
    addController(c: any) {
      controllers.push(c);
    },
  };
}

/** Yield to the macrotask queue so jsdom's MutationObserver callbacks are delivered. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// Common namespaces used across tests.
const greet = createNamespace<{
  hello: Translation;
  count: Translation<{ n: number }>;
}>({ key: "greet" });

const weird = createNamespace<{ toString: string; constructor: string }>({
  key: "weird",
});

beforeEach(() => {
  // Reset <html lang> to a known empty state for DOM-dependent tests.
  document.documentElement.removeAttribute("lang");
});

/* ================================================================= *
 * createNamespace
 * ================================================================= */

describe("createNamespace", () => {
  it("defaults group to null and is frozen", () => {
    const ns = createNamespace<{ a: string }>({ key: "k" });
    expect(ns.key).toBe("k");
    expect(ns.group).toBeNull();
    expect(Object.isFrozen(ns)).toBe(true);
  });

  it("keeps an explicit group", () => {
    const ns = createNamespace<{ a: string }>({ key: "k", group: "g" });
    expect(ns.group).toBe("g");
  });

  it("full() and partial() produce frozen NamespaceTexts referencing the namespace", () => {
    const ns = createNamespace<{ a: string; b: string }>({ key: "k" });
    const full = ns.full({ a: "A", b: "B" });
    const part = ns.partial({ a: "A" });
    expect(full.namespace).toBe(ns);
    expect(part.namespace).toBe(ns);
    expect(full.texts).toEqual({ a: "A", b: "B" });
    expect(part.texts).toEqual({ a: "A" });
    expect(Object.isFrozen(full)).toBe(true);
    expect(Object.isFrozen(part)).toBe(true);
  });
});

/* ================================================================= *
 * bundleTexts
 * ================================================================= */

describe("bundleTexts", () => {
  it("is an identity function (returns the same reference)", () => {
    const b = { de: [greet.partial({ hello: "Hallo" })] };
    expect(bundleTexts(b)).toBe(b);
  });
});

/* ================================================================= *
 * createI18n — dictionary, resolution, formatting
 * ================================================================= */

describe("createI18n / resolution", () => {
  it("resolves a static string for the primary locale", () => {
    const i = createI18n({ getPrimaryLocale: () => "de" });
    i.addTexts({ de: [greet.partial({ hello: "Hallo" })] });
    expect(i.locale("de").getText(greet, "hello")).toBe("Hallo");
  });

  it("returns the key itself when nothing is found", () => {
    const i = createI18n({ getPrimaryLocale: () => "de" });
    expect(i.locale("de").getText(greet, "hello")).toBe("hello");
  });

  it("invokes a dynamic translation with params and a localizer", () => {
    const i = createI18n({ getPrimaryLocale: () => "en" });
    i.addTexts({
      en: [greet.partial({ count: (p, lz) => `n=${lz.formatNumber(p.n)}` })],
    });
    expect(i.locale("en").getText(greet, "count", { n: 1000 })).toBe("n=1,000");
  });

  it("uses a localizer for the FOUND (fallback) locale inside a dynamic translation", () => {
    // Primary de, fallback en. The dynamic value lives only in en, so its localizer
    // must format with en grouping (1,000) not de grouping (1.000).
    const i = createI18n({
      getPrimaryLocale: () => "de",
      getFallbackLocales: () => ["en"],
    });
    i.addTexts({
      en: [greet.partial({ count: (p, lz) => lz.formatNumber(p.n) })],
    });
    expect(i.locale("de").getText(greet, "count", { n: 1000 })).toBe("1,000");
  });

  it("skips a dynamic value when called without params and falls through", () => {
    // Bypass the typed overloads to hit the function-without-params skip branch.
    const i = createI18n({
      getPrimaryLocale: () => "de",
      getFallbackLocales: () => ["en"],
    });
    i.addTexts({
      de: [greet.partial({ count: (p) => `de-${p.n}` })],
      en: [greet.partial({ count: ((..._a: any[]) => "en-static") as any })],
    });
    const getAny = i.locale("de").getText as unknown as (
      ns: any,
      key: any,
    ) => string;
    // de's value is a function but no params -> skip; en's value is also a function
    // without params -> skip; nothing usable -> key.
    expect(getAny(greet, "count")).toBe("count");
  });

  it("treats null-prototype keys like 'toString' / 'constructor' as missing, not inherited", () => {
    const i = createI18n({ getPrimaryLocale: () => "de" });
    // Nothing added: must return the key, never "[object Object]" or a function.
    expect(i.locale("de").getText(weird, "toString")).toBe("toString");
    expect(i.locale("de").getText(weird, "constructor")).toBe("constructor");
    i.addTexts({ de: [weird.partial({ toString: "TS", constructor: "C" })] });
    expect(i.locale("de").getText(weird, "toString")).toBe("TS");
    expect(i.locale("de").getText(weird, "constructor")).toBe("C");
  });
});

/* ================================================================= *
 * Fallback locale chain ordering (#3) + configured fallbacks (#2)
 * ================================================================= */

describe("fallback chain ordering", () => {
  it("prefers language-region over bare language (zh-Hant-TW -> zh-TW -> zh)", () => {
    const ns = createNamespace<{ w: string }>({ key: "z" });
    const i = createI18n({ getPrimaryLocale: () => "zh-Hant-TW" });
    i.addTexts({
      zh: [ns.partial({ w: "generic" })],
      "zh-TW": [ns.partial({ w: "taiwan" })],
    });
    expect(i.locale("zh-Hant-TW").getText(ns, "w")).toBe("taiwan");
  });

  it("falls back to bare language when the region tag is absent", () => {
    const ns = createNamespace<{ w: string }>({ key: "z" });
    const i = createI18n({ getPrimaryLocale: () => "zh-Hant-TW" });
    i.addTexts({ zh: [ns.partial({ w: "generic" })] });
    expect(i.locale("zh-Hant-TW").getText(ns, "w")).toBe("generic");
  });

  it("two-subtag locales fall back to the bare language (de-CH -> de)", () => {
    const ns = createNamespace<{ w: string }>({ key: "z" });
    const i = createI18n({ getPrimaryLocale: () => "de-CH" });
    i.addTexts({ de: [ns.partial({ w: "de" })] });
    expect(i.locale("de-CH").getText(ns, "w")).toBe("de");
  });
});

describe("configured getFallbackLocales drives resolution (#2)", () => {
  const ns = createNamespace<{ hi: string }>({ key: "f" });

  it("falls through to a configured fallback locale", () => {
    const i = createI18n({
      getPrimaryLocale: () => "de",
      getFallbackLocales: () => ["en"],
    });
    i.addTexts({ en: [ns.partial({ hi: "Hello" })] });
    expect(i.locale("de").getText(ns, "hi")).toBe("Hello");
  });

  it("primary wins over a configured fallback when present", () => {
    const i = createI18n({
      getPrimaryLocale: () => "de",
      getFallbackLocales: () => ["en"],
    });
    i.addTexts({
      de: [ns.partial({ hi: "Hallo" })],
      en: [ns.partial({ hi: "Hello" })],
    });
    expect(i.locale("de").getText(ns, "hi")).toBe("Hallo");
  });

  it("expands a fallback tag through the same chain logic (en-GB -> en)", () => {
    const i = createI18n({
      getPrimaryLocale: () => "de",
      getFallbackLocales: () => ["en-GB"],
    });
    i.addTexts({ en: [ns.partial({ hi: "Hello" })] });
    expect(i.locale("de").getText(ns, "hi")).toBe("Hello");
  });

  it("earlier fallback wins over later fallback", () => {
    const i = createI18n({
      getPrimaryLocale: () => "de",
      getFallbackLocales: () => ["fr", "en"],
    });
    i.addTexts({
      fr: [ns.partial({ hi: "Bonjour" })],
      en: [ns.partial({ hi: "Hello" })],
    });
    expect(i.locale("de").getText(ns, "hi")).toBe("Bonjour");
  });

  it("skips an invalid fallback tag and still uses a valid one", () => {
    const i = createI18n({
      getPrimaryLocale: () => "de",
      getFallbackLocales: () => ["en_US_invalid", "en"],
    });
    i.addTexts({ en: [ns.partial({ hi: "Hello" })] });
    expect(i.locale("de").getText(ns, "hi")).toBe("Hello");
  });

  it("with no fallback configured, a miss returns the key (unchanged behavior)", () => {
    const i = createI18n({ getPrimaryLocale: () => "de" });
    i.addTexts({ en: [ns.partial({ hi: "Hello" })] });
    expect(i.locale("de").getText(ns, "hi")).toBe("hi");
  });

  it("propagates an error when the REQUESTED locale tag is invalid", () => {
    const i = createI18n({ getPrimaryLocale: () => "de" });
    i.addTexts({ de: [ns.partial({ hi: "Hallo" })] });
    expect(() => i.locale("en_US_invalid").getText(ns, "hi")).toThrow();
  });
});

/* ================================================================= *
 * addTexts merging semantics
 * ================================================================= */

describe("addTexts merging", () => {
  const a = createNamespace<{ x: string }>({ key: "a" });
  const b = createNamespace<{ y: string }>({ key: "b" });

  it("merges raw locale keys that normalize equally (within one bundle)", () => {
    const i = createI18n({ getPrimaryLocale: () => "en-US" });
    i.addTexts({
      "EN-US": [a.partial({ x: "X" })],
      "en-us": [b.partial({ y: "Y" })],
    });
    expect(i.locale("en-US").getText(a, "x")).toBe("X");
    expect(i.locale("en-US").getText(b, "y")).toBe("Y");
  });

  it("applies multiple bundles (variadic) and last write wins", () => {
    const i = createI18n({ getPrimaryLocale: () => "de" });
    i.addTexts(
      { de: [a.partial({ x: "first" })] },
      { de: [a.partial({ x: "second" })] },
    );
    expect(i.locale("de").getText(a, "x")).toBe("second");
  });

  it("merges into an existing locale + namespace record across calls", () => {
    const ns = createNamespace<{ p: string; q: string }>({ key: "m" });
    const i = createI18n({ getPrimaryLocale: () => "de" });
    i.addTexts({ de: [ns.partial({ p: "P" })] });
    i.addTexts({ de: [ns.partial({ q: "Q" })] });
    expect(i.locale("de").getText(ns, "p")).toBe("P");
    expect(i.locale("de").getText(ns, "q")).toBe("Q");
  });

  it("tolerates an un-parseable raw locale key (normalizeLocale returns it unchanged)", () => {
    const i = createI18n({ getPrimaryLocale: () => "de" });
    // "en_US_invalid" makes `new Intl.Locale` throw; normalizeLocale's catch returns
    // the raw key, so the bundle is stored under it without aborting addTexts.
    expect(() =>
      i.addTexts({ en_US_invalid: [a.partial({ x: "X" })] }),
    ).not.toThrow();
    // A normal lookup is unaffected.
    expect(i.locale("de").getText(a, "x")).toBe("x");
  });
});

/* ================================================================= *
 * onAddTexts: eager for createI18n, buffered for the global instance
 * ================================================================= */

describe("onAddTexts notifications", () => {
  const ns = createNamespace<{ a: string; b: string }>({ key: "n" });

  it("createI18n notifies directly on addTexts, before any read (#1)", () => {
    const events: string[] = [];
    const i = createI18n({
      getPrimaryLocale: () => "de",
      onAddTexts: (loc, n, key) => events.push(`${loc}/${n.key}/${key}`),
    });
    i.addTexts({ de: [ns.full({ a: "A", b: "B" })] });
    expect(events).toEqual(["de/n/a", "de/n/b"]);
  });

  it("notifies once per key per addTexts call, including overwrites", () => {
    const events: string[] = [];
    const i = createI18n({
      getPrimaryLocale: () => "de",
      onAddTexts: (loc, n, key) => events.push(`${loc}/${key}`),
    });
    i.addTexts({ de: [ns.partial({ a: "A1" })] });
    i.addTexts({ de: [ns.partial({ a: "A2" })] });
    expect(events).toEqual(["de/a", "de/a"]);
  });

  it("does not throw when no onAddTexts is configured", () => {
    const i = createI18n({ getPrimaryLocale: () => "de" });
    expect(() => i.addTexts({ de: [ns.partial({ a: "A" })] })).not.toThrow();
  });

  it("global instance buffers pre-init adds and flushes them on first read", async () => {
    const m = await freshModule();
    const events: string[] = [];
    const lns = m.createNamespace<{ a: string }>({ key: "n" });
    m.getI18n().addTexts({ de: [lns.full({ a: "A" })] }); // before init
    m.initI18n({
      getPrimaryLocale: () => "de",
      onAddTexts: (loc, n, key) => events.push(`${loc}/${n.key}/${key}`),
    });
    expect(events).toEqual([]); // not flushed yet
    m.getI18n().locale("de").getText(lns, "a"); // first read -> flush
    expect(events).toEqual(["de/n/a"]);
    m.getI18n().addTexts({ en: [lns.full({ a: "B" })] }); // post-init -> direct
    expect(events).toEqual(["de/n/a", "en/n/a"]);
  });

  it("global buffer is discarded (no throw) when init resolves without onAddTexts", async () => {
    const m = await freshModule();
    const lns = m.createNamespace<{ a: string }>({ key: "n" });
    m.getI18n().addTexts({ de: [lns.full({ a: "A" })] });
    m.initI18n({ getPrimaryLocale: () => "de" }); // no onAddTexts
    expect(m.getI18n().locale("de").getText(lns, "a")).toBe("A");
  });
});

/* ================================================================= *
 * Localizer formatting + helpers
 * ================================================================= */

describe("Localizer formatting", () => {
  const i = createI18n({ getPrimaryLocale: () => "en-US" });

  it("formatNumber respects locale grouping", () => {
    expect(i.locale("en-US").formatNumber(1234567)).toBe("1,234,567");
    expect(i.locale("de-DE").formatNumber(1234567)).toBe("1.234.567");
  });

  it("formatNumber passes through options", () => {
    const out = i.locale("en-US").formatNumber(0.5, { style: "percent" });
    expect(out).toBe("50%");
  });

  it("numberFormat returns an Intl.NumberFormat", () => {
    const nf = i.locale("en-US").numberFormat({ minimumFractionDigits: 2 });
    expect(nf).toBeInstanceOf(Intl.NumberFormat);
    expect(nf.format(1)).toBe("1.00");
  });

  it("formatDateTime returns a string and dateTimeFormat an Intl.DateTimeFormat", () => {
    const d = new Date(Date.UTC(2020, 0, 2, 3, 4, 5));
    const s = i
      .locale("en-US")
      .formatDateTime(d, { timeZone: "UTC", year: "numeric" });
    expect(typeof s).toBe("string");
    expect(s).toContain("2020");
    const dtf = i.locale("en-US").dateTimeFormat({ timeZone: "UTC" });
    expect(dtf).toBeInstanceOf(Intl.DateTimeFormat);
  });

  it("localizer.locale(tag) returns a localizer for another locale on the same instance", () => {
    const fromEn = i.locale("en-US");
    const asDe = fromEn.locale("de-DE");
    expect(asDe.formatNumber(1000)).toBe("1.000");
  });

  it("memoizes one Localizer per distinct locale string", () => {
    expect(i.locale("en-US")).toBe(i.locale("en-US"));
    expect(i.locale("en-US")).not.toBe(i.locale("de-DE"));
  });
});

/* ================================================================= *
 * Instance config accessors + onLocaleChange
 * ================================================================= */

describe("instance config accessors", () => {
  it("getPrimaryLocale returns config value, or defaults to en-US", () => {
    expect(
      createI18n({ getPrimaryLocale: () => "fr" }).getPrimaryLocale(),
    ).toBe("fr");
    expect(createI18n({}).getPrimaryLocale()).toBe("en-US");
  });

  it("getFallbackLocales returns a copy, or [] when unconfigured", () => {
    const src = ["en", "fr"];
    const i = createI18n({ getFallbackLocales: () => src });
    const out = i.getFallbackLocales();
    expect(out).toEqual(["en", "fr"]);
    expect(out).not.toBe(src); // defensive copy
    expect(createI18n({}).getFallbackLocales()).toEqual([]);
  });

  it("onLocaleChange fires when the config source signals, and unsubscribe stops it (idempotent)", () => {
    let trigger: (() => void) | undefined;
    const i = createI18n({
      getPrimaryLocale: () => "de",
      onLocaleChange: (cb) => {
        trigger = cb;
        return () => {};
      },
    });
    let fired = 0;
    const unsub = i.onLocaleChange(() => fired++);
    trigger?.();
    expect(fired).toBe(1);
    unsub();
    unsub(); // idempotent — must not throw
    trigger?.();
    expect(fired).toBe(1);
  });

  it("ensureInitialized runs at most once (config source subscribed a single time)", () => {
    const onLocaleChange = vi.fn(() => () => {});
    const i = createI18n({ getPrimaryLocale: () => "de", onLocaleChange });
    // createI18n is eager -> already initialized exactly once at construction.
    i.locale("de");
    i.getPrimaryLocale();
    i.getFallbackLocales();
    expect(onLocaleChange).toHaveBeenCalledTimes(1);
  });

  it("tolerates a config with no onLocaleChange source", () => {
    const i = createI18n({ getPrimaryLocale: () => "de" });
    let fired = 0;
    const unsub = i.onLocaleChange(() => fired++);
    expect(fired).toBe(0);
    expect(() => unsub()).not.toThrow();
  });
});

/* ================================================================= *
 * getI18n / initI18n — global singleton & guards
 * ================================================================= */

describe("getI18n / initI18n", () => {
  it("getI18n returns a stable singleton", async () => {
    const m = await freshModule();
    expect(m.getI18n()).toBe(m.getI18n());
  });

  it("initI18n config is consumed by the global instance", async () => {
    const m = await freshModule();
    m.initI18n({
      getPrimaryLocale: () => "fr",
      getFallbackLocales: () => ["en"],
    });
    expect(m.getI18n().getPrimaryLocale()).toBe("fr");
    expect(m.getI18n().getFallbackLocales()).toEqual(["en"]);
  });

  it("throws 'only be called once' on a second initI18n", async () => {
    const m = await freshModule();
    m.initI18n({ getPrimaryLocale: () => "de" });
    expect(() => m.initI18n({ getPrimaryLocale: () => "en" })).toThrow(
      /only be called once/,
    );
  });

  it("throws 'Too late' when init happens after the global instance initialized", async () => {
    const m = await freshModule();
    m.getI18n().getPrimaryLocale(); // forces global init
    expect(() => m.initI18n({ getPrimaryLocale: () => "de" })).toThrow(
      /Too late/,
    );
  });

  it("'only be called once' takes precedence over 'Too late'", async () => {
    const m = await freshModule();
    m.initI18n({ getPrimaryLocale: () => "de" }); // sets initI18nCalled
    m.getI18n().getPrimaryLocale(); // sets globalI18nInitialized
    expect(() => m.initI18n({ getPrimaryLocale: () => "en" })).toThrow(
      /only be called once/,
    );
  });

  it("addTexts before initI18n is remembered and resolves after init", async () => {
    const m = await freshModule();
    const lns = m.createNamespace<{ a: string }>({ key: "n" });
    m.getI18n().addTexts({ de: [lns.full({ a: "Hallo" })] });
    m.initI18n({ getPrimaryLocale: () => "de" });
    expect(m.getI18n().locale("de").getText(lns, "a")).toBe("Hallo");
  });
});

/* ================================================================= *
 * Client detection + <html lang> monitor (jsdom)
 * ================================================================= */

describe("document-lang monitor (client-side global default)", () => {
  it("reads the live <html lang> as the primary locale", async () => {
    const m = await freshModule();
    document.documentElement.setAttribute("lang", "fr-FR");
    expect(m.getI18n().getPrimaryLocale()).toBe("fr-FR");
  });

  it("defaults to en-US when <html lang> is absent", async () => {
    const m = await freshModule();
    document.documentElement.removeAttribute("lang");
    expect(m.getI18n().getPrimaryLocale()).toBe("en-US");
  });

  it("is still installed alongside a partial initI18n config (only getFallbackLocales)", async () => {
    const m = await freshModule();
    document.documentElement.setAttribute("lang", "es");
    m.initI18n({ getFallbackLocales: () => ["en"] });
    // primary comes from the monitor; fallbacks from the supplied config
    expect(m.getI18n().getPrimaryLocale()).toBe("es");
    expect(m.getI18n().getFallbackLocales()).toEqual(["en"]);
  });

  it("notifies listeners when <html lang> changes, and stops after unsubscribe", async () => {
    const m = await freshModule();
    document.documentElement.setAttribute("lang", "de");
    let fired = 0;
    const unsub = m.getI18n().onLocaleChange(() => fired++);

    document.documentElement.setAttribute("lang", "fr");
    await tick();
    expect(fired).toBe(1);
    expect(m.getI18n().getPrimaryLocale()).toBe("fr");

    unsub();
    document.documentElement.setAttribute("lang", "es");
    await tick();
    expect(fired).toBe(1);
  });

  it("does NOT install the monitor on the server (no window): primary defaults to en-US", async () => {
    const savedWindow = (globalThis as any).window;
    try {
      (globalThis as any).window = undefined; // isClientSide() -> false
      const m = await freshModule();
      // No config + not client-side -> empty config -> default primary.
      expect(m.getI18n().getPrimaryLocale()).toBe("en-US");
      expect(m.getI18n().getFallbackLocales()).toEqual([]);
    } finally {
      (globalThis as any).window = savedWindow;
    }
  });
});

/* ================================================================= *
 * localize controller
 * ================================================================= */

describe("localize controller", () => {
  it("registers itself on the host", () => {
    const host = makeHost();
    const c = localize(host, createI18n({ getPrimaryLocale: () => "de" }));
    expect(host.controllers).toContain(c);
  });

  it("resolves locale lazily — constructing it before initI18n does NOT lock out initI18n (#4)", async () => {
    const m = await freshModule();
    m.localize(makeHost()); // bound to the global instance by default
    expect(() => m.initI18n({ getPrimaryLocale: () => "de" })).not.toThrow();
  });

  it("getText before connect resolves using the instance primary locale", () => {
    const ns = createNamespace<{ hi: string }>({ key: "c" });
    const i = createI18n({ getPrimaryLocale: () => "de" });
    i.addTexts({ de: [ns.partial({ hi: "Hallo" })] });
    const c = localize(makeHost(), i);
    expect(c.getText(ns, "hi")).toBe("Hallo");
  });

  it("hostConnected does exactly one requestUpdate and reacts to later locale changes", () => {
    const ns = createNamespace<{ hi: string }>({ key: "c" });
    let current = "de";
    let trigger: (() => void) | undefined;
    const i = createI18n({
      getPrimaryLocale: () => current,
      onLocaleChange: (cb) => {
        trigger = cb;
        return () => {
          trigger = undefined;
        };
      },
    });
    i.addTexts({
      de: [ns.partial({ hi: "Hallo" })],
      en: [ns.partial({ hi: "Hi" })],
    });
    const host = makeHost();
    const c = localize(host, i);

    c.hostConnected();
    expect(host.updates).toBe(1);
    expect(c.getText(ns, "hi")).toBe("Hallo");

    current = "en";
    trigger?.();
    expect(host.updates).toBe(2);
    expect(c.getText(ns, "hi")).toBe("Hi");
  });

  it("hostDisconnected unsubscribes and is a no-op when called again or before connect", () => {
    let current = "de";
    let trigger: (() => void) | undefined;
    const i = createI18n({
      getPrimaryLocale: () => current,
      onLocaleChange: (cb) => {
        trigger = cb;
        return () => {
          trigger = undefined;
        };
      },
    });
    const host = makeHost();
    const c = localize(host, i);

    // Disconnect before ever connecting -> no throw, unsubscribe is null.
    expect(() => c.hostDisconnected()).not.toThrow();

    c.hostConnected();
    const afterConnect = host.updates;
    c.hostDisconnected();
    c.hostDisconnected(); // idempotent

    current = "en";
    trigger?.(); // trigger was cleared by unsubscribe; even if not, no listener remains
    expect(host.updates).toBe(afterConnect);
  });

  it("delegates formatting + locale(tag) to the bound instance", () => {
    const i = createI18n({ getPrimaryLocale: () => "en-US" });
    const c = localize(makeHost(), i);
    expect(c.formatNumber(1000)).toBe("1,000");
    expect(c.numberFormat()).toBeInstanceOf(Intl.NumberFormat);
    expect(typeof c.formatDateTime(new Date(0), { timeZone: "UTC" })).toBe(
      "string",
    );
    expect(c.dateTimeFormat()).toBeInstanceOf(Intl.DateTimeFormat);
    expect(c.locale("de-DE").formatNumber(1000)).toBe("1.000");
  });

  it("defaults to the global instance when no instance is supplied", async () => {
    const m = await freshModule();
    const lns = m.createNamespace<{ hi: string }>({ key: "c" });
    m.initI18n({ getPrimaryLocale: () => "de" });
    m.getI18n().addTexts({ de: [lns.partial({ hi: "Hallo" })] });
    const c = m.localize(makeHost());
    expect(c.getText(lns, "hi")).toBe("Hallo");
  });
});
