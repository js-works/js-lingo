// @vitest-environment jsdom
/**
 * Tests for the custom-element integration: the reactive controller, the imperative
 * `provideI18n`, and the `<i18n-provider>` element — including the protocol edge
 * cases (late values, provider switching, unsubscribe identity).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createI18n, createNamespace } from "../i18n.js";
import type { I18n, LocaleSource } from "../i18n.js";
import {
  I18nProviderElement,
  i18nContext,
  i18nController,
  provideI18n,
} from "./i18n-controller.js";
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
// i18nController
// -------------------------------------------------------------------

describe("i18nController", () => {
  it("registers itself with the host and is frozen", () => {
    const host = mountHost();
    const controllerI18n = i18nController(host);
    expect(host.controllers).toEqual([controllerI18n]);
    expect(Object.isFrozen(controllerI18n)).toBe(true);
  });

  it("prefers the explicit argument and never consults the tree for it", () => {
    const explicitI18n = createFixedLocaleI18n("de");
    const providerI18n = createFixedLocaleI18n("fr");
    const stopProviding = provideI18n(document.body, providerI18n);
    const host = mountHost();

    const controllerI18n = i18nController(host, explicitI18n);
    controllerI18n.hostConnected();
    expect(controllerI18n.getLocale()).toBe("de"); // not "fr"
    stopProviding();
  });

  it("falls back to the internal zero-config instance without any provider", () => {
    document.documentElement.setAttribute("lang", "it");
    const host = mountHost();
    const controllerI18n = i18nController(host);
    controllerI18n.hostConnected();
    expect(controllerI18n.getLocale()).toBe("it"); // <html lang> via zero-config fallback
    expect(controllerI18n.getText(greetingTexts, "hello")).toBe("Hello");
  });

  it("adopts an instance provided up the tree on connect", () => {
    const appI18n = createFixedLocaleI18n("fr");
    const stopProviding = provideI18n(document.body, appI18n);
    const host = mountHost();

    const controllerI18n = i18nController(host);
    controllerI18n.hostConnected();
    expect(controllerI18n.getLocale()).toBe("fr");
    stopProviding();
  });

  it("re-renders the host on locale and text changes of the current instance", () => {
    const mutableSource = createMutableLocaleSource("de");
    const host = mountHost();
    const controllerI18n = i18nController(host, createI18n({ localeSource: mutableSource }));
    controllerI18n.hostConnected();

    mutableSource.setLocale("en");
    expect(host.requestUpdate).toHaveBeenCalledTimes(1);
    expect(controllerI18n.getLocale()).toBe("en");
  });

  it("stops re-rendering and unsubscribes from the provider on disconnect", () => {
    const mutableSource = createMutableLocaleSource("de");
    const providerElement = mountProvider();
    providerElement.i18n = createI18n({ localeSource: mutableSource });
    const host = mountHost(providerElement);

    const controllerI18n = i18nController(host);
    controllerI18n.hostConnected();
    expect(controllerI18n.getLocale()).toBe("de");
    host.requestUpdate.mockClear(); // adopting the provider instance already re-rendered once

    controllerI18n.hostDisconnected();
    mutableSource.setLocale("en"); // change subscription must be gone
    expect(host.requestUpdate).not.toHaveBeenCalled();

    providerElement.i18n = createFixedLocaleI18n("fr"); // provider subscription must be gone
    expect(controllerI18n.getLocale()).toBe("en"); // still the OLD instance's (live) locale
  });

  it("delegates the full I18n surface to the current instance", () => {
    const host = mountHost();
    const controllerI18n = i18nController(host, createFixedLocaleI18n("de-DE"));
    controllerI18n.hostConnected();

    expect(controllerI18n.formatNumber(1234.5)).toBe(new Intl.NumberFormat("de-DE").format(1234.5));
    const someDate = new Date(Date.UTC(2026, 0, 2));
    expect(controllerI18n.formatDateTime(someDate, { timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat("de-DE", { timeZone: "UTC" }).format(someDate),
    );
    expect(controllerI18n.numberFormat()).toBe(controllerI18n.numberFormat()); // shared cache
    expect(controllerI18n.dateTimeFormat({ timeZone: "UTC" }).resolvedOptions().timeZone).toBe(
      "UTC",
    );
    expect(controllerI18n.getText(datePickerTexts, "range", { count: 2 })).toBe("2 days");
    expect(controllerI18n.localize("fr").getLocale()).toBe("fr");

    const changes = vi.fn();
    const unsubscribe = controllerI18n.onChange(changes);
    unsubscribe();
  });

  it("bindTexts delegates lazily: bound lookups follow a provider switch", () => {
    const providerElement = mountProvider();
    const host = mountHost(providerElement);
    const controllerI18n = i18nController(host);
    controllerI18n.hostConnected();

    const unboundLookup = controllerI18n.bindTexts();
    const greetingLookup = controllerI18n.bindTexts(greetingTexts);
    expect(unboundLookup(greetingTexts, "hello")).toBe("Hello");
    expect(greetingLookup("hello")).toBe("Hello");
    expect(greetingLookup(datePickerTexts, "range", { count: 3 })).toBe("3 days"); // fully-qualified

    // switch the instance via the provider: previously bound lookups must follow
    const echoLocaleTexts = createNamespace({ key: "echo", defaults: { hello: "Hello" } });
    void echoLocaleTexts;
    providerElement.i18n = createFixedLocaleI18n("fr-CH");
    expect(controllerI18n.getLocale()).toBe("fr-CH");
    expect(greetingLookup(datePickerTexts, "range", { count: 1234.5 })).toBe(
      `${new Intl.NumberFormat("fr-CH").format(1234.5)} days`,
    );
  });

  it("follows repeated provider value changes (stable unsubscribe identity)", () => {
    const providerElement = mountProvider();
    const host = mountHost(providerElement);
    const controllerI18n = i18nController(host);
    controllerI18n.hostConnected();

    providerElement.i18n = createFixedLocaleI18n("de");
    expect(controllerI18n.getLocale()).toBe("de");
    providerElement.i18n = createFixedLocaleI18n("fr");
    expect(controllerI18n.getLocale()).toBe("fr");
    providerElement.i18n = createFixedLocaleI18n("es"); // regression: third switch still works
    expect(controllerI18n.getLocale()).toBe("es");
    expect(host.requestUpdate).toHaveBeenCalledTimes(3);
  });

  it("keeps the latest answer when an inner provider arrives after an outer one", () => {
    const outerI18n = createFixedLocaleI18n("en");
    const stopProviding = provideI18n(document.body, outerI18n);
    const innerProvider = mountProvider(); // no value yet -> does not claim requests
    const host = mountHost(innerProvider);

    const controllerI18n = i18nController(host);
    controllerI18n.hostConnected();
    expect(controllerI18n.getLocale()).toBe("en"); // outer served meanwhile

    innerProvider.i18n = createFixedLocaleI18n("de"); // late inner value wins
    expect(controllerI18n.getLocale()).toBe("de");
    stopProviding();
  });

  it("re-adopts the same instance on reconnect without re-rendering", () => {
    const providerElement = mountProvider();
    providerElement.i18n = createFixedLocaleI18n("de");
    const host = mountHost(providerElement);
    const controllerI18n = i18nController(host);

    controllerI18n.hostConnected();
    controllerI18n.hostDisconnected();
    host.requestUpdate.mockClear();

    controllerI18n.hostConnected(); // provider re-answers with the SAME instance
    expect(controllerI18n.getLocale()).toBe("de");
    expect(host.requestUpdate).not.toHaveBeenCalled(); // switchTo(same) is a no-op
  });

  it("adopts a late answer while disconnected without touching the host", () => {
    const stopProviding = provideI18n(document.body, createFixedLocaleI18n("en"));
    const innerProvider = mountProvider(); // value-less: subscription survives disconnect
    const host = mountHost(innerProvider);
    const controllerI18n = i18nController(host);

    controllerI18n.hostConnected(); // outer answers; inner remembers the subscriber
    controllerI18n.hostDisconnected();
    host.requestUpdate.mockClear();

    innerProvider.i18n = createFixedLocaleI18n("de"); // late answer while disconnected
    expect(controllerI18n.getLocale()).toBe("de"); // adopted for the next connect
    expect(host.requestUpdate).not.toHaveBeenCalled(); // but no render while disconnected
    stopProviding();
  });

  it("tolerates minimal providers that answer subscribe requests without unsubscribe", () => {
    const bareI18n = createFixedLocaleI18n("pt");
    const bareProvider = (event: Event): void => {
      const request = event as Event & { context?: unknown; callback?: (value: I18n) => void };
      if (request.context === i18nContext && request.callback) {
        event.stopPropagation();
        request.callback(bareI18n); // no unsubscribe at all
      }
    };
    document.body.addEventListener("context-request", bareProvider);
    const host = mountHost();
    const controllerI18n = i18nController(host);
    controllerI18n.hostConnected();
    expect(controllerI18n.getLocale()).toBe("pt");
    expect(() => controllerI18n.hostDisconnected()).not.toThrow();
    document.body.removeEventListener("context-request", bareProvider);
  });
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
