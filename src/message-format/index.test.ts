/**
 * Tests for the `msg` ICU MessageFormat tagged template.
 */

import { describe, expect, it } from "vitest";

import { createI18n, createNamespace } from "../i18n.js";
import { msg } from "./index.js";

describe("msg (ICU MessageFormat)", () => {
  it("formats a static message with an interpolated placeholder", () => {
    const greetingTexts = createNamespace({
      key: "greeting",
      defaults: { welcome: msg<{ name: string }>`Hello, {name}!` },
    });
    const i18n = createI18n({ localeSource: { getLocale: () => "en" } });
    expect(i18n.text(greetingTexts, "welcome", { name: "Ada" })).toBe("Hello, Ada!");
  });

  it("supports ICU plural rules", () => {
    const cartTexts = createNamespace({
      key: "cart",
      defaults: {
        itemCount: msg<{ count: number }>`{count, plural, one {# item} other {# items}}`,
      },
    });
    const i18n = createI18n({ localeSource: { getLocale: () => "en" } });
    expect(i18n.text(cartTexts, "itemCount", { count: 1 })).toBe("1 item");
    expect(i18n.text(cartTexts, "itemCount", { count: 3 })).toBe("3 items");
  });

  it("formats according to the locale bound to the translation call", () => {
    const priceTexts = createNamespace({
      key: "price",
      defaults: { amount: msg<{ value: number }>`{value, number}` },
    });
    const i18nDe = createI18n({ localeSource: { getLocale: () => "de" } });
    const i18nEn = createI18n({ localeSource: { getLocale: () => "en" } });
    expect(i18nDe.text(priceTexts, "amount", { value: 1234.5 })).toBe("1.234,5");
    expect(i18nEn.text(priceTexts, "amount", { value: 1234.5 })).toBe("1,234.5");
  });

  it("reuses a cached formatter for a repeated (locale, pattern) pair", () => {
    const ns = createNamespace({
      key: "cache-ns",
      defaults: { greet: msg<{ n: string }>`Hi {n}` },
    });
    const i18n = createI18n({ localeSource: { getLocale: () => "en" } });
    expect(i18n.text(ns, "greet", { n: "A" })).toBe("Hi A"); // cache miss: compiles and caches
    expect(i18n.text(ns, "greet", { n: "B" })).toBe("Hi B"); // cache hit: same compiled formatter
  });

  it("can be invoked directly as a TranslationFn without a namespace", () => {
    const translate = msg<{ name: string }>`Hi {name}`;
    const i18n = createI18n({ localeSource: { getLocale: () => "en" } });
    expect(translate({ name: "Ada" }, i18n)).toBe("Hi Ada");
  });
});
