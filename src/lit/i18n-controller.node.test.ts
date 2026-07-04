/**
 * Node-environment import test: the module must load without a DOM (dummy element
 * base, registration skipped) so isomorphic bundles do not crash on the server.
 */
import { describe, expect, it } from "vitest";
import {
  I18nProviderElement,
  i18nContext,
  i18nController,
  provideI18n,
} from "./i18n-controller.js";

describe("i18n-controller (server-side import)", () => {
  it("loads without a DOM and exports its surface", () => {
    expect(typeof i18nController).toBe("function");
    expect(typeof provideI18n).toBe("function");
    expect(typeof I18nProviderElement).toBe("function");
    expect(typeof i18nContext).toBe("symbol");
    expect(i18nContext).toBe(Symbol.for("i18n-facade.I18n")); // interop contract
  });
});
