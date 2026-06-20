import { describe, it, expect } from "vitest";
import { getI18n } from "./index";

describe("getI18n", () => {
  const i18n = getI18n();

  it("returns always the identical I18n object", () => {
    expect(i18n).equal(getI18n());
    expect(i18n).equal(getI18n());
    expect(i18n).equal(getI18n());
  });

  it("uses locale en-US as primary locale by default", () => {
    expect(i18n.getPrimaryLocale()).equals("en-US");
  });
});
