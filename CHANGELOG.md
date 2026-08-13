# Changelog

All notable changes to `@gts-meghni/nestjs-satim` will be documented in this file.

## v1.0.0 - 2026-08-13

First release: the NestJS port of [gts-meghni/laravel-satim](https://github.com/gts-meghni/laravel-satim).

Accept CIB and Edahabia card payments through the Algerian SATIM gateway, with the same rules the Laravel package enforces: amounts in centimes above the 50 DA minimum, order numbers of exactly ten alphanumeric characters, udf values within 20 characters, and a payment treated as paid only when respCode, errorCode, and orderStatus agree.

### What is in it

- `SatimService`: register, acknowledge, refund, receipt, and order number generation
- Options validated at boot, naming the key that is missing or invalid, so a missing environment variable fails a release rather than a checkout
- An ORM-agnostic audit trail behind `SatimCallStore`, with in-memory, TypeORM, and Prisma stores that all pass the same contract suite
- `SatimReconcileService` for orders whose customer never came back from the payment page
- Four events, reachable through option hooks or `@nestjs/event-emitter`
- `SatimFake` for tests, which replaces the transport and nothing else
- Messages in Arabic, French, and English

### Notes

No runtime dependency: the transport is Node's own fetch. Anything an application might not need lives behind a subpath entry point with an optional peer: `/typeorm`, `/prisma`, `/event-emitter`, `/testing`.

Requires Node 20.19 or newer and NestJS 11.

```bash
pnpm add @gts-meghni/nestjs-satim

```
## 1.0.0

Initial release: the NestJS port of `gts-meghni/laravel-satim`.

- `SatimService` with register, acknowledge, refund, receipt, and order number generation
- Options validated at boot, naming the key that is missing or invalid
- ORM-agnostic audit trail behind `SatimCallStore`, with in-memory, TypeORM, and Prisma stores
- `SatimReconcileService` for orders whose customer never came back
- Four events, reachable through hooks or `@nestjs/event-emitter`
- `SatimFake` for tests, replacing the transport and nothing else
- Messages in Arabic, French, and English
