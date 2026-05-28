import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum SyncType {
  REALTIME_FETCH = 'REALTIME_FETCH',
  BATCH_INGEST = 'BATCH_INGEST',
  REQUEST_RESERVATION = 'REQUEST_RESERVATION',
  REQUEST_RELEASE = 'REQUEST_RELEASE',
  HCM_DEDUCT_CONFIRMED = 'HCM_DEDUCT_CONFIRMED',
}

@Entity('sync_logs')
export class SyncLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  employeeId: string;

  @Column({ type: 'varchar', length: 64 })
  locationId: string;

  @Column({ type: 'varchar', enum: SyncType })
  syncType: SyncType;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  previousHcmBalance: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  newHcmBalance: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  previousReserved: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  newReserved: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  triggeredBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
