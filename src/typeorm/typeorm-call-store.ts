import { Injectable } from '@nestjs/common';
import { LessThan, type QueryDeepPartialEntity, type Repository } from 'typeorm';

import type {
  SatimCallCompletion,
  SatimCallRecord,
  SatimCallStarted,
  SatimCallStore,
  SatimUnconfirmedCriteria,
} from '../call-store.js';
import { SatimOperation } from '../operation.js';
import { SatimCallEntity } from './satim-call.entity.js';

/**
 * The audit trail on TypeORM.
 *
 * Bind it under SATIM_CALL_STORE and register SatimCallEntity with your data
 * source. Nothing in the package core imports TypeORM: only this entry point
 * does, so an application on another ORM never loads it.
 */
@Injectable()
export class TypeOrmSatimCallStore implements SatimCallStore {
  constructor(private readonly repository: Repository<SatimCallEntity>) {}

  async start(call: SatimCallStarted): Promise<void> {
    await this.repository.insert({
      ...call,
      response: null,
      successful: null,
      errorCode: null,
      errorMessage: null,
      orderStatus: null,
      failureReason: null,
      completedAt: null,
    });
  }

  async complete(completion: SatimCallCompletion): Promise<void> {
    const changes: Record<string, unknown> = {
      // Written here too: on a register call the order id does not exist until
      // SATIM replies. A null would erase the one already recorded.
      ...(completion.orderId === null ? {} : { orderId: completion.orderId }),
      response: completion.response,
      successful: completion.successful,
      errorCode: completion.errorCode,
      errorMessage: completion.errorMessage,
      orderStatus: completion.orderStatus,
      completedAt: completion.completedAt,
    };

    // TypeORM's deep partial descends into the response object and then refuses
    // it as a column value, which is exactly what a json column stores.
    await this.repository.update(
      { callId: completion.callId },
      changes as QueryDeepPartialEntity<SatimCallEntity>,
    );
  }

  async fail(callId: string, reason: string): Promise<void> {
    await this.repository.update({ callId }, { successful: false, failureReason: reason });
  }

  async hasOrderNumber(orderNumber: string): Promise<boolean> {
    return (await this.repository.countBy({ orderNumber })) > 0;
  }

  async callsForOrder(orderId: string): Promise<SatimCallRecord[]> {
    return this.repository.find({ where: { orderId }, order: { id: 'ASC' } });
  }

  /**
   * Registers that succeeded and that no completed acknowledge answers for.
   *
   * Expressed as a NOT EXISTS subquery rather than two round trips, so the
   * limit applies to the orders actually worth asking about.
   */
  async unconfirmed(criteria: SatimUnconfirmedCriteria): Promise<SatimCallRecord[]> {
    const table = this.repository.metadata.tableName;
    // Column names come from the metadata rather than the property names, so
    // the subquery still works under a snake case naming strategy.
    const orderId = this.column('orderId');
    const operation = this.column('operation');
    const completedAt = this.column('completedAt');

    return this.repository
      .createQueryBuilder('registered')
      .where('registered.operation = :operation', { operation: SatimOperation.Register })
      .andWhere('registered.successful = :successful', { successful: true })
      .andWhere('registered.orderId IS NOT NULL')
      .andWhere('registered.createdAt <= :before', { before: criteria.registeredBefore })
      .andWhere('registered.createdAt >= :after', { after: criteria.registeredAfter })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM ${table} answered
          WHERE answered.${orderId} = registered.${orderId}
            AND answered.${operation} = :acknowledge
            AND answered.${completedAt} IS NOT NULL
        )`,
        { acknowledge: SatimOperation.Acknowledge },
      )
      .orderBy('registered.id', 'ASC')
      .limit(criteria.limit)
      .getMany();
  }

  private column(property: keyof SatimCallEntity): string {
    return this.repository.metadata.findColumnWithPropertyName(property)?.databaseName ?? property;
  }

  async prune(before: Date): Promise<number> {
    const result = await this.repository.delete({ createdAt: LessThan(before) });

    return result.affected ?? 0;
  }
}
