# NestJS SATIM

Accept CIB and Edahabia card payments in NestJS through the Algerian SATIM gateway, with typed results, an ORM-agnostic audit trail, and multilingual receipts.

This is the NestJS port of [gts-meghni/laravel-satim](https://github.com/gts-meghni/laravel-satim). Same gateway rules, same guarantees, idiomatic NestJS.

## Install

```bash
pnpm add @gts-meghni/nestjs-satim
```

Requires Node 20.19 or newer and NestJS 11. The package has **no runtime dependencies**: it talks to the gateway through Node's own `fetch`.

## Register the module

```ts
import { Module } from '@nestjs/common';
import { SatimModule } from '@gts-meghni/nestjs-satim';

@Module({
  imports: [
    SatimModule.register({
      baseUrl: process.env.SATIM_BASE_URL!,
      username: process.env.SATIM_USER!,
      password: process.env.SATIM_PASSWORD!,
      terminalId: process.env.SATIM_TERMINAL_ID!,
      returnUrl: process.env.SATIM_RETURN_URL!,
      failUrl: process.env.SATIM_FAIL_URL!,
      receiptLogo: '/assets/satim.png',
    }),
  ],
})
export class AppModule {}
```

Or build the options at boot, from `@nestjs/config` or anywhere else:

```ts
SatimModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    baseUrl: config.getOrThrow('SATIM_BASE_URL'),
    // ...
  }),
});
```

There is deliberately **no default base URL**: the production host is not the test host, and a fallback would risk sending live money to the wrong gateway. The test host is `https://test2.satim.dz/payment/rest`. HTTPS is required.

The options are validated as they are resolved, so a missing value fails at boot naming the key, not at checkout with a rejected payment.

## Take a payment

```ts
@Injectable()
export class CheckoutService {
  constructor(private readonly satim: SatimService) {}

  async pay(amountInDinars: number) {
    const orderNumber = await this.satim.orderNumber();

    // Persist your own payment attempt against orderNumber BEFORE this call.
    const result = await this.satim.register({ orderNumber, amount: amountInDinars });

    if (result.failed()) {
      // A gateway rejection is a normal outcome, not a thrown error.
      throw new BadRequestException(result.errorMessage ?? 'SATIM refused the order.');
    }

    // Store result.orderId, result.rawRequest and result.rawResponse, then send
    // the customer to result.formUrl.
    return result.formUrl;
  }
}
```

Amounts are given in dinars and converted to centimes for the gateway. SATIM refuses anything below 50 DA.

## Confirm the outcome

SATIM cancels unconfirmed orders after a delay, and a customer landing on the fail URL is not proof of failure. Call `acknowledge` on **both** the return and the fail URL:

```ts
const result = await this.satim.acknowledge(orderId);

if (result.paid()) {
  // Deposited: this is the only state that means the customer paid.
}

result.rejected(); // not paid, whatever the reason
result.refunded(); // refunded from SATIM's back office
result.cancelled(); // authorisation reversed
```

Whether the money moved is decided by `respCode`, `errorCode` and `orderStatus` read together, never by one alone. `paid()` is that rule.

## Refund

```ts
const refund = await this.satim.refund(orderId, 250.5);

refund.successful(); // errorCode "0"; a missing code counts as a failure
```

Several refunds against one order are allowed as long as they do not add up to more than was deposited. Your SATIM user needs the refund permission.

## Receipt

```ts
const receipt = this.satim.receipt(result, paidAt, SatimLanguage.AR);
```

`Receipt` holds every field the SATIM certification checklist expects and nothing that renders it: the page, the PDF, and the email are yours to brand. It carries `locale()` and `direction()`, so an Arabic receipt reads right to left.

Build it once after confirming, store it, and pass the stored `paidAt` back later: a reprint must be the original receipt, not a freshly dated one. `receiptLogo` must be set, because SATIM requires the logo beside the hotline text and never the text alone. The logo ships in `assets/satim.png`; serve it from your own static directory.

## The audit trail

One record per gateway call: what was sent, what came back, and what it meant. On by default, because SATIM may ask months later what exactly was exchanged for a payment.

The core imports no ORM. Bind whichever store matches your stack:

**TypeORM**

```ts
import { SatimCallEntity, TypeOrmSatimCallStore } from '@gts-meghni/nestjs-satim/typeorm';

const imports = [
  TypeOrmModule.forFeature([SatimCallEntity]),
  SatimModule.register(options, {
    extraProviders: [
      {
        provide: SATIM_CALL_STORE,
        inject: [getRepositoryToken(SatimCallEntity)],
        useFactory: (repository) => new TypeOrmSatimCallStore(repository),
      },
    ],
  }),
];
```

**Prisma**

```ts
import { PrismaSatimCallStore } from '@gts-meghni/nestjs-satim/prisma';

SatimModule.register(options, {
  extraProviders: [
    {
      provide: SATIM_CALL_STORE,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaSatimCallStore(prisma.satimCall),
    },
  ],
});
```

The Prisma model to add is in the doc comment on `PrismaSatimCallStore`. Anything else (Drizzle, Mongo, your own table) means implementing the `SatimCallStore` interface: seven methods.

**Leave it unbound and you get `InMemorySatimCallStore`**, which loses the trail on restart. Fine for a test, never enough for production.

What the trail buys you:

```ts
const state = await this.audit.stateFor(orderId);

state.paid();
state.refundedInCentimes();
state.unanswered(); // calls that were sent and never came back
```

Retention defaults to ten years, the period article 12 of the Algerian code de commerce sets for commercial books and documents. Nothing is deleted until you call `SatimAuditService.prune()`; schedule it yourself. Do not shorten it without asking whoever answers for your accounting.

## Reconciliation

A customer whose browser never reaches the return URL leaves an order nobody confirmed, even though the card may have been charged. `SatimReconcileService` asks the gateway what became of those orders:

```ts
SatimModule.register({ ...options, reconcile: { everyMs: 15 * 60 * 1000 } });
```

Or drive it from your own scheduler:

```ts
@Cron(CronExpression.EVERY_30_MINUTES)
async reconcile() {
  const summary = await this.reconcile.run();
}
```

It updates nothing of yours: listen for the reconciled event and settle the order in your own records. It reads the audit trail to find the orders, so it does nothing while the trail is off. An unreachable gateway is left for the next run rather than failing.

## Events

Four events: call started, call completed, call failed, order reconciled. The started event is emitted **before the request leaves**, so a call that dies in flight is still on record.

Hooks need no event library:

```ts
SatimModule.register({
  ...options,
  hooks: {
    onCallFailed: (event) => this.alerts.page(event.reason),
    onOrderReconciled: (event) => this.orders.settle(event.orderId, event.result),
  },
});
```

A throwing hook is logged and swallowed: your bookkeeping must not fail a payment the gateway already accepted.

For `@OnEvent` listeners, bridge onto `@nestjs/event-emitter`:

```ts
import { SatimEventEmitterPublisher } from '@gts-meghni/nestjs-satim/event-emitter';

SatimModule.register(options, {
  extraProviders: [{ provide: SATIM_EVENT_PUBLISHER, useClass: SatimEventEmitterPublisher }],
});

@OnEvent('satim.call.failed')
handle(event: SatimCallFailedEvent) {}
```

## Testing

`SatimFake` replaces the transport and nothing else: the amount conversion, the order number and udf validation, the events, and the audit trail all still run, so a test cannot pass on a call production would refuse to send.

```ts
import { SatimFake, SatimFakeResponse } from '@gts-meghni/nestjs-satim/testing';

const fake = new SatimFake({ acknowledge: SatimFakeResponse.declined() });

const moduleRef = await Test.createTestingModule({
  imports: [
    SatimModule.register(options, {
      extraProviders: [{ provide: SATIM_TRANSPORT, useValue: fake }],
    }),
  ],
}).compile();

// ...

fake.assertRegistered();
fake.assertRefunded(orderId, 250.5);
fake.assertNothingSent();
```

Queue several answers per operation and the last one keeps answering, which is what a reconciliation loop calling `acknowledge` twice needs. The assertions throw a plain `Error`, so they fail a test under any runner.

## Checking the configuration on deploy

```ts
const result = checkSatimOptions(options);
// result.valid, result.error, result.settings (password masked)
```

Turns a missing environment variable into a failed release instead of a failed payment at checkout.

## Timeouts

One `timeoutMs`, defaulting to 30 seconds. Keep it generous: cutting a request off does not undo it, so a short value risks money moving without your application learning the outcome.

Native `fetch` cannot express a separate connect timeout. If you want one, pass an undici `Agent` as `dispatcher` and it goes straight to `fetch`:

```ts
import { Agent } from 'undici';

SatimModule.register({ ...options, dispatcher: new Agent({ connect: { timeout: 10_000 } }) });
```

## Error codes

The same number does not mean the same thing on every endpoint, so read a code through `describeErrorCode(code, operation)`. SATIM's own message, in the language of the request, is what a customer should see; the code is for deciding what your code does next. A code outside the documented list leaves the raw value on the result.

## Licence

MIT. See [LICENSE.md](LICENSE.md).
