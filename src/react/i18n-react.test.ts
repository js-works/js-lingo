// @vitest-environment jsdom
/**
 * Tests for the React integration: `I18nProvider` (React context + DOM Context
 * Community Protocol bridge) and `useI18n` (reactive snapshot + bound `t`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, Suspense } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { createI18n, createNamespace } from "../i18n.js";
import type { I18n, LoadingAware, LocaleSource, TextSource } from "../i18n.js";
import { i18nContext } from "../web-components/index.js";
import { I18nProvider, useI18n, useI18nSuspense } from "./i18n-react.js";

// React 19's act() warns unless this is set, absent a testing-library environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const greetingTexts = createNamespace({
  key: "greeting",
  defaults: {
    hello: "Hello",
    welcome: (params: { name: string }) => `Welcome, ${params.name}!`,
  },
});

function createFixedLocaleI18n(locale: string): I18n {
  return createI18n({ localeSource: { getLocale: () => locale } });
}

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

let container: HTMLDivElement;
let root: Root;

function mount(node: Parameters<typeof h>[0], props?: unknown, ...children: unknown[]): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(h(node as never, props as never, ...(children as never[])));
  });
}

function dispatchContextRequest(
  target: Element,
  callback: (value: I18n, unsubscribe?: () => void) => void,
): void {
  target.dispatchEvent(
    Object.assign(new Event("context-request", { bubbles: true, composed: true }), {
      context: i18nContext,
      callback,
    }),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

describe("useI18n", () => {
  it("without any provider, falls back to the module's zero-config default instance", () => {
    function Display() {
      const { t } = useI18n(greetingTexts);
      return h("span", { id: "out" }, t("hello"));
    }
    mount(Display, null);
    expect(container.querySelector("#out")!.textContent).toBe("Hello");
  });

  it("scopes t to the given namespace, including dynamic (parameterized) keys", () => {
    const appI18n = createFixedLocaleI18n("de");
    function Display() {
      const { t } = useI18n(greetingTexts);
      return h("span", { id: "out" }, t("welcome", { name: "Ada" }));
    }
    mount(I18nProvider, { i18n: appI18n }, h(Display, null));
    expect(container.querySelector("#out")!.textContent).toBe("Welcome, Ada!");
  });

  it("without a namespace, returns a fully-qualified t and the raw i18n facade", () => {
    const appI18n = createFixedLocaleI18n("de-DE");
    function Display() {
      const { t, i18n } = useI18n();
      return h(
        "span",
        { id: "out" },
        `${t(greetingTexts, "hello")}:${i18n.formatNumber(1234.5)}`,
      );
    }
    mount(I18nProvider, { i18n: appI18n }, h(Display, null));
    expect(container.querySelector("#out")!.textContent).toBe(
      `Hello:${new Intl.NumberFormat("de-DE").format(1234.5)}`,
    );
  });

  it("re-renders with a fresh statically-bound snapshot on locale change", () => {
    const mutableSource = createMutableLocaleSource("de");
    const appI18n = createI18n({ localeSource: mutableSource });

    function Display() {
      const { t, i18n } = useI18n(greetingTexts);
      return h("span", { id: "out" }, `${i18n.locale()}:${t("hello")}`);
    }
    mount(I18nProvider, { i18n: appI18n }, h(Display, null));
    expect(container.querySelector("#out")!.textContent).toBe("de:Hello");

    act(() => mutableSource.setLocale("fr"));
    expect(container.querySelector("#out")!.textContent).toBe("fr:Hello");
  });

  it("re-renders when late-arriving texts change (text-channel reactivity)", async () => {
    let resolveBundle!: (value: unknown) => void;
    const pendingBundle = new Promise((resolvePromise) => {
      resolveBundle = resolvePromise;
    });
    const { defaultTextSource, someTexts } = await import("../i18n.js");
    const appI18n = createI18n({
      localeSource: { getLocale: () => "de" },
      textSource: defaultTextSource({ textBundles: [pendingBundle as never] }),
    });

    function Display() {
      const { t } = useI18n(greetingTexts);
      return h("span", { id: "out" }, t("hello"));
    }
    mount(I18nProvider, { i18n: appI18n }, h(Display, null));
    expect(container.querySelector("#out")!.textContent).toBe("Hello");

    await act(async () => {
      resolveBundle({ de: [someTexts(greetingTexts, { hello: "Hallo" })] });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    expect(container.querySelector("#out")!.textContent).toBe("Hallo");
  });

  it("adopts a new i18n instance when the provider's prop changes", () => {
    const first = createFixedLocaleI18n("de");
    const second = createFixedLocaleI18n("fr");

    function Display() {
      const { i18n } = useI18n();
      return h("span", { id: "out" }, i18n.locale());
    }
    function App({ current }: { current: I18n }) {
      return h(I18nProvider, { i18n: current }, h(Display, null));
    }

    mount(App, { current: first });
    expect(container.querySelector("#out")!.textContent).toBe("de");

    act(() => root.render(h(App, { current: second })));
    expect(container.querySelector("#out")!.textContent).toBe("fr");
  });
});

describe("I18nProvider", () => {
  it("bridges the instance onto the DOM Context Community Protocol from its wrapper div", () => {
    const appI18n = createFixedLocaleI18n("de");
    function Child() {
      return h("span", { id: "marker" }, "child");
    }
    mount(I18nProvider, { i18n: appI18n }, h(Child, null));

    const wrapperDiv = container.querySelector("div")!;
    expect(wrapperDiv.style.display).toBe("contents");

    const answers = vi.fn();
    dispatchContextRequest(container.querySelector("#marker")!, answers);
    expect(answers).toHaveBeenCalledWith(appI18n, undefined);
  });

  it("re-provides (unsubscribing the old listener) when the i18n prop changes", () => {
    const first = createFixedLocaleI18n("de");
    const second = createFixedLocaleI18n("fr");

    function App({ current }: { current: I18n }) {
      return h(I18nProvider, { i18n: current }, h("span", { id: "marker" }, "child"));
    }
    mount(App, { current: first });

    const firstAnswers = vi.fn();
    dispatchContextRequest(container.querySelector("#marker")!, firstAnswers);
    expect(firstAnswers).toHaveBeenCalledWith(first, undefined);

    act(() => root.render(h(App, { current: second })));

    const secondAnswers = vi.fn();
    dispatchContextRequest(container.querySelector("#marker")!, secondAnswers);
    expect(secondAnswers).toHaveBeenCalledWith(second, undefined); // not `first` -> old listener is gone
  });

  it("stops providing once unmounted", () => {
    const appI18n = createFixedLocaleI18n("de");
    mount(I18nProvider, { i18n: appI18n }, h("span", { id: "marker" }, "child"));
    const marker = container.querySelector("#marker")!;

    act(() => root.unmount());

    const answers = vi.fn();
    dispatchContextRequest(marker, answers); // detached from the document, but the listener itself must be gone
    expect(answers).not.toHaveBeenCalled();
  });
});

describe("useI18nSuspense", () => {
  /** An async source that misses (→ defaults) while loading, then serves after `settle()`. */
  function createControllableAsyncSource(hit: string) {
    let loading = true;
    const listeners = new Set<() => void>();
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolvePromise) => {
      resolveReady = resolvePromise;
    });
    const source: TextSource & LoadingAware = {
      resolve: (request) =>
        loading ? undefined : request.key === "hello" ? hit : undefined,
      isLoading: () => loading,
      whenReady: () => ready,
      onChange: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    };
    const settle = (): void => {
      loading = false;
      resolveReady();
      for (const listener of [...listeners]) listener();
    };
    return { source, settle };
  }

  it("suspends while loading, then renders the real texts (never the default)", async () => {
    const { source, settle } = createControllableAsyncSource("Hallo");
    const appI18n = createI18n({ localeSource: { getLocale: () => "de" }, textSource: source });

    function Display() {
      const { t } = useI18nSuspense(source, greetingTexts);
      return h("span", { id: "out" }, t("hello"));
    }
    mount(
      Suspense,
      { fallback: h("span", { id: "fallback" }, "loading…") },
      h(I18nProvider, { i18n: appI18n }, h(Display, null)),
    );

    // Suspended: fallback shown, the default "Hello" is never painted.
    expect(container.querySelector("#fallback")).not.toBeNull();
    expect(container.querySelector("#out")).toBeNull();

    await act(async () => {
      settle();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });

    expect(container.querySelector("#fallback")).toBeNull();
    expect(container.querySelector("#out")!.textContent).toBe("Hallo");
  });

  it("does not suspend when the source reports the namespace already ready", () => {
    const readySource: TextSource & LoadingAware = {
      resolve: (request) => (request.key === "hello" ? "Hallo" : undefined),
      isLoading: () => false,
      whenReady: () => Promise.resolve(),
    };
    const appI18n = createI18n({ localeSource: { getLocale: () => "de" }, textSource: readySource });

    function Display() {
      const { t } = useI18nSuspense(readySource, greetingTexts);
      return h("span", { id: "out" }, t("hello"));
    }
    mount(
      Suspense,
      { fallback: h("span", { id: "fallback" }, "loading…") },
      h(I18nProvider, { i18n: appI18n }, h(Display, null)),
    );

    expect(container.querySelector("#fallback")).toBeNull();
    expect(container.querySelector("#out")!.textContent).toBe("Hallo");
  });
});
