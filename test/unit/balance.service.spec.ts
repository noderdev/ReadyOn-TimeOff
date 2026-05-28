import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { BalanceService } from '../../src/balance/balance.service';
import { Balance } from '../../src/balance/entities/balance.entity';
import { SyncLog, SyncType } from '../../src/sync/entities/sync-log.entity';
import { HcmService } from '../../src/hcm/hcm.service';

const mockBalanceRepo = () => ({
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
});

const mockSyncLogRepo = () => ({
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
});

const mockDataSource = () => ({
  query: jest.fn(),
});

const mockHcmService = () => ({
  getBalance: jest.fn(),
  deductBalance: jest.fn(),
  restoreBalance: jest.fn(),
});

describe('BalanceService', () => {
  let service: BalanceService;
  let balanceRepo: ReturnType<typeof mockBalanceRepo>;
  let syncLogRepo: ReturnType<typeof mockSyncLogRepo>;
  let dataSource: ReturnType<typeof mockDataSource>;
  let hcmService: ReturnType<typeof mockHcmService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalanceService,
        { provide: getRepositoryToken(Balance), useFactory: mockBalanceRepo },
        { provide: getRepositoryToken(SyncLog), useFactory: mockSyncLogRepo },
        { provide: getDataSourceToken(), useFactory: mockDataSource },
        { provide: HcmService, useFactory: mockHcmService },
      ],
    }).compile();

    service = module.get<BalanceService>(BalanceService);
    balanceRepo = module.get(getRepositoryToken(Balance));
    syncLogRepo = module.get(getRepositoryToken(SyncLog));
    dataSource = module.get(getDataSourceToken());
    hcmService = module.get(HcmService);

    // Default mock for syncLogRepo.create and save
    syncLogRepo.create.mockImplementation((data) => data);
    syncLogRepo.save.mockResolvedValue({});
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.clearProcessedBatchIds();
  });

  function makeBalance(overrides: Partial<Balance> = {}): Balance {
    const b = new Balance();
    b.id = 'uuid-1';
    b.employeeId = 'emp-1';
    b.locationId = 'loc-1';
    b.hcmBalance = 10;
    b.reservedDays = 2;
    b.lastSyncedAt = new Date();
    b.version = 1;
    Object.assign(b, overrides);
    return b;
  }

  describe('getBalance', () => {
    it('returns availableDays = hcmBalance - reservedDays', async () => {
      const balance = makeBalance({ hcmBalance: 10, reservedDays: 2 });
      balanceRepo.findOne.mockResolvedValue(balance);

      const result = await service.getBalance('emp-1', 'loc-1');

      expect(result.availableDays).toBe(8);
    });

    it('calls HCM if not found locally', async () => {
      balanceRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(makeBalance());
      hcmService.getBalance.mockResolvedValue({ balance: 15 });
      balanceRepo.create.mockImplementation((data) => ({ ...data }));
      balanceRepo.save.mockResolvedValue(makeBalance({ hcmBalance: 15 }));

      const result = await service.getBalance('emp-1', 'loc-1');

      expect(hcmService.getBalance).toHaveBeenCalledWith('emp-1', 'loc-1');
      expect(result).toBeDefined();
    });

    it('throws NotFoundException if not found locally or in HCM', async () => {
      balanceRepo.findOne.mockResolvedValue(null);
      hcmService.getBalance.mockRejectedValue(new Error('HCM error'));

      await expect(service.getBalance('emp-1', 'loc-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('calls HCM when refresh=true', async () => {
      hcmService.getBalance.mockResolvedValue({ balance: 20 });
      balanceRepo.findOne.mockResolvedValue(makeBalance({ hcmBalance: 10 }));
      balanceRepo.save.mockResolvedValue(makeBalance({ hcmBalance: 20 }));

      await service.getBalance('emp-1', 'loc-1', true);

      expect(hcmService.getBalance).toHaveBeenCalled();
    });
  });

  describe('reserveDays', () => {
    it('increments reservedDays', async () => {
      const balance = makeBalance({ reservedDays: 2, version: 1 });
      balanceRepo.findOne.mockResolvedValueOnce(balance).mockResolvedValueOnce(
        makeBalance({ reservedDays: 5 }),
      );
      dataSource.query.mockResolvedValue({ changes: 1 });

      const result = await service.reserveDays('emp-1', 'loc-1', 3, 'req-1');

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE balances'),
        expect.arrayContaining([
          '5.00', // newReserved
          expect.any(String), // date
          'emp-1',
          'loc-1',
          1, // version
        ]),
      );
    });

    it('retries on version conflict', async () => {
      const balance = makeBalance({ reservedDays: 2, version: 1 });
      balanceRepo.findOne.mockResolvedValue(balance);
      // First two attempts: version conflict (0 rows affected)
      // Third attempt: success
      dataSource.query
        .mockResolvedValueOnce({ changes: 0 })
        .mockResolvedValueOnce({ changes: 0 })
        .mockResolvedValueOnce({ changes: 1 });
      balanceRepo.findOne.mockResolvedValue(makeBalance({ reservedDays: 5 }));

      const result = await service.reserveDays('emp-1', 'loc-1', 3);

      expect(dataSource.query).toHaveBeenCalledTimes(3);
    });

    it('throws ConflictException after max retries', async () => {
      balanceRepo.findOne.mockResolvedValue(makeBalance());
      dataSource.query.mockResolvedValue({ changes: 0 });

      await expect(service.reserveDays('emp-1', 'loc-1', 3)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException if balance not found', async () => {
      balanceRepo.findOne.mockResolvedValue(null);

      await expect(service.reserveDays('emp-1', 'loc-1', 3)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('releaseDays', () => {
    it('decrements reservedDays', async () => {
      const balance = makeBalance({ reservedDays: 5, hcmBalance: 10 });
      balanceRepo.findOne.mockResolvedValueOnce(balance).mockResolvedValueOnce(
        makeBalance({ reservedDays: 2 }),
      );
      dataSource.query.mockResolvedValue({});

      await service.releaseDays('emp-1', 'loc-1', 3);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE balances'),
        expect.arrayContaining(['2.00']),
      );
    });

    it('never goes below 0 reservedDays', async () => {
      const balance = makeBalance({ reservedDays: 1, hcmBalance: 10 });
      balanceRepo.findOne.mockResolvedValueOnce(balance).mockResolvedValueOnce(
        makeBalance({ reservedDays: 0 }),
      );
      dataSource.query.mockResolvedValue({});

      await service.releaseDays('emp-1', 'loc-1', 5);

      // Should have called with 0.00, not -4.00
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE balances'),
        expect.arrayContaining(['0.00']),
      );
    });
  });

  describe('confirmDeduction', () => {
    it('decrements both hcmBalance and reservedDays atomically', async () => {
      const balance = makeBalance({ hcmBalance: 10, reservedDays: 3 });
      balanceRepo.findOne.mockResolvedValueOnce(balance).mockResolvedValueOnce(
        makeBalance({ hcmBalance: 7, reservedDays: 0 }),
      );
      dataSource.query.mockResolvedValue({});

      await service.confirmDeduction('emp-1', 'loc-1', 3);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE balances'),
        expect.arrayContaining(['7.00', '0.00']),
      );
    });

    it('writes HCM_DEDUCT_CONFIRMED sync log', async () => {
      const balance = makeBalance({ hcmBalance: 10, reservedDays: 3 });
      balanceRepo.findOne.mockResolvedValue(balance);
      dataSource.query.mockResolvedValue({});

      await service.confirmDeduction('emp-1', 'loc-1', 3);

      expect(syncLogRepo.save).toHaveBeenCalled();
      expect(syncLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ syncType: SyncType.HCM_DEDUCT_CONFIRMED }),
      );
    });
  });

  describe('processBatch', () => {
    it('updates hcmBalance from batch and preserves reservedDays', async () => {
      const existing = makeBalance({ hcmBalance: 10, reservedDays: 3 });
      balanceRepo.findOne.mockResolvedValue(existing);
      balanceRepo.save.mockResolvedValue({ ...existing, hcmBalance: 15 });

      await service.processBatch('batch-1', new Date().toISOString(), [
        { employeeId: 'emp-1', locationId: 'loc-1', balance: 15 },
      ]);

      expect(balanceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ hcmBalance: 15 }),
      );
      // reservedDays should remain 3
      const savedArg = balanceRepo.save.mock.calls[0][0];
      expect(savedArg.reservedDays).toBe(3); // unchanged
    });

    it('is idempotent — same batchId is no-op', async () => {
      balanceRepo.findOne.mockResolvedValue(makeBalance());
      balanceRepo.save.mockResolvedValue(makeBalance());

      const balances = [{ employeeId: 'emp-1', locationId: 'loc-1', balance: 15 }];

      await service.processBatch('batch-idempotent', new Date().toISOString(), balances);
      await service.processBatch('batch-idempotent', new Date().toISOString(), balances);

      // save should only be called once (first invocation)
      expect(balanceRepo.save).toHaveBeenCalledTimes(1);
    });

    it('writes BATCH_INGEST sync log', async () => {
      const existing = makeBalance({ hcmBalance: 10, reservedDays: 2 });
      balanceRepo.findOne.mockResolvedValue(existing);
      balanceRepo.save.mockResolvedValue(existing);

      await service.processBatch('batch-log', new Date().toISOString(), [
        { employeeId: 'emp-1', locationId: 'loc-1', balance: 15 },
      ]);

      expect(syncLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ syncType: SyncType.BATCH_INGEST }),
      );
    });
  });
});
