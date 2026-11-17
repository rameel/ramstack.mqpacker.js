# @ramstack/mqpacker
[![NPM](https://img.shields.io/npm/v/@ramstack/mqpacker)](https://www.npmjs.com/package/@ramstack/mqpacker)
[![MIT](https://img.shields.io/github/license/rameel/ramstack.mqpacker.js)](https://github.com/rameel/ramstack.mqpacker.js/blob/main/LICENSE)

A [PostCSS](https://postcss.org) plugin that packs identical media queries into one `@media` rule.

It is a modern replacement for the unmaintained [css-mqpacker](https://github.com/hail2u/node-css-mqpacker)
and understands today's CSS: native nesting, cascade layers, `@supports`, `@container`, `@scope`
and the media queries range syntax.

```css
/* Input */
.card {
  padding: 1rem;

  @media (width >= 768px) {
    padding: 2rem;
  }
}

.button {
  color: black;

  @media (width >= 768px) {
    color: blue;
  }
}

/* Output */
.card {
  padding: 1rem;
}

.button {
  color: black;
}

@media (width >= 768px) {
  .card {
    padding: 2rem;
  }

  .button {
    color: blue;
  }
}
```


## Installation
```bash
npm install --save-dev postcss @ramstack/mqpacker
```


## Usage
```js
// postcss.config.js
import mqpacker from "@ramstack/mqpacker";

export default {
  plugins: [
    mqpacker()
  ]
};
```

Or with the PostCSS API:

```js
import postcss from "postcss";
import mqpacker from "@ramstack/mqpacker";

const result = await postcss([mqpacker()]).process(css, { from: "style.css" });
```

In CommonJS, `require()` returns the plugin (Node.js 22.12 or later):

```js
// postcss.config.cjs
module.exports = {
  plugins: [
    require("@ramstack/mqpacker")()
  ]
};
```

Run the plugin before minifiers like `cssnano`, and after plugins that generate media queries,
such as `postcss-custom-media`.


## Options

### `sort`
Specifies the order of the packed media queries. Default: `true`.

| Value                            | Order                                                                                  |
|----------------------------------|----------------------------------------------------------------------------------------|
| `true`, `null`, `"mobile-first"` | Queries with a lower width bound first, ascending. See below.                          |
| `"desktop-first"`                | Queries with an upper width bound first, descending. See below.                        |
| `false`                          | The order in which the queries first appear.                                           |
| `(a, b) => number`               | A custom compare function that receives the query lists, as in `Array.prototype.sort`. |

#### `"mobile-first"`
In the mobile-first approach, the base styles target small screens, and media queries with
a lower width bound (`min-width`, `width >= …`, `… <= width`) add styles as the viewport grows.
Since a later rule wins in the cascade, these queries are sorted by the lower bound in ascending order,
so the styles for wider viewports override the styles for narrower ones:

```css
/* Input */
@media (width >= 768px) { .a { color: blue } }
@media (width >= 560px) { .a { color: red } }
@media (width >= 1024px) { .a { color: green } }

/* Output */
@media (width >= 560px) { .a { color: red } }
@media (width >= 768px) { .a { color: blue } }
@media (width >= 1024px) { .a { color: green } }
```

`sort: true` is the same as `sort: "mobile-first"`.

#### `"desktop-first"`
In the desktop-first approach, the base styles target large screens, and media queries with
an upper width bound (`max-width`, `width <= …`, `… >= width`) adjust them as the viewport shrinks.
These queries are sorted by the upper bound in descending order, so the styles for narrower viewports
override the styles for wider ones:

```css
/* Input */
@media (max-width: 767px) { .a { color: blue } }
@media (max-width: 1023px) { .a { color: green } }
@media (max-width: 559px) { .a { color: red } }

/* Output */
@media (max-width: 1023px) { .a { color: green } }
@media (max-width: 767px) { .a { color: blue } }
@media (max-width: 559px) { .a { color: red } }
```

#### Remaining queries
In both modes, the queries without the corresponding bound, such as `print`, `(prefers-color-scheme: dark)`
or `max-width` queries in the mobile-first mode, follow the sorted ones in their original order:

```css
/* Input */
@media (max-width: 767px) { .a { color: black } }
@media (width >= 1024px) { .a { color: green } }
@media print { .a { color: gray } }
@media (width >= 560px) { .a { color: red } }

/* Output with sort: true */
@media (width >= 560px) { .a { color: red } }
@media (width >= 1024px) { .a { color: green } }
@media (max-width: 767px) { .a { color: black } }
@media print { .a { color: gray } }

/* Output with sort: "desktop-first" */
@media (max-width: 767px) { .a { color: black } }
@media (width >= 1024px) { .a { color: green } }
@media print { .a { color: gray } }
@media (width >= 560px) { .a { color: red } }
```

#### Details
* A query with both bounds, such as `(768px <= width < 1024px)`, is sorted by the lower bound
  in the mobile-first mode and by the upper bound in the desktop-first mode. An exact width,
  `(width: 768px)` or `(width = 768px)`, is both bounds.
* A query list is sorted by the widest range of its queries: the lowest lower bound in the mobile-first mode
  and the highest upper bound in the desktop-first mode. For example, `print, (min-width: 768px)` is sorted
  as `768px`, and `(max-width: 500px), (max-width: 900px)` as `900px`.
* Lengths in `px`, `em` and `rem` are supported; `em` and `rem` are resolved against `16px`,
  as browsers do in media queries. Bounds with other values, such as `calc()` or `vw`, are ignored.
* Queries with `not` or `or`, and queries for media types other than `all` and `screen`
  (e.g. `print and (min-width: 768px)`), are treated as having no bound.


## How it works
Media queries are packed within a **context**: the stylesheet, a `@layer` block, or a `@media` rule
for the media queries nested in it. All the `@media` rules with the same query list are merged into one,
which is placed at the end of the context.

Queries are compared after normalization, so `(min-width:768px)`, `( MIN-WIDTH : 768px )` and
`(min-width: 768px) /* tablet */` are considered identical. Custom media queries such as `(--Tablet)`
keep their case.

### Nesting
A media query nested in a style rule is moved out of it together with the selector, keeping
the nesting intact, so `&` and relative selectors resolve exactly as before:

```css
/* Input */
.card {
  .title {
    @media (width >= 768px) {
      font-size: 2rem;

      & + p { margin: 0 }
    }
  }
}

/* Output */
@media (width >= 768px) {
  .card {
    .title {
      font-size: 2rem;

      & + p { margin: 0 }
    }
  }
}
```

Rules that become empty are removed, and adjacent pieces of the same rule are merged back together.

### Conditional at-rules
`@supports`, `@container`, `@scope` and `@starting-style` only restrict where their content applies,
so a media query is moved out of them by swapping the nesting:

```css
/* Input */
@supports (display: grid) {
  @media (width >= 768px) {
    .grid { display: grid }
  }
}

/* Output */
@media (width >= 768px) {
  @supports (display: grid) {
    .grid { display: grid }
  }
}
```

Media queries nested in another `@media` rule are packed inside it. Their query lists are never
combined, since this is not possible in general: `screen, print` and `(min-width: 768px)`
cannot be expressed as a single query list without changing the meaning.

### Cascade layers
Moving a rule out of a `@layer` block would move it into a different layer, so media queries
are packed only within their layer block.

The order of cascade layers is determined by the order in which they are first declared.
A media query that declares a layer would change that order when moved to the end, so such
media queries are left in place with a warning:

```css
@media (width >= 768px) {
  @layer components { /* ... */ }  /* "components" is declared here first */
}

@layer utilities { /* ... */ }
```

The preceding media queries with the same query list are left in place as well,
since moving them after it would change the order of their rules.

To allow packing, declare the layer order upfront. Only unconditional declarations count:
an `@layer` statement or block, or an `@import` with `layer()` and no conditions.

```css
@layer components, utilities;
```

### Other at-rules
The content of other at-rules, including unknown ones such as `@mixin` or `@-moz-document`,
is left untouched, since moving media queries out of them may change the meaning.

### Comments
Comments right before a `@media` rule usually describe it, so they are moved together with its content:

```css
/* Input */
.a { color: red }
/* Tablet */
@media (width >= 768px) { .a { color: blue } }
.b { color: red }

/* Output */
.a { color: red }
.b { color: red }
@media (width >= 768px) { /* Tablet */ .a { color: blue } }
```

Other comments stay in place, including a comment separated from the `@media` rule by an empty line,
a comment on the same line as the preceding rule, and `/*! ... */` comments.


## Caveats
Like any media query packer, the plugin changes the order of rules, which may change the result
of the cascade. For example, `.a` below is red on wide screens before packing and blue after it:

```css
@media (width >= 768px) { .a { color: blue } }
.a { color: red }
```

Make sure the rules in media queries do not rely on being overridden by the rules that follow them.

Sorting, which is enabled by default, also changes the order of the media queries relative to each other.
When two queries can match at the same time, such as a `max-width` and a `min-width` query,
or `(prefers-color-scheme: dark)` and a width query, sorting may change which of their rules wins.
For example, the default mobile-first sorting moves the `max-width` query below after the `min-width` one,
so on a 700px wide viewport `.a` is blue before packing and red after it:

```css
@media (max-width: 1000px) { .a { color: red } }
@media (min-width: 500px) { .a { color: blue } }
```

If the rules in such queries depend on their order, disable sorting with `sort: false`.

`@keyframes` and `@font-face` rules in media queries are moved as well. When several of them define
the same animation or font face, the last one takes effect, so a moved rule may override the ones
that followed it.


## Migrating from css-mqpacker
Replace the import:

```diff
- import mqpacker from "css-mqpacker";
+ import mqpacker from "@ramstack/mqpacker";
```

The values of the `sort` option are compatible, including custom compare functions. The differences:

* Media queries are sorted mobile-first by default. Pass `sort: false` to keep the order in which
  they first appear, as css-mqpacker does by default.
* The plugin requires PostCSS 8 and is published as an ES module. `require()` works
  in Node.js 22.12 or later.
* The `mqpacker.pack()` helper and the CLI are not provided; use the PostCSS API or `postcss-cli`.
* Media queries are moved out of nested style rules, `@container`, `@scope` and `@starting-style`,
  not only out of `@supports`, at any depth.
* Media queries are never moved out of `@layer` blocks.
* Equal query lists are recognized regardless of whitespace, comments and case.
* Sorting understands the range syntax: `(width >= 768px)`, `(768px <= width < 1024px)`.


## License
This package is released as open source under the **MIT License**.
See the [LICENSE](https://github.com/rameel/ramstack.mqpacker.js/blob/main/LICENSE) file for more details.
