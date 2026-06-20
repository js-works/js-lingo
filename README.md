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

### 2. Define translations

```ts
import { defineTexts } from "js-lingo";

const texts = defineTexts({
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

i18n.registerTexts(texts);
```

---

### 4. Get translated text

```ts
const message = i18n.getText(
  "en-US",
  common,
  "greet",
  { name: "John" }
);
```

---

## Localizer (Convenience API)

A `Localizer` binds a locale to simplify calls.

```ts
const loc = i18n.getLocalizer("en-US");

loc.getText(common, "hello");
loc.formatNumber(1234.56);
loc.formatDateTime(new Date());
```

---

## Lit-style Controller

js-lingo includes a controller abstraction that can be used in reactive frameworks.

```ts
import { LitElement } from "lit";
import { localize } from "js-lingo";

class MyComponent extends LitElement {
  private #loc = localize(this);

  render() {
    return this.#loc.getText(greetTexts, "hello");
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
const texts = defineTexts({
  "en-US": [
    cartTexts.full({
      items: (params) => `You have ${params.count} items`,
    }),
  ],
});
```

---

## API Reference

### Core

- createI18n(config?) – create isolated instance
- getI18n() – global singleton instance
- initI18n(config) – initialize global config once
- registerTexts(...) – add translations

---

### Namespaces

- createNamespace<T>(id) – typed namespace builder

---

### Utilities

- defineTexts(texts) – type-safe translation definition
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
- Framework integration via controller abstraction
- Supports both static and dynamic translations

---

## License

MIT
