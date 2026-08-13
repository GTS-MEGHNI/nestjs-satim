import { Injectable } from '@nestjs/common';

import type {
  SatimCallCompletion,
  SatimCallRecord,
  SatimCallStarted,
  SatimCallStore,
  SatimUnconfirmedCriteria,
} from '../call-store.js';
import { SatimOperation } from '../operation.js';
import type { SatimResponse } from '../response-reader.js';

/**
 * The part of `prisma.satimCall` this store uses.
 *
 * Typed structurally rather than against @prisma/client, so the package depends
 * on no Prisma version and works whether the model is called satimCall or
 * something else: pass whichever delegate matches the schema below.
 */
export interface PrismaSatimCallDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<unknown>;
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
}

/**
 * The audit trail on Prisma.
 *
 * Add this model to your schema, then bind the store under SATIM_CALL_STORE:
 *
 * ```prisma
 * model SatimCall {
 *   id               Int       @id @default(autoincrement())
 *   callId           String    @unique
 *   operation        String
 *   orderNumber      String?
 *   orderId          String?
 *   amountInCentimes BigInt?
 *   request          Json
 *   response         Json?
 *   successful       Boolean?
 *   errorCode        String?
 *   errorMessage     String?
 *   orderStatus      Int?
 *   failureReason    String?
 *   createdAt        DateTime
 *   completedAt      DateTime?
 *
 *   @@index([orderId])
 *   @@index([orderNumber])
 *   @@index([createdAt])
 * }
 * ```
 */
@Injectable()
export class PrismaSatimCallStore implements SatimCallStore {
  constructor(private readonly calls: PrismaSatimCallDelegate) {}

  async start(call: SatimCallStarted): Promise<void> {
    await this.calls.create({
      data: {
        callId: call.callId,
        operation: call.operation,
        orderNumber: call.orderNumber,
        orderId: call.orderId,
        amountInCentimes: call.amountInCentimes,
        request: call.request,
        createdAt: call.createdAt,
      },
    });
  }

  async complete(completion: SatimCallCompletion): Promise<void> {
    await this.calls.updateMany({
      where: { callId: completion.callId },
      data: {
        // Written here too: on a register call the order id does not exist
        // until SATIM replies. A null would erase the one already recorded.
        ...(completion.orderId === null ? {} : { orderId: completion.orderId }),
        response: completion.response,
        successful: completion.successful,
        errorCode: completion.errorCode,
        errorMessage: completion.errorMessage,
        orderStatus: completion.orderStatus,
        completedAt: completion.completedAt,
      },
    });
  }

  async fail(callId: string, reason: string): Promise<void> {
    await this.calls.updateMany({
      where: { callId },
      data: { successful: false, failureReason: reason },
    });
  }

  async hasOrderNumber(orderNumber: string): Promise<boolean> {
    return (await this.calls.count({ where: { orderNumber } })) > 0;
  }

  async callsForOrder(orderId: string): Promise<SatimCallRecord[]> {
    const rows = await this.calls.findMany({ where: { orderId }, orderBy: { id: 'asc' } });

    return rows.map((row) => toRecord(row));
  }

  /**
   * Two queries rather than one: Prisma has no portable NOT EXISTS across an
   * unrelated row of the same model, and raw SQL would tie this to one
   * database. The limit is applied after the answered orders are removed, so a
   * run still asks about as many orders as it was allowed to.
   */
  async unconfirmed(criteria: SatimUnconfirmedCriteria): Promise<SatimCallRecord[]> {
    const registered = await this.calls.findMany({
      where: {
        operation: SatimOperation.Register,
        successful: true,
        orderId: { not: null },
        createdAt: { lte: criteria.registeredBefore, gte: criteria.registeredAfter },
      },
      orderBy: { id: 'asc' },
    });

    const orderIds = registered
      .map((row) => row['orderId'])
      .filter((orderId): orderId is string => typeof orderId === 'string');

    if (orderIds.length === 0) {
      return [];
    }

    const answered = await this.calls.findMany({
      where: {
        operation: SatimOperation.Acknowledge,
        completedAt: { not: null },
        orderId: { in: orderIds },
      },
      select: { orderId: true },
    });

    const settled = new Set(answered.map((row) => row['orderId']));

    return registered
      .filter((row) => !settled.has(row['orderId']))
      .slice(0, criteria.limit)
      .map((row) => toRecord(row));
  }

  async prune(before: Date): Promise<number> {
    const { count } = await this.calls.deleteMany({ where: { createdAt: { lt: before } } });

    return count;
  }
}

/**
 * Prisma hands BigInt columns back as bigint and Json columns back as unknown,
 * so the row is narrowed here rather than at every call site.
 */
function toRecord(row: Record<string, unknown>): SatimCallRecord {
  const amount = row['amountInCentimes'];

  return {
    callId: String(row['callId']),
    operation: row['operation'] as SatimOperation,
    orderNumber: (row['orderNumber'] as string | null) ?? null,
    orderId: (row['orderId'] as string | null) ?? null,
    amountInCentimes: amount === null || amount === undefined ? null : Number(amount),
    request: (row['request'] as Record<string, string> | null) ?? {},
    response: (row['response'] as SatimResponse | null) ?? null,
    successful: (row['successful'] as boolean | null) ?? null,
    errorCode: (row['errorCode'] as string | null) ?? null,
    errorMessage: (row['errorMessage'] as string | null) ?? null,
    orderStatus: (row['orderStatus'] as number | null) ?? null,
    failureReason: (row['failureReason'] as string | null) ?? null,
    createdAt: row['createdAt'] as Date,
    completedAt: (row['completedAt'] as Date | null) ?? null,
  };
}
