import { describe, expect, it, vi } from "vitest";
import { bundleTexts, createI18n, createNamespace } from "./index";
import type { Translation } from "./index.js";

describe("getI18n", () => {
  const i18n = createI18n();

  it("returns stable primary locale", () => {
    expect(i18n.getPrimaryLocale()).toBe("en-US");
  });

  it("returns empty fallback locales by default", () => {
    expect(i18n.getFallbackLocales()).toEqual([]);
  });

  it("returns unsubscribe functions", () => {
    expect(typeof i18n.onPrimaryLocaleChange(() => {})).toBe("function");
    expect(typeof i18n.onFallbackLocalesChange(() => {})).toBe("function");
  });
});

describe("createNamespace", () => {
  it("creates namespace with default group", () => {
    const commonTexts = createNamespace<{ hello: Translation }>({
      key: "common",
    });

    expect(commonTexts.key).toBe("common");
    expect(commonTexts.group).toBeNull();
  });

  it("creates namespace with custom group", () => {
    const commonTexts = createNamespace<{ hello: Translation }>({
      key: "common",
      group: "app",
    });

    expect(commonTexts.group).toBe("app");
  });

  it("creates frozen namespace", () => {
    const commonTexts = createNamespace<{ hello: Translation }>({
      key: "common",
    });

    expect(Object.isFrozen(commonTexts)).toBe(true);
  });

  it("full() requires complete text map", () => {
    const commonTexts = createNamespace<{
      hello: Translation;
      bye: Translation;
    }>({
      key: "common",
    });

    const bundle = commonTexts.full({
      hello: "Hello",
      bye: "Bye",
    });

    expect(bundle.namespace).toBe(commonTexts);
    expect(bundle.texts).toEqual({
      hello: "Hello",
      bye: "Bye",
    });

    expect(Object.isFrozen(bundle)).toBe(true);
  });

  it("partial() allows subset updates", () => {
    const commonTexts = createNamespace<{
      hello: Translation;
      bye: Translation;
    }>({
      key: "common",
    });

    const bundle = commonTexts.partial({
      hello: "Hello",
    });

    expect(bundle.namespace).toBe(commonTexts);
    expect(bundle.texts).toEqual({
      hello: "Hello",
    });

    expect(Object.isFrozen(bundle)).toBe(true);
  });
});

describe("bundleTexts", () => {
  it("returns identical object", () => {
    const commonTexts = createNamespace<{ hello: Translation }>({
      key: "common",
    });

    const texts = {
      en: [
        commonTexts.full({
          hello: "Hello",
        }),
      ],
    };

    expect(bundleTexts(texts)).toBe(texts);
  });
});

describe("createI18n", () => {
  const commonTexts = createNamespace<{
    hello: Translation;
    bye: Translation;
    greeting: Translation<{ name: string }>;
  }>({
    key: "common",
  });

  it("returns missing translation as key", () => {
    const i18n = createI18n();
    expect(i18n.getText("en", commonTexts, "hello")).toBe("hello");
  });

  it("returns static translation", () => {
    const i18n = createI18n();

    i18n.addTexts({
      en: [
        commonTexts.full({
          hello: "Hello",
          bye: "Bye",
          greeting: ({ name }) => `Hello ${name}`,
        }),
      ],
    });

    expect(i18n.getText("en", commonTexts, "hello")).toBe("Hello");
    expect(i18n.getText("en", commonTexts, "bye")).toBe("Bye");
  });

  it("supports dynamic translation", () => {
    const i18n = createI18n();

    i18n.addTexts({
      en: [
        commonTexts.full({
          hello: "Hello",
          bye: "Bye",
          greeting: ({ name }) => `Hello ${name}`,
        }),
      ],
    });

    expect(
      i18n.getText("en", commonTexts, "greeting", {
        name: "John",
      }),
    ).toBe("Hello John");
  });

  it("supports nested translations", () => {
    const i18n = createI18n();

    i18n.addTexts({
      en: [
        commonTexts.full({
          hello: "Hello",
          bye: "Bye",
          greeting: ({ name }, loc) =>
            `${loc.getText(commonTexts, "hello")} ${name}`,
        }),
      ],
    });

    expect(
      i18n.getText("en", commonTexts, "greeting", {
        name: "Jane",
      }),
    ).toBe("Hello Jane");
  });

  it("falls back from region to language", () => {
    const i18n = createI18n();

    i18n.addTexts({
      en: [
        commonTexts.partial({
          hello: "Hello",
        }),
      ],
    });

    expect(i18n.getText("en-US", commonTexts, "hello")).toBe("Hello");
  });

  it("normalizes locale names", () => {
    const i18n = createI18n();

    i18n.addTexts({
      "EN-us": [
        commonTexts.partial({
          hello: "Hello",
        }),
      ],
    });

    expect(i18n.getText("en-US", commonTexts, "hello")).toBe("Hello");
  });

  it("supports multiple locales", () => {
    const i18n = createI18n();

    i18n.addTexts({
      en: [
        commonTexts.partial({
          hello: "Hello",
        }),
      ],
      de: [
        commonTexts.partial({
          hello: "Hallo",
        }),
      ],
    });

    expect(i18n.getText("en", commonTexts, "hello")).toBe("Hello");
    expect(i18n.getText("de", commonTexts, "hello")).toBe("Hallo");
  });

  it("supports partial updates (last write wins)", () => {
    const i18n = createI18n();

    i18n.addTexts({
      en: [
        commonTexts.partial({
          hello: "Hello",
          bye: "Bye",
        }),
      ],
    });

    i18n.addTexts({
      en: [
        commonTexts.partial({
          hello: "Hi",
        }),
      ],
    });

    expect(i18n.getText("en", commonTexts, "hello")).toBe("Hi");
    expect(i18n.getText("en", commonTexts, "bye")).toBe("Bye");
  });

  it("supports multiple bundles", () => {
    const i18n = createI18n();

    i18n.addTexts(
      {
        en: [
          commonTexts.partial({
            hello: "Hello",
          }),
        ],
      },
      {
        en: [
          commonTexts.partial({
            bye: "Bye",
          }),
        ],
      },
    );

    expect(i18n.getText("en", commonTexts, "hello")).toBe("Hello");
    expect(i18n.getText("en", commonTexts, "bye")).toBe("Bye");
  });

  it("ignores empty addTexts calls", () => {
    const i18n = createI18n();
    expect(() => i18n.addTexts()).not.toThrow();
  });

  it("calls onAddTexts for every key", () => {
    const spy = vi.fn();

    const i18n = createI18n({
      onAddTexts: spy,
    });

    i18n.addTexts({
      en: [
        commonTexts.partial({
          hello: "Hello",
          bye: "Bye",
        }),
      ],
    });

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("Localizer", () => {
  const commonTexts = createNamespace<{ hello: Translation }>({
    key: "common",
  });

  const i18n = createI18n();

  i18n.addTexts({
    en: [
      commonTexts.full({
        hello: "Hello",
      }),
    ],
  });

  const localizer = i18n.getLocalizer("en");

  it("translates text", () => {
    expect(localizer.getText(commonTexts, "hello")).toBe("Hello");
  });

  it("formats numbers", () => {
    expect(localizer.formatNumber(1234)).toBe(
      new Intl.NumberFormat("en").format(1234),
    );
  });

  it("creates Intl formatters", () => {
    expect(localizer.numberFormat()).toBeInstanceOf(Intl.NumberFormat);
    expect(localizer.dateTimeFormat()).toBeInstanceOf(Intl.DateTimeFormat);
  });

  it("returns underlying i18n", () => {
    expect(localizer.getI18n()).toBe(i18n);
  });
});
