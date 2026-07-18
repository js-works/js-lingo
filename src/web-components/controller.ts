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

import { createI18n } from "../core.js";
import type { I18n, Unsubscribe } from "../core.js";
import { i18nContext, ContextRequestEvent } from "./provider.js";

export { i18nController };
export type { I18nController, I18nControllerHost };

// -------------------------------------------------------------------
// # Internal zero-config fallback (NOT exported, immutable once created)
// -------------------------------------------------------------------

let fallbackI18n: I18n | undefined;

function getFallbackI18n(): I18n {
  return (fallbackI18n ??= createI18n());
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
    text: ((namespace: any, key: any, params?: any) =>
      (current.text as (ns: any, key: any, params?: any) => string)(
        namespace,
        key,
        params,
      )) as I18n["text"],
    bindTexts: ((namespace?: any) => {
      // Bind lazily through `current` so a later instance switch is honored.
      const lookup = (ns: any, key: any, params?: any): string =>
        (current.text as (ns: any, key: any, params?: any) => string)(
          ns,
          key,
          params,
        );
      return (first: unknown, second?: unknown, third?: unknown): string =>
        namespace && typeof first === "string"
          ? lookup(namespace, first, second)
          : lookup(first, second, third);
    }) as I18n["bindTexts"],
    hasText: ((namespace: any, key: any, includeFallback?: boolean) =>
      current.hasText(namespace, key, includeFallback)) as I18n["hasText"],
    formatNumber: (value, options?) => current.formatNumber(value, options),
    formatNumberRange: (start, end, options?) => current.formatNumberRange(start, end, options),
    numberFormat: (options) => current.numberFormat(options),
    formatDateTime: (value, options) => current.formatDateTime(value, options),
    formatDateTimeRange: (start, end, options?) =>
      current.formatDateTimeRange(start, end, options),
    dateTimeFormat: (options) => current.dateTimeFormat(options),
    formatRelativeTime: (value, unit, options?) =>
      current.formatRelativeTime(value, unit, options),
    relativeTimeFormat: (options) => current.relativeTimeFormat(options),
    formatList: (list, options?) => current.formatList(list, options),
    listFormat: (options) => current.listFormat(options),
    locale: () => current.locale(),
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
