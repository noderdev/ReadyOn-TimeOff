import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { HttpModule } from '@nestjs/axios';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TimeOffRequestService } from '../../src/time-off-request/time-off-request.service';
import { BalanceService } from '../../src/balance/balance.service';
import { HcmService } from '../../src/hcm/hcm.service';
import { TimeOffRequest, TimeOffStatus } from '../../src/time-off-request/entities/time-off-request.entity';
import { Balance } from '../../src/balance/entities/balance.entity';
import { SyncLog } from '../../src/sync/entities/sync-log.entity';
import { MockHcmServer } from '../mock-hcm/mock-hcm.server';

describe('TimeOffRequestService Integration', () => {
  let module: TestingModule;
  let requestService: TimeOffRequestService;
  let balanceService: BalanceService;
  let requestRepo: Repository<TimeOffRequest>;
  let balanceRepo: Repository<Balance>;
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
          entities: [Balance, TimeOffRequest, SyncLog],
          synchronize: true,
          logging: false,
        }),
        TypeOrmModule.forFeature([Balance, TimeOffRequest, SyncLog]),
        HttpModule,
      ],
      providers: [
        TimeOffRequestService,
        BalanceService,
        HcmService,
      ],
    }).compile();

    requestService = module.get<TimeOffRequestService>(TimeOffRequestService);
    balanceService = module.get<BalanceService>(BalanceService);
    requestRepo = module.get<Repository<TimeOffRequest>>(getRepositoryToken(TimeOffRequest));
    balanceRepo = module.get<Repository<Balance>>(getRepositoryToken(Balance));
    dataSource = module.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    await module.close();
    await mockHcm.stop();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM time_off_requests');
    await dataSource.query('DELETE FROM balances');
    await dataSource.query('DELETE FROM sync_logs');
    mockHcm.clearCallLog();
    mockHcm.disableDowntime();
    mockHcm.disableInsufficientBalance();
    mockHcm.disableNetworkTimeout();
    balanceService.clearProcessedBatchIds();
  });

  async function seedBalance(employeeId: string, locationId: string, balance: number) {
    mockHcm.seed(employeeId, locationId, balance);
    await balanceService.syncFromHcm(employeeId, locationId);
  }

  describe('Happy path: create → approve → HCM_CONFIRMED', () => {
    it('creates request, approves, confirms with HCM, updates balance', async () => {
      await seedBalance('emp-1', 'loc-1', 10);

      const request = await requestService.create(
        {
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 3,
        },
        'idem-happy-1',
      );

      expect(request.status).toBe(TimeOffStatus.PENDING_APPROVAL);

      const approved = await requestService.approve(request.id, 'mgr-1');

      expect(approved.status).toBe(TimeOffStatus.HCM_CONFIRMED);

      const balance = await balanceRepo.findOne({
        where: { employeeId: 'emp-1', locationId: 'loc-1' },
      });

      expect(Number(balance.hcmBalance)).toBe(7); // 10 - 3
      expect(Number(balance.reservedDays)).toBe(0); // released after confirm
    });
  });

  describe('Approve with insufficient balance', () => {
    it('returns 422 without calling HCM deduct', async () => {
      await seedBalance('emp-1', 'loc-1', 2);

      const request = await requestService.create(
        {
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 2,
        },
        'idem-insuf-1',
      );

      // Drain the balance so we don't have enough to approve
      await dataSource.query(
        `UPDATE balances SET hcmBalance = '1.00' WHERE employeeId = 'emp-1' AND locationId = 'loc-1'`,
      );
      mockHcm.setBalance('emp-1', 'loc-1', 1);

      mockHcm.clearCallLog();

      await expect(requestService.approve(request.id, 'mgr-1')).rejects.toThrow();

      const deductCalls = mockHcm
        .getCallLog()
        .filter((c) => c.path.includes('deduct'));
      expect(deductCalls).toHaveLength(0);
    });
  });

  describe('Cancel HCM_CONFIRMED request', () => {
    it('calls HCM restore and restores balance', async () => {
      await seedBalance('emp-1', 'loc-1', 10);

      const request = await requestService.create(
        {
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 3,
        },
        'idem-cancel-1',
      );

      await requestService.approve(request.id, 'mgr-1');
      mockHcm.clearCallLog();

      const cancelled = await requestService.cancel(request.id);

      expect(cancelled.status).toBe(TimeOffStatus.CANCELLED);

      const restoreCalls = mockHcm
        .getCallLog()
        .filter((c) => c.path.includes('restore'));
      expect(restoreCalls).toHaveLength(1);

      const balance = await balanceRepo.findOne({
        where: { employeeId: 'emp-1', locationId: 'loc-1' },
      });
      // Balance should be restored (though HCM restore + local confirmDeduction with negative)
      // After approve: hcmBalance=7, reservedDays=0
      // After cancel: confirmDeduction(-3) => hcmBalance=10, reservedDays=0
      expect(Number(balance.hcmBalance)).toBe(10);
    });
  });

  describe('Duplicate idempotency key', () => {
    it('only creates one DB record on duplicate idempotency key', async () => {
      await seedBalance('emp-1', 'loc-1', 10);

      await requestService.create(
        {
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 2,
        },
        'idem-dup-key',
      );

      await requestService.create(
        {
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 2,
        },
        'idem-dup-key',
      );

      const requests = await requestRepo.find({
        where: { idempotencyKey: 'idem-dup-key' },
      });
      expect(requests).toHaveLength(1);
    });
  });

  describe('HCM down during approval', () => {
    it('returns error and keeps request PENDING_APPROVAL with reservation released', async () => {
      await seedBalance('emp-1', 'loc-1', 10);

      const request = await requestService.create(
        {
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 3,
        },
        'idem-hcm-down',
      );

      mockHcm.enableDowntime();

      await expect(requestService.approve(request.id, 'mgr-1')).rejects.toThrow();

      mockHcm.disableDowntime();

      // The request should not be in a broken state; in our implementation it goes
      // to HCM_FAILED if the deduct fails, but if HCM is down during getBalance
      // the reservation never happens
      const updated = await requestRepo.findOne({ where: { id: request.id } });
      // Should still have PENDING_APPROVAL (downtime during balance fetch = no reservation)
      expect(updated.status).toBe(TimeOffStatus.PENDING_APPROVAL);

      const balance = await balanceRepo.findOne({
        where: { employeeId: 'emp-1', locationId: 'loc-1' },
      });
      // Reservation should not have been made
      expect(Number(balance.reservedDays)).toBe(0);
    });
  });

  describe('Two concurrent approvals (sequential simulation)', () => {
    it('second approval fails if balance already deducted by first', async () => {
      await seedBalance('emp-1', 'loc-1', 3);

      const req1 = await requestService.create(
        {
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-10',
          daysRequested: 3,
        },
        'idem-concurrent-1',
      );

      const req2 = await requestService.create(
        {
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-11',
          endDate: '2026-06-11',
          daysRequested: 3,
        },
        'idem-concurrent-2',
      );

      await requestService.approve(req1.id, 'mgr-1');

      await expect(requestService.approve(req2.id, 'mgr-1')).rejects.toThrow();

      const balance = await balanceRepo.findOne({
        where: { employeeId: 'emp-1', locationId: 'loc-1' },
      });
      // Only 3 days deducted, not 6
      expect(Number(balance.hcmBalance)).toBe(0);
      expect(Number(balance.reservedDays)).toBe(0);
    });
  });
});
