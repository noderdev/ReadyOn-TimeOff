import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

@Entity('balances')
@Unique(['employeeId', 'locationId'])
export class Balance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  employeeId: string;

  @Column({ type: 'varchar', length: 64 })
  locationId: string;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  hcmBalance: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  reservedDays: number;

  @Column({ type: 'datetime' })
  lastSyncedAt: Date;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  get availableDays(): number {
    return Number(this.hcmBalance) - Number(this.reservedDays);
  }
}
