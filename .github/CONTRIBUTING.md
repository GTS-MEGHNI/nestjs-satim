# Contribution Guide

Thank you for considering contributing to NestJS Satim! Please review the following guidelines before submitting a pull request.

For significant changes, please open an issue first so we can discuss the approach.

## Process

1. Fork the project
2. Create a new branch
3. Code, test, commit, and push
4. Open a pull request detailing your changes

## Guidelines

- Ensure everything passes by running `pnpm validate`.
- Send a coherent commit history, making sure each commit in your pull request is meaningful.
- You may need to [rebase](https://git-scm.com/book/en/v2/Git-Branching-Rebasing) to avoid merge conflicts.
- Please remember that we follow [SemVer](http://semver.org/).
- Nothing may be added to `dependencies`. The package ships with no runtime dependency, and anything an application might not need belongs behind a subpath entry point with an optional peer.

## Setup

Clone your fork, then install the dev dependencies with pnpm 10 and Node 20.19 or newer:

```bash
pnpm install
```

## Validate

One command runs everything CI runs:

```bash
pnpm validate
```

It runs, in order: oxlint, a Prettier check, `tsc --noEmit`, the test suite with its coverage thresholds, both builds, and the packaging checks (`publint` and `attw`).

The parts can also be run on their own:

```bash
pnpm lint          # oxlint
pnpm lint:fix      # oxlint --fix
pnpm format        # prettier --write
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run
pnpm test:watch    # vitest
pnpm test:coverage # vitest with the coverage thresholds enforced
pnpm build         # dist/cjs and dist/esm, both from tsc
```

## Tests

Tests live in `tests/` and run on Vitest. A gateway call is exercised through `SatimFake`, which replaces the transport and nothing else, so validation, events, and the audit trail all still run.

A new store adapter must pass the shared contract suite in `tests/stores.test.ts`: add it to the `behavesLikeACallStore` calls rather than writing a suite of its own, so every store answers the reconciler and the order state the same way.
