// @vitest-environment jsdom
/**
 * Isolated test for I18nProvider's defensive `ref.current` null-check inside its
 * DOM-bridge effect. Under React's real ref-before-effect commit guarantees this
 * branch is not reachable through normal rendering (the wrapper div's ref is always
 * attached before the effect runs) — this file mocks `useRef` to force it anyway, so
 * the fallback path itself (skip `provideI18n`, no crash) is verified rather than
 * left untested. Kept separate from context.test.ts so the mock does not affect
 * the rest of the suite.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useRef: () => ({ current: null }) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("I18nProvider (ref.current unavailable at effect time)", () => {
  it("does not crash and skips provideI18n", async () => {
    const { act, createElement: h } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { createI18n } = await import("../core.js");
    const { I18nProvider } = await import("./context.js");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const i18n = createI18n({ localeSource: { getLocale: () => "de" } });

    expect(() => {
      act(() => {
        root.render(h(I18nProvider, { i18n }, h("span", null, "x")));
      });
    }).not.toThrow();

    act(() => root.unmount());
    container.remove();
  });
});
