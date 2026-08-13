import type { PrismaSatimCallDelegate } from '../src/prisma/prisma-call-store.js';

type Row = Record<string, unknown>;

interface Where {
  callId?: string;
  orderNumber?: string;
  orderId?: string | { not?: null; in?: string[] };
  operation?: string;
  successful?: boolean;
  completedAt?: { not?: null };
  createdAt?: { lt?: Date; lte?: Date; gte?: Date };
}

function matches(row: Row, where: Where): boolean {
  if (where.callId !== undefined && row['callId'] !== where.callId) {
    return false;
  }

  if (where.orderNumber !== undefined && row['orderNumber'] !== where.orderNumber) {
    return false;
  }

  if (where.operation !== undefined && row['operation'] !== where.operation) {
    return false;
  }

  if (where.successful !== undefined && row['successful'] !== where.successful) {
    return false;
  }

  if (typeof where.orderId === 'string' && row['orderId'] !== where.orderId) {
    return false;
  }

  if (where.orderId !== undefined && typeof where.orderId === 'object') {
    if ('not' in where.orderId && row['orderId'] === null) {
      return false;
    }

    if (where.orderId.in !== undefined && !where.orderId.in.includes(row['orderId'] as string)) {
      return false;
    }
  }

  if (where.completedAt?.not === null && row['completedAt'] === null) {
    return false;
  }

  const createdAt = row['createdAt'] as Date;

  if (where.createdAt?.lt !== undefined && !(createdAt < where.createdAt.lt)) {
    return false;
  }

  if (where.createdAt?.lte !== undefined && !(createdAt <= where.createdAt.lte)) {
    return false;
  }

  if (where.createdAt?.gte !== undefined && !(createdAt >= where.createdAt.gte)) {
    return false;
  }

  return true;
}

/**
 * A stand-in for a Prisma model delegate, honouring exactly the query shapes
 * PrismaSatimCallStore builds.
 *
 * Prisma itself is not a dependency of this package, so there is no generated
 * client to run against. What this fixture can prove is the shape of every
 * query the store sends and what it does with the rows that come back; what it
 * cannot prove is that a real Prisma client agrees, which is what the TypeORM
 * suite against a real SQLite database is there for.
 */
export function fakePrismaDelegate(): PrismaSatimCallDelegate {
  const rows: Row[] = [];
  let id = 0;

  return {
    create({ data }): Promise<void> {
      id += 1;
      rows.push({
        id,
        response: null,
        successful: null,
        errorCode: null,
        errorMessage: null,
        orderStatus: null,
        failureReason: null,
        completedAt: null,
        ...data,
      });

      return Promise.resolve();
    },

    updateMany({ where, data }): Promise<void> {
      for (const row of rows) {
        if (matches(row, where as Where)) {
          Object.assign(row, data);
        }
      }

      return Promise.resolve();
    },

    findMany(args): Promise<Row[]> {
      const where = (args['where'] ?? {}) as Where;

      return Promise.resolve(
        rows
          .filter((row) => matches(row, where))
          .toSorted((a, b) => Number(a['id']) - Number(b['id'])),
      );
    },

    count({ where }): Promise<number> {
      return Promise.resolve(rows.filter((row) => matches(row, where as Where)).length);
    },

    deleteMany({ where }): Promise<{ count: number }> {
      const kept = rows.filter((row) => !matches(row, where as Where));
      const count = rows.length - kept.length;

      rows.length = 0;
      rows.push(...kept);

      return Promise.resolve({ count });
    },
  };
}
