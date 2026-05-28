import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Balance } from './entities/balance.entity';
import { SyncLog, SyncType } from '../sync/entities/sync-log.entity';
import { HcmService } from '../hcm/hcm.service';
import { BalanceRecordDto } from './dto/batch-sync.dto';

// In-memory set for processed batch IDs (acceptable for this scope)
const processedBatchIds = new Set<string>();

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    @InjectRepository(Balance)
    private readonly balanceRepo: Repository<Balance>,
    @InjectRepository(SyncLog)
    private readonly syncLogRepo: Repository<SyncLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly hcmService: HcmService,
  ) {}

  async getBalance(
    employeeId: string,
    locationId: string,
    refresh = false,
  ): Promise<Balance> {
    if (refresh) {
      return this.syncFromHcm(employeeId, locationId);
    }

    const balance = await this.balanceRepo.findOne({
      where: { employeeId, locationId },
    });

    if (!balance) {
      // Try HCM as fallback
      try {
        return await this.syncFromHcm(employeeId, locationId);
      } catch (error) {
        throw new NotFoundException(
          `Balance not found for employee ${employeeId} at location ${locationId}`,
        );
      }
    }

    return balance;
  }

  async syncFromHcm(employeeId: string, locationId: string): Promise<Balance> {
    const hcmData = await this.hcmService.getBalance(employeeId, locationId);

    const existing = await this.balanceRepo.findOne({
      where: { employeeId, locationId },
    });

    const previousHcmBalance = existing ? Number(existing.hcmBalance) : null;
    const previousReserved = existing ? Number(existing.reservedDays) : null;

    let balance: Balance;
    if (existing) {
      existing.hcmBalance = hcmData.balance;
      existing.lastSyncedAt = new Date();
      balance = await this.balanceRepo.save(existing);
    } else {
      balance = await this.balanceRepo.save(
        this.balanceRepo.create({
          employeeId,
          locationId,
          hcmBalance: hcmData.balance,
          reservedDays: 0,
          lastSyncedAt: new Date(),
          version: 1,
        }),
      );
    }

    await this.syncLogRepo.save(
      this.syncLogRepo.create({
        employeeId,
        locationId,
        syncType: SyncType.REALTIME_FETCH,
        previousHcmBalance,
        newHcmBalance: hcmData.balance,
        previousReserved,
        newReserved: Number(balance.reservedDays),
        triggeredBy: 'realtime-fetch',
      }),
    );

    return balance;
  }

  async processBatch(
    batchId: string,
    generatedAt: string,
    balances: BalanceRecordDto[],
  ): Promise<{ batchId: string; status: string; recordCount: number }> {
    if (processedBatchIds.has(batchId)) {
      return {
        batchId,
        status: 'ACCEPTED',
        recordCount: balances.length,
      };
    }

    for (const record of balances) {
      const existing = await this.balanceRepo.findOne({
        where: {
          employeeId: record.employeeId,
          locationId: record.locationId,
        },
      });

      const previousHcmBalance = existing ? Number(existing.hcmBalance) : null;
      const previousReserved = existing ? Number(existing.reservedDays) : 0;

      if (existing) {
        existing.hcmBalance = record.balance;
        existing.lastSyncedAt = new Date(generatedAt);
        await this.balanceRepo.save(existing);
      } else {
        await this.balanceRepo.save(
          this.balanceRepo.create({
            employeeId: record.employeeId,
            locationId: record.locationId,
            hcmBalance: record.balance,
            reservedDays: 0,
            lastSyncedAt: new Date(generatedAt),
            version: 1,
          }),
        );
      }

      await this.syncLogRepo.save(
        this.syncLogRepo.create({
          employeeId: record.employeeId,
          locationId: record.locationId,
          syncType: SyncType.BATCH_INGEST,
          previousHcmBalance,
          newHcmBalance: record.balance,
          previousReserved,
          newReserved: previousReserved,
          triggeredBy: batchId,
        }),
      );
    }

    processedBatchIds.add(batchId);

    return {
      batchId,
      status: 'ACCEPTED',
      recordCount: balances.length,
    };
  }

  async reserveDays(
    employeeId: string,
    locationId: string,
    days: number,
    triggeredBy?: string,
  ): Promise<Balance> {
    const maxRetries = 3;
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const balance = await this.balanceRepo.findOne({
        where: { employeeId, locationId },
      });

      if (!balance) {
        throw new NotFoundException(
          `Balance not found for employee ${employeeId} at location ${locationId}`,
        );
      }

      const previousReserved = Number(balance.reservedDays);
      const newReserved = previousReserved + days;
      const expectedVersion = balance.version;

      const result = await this.dataSource.query(
        `UPDATE balances
         SET reservedDays = ?, version = version + 1, updatedAt = ?
         WHERE employeeId = ? AND locationId = ? AND version = ?`,
        [
          newReserved.toFixed(2),
          new Date().toISOString(),
          employeeId,
          locationId,
          expectedVersion,
        ],
      );

      const affected = result?.changes ?? result?.[0]?.affectedRows ?? (Array.isArray(result) ? result[1] : result);
      const rowsAffected = typeof affected === 'number' ? affected : 0;

      if (rowsAffected > 0) {
        await this.syncLogRepo.save(
          this.syncLogRepo.create({
            employeeId,
            locationId,
            syncType: SyncType.REQUEST_RESERVATION,
            previousHcmBalance: Number(balance.hcmBalance),
            newHcmBalance: Number(balance.hcmBalance),
            previousReserved,
            newReserved,
            triggeredBy: triggeredBy || 'reservation',
          }),
        );

        const updated = await this.balanceRepo.findOne({
          where: { employeeId, locationId },
        });
        return updated;
      }

      lastError = new ConflictException('Concurrent modification detected, retrying...');
      this.logger.warn(
        `Version conflict on reserveDays attempt ${attempt + 1} for ${employeeId}/${locationId}`,
      );
    }

    throw lastError || new ConflictException('Failed to reserve days after retries');
  }

  async releaseDays(
    employeeId: string,
    locationId: string,
    days: number,
    triggeredBy?: string,
  ): Promise<Balance> {
    const balance = await this.balanceRepo.findOne({
      where: { employeeId, locationId },
    });

    if (!balance) {
      throw new NotFoundException(
        `Balance not found for employee ${employeeId} at location ${locationId}`,
      );
    }

    const previousReserved = Number(balance.reservedDays);
    const newReserved = Math.max(0, previousReserved - days);

    await this.dataSource.query(
      `UPDATE balances
       SET reservedDays = ?, updatedAt = ?
       WHERE employeeId = ? AND locationId = ?`,
      [newReserved.toFixed(2), new Date().toISOString(), employeeId, locationId],
    );

    await this.syncLogRepo.save(
      this.syncLogRepo.create({
        employeeId,
        locationId,
        syncType: SyncType.REQUEST_RELEASE,
        previousHcmBalance: Number(balance.hcmBalance),
        newHcmBalance: Number(balance.hcmBalance),
        previousReserved,
        newReserved,
        triggeredBy: triggeredBy || 'release',
      }),
    );

    const updated = await this.balanceRepo.findOne({
      where: { employeeId, locationId },
    });
    return updated;
  }

  async confirmDeduction(
    employeeId: string,
    locationId: string,
    days: number,
    triggeredBy?: string,
  ): Promise<Balance> {
    const balance = await this.balanceRepo.findOne({
      where: { employeeId, locationId },
    });

    if (!balance) {
      throw new NotFoundException(
        `Balance not found for employee ${employeeId} at location ${locationId}`,
      );
    }

    const previousHcmBalance = Number(balance.hcmBalance);
    const previousReserved = Number(balance.reservedDays);
    const newHcmBalance = previousHcmBalance - days;
    const newReserved = Math.max(0, previousReserved - days);

    await this.dataSource.query(
      `UPDATE balances
       SET hcmBalance = ?, reservedDays = ?, updatedAt = ?
       WHERE employeeId = ? AND locationId = ?`,
      [
        newHcmBalance.toFixed(2),
        newReserved.toFixed(2),
        new Date().toISOString(),
        employeeId,
        locationId,
      ],
    );

    await this.syncLogRepo.save(
      this.syncLogRepo.create({
        employeeId,
        locationId,
        syncType: SyncType.HCM_DEDUCT_CONFIRMED,
        previousHcmBalance,
        newHcmBalance,
        previousReserved,
        newReserved,
        triggeredBy: triggeredBy || 'deduction',
      }),
    );

    const updated = await this.balanceRepo.findOne({
      where: { employeeId, locationId },
    });
    return updated;
  }

  // Clear processed batch IDs (for testing)
  clearProcessedBatchIds(): void {
    processedBatchIds.clear();
  }
}
