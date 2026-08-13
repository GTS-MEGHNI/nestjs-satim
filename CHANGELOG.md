# Changelog

All notable changes to `@gts-meghni/nestjs-satim` will be documented in this file.

## 1.0.0

Initial release: the NestJS port of `gts-meghni/laravel-satim`.

- `SatimService` with register, acknowledge, refund, receipt, and order number generation
- Options validated at boot, naming the key that is missing or invalid
- ORM-agnostic audit trail behind `SatimCallStore`, with in-memory, TypeORM, and Prisma stores
- `SatimReconcileService` for orders whose customer never came back
- Four events, reachable through hooks or `@nestjs/event-emitter`
- `SatimFake` for tests, replacing the transport and nothing else
- Messages in Arabic, French, and English
