# Contributing

Bug reports, fixes, and documentation improvements are welcome, including small ones.

## Reporting bugs

Tell us what happened and what you expected. Include the `@ramstack/mqpacker`, PostCSS, and Node.js versions
you're using, along with the plugin options.

A minimal CSS example that reproduces the problem helps the most: the input, the output you got,
and the output you expected.

Note that packing changes the order of rules, which can change the result of the cascade.
See [Caveats](README.md#caveats) before reporting such a change as a bug.

## Development setup

Install Node.js and [pnpm](https://pnpm.io) to build from source.

Run the commands below from the repository root:

```console
pnpm install --frozen-lockfile
```

## Building and testing

```console
pnpm test
pnpm typecheck
pnpm build
```

Tests run directly against `src`, so there is no need to build before running them.

## Code style

Follow [.editorconfig](.editorconfig) and the style of the surrounding code.
Keep formatting changes limited to the code you're working on.

## Pull requests

- Keep each pull request focused on one goal. Do not mix unrelated changes into it.
- Explain what changed and why, and link to related issues if there are any.
- When fixing a reproducible bug, add a regression test with the input and the expected output.
  Add tests for new behavior where appropriate.
- Update the [README](README.md) if your change affects the options or the output.
- Keep changes compatible with the supported PostCSS versions (`peerDependencies` in `package.json`).

For new options or changes to the order of the output, open an issue first so we can agree
on the approach before you spend time on it.

Use the [scoped commit style](#commit-messages) for pull request titles. Choose the scope with the
[same rules](#choosing-a-scope) as for a commit, treating the whole pull request as one change.
The title does not need to summarize every supporting commit.

## Commit messages

Use scoped commit messages:

```text
<scope>: <concise description>
```

The scope identifies the part of the project that changed. Write the description in the imperative mood,
starting with a lowercase letter and without a trailing period. Describe what the change does rather than
just naming its type.

```text
plugin: preserve the order of cascade layers
plugin: accept a custom comparer in the sort option
plugin: document the sort option
docs: add a guide for migrating from css-mqpacker
build: generate type declarations with rolldown-plugin-dts
repo: define contribution conventions
```

Do not prefix messages with conventional commit types such as `feat`, `fix`, `refactor`, or `chore`,
and do not use ticket numbers as scopes. The description should make the type of change clear when it matters.
Put ticket references and implementation details in the message body when needed.

### Scopes

| Scope    | Area                                                                                         |
|----------|----------------------------------------------------------------------------------------------|
| `plugin` | Plugin behavior, options, and public API, including their tests, documentation, and examples |
| `docs`   | General documentation, such as installation and migration guides                             |
| `tests`  | Shared test infrastructure                                                                   |
| `build`  | Build, CI, dependencies, development tooling, and npm packaging                              |
| `repo`   | Repository structure and metadata, contribution and code style rules, cross-area cleanups    |

Use `plugin` for its tests, documentation, and examples, even when a commit changes only those files.
For example, use `plugin: test nested layers` rather than `tests: add layer tests`.
Reserve `tests` and `docs` for their own infrastructure or for general content.

If the history of `plugin` becomes difficult to navigate, add a subscope for a stable area,
such as `plugin/layers`. Separate the root scope and subscope with `/`.

### Choosing a scope

Most commits change one area; use its scope from the table. When a commit touches several scopes,
use the first rule that applies:

1. **It changes behavior, public API, or performance.** Use `plugin`, even if the change also touches
   the build or the tests.
2. **It introduces or updates one thing that the rest of the commit adopts.** Use the scope of that thing:
   `build: enable strict type checking`, `repo: define formatting rules`.
3. **Anything else**, such as formatting, renames, or file moves. Use `repo`, even when only
   the plugin code changes.

Make each commit one logical change. Split logically separate changes into separate commits, even when they
share a scope: if the description needs "and" to join unrelated changes, the commit should be split.
Do not split a single change only to give each part its own scope, and do not list several scopes
(`plugin, docs:`).
