// @vitest-environment jsdom
/**
 * Tests for the client-side branches: `defaultLocaleSource` detecting the DOM and the
 * `<html lang>` monitor (MutationObserver-driven change channel).
 */

import { describe, expect, it, vi } from "vitest";

import { createI18n, createNamespace, defaultLocaleSource } from "./i18n.js";

const greetingTexts = createNamespace({ key: "greeting", defaults: { hello: "Hello" } });

/** MutationObserver delivers asynchronously — wait one macrotask. */
const tick = () => new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

function setDocumentLang(lang: string | null): void {
  if (lang === null) {
    document.documentElement.removeAttribute("lang");
  } else {
    document.documentElement.setAttribute("lang", lang);
  }
}

describe("defaultLocaleSource (client, <html lang> monitor)", () => {
  it("reads the live lang attribute", () => {
    setDocumentLang("de-CH");
    const i18n = createI18n({ localeSource: defaultLocaleSource() });
    expect(i18n.locale()).toBe("de-CH");
    setDocumentLang("fr");
    expect(i18n.locale()).toBe("fr");
  });

  it("falls back to defaultLocale when the attribute is absent (and ignores serverSide)", () => {
    setDocumentLang(null);
    const i18n = createI18n({
      localeSource: defaultLocaleSource({ defaultLocale: "ja", serverSide: "de" }),
    });
    expect(i18n.locale()).toBe("ja"); // serverSide plays no role on the client
    expect(createI18n({ localeSource: defaultLocaleSource() }).locale()).toBe("en-US");
  });

  it("is the zero-config default on the client", () => {
    setDocumentLang("it");
    const i18n = createI18n();
    expect(i18n.locale()).toBe("it");
    expect(i18n.text(greetingTexts, "hello")).toBe("Hello");
  });

  it("notifies on lang changes and honors unsubscribe", async () => {
    setDocumentLang("de");
    const i18n = createI18n({ localeSource: defaultLocaleSource() });

    const keptChanges = vi.fn();
    const removedChanges = vi.fn();
    i18n.onChange(keptChanges);
    const unsubscribe = i18n.onChange(removedChanges);
    unsubscribe();

    setDocumentLang("en");
    await tick();
    expect(keptChanges).toHaveBeenCalledTimes(1);
    expect(removedChanges).not.toHaveBeenCalled();
    expect(i18n.locale()).toBe("en");

    setDocumentLang("fr");
    await tick();
    expect(keptChanges).toHaveBeenCalledTimes(2);
  });

  it("supports multiple independent monitor subscriptions (source-level unsubscribe)", async () => {
    setDocumentLang("de");
    const localeSource = defaultLocaleSource();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    localeSource.onChange!(firstListener);
    const unsubscribeSecond = localeSource.onChange!(secondListener);
    unsubscribeSecond();

    setDocumentLang("en");
    await tick();
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).not.toHaveBeenCalled();
  });

  it("does not detect the client when window has no MutationObserver", () => {
    const original = globalThis.window.MutationObserver;
    // @ts-expect-error simulating a browser-like global without MutationObserver support
    delete globalThis.window.MutationObserver;
    try {
      const i18n = createI18n({ localeSource: defaultLocaleSource({ defaultLocale: "ja" }) });
      expect(i18n.locale()).toBe("ja"); // fell through to the non-client branch
    } finally {
      globalThis.window.MutationObserver = original;
    }
  });

  it("does not detect the client when document is unavailable even though window is", () => {
    const original = globalThis.document;
    // @ts-expect-error simulating a global without a `document` (the detection branch itself)
    delete globalThis.document;
    try {
      const i18n = createI18n({ localeSource: defaultLocaleSource({ defaultLocale: "ja" }) });
      expect(i18n.locale()).toBe("ja"); // fell through to the non-client branch
    } finally {
      globalThis.document = original;
    }
  });
});
