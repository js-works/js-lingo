/**
 * Custom-element integration for the i18n facade — the Context Community Protocol
 * (https://github.com/webcomponents-cg/community-protocols) as distribution
 * mechanism, dependency-free (works with, but does not require, Lit).
 *
 *   - `i18nController(host)` — a Lit-style reactive controller that IS an I18n
 *     (delegating) and re-renders its host on locale/text changes.
 *   - `<i18n-provider .i18n=${...}>` — declarative provision inside templates.
 *   - `provideI18n(target, i18n)` — imperative provision on any EventTarget
 *     (e.g. `document.body` for app-wide provision).
 *
 * The controller resolves its instance in three stages, first match wins:
 *
 *   explicit argument -> context-request (protocol) -> internal zero-config fallback
 *
 * Interop: consumers and providers only share the `context-request` event and the
 * `i18nContext` key (a `Symbol.for` registry symbol), so this module interoperates
 * with any protocol-compliant counterpart (e.g. an @lit/context provider using the
 * same key) — across bundle copies and versions.
 *
 * Importing this module registers the `<i18n-provider>` element (guarded against
 * double registration and non-browser environments).
 */

import { createI18n } from "../i18n.js";
import type { I18n, Unsubscribe } from "../i18n.js";

export { I18nProviderElement, i18nContext, i18nController, provideI18n };

export type { I18nController, I18nControllerHost };

// -------------------------------------------------------------------
// # Context Community Protocol
// -------------------------------------------------------------------

// The context key. `Symbol.for` (global symbol registry) so that multiple copies or
// versions of this module in one bundle still interoperate — key equality is the
// protocol's only identity mechanism.
const i18nContext: symbol = Symbol.for("i18n-facade.I18n");

type ContextCallback = (value: I18n, unsubscribe?: Unsubscribe) => void;

// The protocol's event shape: fields live directly on the event (not in `detail`).
class ContextRequestEvent extends Event {
  public readonly context: unknown;
  public readonly callback: ContextCallback;
  public readonly subscribe?: boolean;

  constructor(context: unknown, callback: ContextCallback, subscribe?: boolean) {
    super("context-request", { bubbles: true, composed: true });
    this.context = context;
    this.callback = callback;
    this.subscribe = subscribe;
  }
}

/** Is this a request for OUR context, with a usable callback? */
function isI18nRequest(event: Event): event is Event & ContextRequestEvent {
  const request = event as Partial<ContextRequestEvent>;
  return request.context === i18nContext && typeof request.callback === "function";
}

// -------------------------------------------------------------------
// # Internal zero-config fallback (NOT exported, immutable once created)
// -------------------------------------------------------------------

let fallbackI18n: I18n | undefined;

function getFallbackI18n(): I18n {
  return (fallbackI18n ??= createI18n());
}

// -------------------------------------------------------------------
// # Providers
// -------------------------------------------------------------------

/**
 * Make `target` answer i18n context requests with the given instance. Mount it on any
 * ancestor of the consuming components — `document.body` for app-wide provision.
 * Returns an Unsubscribe that stops providing.
 */
function provideI18n(target: EventTarget, i18n: I18n): Unsubscribe {
  const listener = (event: Event): void => {
    if (!isI18nRequest(event)) {
      return; // some other context's request — let it bubble on
    }
    event.stopPropagation();
    // Our provided value never changes (the instance is stable; its CONTENT changes
    // are delivered via i18n.onChange), so subscribers get a no-op unsubscribe.
    event.callback(i18n, event.subscribe ? () => undefined : undefined);
  };

  target.addEventListener("context-request", listener);
  return () => target.removeEventListener("context-request", listener);
}

// HTMLElement is absent outside the browser; a dummy base keeps this module loadable
// there (the element is only registered client-side anyway).
const ElementBase: typeof HTMLElement =
  globalThis.HTMLElement ?? (class {} as unknown as typeof HTMLElement);

/**
 * Declarative provider for templates:
 *
 *   <i18n-provider .i18n=${appI18n}>
 *     <fancy-date-picker></fancy-date-picker>
 *   </i18n-provider>
 *
 * Layout-neutral (`display: contents`). Value semantics:
 *   - Requests arriving while `i18n` is set are answered and claimed (stopPropagation).
 *   - Requests arriving BEFORE `i18n` is set are NOT claimed (an outer provider may
 *     serve meanwhile); `subscribe` requests are remembered and answered as soon as a
 *     value arrives — consumers keep the latest answer.
 *   - Setting a NEW instance re-notifies all subscribed consumers.
 */
class I18nProviderElement extends ElementBase {
  #i18n: I18n | null = null;
  // subscriber -> its STABLE unsubscribe (stable so consumers can compare identity
  // across repeated answers, as e.g. @lit/context consumers do)
  #subscribers = new Map<ContextCallback, Unsubscribe>();

  readonly #listener = (event: Event): void => {
    if (!isI18nRequest(event)) {
      return;
    }
    const { callback, subscribe } = event;

    if (subscribe) {
      let unsubscribe = this.#subscribers.get(callback);
      if (!unsubscribe) {
        unsubscribe = () => void this.#subscribers.delete(callback);
        this.#subscribers.set(callback, unsubscribe);
      }
      if (this.#i18n) {
        event.stopPropagation();
        callback(this.#i18n, unsubscribe);
      }
      // no value yet: keep the subscription, but let the request bubble on so an
      // outer provider can serve in the meantime.
    } else if (this.#i18n) {
      event.stopPropagation();
      callback(this.#i18n);
    }
  };

  get i18n(): I18n | null {
    return this.#i18n;
  }

  set i18n(value: I18n | null) {
    if (value === this.#i18n) return;
    this.#i18n = value;
    if (value) {
      for (const [callback, unsubscribe] of [...this.#subscribers] /* NOSONAR */) {
        callback(value, unsubscribe);
      }
    }
  }

  connectedCallback(): void {
    this.style.display = "contents"; // provider must not affect layout
    this.addEventListener("context-request", this.#listener);
  }

  disconnectedCallback(): void {
    this.removeEventListener("context-request", this.#listener);
  }
}

// Register on import — guarded against double registration (duplicate bundle copies)
// and against non-browser environments.
if (globalThis.customElements && !globalThis.customElements.get("i18n-provider")) {
  globalThis.customElements.define("i18n-provider", I18nProviderElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "i18n-provider": I18nProviderElement;
  }
}

// -------------------------------------------------------------------
// # Reactive controller (Lit-style hosts)
// -------------------------------------------------------------------

type I18nController = I18n & {
  hostConnected(): void;
  hostDisconnected(): void;
};

// Must be an EventTarget (e.g. a LitElement) so the controller can dispatch
// `context-request` events per the Context Community Protocol.
type I18nControllerHost = EventTarget & {
  requestUpdate(): void;
  addController(controller: I18nController): void;
};

/**
 * A Lit-style reactive controller that IS an I18n (delegating to its current
 * instance) and re-renders its host on locale/text changes.
 *
 * Instance resolution, first match wins:
 *   1. the explicit `i18n` argument (tests, special cases)
 *   2. a context provider up the tree (re-requested on every connect; providers may
 *      answer late via `subscribe`)
 *   3. the internal zero-config fallback
 *
 * Note: `localize(locale)` hands out a facade of the CURRENT instance; if a provider
 * swaps the instance later, previously returned facades keep pointing at the old one.
 * Prefer calling through the controller in render code.
 */
function i18nController(host: I18nControllerHost, i18n?: I18n): I18nController {
  let current: I18n = i18n ?? getFallbackI18n();
  let connected = false;
  let unsubscribeChange: Unsubscribe | null = null;
  let unsubscribeContext: Unsubscribe | null = null;

  function subscribeToCurrent(): void {
    unsubscribeChange?.();
    unsubscribeChange = current.onChange(() => host.requestUpdate());
  }

  function switchTo(instance: I18n): void {
    if (instance === current) return;
    current = instance;
    if (connected) {
      subscribeToCurrent();
      host.requestUpdate();
    }
  }

  const controller: I18nController = {
    // Delegating members — `current` may be swapped by a context provider, so the
    // controller forwards instead of spreading a snapshot.
    getText: ((namespace: any, key: any, params?: any) =>
      (current.getText as (ns: any, key: any, params?: any) => string)(
        namespace,
        key,
        params,
      )) as I18n["getText"],
    bindTexts: ((namespace?: any) => {
      // Bind lazily through `current` so a later instance switch is honored.
      const lookup = (ns: any, key: any, params?: any): string =>
        (current.getText as (ns: any, key: any, params?: any) => string)(ns, key, params);
      return (first: unknown, second?: unknown, third?: unknown): string =>
        namespace && typeof first === "string"
          ? lookup(namespace, first, second)
          : lookup(first, second, third);
    }) as I18n["bindTexts"],
    formatNumber: (value, options?) => current.formatNumber(value, options),
    numberFormat: (options) => current.numberFormat(options),
    formatDateTime: (value, options) => current.formatDateTime(value, options),
    dateTimeFormat: (options) => current.dateTimeFormat(options),
    getLocale: () => current.getLocale(),
    onChange: (listener) => current.onChange(listener),
    localize: (locale?) => current.localize(locale),

    hostConnected() {
      connected = true;
      subscribeToCurrent();

      // Only consult the tree when no explicit instance was given.
      if (!i18n) {
        host.dispatchEvent(
          new ContextRequestEvent(
            i18nContext,
            (value, unsubscribe) => {
              // A provider may answer repeatedly (late value, changed value). Keep
              // only the latest subscription — but compare identity first: repeated
              // answers of the SAME subscription must not unsubscribe themselves.
              if (unsubscribe !== unsubscribeContext) {
                unsubscribeContext?.();
                unsubscribeContext = unsubscribe ?? null;
              }
              switchTo(value);
            },
            true, // subscribe: allow late/updated answers
          ),
        );
      }
    },

    hostDisconnected() {
      connected = false;
      unsubscribeChange?.();
      unsubscribeChange = null;
      unsubscribeContext?.();
      unsubscribeContext = null;
    },
  };

  host.addController(controller);
  return Object.freeze(controller);
}
