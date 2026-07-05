// @vitest-environment jsdom
/**
 * Tests for the custom-element integration: the reactive controller, the imperative
 * `provideI18n`, and the `<i18n-provider>` element — including the protocol edge
 * cases (late values, provider switching, unsubscribe identity).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createI18n, createNamespace } from "../i18n.js";
import type { I18n, LocaleSource } from "../i18n.js";
import { I18nProviderElement, i18nContext, provideI18n } from "./i18n-provider.js";
import type { I18nController } from "./i18n-controller.js";

const greetingTexts = createNamespace({ key: "greeting", defaults: { hello: "Hello" } });
const datePickerTexts = createNamespace({
  key: "date-picker",
  defaults: {
    today: "Today",
    range: (params: { count: number }, rangeI18n: I18n) =>
      `${rangeI18n.formatNumber(params.count)} days`,
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

/** A minimal Lit-style host element. */
class TestHostElement extends HTMLElement {
  requestUpdate = vi.fn();
  controllers: I18nController[] = [];
  addController(controller: I18nController): void {
    this.controllers.push(controller);
  }
}
customElements.define("test-host", TestHostElement);

function mountHost(parent: Element = document.body): TestHostElement {
  const host = document.createElement("test-host") as TestHostElement;
  parent.appendChild(host);
  return host;
}

function mountProvider(parent: Element = document.body): I18nProviderElement {
  const provider = document.createElement("i18n-provider");
  parent.appendChild(provider);
  return provider;
}

/** A handcrafted protocol event (the event class itself is not exported). */
function createContextRequest(
  callback: (value: I18n, unsubscribe?: () => void) => void,
  subscribe?: boolean,
  context: unknown = i18nContext,
): Event {
  return Object.assign(new Event("context-request", { bubbles: true, composed: true }), {
    context,
    callback,
    subscribe,
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// provideI18n
// -------------------------------------------------------------------

describe("provideI18n", () => {
  it("answers non-subscribe requests without an unsubscribe argument", () => {
    const appI18n = createFixedLocaleI18n("de");
    const stopProviding = provideI18n(document.body, appI18n);
    const answers = vi.fn();

    document.body.dispatchEvent(createContextRequest(answers, undefined));
    expect(answers).toHaveBeenCalledWith(appI18n, undefined);
    stopProviding();
  });

  it("hands subscribers a no-op unsubscribe", () => {
    const appI18n = createFixedLocaleI18n("de");
    const stopProviding = provideI18n(document.body, appI18n);
    const answers = vi.fn();

    document.body.dispatchEvent(createContextRequest(answers, true));
    const [answeredI18n, unsubscribe] = answers.mock.calls[0];
    expect(answeredI18n).toBe(appI18n);
    expect(() => unsubscribe()).not.toThrow();
    stopProviding();
  });

  it("ignores foreign contexts and events without callback", () => {
    const stopProviding = provideI18n(document.body, createFixedLocaleI18n("de"));
    const answers = vi.fn();

    document.body.dispatchEvent(createContextRequest(answers, true, Symbol("other-context")));
    document.body.dispatchEvent(
      Object.assign(new Event("context-request", { bubbles: true }), { context: i18nContext }),
    );
    expect(answers).not.toHaveBeenCalled();
    stopProviding();
  });

  it("stops providing after the returned unsubscribe", () => {
    const stopProviding = provideI18n(document.body, createFixedLocaleI18n("de"));
    stopProviding();
    const answers = vi.fn();
    document.body.dispatchEvent(createContextRequest(answers, true));
    expect(answers).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------
// <i18n-provider>
// -------------------------------------------------------------------

describe("<i18n-provider>", () => {
  it("is registered, layout-neutral, and exposes its value", () => {
    const providerElement = mountProvider();
    expect(providerElement).toBeInstanceOf(I18nProviderElement);
    expect(providerElement.style.display).toBe("contents");
    expect(providerElement.i18n).toBeNull();

    const appI18n = createFixedLocaleI18n("de");
    providerElement.i18n = appI18n;
    expect(providerElement.i18n).toBe(appI18n);
  });

  it("answers and claims requests once a value is set", () => {
    const providerElement = mountProvider();
    providerElement.i18n = createFixedLocaleI18n("de");
    const inner = mountHost(providerElement);
    const outerAnswers = vi.fn();
    const stopProviding = provideI18n(document.body, createFixedLocaleI18n("en"));
    void outerAnswers;

    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, undefined)); // non-subscribe branch
    expect(answers).toHaveBeenCalledTimes(1);
    expect((answers.mock.calls[0][0] as I18n).getLocale()).toBe("de"); // inner claimed, outer never saw it
    expect(answers.mock.calls[0][1]).toBeUndefined();
    stopProviding();
  });

  it("does not claim value-less non-subscribe requests (outer provider serves)", () => {
    const outerI18n = createFixedLocaleI18n("en");
    const stopProviding = provideI18n(document.body, outerI18n);
    const providerElement = mountProvider(); // value-less
    const inner = mountHost(providerElement);

    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, undefined));
    expect(answers).toHaveBeenCalledWith(outerI18n, undefined);
    stopProviding();
  });

  it("setting the same instance again is a no-op for subscribers", () => {
    const providerElement = mountProvider();
    const inner = mountHost(providerElement);
    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, true));

    const appI18n = createFixedLocaleI18n("de");
    providerElement.i18n = appI18n;
    providerElement.i18n = appI18n; // same instance -> no re-notification
    expect(answers).toHaveBeenCalledTimes(1);
  });

  it("clearing the value keeps subscribers silent until a new value arrives", () => {
    const providerElement = mountProvider();
    const inner = mountHost(providerElement);
    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, true));

    providerElement.i18n = createFixedLocaleI18n("de");
    providerElement.i18n = null; // clear: no notification, consumers keep the last value
    expect(providerElement.i18n).toBeNull();
    expect(answers).toHaveBeenCalledTimes(1);

    providerElement.i18n = createFixedLocaleI18n("fr");
    expect(answers).toHaveBeenCalledTimes(2);
  });

  it("honors subscriber unsubscribe across value changes", () => {
    const providerElement = mountProvider();
    const inner = mountHost(providerElement);

    let latestUnsubscribe: (() => void) | undefined;
    const answers = vi.fn((_value: I18n, unsubscribe?: () => void) => {
      latestUnsubscribe = unsubscribe;
    });
    inner.dispatchEvent(createContextRequest(answers, true));

    providerElement.i18n = createFixedLocaleI18n("de");
    expect(answers).toHaveBeenCalledTimes(1);
    latestUnsubscribe!();
    providerElement.i18n = createFixedLocaleI18n("fr");
    expect(answers).toHaveBeenCalledTimes(1); // unsubscribed -> not notified again
  });

  it("reuses one stable subscription per callback (repeated requests)", () => {
    const providerElement = mountProvider();
    providerElement.i18n = createFixedLocaleI18n("de");
    const inner = mountHost(providerElement);

    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, true));
    inner.dispatchEvent(createContextRequest(answers, true)); // e.g. reconnect
    const firstUnsubscribe = answers.mock.calls[0][1];
    const secondUnsubscribe = answers.mock.calls[1][1];
    expect(firstUnsubscribe).toBe(secondUnsubscribe);
  });

  it("stops listening after disconnect", () => {
    const outerI18n = createFixedLocaleI18n("en");
    const stopProviding = provideI18n(document.body, outerI18n);
    const providerElement = mountProvider();
    providerElement.i18n = createFixedLocaleI18n("de");
    const inner = mountHost(providerElement);

    providerElement.remove(); // triggers disconnectedCallback; inner moves out with it
    document.body.appendChild(providerElement); // reconnect wrapper but detach listener check:
    providerElement.disconnectedCallback(); // force-remove listener while staying in DOM

    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, undefined));
    expect(answers).toHaveBeenCalledWith(outerI18n, undefined); // outer serves, inner is deaf
    stopProviding();
  });

  it("ignores foreign contexts", () => {
    const providerElement = mountProvider();
    providerElement.i18n = createFixedLocaleI18n("de");
    const inner = mountHost(providerElement);

    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, true, Symbol("other-context")));
    expect(answers).not.toHaveBeenCalled();
  });
});
