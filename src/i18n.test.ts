/**
 * Tests for the i18n facade (node environment — the server-side branches of
 * `defaultLocaleSource` and everything that does not need a DOM).
 * The client-side branches (<html lang> monitor) live in i18n.dom.test.ts.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  someTexts,
  bundleTexts,
  createI18n,
  createNamespace,
  defaultLocaleSource,
  defaultTextSource,
  allTexts,
} from "./i18n.js";

import type { I18n, LocaleSource, TextBundle, TextMiddleware, TextSource } from "./i18n.js";

// -------------------------------------------------------------------
// Shared fixtures
// -------------------------------------------------------------------

const datePickerTexts = createNamespace({
  key: "date-picker",
  defaults: {
    today: "Today",
    range: (params: { count: number }, rangeI18n: I18n) =>
      `${rangeI18n.formatNumber(params.count)} days`,
  },
});

const greetingTexts = createNamespace({
  key: "greeting",
  defaults: { hello: "Hello" },
});

/** A locale source with a controllable locale and change channel. */
function createMutableLocaleSource(initial: string): LocaleSource & {
  setLocale(locale: string): void;
} {
  let currentLocale = initial;
  let listeners: (() => void)[] = [];
  return {
    getLocale: () => currentLocale,
    onChange: (listener) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((it) => it !== listener);
      };
    },
    setLocale: (locale) => {
      currentLocale = locale;
      for (const listener of [...listeners]) listener();
    },
  };
}

function createFixedLocaleI18n(
  locale: string,
  textSource?: TextSource,
  middlewares?: TextMiddleware[],
): I18n {
  return createI18n({ localeSource: { getLocale: () => locale }, textSource, middlewares });
}

const tick = () => new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// Namespaces and bundles
// -------------------------------------------------------------------

describe("createNamespace / texts / allTexts / bundleTexts", () => {
  it("creates a frozen, pure-data namespace with frozen defaults", () => {
    expect(Object.isFrozen(datePickerTexts)).toBe(true);
    expect(Object.isFrozen(datePickerTexts.defaults)).toBe(true);
    expect(datePickerTexts.key).toBe("date-picker");
    expect(datePickerTexts.defaults.today).toBe("Today");
  });

  it("copies the defaults so later mutation of the input has no effect", () => {
    const defaults: Record<string, string> = { label: "Label" };
    const copiedTexts = createNamespace({ key: "copied", defaults });
    defaults.label = "Changed";
    expect(copiedTexts.defaults.label).toBe("Label");
  });

  it("texts / allTexts pair the namespace with the given texts (frozen)", () => {
    const partial = someTexts(datePickerTexts, { today: "Heute" });
    expect(partial.namespace).toBe(datePickerTexts);
    expect(partial.texts).toEqual({ today: "Heute" });
    expect(Object.isFrozen(partial)).toBe(true);

    const complete = allTexts(datePickerTexts, {
      today: "Heute",
      range: (params) => `${params.count} Tage`,
    });
    expect(complete.namespace).toBe(datePickerTexts);
  });

  it("bundleTexts is the identity", () => {
    const bundle: TextBundle = { de: [someTexts(greetingTexts, { hello: "Hallo" })] };
    expect(bundleTexts(bundle)).toBe(bundle);
  });
});

// -------------------------------------------------------------------
// defaultLocaleSource (server-side branches)
// -------------------------------------------------------------------

describe("defaultLocaleSource (server)", () => {
  it("accepts a fixed tag", () => {
    const i18n = createI18n({ localeSource: defaultLocaleSource({ serverSide: "de" }) });
    expect(i18n.getLocale()).toBe("de");
  });

  it("accepts a live getter", () => {
    let requestLocale = "fr";
    const i18n = createI18n({
      localeSource: defaultLocaleSource({ serverSide: () => requestLocale }),
    });
    expect(i18n.getLocale()).toBe("fr");
    requestLocale = "it";
    expect(i18n.getLocale()).toBe("it");
  });

  it("accepts a full LocaleSource including its change channel", () => {
    const mutableSource = createMutableLocaleSource("es");
    const i18n = createI18n({ localeSource: defaultLocaleSource({ serverSide: mutableSource }) });
    const changes = vi.fn();
    i18n.onChange(changes);
    mutableSource.setLocale("pt");
    expect(i18n.getLocale()).toBe("pt");
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it("falls back to defaultLocale without serverSide, and to en-US without options", () => {
    expect(
      createI18n({ localeSource: defaultLocaleSource({ defaultLocale: "ja" }) }).getLocale(),
    ).toBe("ja");
    expect(createI18n({ localeSource: defaultLocaleSource() }).getLocale()).toBe("en-US");
    expect(createI18n().getLocale()).toBe("en-US"); // zero-config uses defaultLocaleSource()
  });
});

// -------------------------------------------------------------------
// Resolution: namespace defaults, store, tag narrowing, miss policy
// -------------------------------------------------------------------

describe("resolution", () => {
  it("resolves namespace defaults with zero config (static and dynamic)", () => {
    const i18n = createFixedLocaleI18n("de-CH");
    expect(i18n.getText(greetingTexts, "hello")).toBe("Hello");
    // dynamic default runs with the REQUESTED locale (de-CH number grouping)
    expect(i18n.getText(datePickerTexts, "range", { count: 1234.5 })).toBe(
      `${new Intl.NumberFormat("de-CH").format(1234.5)} days`,
    );
  });

  it("prefers store texts over defaults and narrows tags within the language", () => {
    const i18n = createFixedLocaleI18n(
      "de-CH",
      defaultTextSource({
        textBundles: [{ de: [someTexts(greetingTexts, { hello: "Hallo" })] }],
      }),
    );
    expect(i18n.getText(greetingTexts, "hello")).toBe("Hallo"); // de-CH -> de
  });

  it("invokes dynamic store texts with an I18n bound to the FOUND locale", () => {
    const i18n = createFixedLocaleI18n(
      "de-CH",
      defaultTextSource({
        textBundles: [
          {
            de: [
              someTexts(datePickerTexts, {
                range: (params, foundI18n) => `${params.count}:${foundI18n.getLocale()}`,
              }),
            ],
          },
        ],
      }),
    );
    expect(i18n.getText(datePickerTexts, "range", { count: 2 })).toBe("2:de");
  });

  it("treats the empty string as a valid translation", () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({ textBundles: [{ de: [someTexts(greetingTexts, { hello: "" })] }] }),
    );
    expect(i18n.getText(greetingTexts, "hello")).toBe("");
  });

  it("skips dynamic values when params are missing, down to the bare key", () => {
    const looseGetText = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        textBundles: [
          { de: [someTexts(datePickerTexts, { range: (params) => `${params.count}` })] },
        ],
      }),
    ).getText as (namespace: unknown, key: unknown, params?: unknown) => string;
    // no params: the store fn is skipped AND the default fn is skipped -> bare key
    expect(looseGetText(datePickerTexts, "range")).toBe("range");
  });

  it("returns the bare key for keys unknown to store AND defaults", () => {
    const looseGetText = createFixedLocaleI18n("de").getText as (
      namespace: unknown,
      key: unknown,
    ) => string;
    expect(looseGetText(greetingTexts, "missing")).toBe("missing");
  });

  it("merges bundle locale keys that normalize equally (last write wins)", () => {
    const i18n = createFixedLocaleI18n(
      "de-DE",
      defaultTextSource({
        textBundles: [
          {
            "de-DE": [someTexts(greetingTexts, { hello: "Hallo" })],
            "de-DE-u-co-phonebk": [someTexts(greetingTexts, { hello: "Hallo!" })], // same baseName
          },
        ],
      }),
    );
    expect(i18n.getText(greetingTexts, "hello")).toBe("Hallo!");
  });

  it("keeps invalid locale keys of a bundle usable as-is (normalize catch path)", () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        textBundles: [{ "not a locale!!": [someTexts(greetingTexts, { hello: "Kaputt" })] }],
      }),
    );
    expect(i18n.getText(greetingTexts, "hello")).toBe("Hello"); // unreachable entry, default wins
  });

  it("supports script subtags in the narrowing chain (zh-Hant-TW -> zh-TW -> zh)", () => {
    const i18n = createFixedLocaleI18n(
      "zh-Hant-TW",
      defaultTextSource({
        textBundles: [{ "zh-TW": [someTexts(greetingTexts, { hello: "你好" })] }],
      }),
    );
    expect(i18n.getText(greetingTexts, "hello")).toBe("你好");
  });

  it("handles the language-less 'und' tag (chain without language subtag)", () => {
    const i18n = createFixedLocaleI18n(
      "und",
      defaultTextSource({ textBundles: [{ und: [someTexts(greetingTexts, { hello: "…" })] }] }),
    );
    expect(i18n.getText(greetingTexts, "hello")).toBe("…");
  });

  it("applies the fallbackLocales option of defaultTextSource", () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        textBundles: [{ en: [someTexts(greetingTexts, { hello: "HelloEN" })] }],
        fallbackLocales: ["en"],
      }),
    );
    expect(i18n.getText(greetingTexts, "hello")).toBe("HelloEN");
  });

  it("propagates an invalid REQUESTED locale as an error", () => {
    const i18n = createFixedLocaleI18n(
      "not a locale!!",
      defaultTextSource({
        textBundles: [{ de: [someTexts(greetingTexts, { hello: "Hallo" })] }],
      }),
    );
    expect(() => i18n.getText(greetingTexts, "hello")).toThrow();
  });

  it("re-enters the full pipeline for nested lookups from translation functions", () => {
    const nestedTexts = createNamespace({
      key: "nested",
      defaults: {
        outer: (params: { count: number }, nestedI18n: I18n) =>
          `[${nestedI18n.getText(greetingTexts, "hello")}:${params.count}]`,
      },
    });
    const i18n = createFixedLocaleI18n("de", undefined, [
      (request, _context, next) => (request.namespace.key === "greeting" ? `*${next()}*` : next()),
    ]);
    // the middleware decorates the NESTED greeting lookup made by the outer default fn
    expect(i18n.getText(nestedTexts, "outer", { count: 1 })).toBe("[*Hello*:1]");
  });
});

// -------------------------------------------------------------------
// Middlewares
// -------------------------------------------------------------------

describe("middlewares", () => {
  it("run outermost-first and see texts from source AND defaults", () => {
    const order: string[] = [];
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        textBundles: [{ de: [someTexts(greetingTexts, { hello: "Hallo" })] }],
      }),
      [
        (request, _context, next) => {
          order.push("outer");
          return `<${next()}>`;
        },
        (request, _context, next) => {
          order.push("inner");
          return `(${next()})`;
        },
      ],
    );
    expect(i18n.getText(greetingTexts, "hello")).toBe("<(Hallo)>"); // source text decorated
    expect(i18n.getText(datePickerTexts, "today")).toBe("<(Today)>"); // default text decorated
    expect(order.slice(0, 2)).toEqual(["outer", "inner"]);
  });

  it("can rewrite the request via next(patch)", () => {
    const i18n = createFixedLocaleI18n(
      "nb",
      defaultTextSource({ textBundles: [{ no: [someTexts(greetingTexts, { hello: "Hei" })] }] }),
      [(request, _context, next) => next(request.locale === "nb" ? { locale: "no" } : undefined)],
    );
    expect(i18n.getText(greetingTexts, "hello")).toBe("Hei");
  });

  it("can short-circuit without calling next", () => {
    const i18n = createFixedLocaleI18n("de", undefined, [() => "SHORT"]);
    expect(i18n.getText(greetingTexts, "hello")).toBe("SHORT");
  });

  it("sees undefined from next() only on a HARD miss (no source hit, no default)", () => {
    const hardMisses: string[] = [];
    const i18n = createFixedLocaleI18n("de", undefined, [
      (request, _context, next) => {
        const resolved = next();
        if (resolved === undefined) hardMisses.push(request.key);
        return resolved;
      },
    ]);
    const looseGetText = i18n.getText as (namespace: unknown, key: unknown) => string;
    expect(i18n.getText(greetingTexts, "hello")).toBe("Hello"); // default -> not a hard miss
    expect(looseGetText(greetingTexts, "missing")).toBe("missing");
    expect(hardMisses).toEqual(["missing"]);
  });
});

// -------------------------------------------------------------------
// defaultTextSource: async inputs
// -------------------------------------------------------------------

describe("defaultTextSource (async inputs)", () => {
  it("registers promise bundles when they settle and notifies", async () => {
    let resolveBundle!: (bundle: TextBundle) => void;
    const pendingBundle = new Promise<TextBundle>((resolvePromise) => {
      resolveBundle = resolvePromise;
    });
    const i18n = createFixedLocaleI18n("de", defaultTextSource({ textBundles: [pendingBundle] }));
    const changes = vi.fn();
    i18n.onChange(changes);

    expect(i18n.getText(greetingTexts, "hello")).toBe("Hello"); // default until it lands
    resolveBundle({ de: [someTexts(greetingTexts, { hello: "Hallo" })] });
    await tick();
    expect(changes).toHaveBeenCalledTimes(1);
    expect(i18n.getText(greetingTexts, "hello")).toBe("Hallo");
  });

  it("does not notify for a settled bundle that adds nothing", async () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({ textBundles: [Promise.resolve({} as TextBundle)] }),
    );
    const changes = vi.fn();
    i18n.onChange(changes);
    await tick();
    expect(changes).not.toHaveBeenCalled();
  });

  it("invokes thunks lazily on the first resolution only", () => {
    const thunk = vi.fn(() => ({ de: [someTexts(greetingTexts, { hello: "Hallo" })] }));
    const i18n = createFixedLocaleI18n("de", defaultTextSource({ textBundles: [thunk] }));
    expect(thunk).not.toHaveBeenCalled();
    expect(i18n.getText(greetingTexts, "hello")).toBe("Hallo"); // first use triggers the thunk
    expect(i18n.getText(greetingTexts, "hello")).toBe("Hallo"); // second use: early return path
    expect(thunk).toHaveBeenCalledTimes(1);
  });

  it("notifies when a synchronous thunk adds texts", () => {
    const source = defaultTextSource({
      textBundles: [() => ({ de: [someTexts(greetingTexts, { hello: "Hallo" })] })],
    });
    const changes = vi.fn();
    source.onChange!(changes);
    source.resolve(
      { locale: "de", namespace: greetingTexts, key: "hello", params: undefined },
      { localize: () => createFixedLocaleI18n("de") },
    );
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it("does not notify when a synchronous thunk adds nothing", () => {
    const source = defaultTextSource({ textBundles: [() => ({}) as TextBundle] });
    const changes = vi.fn();
    source.onChange!(changes);
    source.resolve(
      { locale: "de", namespace: greetingTexts, key: "hello", params: undefined },
      { localize: () => createFixedLocaleI18n("de") },
    );
    expect(changes).not.toHaveBeenCalled();
  });

  it("supports thunks returning promises", async () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        textBundles: [
          () => Promise.resolve({ de: [someTexts(greetingTexts, { hello: "Hallo" })] }),
        ],
      }),
    );
    expect(i18n.getText(greetingTexts, "hello")).toBe("Hello"); // triggers the load
    await tick();
    expect(i18n.getText(greetingTexts, "hello")).toBe("Hallo");
  });

  it("reports rejected bundle loads and throwing thunks via console.error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        textBundles: [
          Promise.reject(new Error("load failed")),
          () => {
            throw new Error("thunk failed");
          },
        ],
      }),
    );
    expect(i18n.getText(greetingTexts, "hello")).toBe("Hello"); // thunk throw is contained
    await tick(); // rejection is contained
    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  it("unsubscribing from the source change channel is idempotent", () => {
    const source = defaultTextSource();
    const unsubscribe = source.onChange!(vi.fn());
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });
});

// -------------------------------------------------------------------
// The facade: reactivity, siblings, formatters, bindTexts
// -------------------------------------------------------------------

describe("I18n facade", () => {
  it("localize() memoizes siblings and round-trips to the dynamic instance", () => {
    const i18n = createFixedLocaleI18n("de");
    const frenchI18n = i18n.localize("fr");
    expect(frenchI18n.getLocale()).toBe("fr");
    expect(i18n.localize("fr")).toBe(frenchI18n); // memoized
    expect(frenchI18n.localize()).toBe(i18n); // back to dynamic
    expect(i18n.localize()).toBe(i18n);
    expect(Object.isFrozen(i18n)).toBe(true);
  });

  it("statically bound siblings share the change channel", () => {
    const mutableSource = createMutableLocaleSource("de");
    const i18n = createI18n({ localeSource: mutableSource });
    const changes = vi.fn();
    i18n.localize("fr").onChange(changes); // subscribe via the SIBLING
    mutableSource.setLocale("en");
    expect(changes).toHaveBeenCalledTimes(1);
    expect(i18n.getLocale()).toBe("en");
  });

  it("onChange unsubscribe removes the listener and is idempotent", () => {
    const mutableSource = createMutableLocaleSource("de");
    const i18n = createI18n({ localeSource: mutableSource });
    const changes = vi.fn();
    const unsubscribe = i18n.onChange(changes);
    unsubscribe();
    unsubscribe();
    mutableSource.setLocale("en");
    expect(changes).not.toHaveBeenCalled();
  });

  it("formats numbers and dates in the active locale with shared cached formatters", () => {
    const i18n = createFixedLocaleI18n("de-DE");
    expect(i18n.formatNumber(1234.5)).toBe(new Intl.NumberFormat("de-DE").format(1234.5));
    const someDate = new Date(Date.UTC(2026, 0, 2));
    expect(i18n.formatDateTime(someDate, { timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat("de-DE", { timeZone: "UTC" }).format(someDate),
    );

    // identity: same options -> same instance; key order must not matter
    expect(i18n.numberFormat({ style: "currency", currency: "EUR" })).toBe(
      i18n.numberFormat({ currency: "EUR", style: "currency" }),
    );
    expect(i18n.dateTimeFormat({ timeZone: "UTC", year: "numeric" })).toBe(
      i18n.dateTimeFormat({ year: "numeric", timeZone: "UTC" }),
    );
    // options-less variant hits the empty cache key
    expect(i18n.numberFormat()).toBe(i18n.numberFormat());
    // different locales get different formatters
    expect(i18n.localize("fr").numberFormat()).not.toBe(i18n.numberFormat());
  });

  it("bindTexts without a namespace is exactly getText", () => {
    const i18n = createFixedLocaleI18n("de");
    const lookupText = i18n.bindTexts();
    expect(lookupText(greetingTexts, "hello")).toBe("Hello");
    expect(lookupText(datePickerTexts, "range", { count: 2 })).toBe("2 days");
  });

  it("bindTexts with a namespace scopes it and still accepts fully-qualified calls", () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        textBundles: [{ de: [someTexts(greetingTexts, { hello: "Hallo" })] }],
      }),
    );
    const greetingLookup = i18n.bindTexts(greetingTexts);
    expect(greetingLookup("hello")).toBe("Hallo"); // scoped
    expect(greetingLookup(datePickerTexts, "today")).toBe("Today"); // fully-qualified escape
    expect(greetingLookup(datePickerTexts, "range", { count: 4 })).toBe("4 days");
  });
});
