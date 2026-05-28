import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum TimeOffStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  HCM_SUBMITTING = 'HCM_SUBMITTING',
  HCM_CONFIRMED = 'HCM_CONFIRMED',
  HCM_FAILED = 'HCM_FAILED',
}

@Entity('time_off_requests')
@Index(['employeeId', 'locationId', 'status'])
export class TimeOffRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  employeeId: string;

  @Column({ type: 'varchar', length: 64 })
  locationId: string;

  @Column({ type: 'date' })
  startDate: string;

  @Column({ type: 'date' })
  endDate: string;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  daysRequested: number;

  @Column({
    type: 'varchar',
    enum: TimeOffStatus,
    default: TimeOffStatus.PENDING_APPROVAL,
  })
  status: TimeOffStatus;

  @Column({ type: 'datetime' })
  requestedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  resolvedAt: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  resolvedBy: string;

  @Column({ type: 'text', nullable: true })
  failureReason: string;

  @Column({ type: 'varchar', length: 128, nullable: true, unique: true })
  idempotencyKey: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
