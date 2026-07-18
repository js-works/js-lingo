/**
 * React integration for the i18n facade.
 *
 * Two public entry points — `I18nProvider` and `useI18n` — mirroring the minimal
 * surface of the other adapters. The React context is private; consumers interact
 * only through these two.
 *
 * The provider serves TWO channels from one instance:
 *   - React context, for `useI18n` in React components;
 *   - the DOM/context protocol (via `provideI18n` on a layout-neutral wrapper), for
 *     custom elements rendered in the subtree — the primary path when React merely
 *     hosts js-lingo-based web components.
 *
 * `useI18n` returns the current instance plus a bound `t` (scoped to the given
 * namespace, or fully-qualified without one). It re-renders on locale AND text
 * changes by minting a fresh statically-bound sibling per change, SHALLOW-COPIED so
 * its identity is guaranteed fresh even when `localize()` returns an already-cached
 * sibling (e.g. a text-only change with the locale unchanged) — the dynamic instance
 * is reference-stable and a repeated-locale sibling is cache-stable, and either would
 * otherwise make useSyncExternalStore bail out on an unchanged reference. The
 * statically-bound snapshot also guarantees a consistent locale across one render
 * pass (tearing-safe under concurrent rendering).
 *
 * JSX-free on purpose (uses `createElement as h`), so this file is a plain `.ts`.
 */

import {
  createContext,
  createElement as h,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import type { ReactNode } from "react";
import { createI18n } from "../index.js";
import { provideI18n } from "../web-components/index.js";
import type {
  BoundTexts,
  I18n,
  LoadingAware,
  Namespace,
  TextMap,
  TextSource,
  UnboundTexts,
} from "../index.js";

export { I18nProvider, useI18n, useI18nSuspense };

// -------------------------------------------------------------------
// # Context (private)
// -------------------------------------------------------------------

// Default: the zero-config instance, so `useI18n` works without a provider — untranslated
// but never broken, mirroring the controller's and provider's fallback behavior.
const I18nContext = createContext<I18n>(createI18n());

// -------------------------------------------------------------------
// # Provider
// -------------------------------------------------------------------

/**
 * Provide an i18n instance to the subtree — to React components (via context) AND to
 * custom elements (via the DOM context protocol, on a `display: contents` wrapper that
 * is present in the DOM for event bubbling but invisible to layout).
 *
 * Pass a STABLE instance (module scope, or memoized) — an instance created inline on
 * every render would reset the snapshot machinery and thrash re-rendering.
 */
function I18nProvider({ i18n, children }: { i18n: I18n; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  // Bridge to the DOM/context protocol for custom elements in the subtree. `ref.current`
  // is guaranteed attached here (React commits refs before running passive effects, and
  // the wrapper div below is rendered unconditionally) — the null check is a defensive
  // fallback with no reachable path under normal rendering; see provider-ref.test.ts
  // for the one way (mocking `useRef`) it can be exercised at all.
  useEffect(() => {
    /* v8 ignore next */
    return ref.current ? provideI18n(ref.current, i18n) : undefined;
  }, [i18n]);

  return h(
    I18nContext.Provider,
    { value: i18n },
    h("div", { ref, style: { display: "contents" } }, children),
  );
}

// -------------------------------------------------------------------
// # Hook
// -------------------------------------------------------------------

/**
 * Access the active i18n instance and a bound `t`.
 *
 *   const { t, i18n } = useI18n(dialogTexts); // t is scoped to dialogTexts
 *   const { t, i18n } = useI18n();            // t is the fully-qualified lookup
 *
 * Re-renders the component on locale and text changes.
 */
function useI18n(): { i18n: I18n; t: UnboundTexts };
function useI18n<T extends TextMap>(namespace: Namespace<T>): { i18n: I18n; t: BoundTexts<T> };
function useI18n(namespace?: Namespace<any>): { i18n: I18n; t: (...args: any[]) => string } {
  const source = useContext(I18nContext);

  // A store whose snapshot IDENTITY changes on every locale/text change, so
  // useSyncExternalStore actually re-renders. Shallow-copied: `localize()` caches
  // siblings per canonical locale, so a text-only change (locale unchanged) would
  // otherwise hand back the SAME cached sibling and be mistaken for "nothing changed".
  const store = useMemo(() => {
    const freshSnapshot = (): I18n => ({ ...source.localize(source.locale()) });
    let snapshot: I18n = freshSnapshot();
    return {
      subscribe: (onStoreChange: () => void) =>
        source.onChange(() => {
          snapshot = freshSnapshot(); // fresh identity per event, always
          onStoreChange();
        }),
      getSnapshot: () => snapshot,
    };
  }, [source]);

  // Third arg = server snapshot (SSR): the per-request instance arrives via the provider.
  const i18n = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // Derived from the current snapshot, so `t` changes identity per render — safe in
  // dependency arrays.
  const t = useMemo(
    () => (namespace ? i18n.bindTexts(namespace) : i18n.bindTexts()),
    [i18n, namespace],
  );

  return { i18n, t };
}

/**
 * Like `useI18n(namespace)`, but SUSPENDS while the given source is still loading that
 * namespace in the active locale — so the component renders only real translations,
 * never the flash-of-default-text that the plain hook allows.
 *
 *   const { t } = useI18nSuspense(appTextSource, dialogTexts); // inside a <Suspense fallback={…}>
 *
 * Takes the `TextSource` explicitly (the one you passed to `createI18n`) rather than
 * reading loading state off the facade — loading is a source concern, kept off the lean,
 * sync `I18n` type. The source must implement the `LoadingAware` capability
 * (`isLoading`/`whenReady`), i.e. an adapter over an on-demand backend; `defaultTextSource`
 * does not, so it isn't a valid argument here (use plain `useI18n` with it).
 *
 * Mechanism: while `source.isLoading(locale, namespace)` it throws
 * `source.whenReady(locale, namespace)` — the promise React's Suspense awaits, retrying
 * the render once it settles. `whenReady` resolves (never rejects) even on a failed load,
 * so the boundary always un-suspends; after a failure the texts fall through to the
 * namespace defaults.
 */
function useI18nSuspense<T extends TextMap>(
  source: TextSource & LoadingAware,
  namespace: Namespace<T>,
): { i18n: I18n; t: BoundTexts<T> } {
  const result = useI18n(namespace);
  if (source.isLoading(result.i18n.locale(), namespace)) {
    throw source.whenReady(result.i18n.locale(), namespace); // Suspense catches this; retries on settle
  }
  return result;
}
