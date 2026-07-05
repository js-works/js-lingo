import IntlMessageFormat from "intl-messageformat";
import type { TranslationFn } from "js-lingo";

export { msg };

const cache = new Map<string, IntlMessageFormat>();

function msg<P extends Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...expr: never[] // ICU-Syntax steht IM String, nicht in ${}-Interpolationen
): TranslationFn<P> {
  const pattern = strings.raw.join(""); // ein einziger statischer String
  return (params, i18n) => {
    const key = `${i18n.getLocale()}\u0001${pattern}`;
    let fmt = cache.get(key);
    if (!fmt) {
      fmt = new IntlMessageFormat(pattern, i18n.getLocale());
      cache.set(key, fmt);
    }
    return String(fmt.format(params));
  };
}
