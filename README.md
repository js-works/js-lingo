[This text is ChatGPT generated - contains a lot of errors. Will be fixed soon]

# js-lingo

js-lingo is a small but fully functional i18n (internationalization) library for TypeScript/JavaScript applications. It is designed to be lightweight, flexible, and easy to embed, while also being capable of acting as a facade over more complex i18n systems.

It supports:

- Direct in-memory translation registration
- Lazy initialization
- Namespace-based organization
- Parameterized translations (functions)
- Locale fallback resolution
- Framework-agnostic usage
- Integration via a controller pattern (e.g. Lit-like reactive systems)

---

## Installation

```bash
npm install js-lingo
```

---

## Core Concept

Translations are organized as:

Locale → Namespace → Key → LocalizedText

A LocalizedText is either:

- a string
- a function that returns a string based on parameters

```ts
type LocalizedText =
  | string
  | (<T extends Record<string, unknown>>(params: T) => string);
```

---

## Basic Usage

### 1. Create a namespace

The namespace is typed via a `TextMap`, so you get full type safety.

```ts
import { createNamespace } from "js-lingo";

type GreetTexts = {
  hello: string;
  greet: (params: { name: string }) => string;
};

const greetTexts = createNamespace<GreetTexts>("greet");
```

---

### 2. Bundle texts

```ts
import { bundleTexts } from "js-lingo";

const texts = bundleTexts({
  "en-US": [
    greetTexts.full({
      hello: "Hello",
      greet: (params) => `Hello ${params.name}`,
    })
  ],
});
```

---

### 3. Initialize i18n

```ts
import { createI18n } from "js-lingo";

const i18n = createI18n();

i18n.addTexts(texts);
```

---

### 4. Get translated text

```ts
const message = i18n.getText("en-US", greetTexts, "greet", { name: "John" });
```

---

## Localizer

A `Localizer` binds a locale to simplify calls.

```ts
const loc = getI18n().getLocalizer("en-US");

loc.getText(greetTexts, "hello");
loc.formatNumber(1234.56);
loc.formatDateTime(new Date());
```

---

## Lit-style Controller

js-lingo includes a controller abstraction that can be used in reactive frameworks.

```ts
import { LitElement } from "lit";
import { bundleTexts, createNamespace, localize } from "js-lingo";

export { dateFieldTexts, defaultDateFieldTexts, DateField };
export type { DateFieldTexts };

type DateFieldTexts = {
  today: string,
  selectDate: string,
}

const dateFieldTexts = createNamespace<DateFieldTexts>("myLibrary.dateField");

const defaultDateFieldTexts = bundleTexts({
  "en-US": [
    dateFieldTexts.full({
      today: "Today",
      selectDate: "Please select a date",
    });
  ],
});

getI18n().addTexts(defaultDateFieldTexts);

@customElement("my-date-field")
class DateField extends LitElement {
  #loc = localize(this);
  #t = this.#loc.texts(dateFieldTexts);

  // ...

  render() {
    const todayText = this.#t("today");
    // ...
  }
}
```

The controller automatically reacts to:

- primary locale changes
- fallback locale changes

---

## Lazy Initialization (Global Singleton)

You can also use a global singleton instance:

```ts
import { getI18n } from "js-lingo";

const i18n = getI18n();
```

This instance:

- initializes lazily
- can optionally derive locale from DOM (`<html lang="...">`)
- supports runtime locale updates via MutationObserver

---

## Namespaces

Namespaces help structure translations and provide type safety.

```ts
const authTexts = createNamespace<AuthTexts>("auth");

authTexts.full({
  login: "Login",
  logout: "Logout",
});
```

Partial namespaces are also supported:

```ts
authTexts.partial({
  login: "Login",
});
```

---

## Translation Functions

Translations can be dynamic:

```ts
const texts = bundleTexts({
  "en-US": [
    cartTexts.full({
      items: (params) => `You have ${params.count} items`,
    }),
  ],
});
```

---

## API Reference

- createI18n(config?) – create isolated instance
- getI18n() – global singleton instance
- initI18n(config) – initialize global config once
- createNamespace<T>(id) – typed namespace builder
- bundleTexts(texts) – type-safe translation bundling
- localize(host) – controller binding

---

## Configuration

```ts
type I18nConfig = {
  getPrimaryLocale?(): string;
  onPrimaryLocaleChange?(fn: () => void): () => void;
  getFallbackLocales?(): string[];
  onFallbackLocalesChange?(fn: () => void): () => void;
  onAddTexts?(locale: string, namespace: string, key: string): void;
};
```

---

## Design Goals

- Minimal runtime overhead
- Strong TypeScript inference
- No dependency required
- Works standalone or as facade
- UI framework integration via controller abstraction

---

## License

MIT
