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
  it("ignores empty addTexts calls", () => {
    const i18n = createI18n();
    expect(() => i18n.addTexts()).not.toThrow();
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

  const localizer = i18n.locale("en");

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
});
