import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { SatimOperation } from '../operation.js';
import type { SatimResponse } from '../response-reader.js';

/**
 * Several drivers hand a bigint back as a string, which would then be compared
 * and summed as text.
 */
const bigintToNumber = {
  to: (value: number | null): number | null => value,
  from: (value: string | number | null | undefined): number | null =>
    value === null || value === undefined ? null : Number(value),
};

/**
 * One row per call to SATIM: what was sent, what came back, and what it meant.
 *
 * Rows are written before the request leaves and completed when the answer
 * arrives, so a call that times out still leaves evidence. Nothing here belongs
 * to the host application: only SATIM's own identifiers and payloads.
 *
 * Written once and completed once, never edited afterwards, which is why there
 * is no updatedAt column.
 */
@Entity('satim_calls')
export class SatimCallEntity {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  /**
   * Correlates the row with the events that created and completed it.
   *
   * A plain string rather than a uuid column: SQL Server's uniqueidentifier
   * type rewrites the value in upper case, so the id read back would not match
   * the one the event carried.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 36 })
  callId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  operation!: SatimOperation;

  /** Present on register; SATIM's own id arrives with the response. */
  @Index()
  @Column({ type: 'varchar', length: 20, nullable: true })
  orderNumber!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 40, nullable: true })
  orderId!: string | null;

  @Column({ type: 'bigint', nullable: true, transformer: bigintToNumber })
  amountInCentimes!: number | null;

  // "simple-json" rather than a driver-specific json type, so the table works
  // on every database TypeORM supports.
  @Column({ type: 'simple-json' })
  request!: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  response!: SatimResponse | null;

  /**
   * Null until the call finishes: the meaningful outcome, not merely whether a
   * reply arrived.
   */
  @Column({ type: 'boolean', nullable: true })
  successful!: boolean | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  errorCode!: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'int', nullable: true })
  orderStatus!: number | null;

  /** Set only when no usable reply arrived at all. */
  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  // The column type is left to the driver: the package writes the instant it
  // recorded the call, and a fixed type would not exist on every database.
  @Index()
  @Column({ type: Date })
  createdAt!: Date;

  @Column({ type: Date, nullable: true })
  completedAt!: Date | null;
}
