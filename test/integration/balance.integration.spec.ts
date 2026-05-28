import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { BalanceService } from '../../src/balance/balance.service';
import { Balance } from '../../src/balance/entities/balance.entity';
import { SyncLog, SyncType } from '../../src/sync/entities/sync-log.entity';
import { HcmService } from '../../src/hcm/hcm.service';
import { MockHcmServer } from '../mock-hcm/mock-hcm.server';
import { HttpModule } from '@nestjs/axios';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

describe('BalanceService Integration', () => {
  let module: TestingModule;
  let service: BalanceService;
  let balanceRepo: Repository<Balance>;
  let syncLogRepo: Repository<SyncLog>;
  let dataSource: DataSource;
  let mockHcm: MockHcmServer;

  beforeAll(async () => {
    mockHcm = new MockHcmServer();
    await mockHcm.start(0);

    process.env.HCM_BASE_URL = `http://localhost:${mockHcm.port}`;
    process.env.HCM_TIMEOUT_MS = '5000';
    process.env.HCM_RETRY_COUNT = '0';

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Balance, SyncLog],
          synchronize: true,
          logging: false,
        }),
        TypeOrmModule.forFeature([Balance, SyncLog]),
        HttpModule,
      ],
      providers: [
        BalanceService,
        HcmService,
      ],
    }).compile();

    service = module.get<BalanceService>(BalanceService);
    balanceRepo = module.get<Repository<Balance>>(getRepositoryToken(Balance));
    syncLogRepo = module.get<Repository<SyncLog>>(getRepositoryToken(SyncLog));
    dataSource = module.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    await module.close();
    await mockHcm.stop();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM balances');
    await dataSource.query('DELETE FROM sync_logs');
    mockHcm.clearCallLog();
    service.clearProcessedBatchIds();
  });

  describe('upsert and retrieve balance', () => {
    it('syncs from HCM and retrieves balance', async () => {
      mockHcm.seed('emp-1', 'loc-1', 15.5);

      const balance = await service.syncFromHcm('emp-1', 'loc-1');

      expect(Number(balance.hcmBalance)).toBe(15.5);
      expect(Number(balance.reservedDays)).toBe(0);
      expect(balance.availableDays).toBe(15.5);

      const stored = await balanceRepo.findOne({
        where: { employeeId: 'emp-1', locationId: 'loc-1' },
      });
      expect(stored).toBeDefined();
      expect(Number(stored.hcmBalance)).toBe(15.5);
    });

    it('getBalance returns cached value without HCM call', async () => {
      mockHcm.seed('emp-1', 'loc-1', 20);

      await service.syncFromHcm('emp-1', 'loc-1');
      mockHcm.clearCallLog();

      const balance = await service.getBalance('emp-1', 'loc-1', false);

      expect(Number(balance.hcmBalance)).toBe(20);
      // No HCM calls since refresh=false
      const calls = mockHcm.getCallLog().filter((c) => c.path.includes('balances'));
      expect(calls).toHaveLength(0);
    });
  });

  describe('reserveDays and releaseDays', () => {
    beforeEach(async () => {
      mockHcm.seed('emp-1', 'loc-1', 10);
      await service.syncFromHcm('emp-1', 'loc-1');
    });

    it('reserveDays increments reservedDays in DB', async () => {
      await service.reserveDays('emp-1', 'loc-1', 3);

      const balance = await balanceRepo.findOne({
        where: { employeeId: 'emp-1', locationId: 'loc-1' },
      });
      expect(Number(balance.reservedDays)).toBe(3);
    });

    it('releaseDays decrements reservedDays in DB', async () => {
      await service.reserveDays('emp-1', 'loc-1', 5);
      await service.releaseDays('emp-1', 'loc-1', 3);

      const balance = await balanceRepo.findOne({
        where: { employeeId: 'emp-1', locationId: 'loc-1' },
      });
      expect(Number(balance.reservedDays)).toBe(2);
    });

    it('releaseDays never goes below 0', async () => {
      await service.releaseDays('emp-1', 'loc-1', 100);

      const balance = await balanceRepo.findOne({
        where: { employeeId: 'emp-1', locationId: 'loc-1' },
      });
      expect(Number(balance.reservedDays)).toBe(0);
    });
  });

  describe('batch sync', () => {
    it('updates hcmBalance but preserves reservedDays', async () => {
      mockHcm.seed('emp-1', 'loc-1', 10);
      await service.syncFromHcm('emp-1', 'loc-1');
      await service.reserveDays('emp-1', 'loc-1', 3);

      await service.processBatch('batch-1', new Date().toISOString(), [
        { employeeId: 'emp-1', locationId: 'loc-1', balance: 20 },
      ]);

      const balance = await balanceRepo.findOne({
        where: { employeeId: 'emp-1', locationId: 'loc-1' },
      });

      expect(Number(balance.hcmBalance)).toBe(20);
      expect(Number(balance.reservedDays)).toBe(3); // preserved
    });

    it('duplicate batchId is a no-op (second sync does not change DB)', async () => {
      mockHcm.seed('emp-1', 'loc-1', 10);
      await service.syncFromHcm('emp-1', 'loc-1');

      await service.processBatch('batch-dup', new Date().toISOString(), [
        { employeeId: 'emp-1', locationId: 'loc-1', balance: 25 },
      ]);

      await service.processBatch('batch-dup', new Date().toISOString(), [
        { employeeId: 'emp-1', locationId: 'loc-1', balance: 999 },
      ]);

      const balance = await balanceRepo.findOne({
        where: { employeeId: 'emp-1', locationId: 'loc-1' },
      });

      expect(Number(balance.hcmBalance)).toBe(25); // from first batch, not 999
    });
  });

  describe('sync_logs written for every operation', () => {
    beforeEach(async () => {
      mockHcm.seed('emp-1', 'loc-1', 10);
    });

    it('writes REALTIME_FETCH log on syncFromHcm', async () => {
      await service.syncFromHcm('emp-1', 'loc-1');

      const logs = await syncLogRepo.find({ where: { syncType: SyncType.REALTIME_FETCH } });
      expect(logs.length).toBeGreaterThan(0);
    });

    it('writes BATCH_INGEST log on processBatch', async () => {
      await service.syncFromHcm('emp-1', 'loc-1');
      await service.processBatch('batch-log-test', new Date().toISOString(), [
        { employeeId: 'emp-1', locationId: 'loc-1', balance: 12 },
      ]);

      const logs = await syncLogRepo.find({ where: { syncType: SyncType.BATCH_INGEST } });
      expect(logs.length).toBeGreaterThan(0);
    });

    it('writes REQUEST_RESERVATION log on reserveDays', async () => {
      await service.syncFromHcm('emp-1', 'loc-1');
      await service.reserveDays('emp-1', 'loc-1', 2);

      const logs = await syncLogRepo.find({ where: { syncType: SyncType.REQUEST_RESERVATION } });
      expect(logs.length).toBeGreaterThan(0);
    });

    it('writes REQUEST_RELEASE log on releaseDays', async () => {
      await service.syncFromHcm('emp-1', 'loc-1');
      await service.reserveDays('emp-1', 'loc-1', 2);
      await service.releaseDays('emp-1', 'loc-1', 2);

      const logs = await syncLogRepo.find({ where: { syncType: SyncType.REQUEST_RELEASE } });
      expect(logs.length).toBeGreaterThan(0);
    });

    it('writes HCM_DEDUCT_CONFIRMED log on confirmDeduction', async () => {
      await service.syncFromHcm('emp-1', 'loc-1');
      await service.reserveDays('emp-1', 'loc-1', 2);
      await service.confirmDeduction('emp-1', 'loc-1', 2);

      const logs = await syncLogRepo.find({ where: { syncType: SyncType.HCM_DEDUCT_CONFIRMED } });
      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
