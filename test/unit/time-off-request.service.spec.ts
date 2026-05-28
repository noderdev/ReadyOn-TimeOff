import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { TimeOffRequestService } from '../../src/time-off-request/time-off-request.service';
import {
  TimeOffRequest,
  TimeOffStatus,
} from '../../src/time-off-request/entities/time-off-request.entity';
import { BalanceService } from '../../src/balance/balance.service';
import { HcmService, HcmUnavailableException, HcmInsufficientBalanceException } from '../../src/hcm/hcm.service';
import { Balance } from '../../src/balance/entities/balance.entity';

const mockRequestRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const mockBalanceService = () => ({
  getBalance: jest.fn(),
  reserveDays: jest.fn(),
  releaseDays: jest.fn(),
  confirmDeduction: jest.fn(),
  syncFromHcm: jest.fn(),
});

const mockHcmService = () => ({
  getBalance: jest.fn(),
  deductBalance: jest.fn(),
  restoreBalance: jest.fn(),
});

function makeBalance(hcmBalance: number, reservedDays: number): Balance {
  const b = new Balance();
  b.id = 'balance-uuid';
  b.employeeId = 'emp-1';
  b.locationId = 'loc-1';
  b.hcmBalance = hcmBalance;
  b.reservedDays = reservedDays;
  b.lastSyncedAt = new Date();
  b.version = 1;
  return b;
}

function makeRequest(overrides: Partial<TimeOffRequest> = {}): TimeOffRequest {
  const r = new TimeOffRequest();
  r.id = 'req-uuid';
  r.employeeId = 'emp-1';
  r.locationId = 'loc-1';
  r.startDate = '2026-06-10';
  r.endDate = '2026-06-12';
  r.daysRequested = 3;
  r.status = TimeOffStatus.PENDING_APPROVAL;
  r.requestedAt = new Date();
  r.idempotencyKey = 'idem-key-1';
  Object.assign(r, overrides);
  return r;
}

describe('TimeOffRequestService', () => {
  let service: TimeOffRequestService;
  let requestRepo: ReturnType<typeof mockRequestRepo>;
  let balanceService: ReturnType<typeof mockBalanceService>;
  let hcmService: ReturnType<typeof mockHcmService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeOffRequestService,
        { provide: getRepositoryToken(TimeOffRequest), useFactory: mockRequestRepo },
        { provide: BalanceService, useFactory: mockBalanceService },
        { provide: HcmService, useFactory: mockHcmService },
      ],
    }).compile();

    service = module.get<TimeOffRequestService>(TimeOffRequestService);
    requestRepo = module.get(getRepositoryToken(TimeOffRequest));
    balanceService = module.get(BalanceService);
    hcmService = module.get(HcmService);

    requestRepo.create.mockImplementation((data) => ({ ...data }));
    requestRepo.save.mockImplementation((data) => Promise.resolve({ ...data }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('returns existing request on duplicate idempotencyKey', async () => {
      const existing = makeRequest();
      requestRepo.findOne.mockResolvedValue(existing);

      const result = await service.create(
        {
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 3,
        },
        'idem-key-1',
      );

      expect(result).toBe(existing);
      expect(balanceService.getBalance).not.toHaveBeenCalled();
    });

    it('throws 422 when availableDays < daysRequested', async () => {
      requestRepo.findOne.mockResolvedValue(null);
      balanceService.getBalance.mockResolvedValue(makeBalance(5, 3)); // availableDays = 2

      await expect(
        service.create(
          {
            employeeId: 'emp-1',
            locationId: 'loc-1',
            startDate: '2026-06-10',
            endDate: '2026-06-12',
            daysRequested: 3,
          },
          'idem-key-2',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('succeeds when balance is sufficient', async () => {
      requestRepo.findOne.mockResolvedValue(null);
      balanceService.getBalance.mockResolvedValue(makeBalance(10, 2)); // availableDays = 8

      const result = await service.create(
        {
          employeeId: 'emp-1',
          locationId: 'loc-1',
          startDate: '2026-06-10',
          endDate: '2026-06-12',
          daysRequested: 3,
        },
        'idem-key-3',
      );

      expect(result.status).toBe(TimeOffStatus.PENDING_APPROVAL);
      expect(requestRepo.save).toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    it('rejects with 422 when local balance insufficient', async () => {
      const request = makeRequest({ status: TimeOffStatus.PENDING_APPROVAL, daysRequested: 5 });
      requestRepo.findOne.mockResolvedValue(request);
      balanceService.getBalance.mockResolvedValue(makeBalance(5, 3)); // availableDays = 2

      await expect(service.approve('req-uuid', 'mgr-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(hcmService.getBalance).not.toHaveBeenCalled();
    });

    it('rejects with 503 when HCM unavailable during balance fetch', async () => {
      const request = makeRequest({ status: TimeOffStatus.PENDING_APPROVAL, daysRequested: 3 });
      requestRepo.findOne.mockResolvedValue(request);
      balanceService.getBalance.mockResolvedValue(makeBalance(10, 0)); // availableDays = 10
      hcmService.getBalance.mockRejectedValue(new HcmUnavailableException('HCM down'));

      await expect(service.approve('req-uuid', 'mgr-1')).rejects.toThrow(
        HcmUnavailableException,
      );
      expect(balanceService.reserveDays).not.toHaveBeenCalled();
    });

    it('sets HCM_CONFIRMED on success', async () => {
      const request = makeRequest({ status: TimeOffStatus.PENDING_APPROVAL, daysRequested: 3 });
      requestRepo.findOne.mockResolvedValue(request);
      balanceService.getBalance.mockResolvedValue(makeBalance(10, 0));
      hcmService.getBalance.mockResolvedValue({ balance: 10 });
      balanceService.reserveDays.mockResolvedValue(makeBalance(10, 3));
      hcmService.deductBalance.mockResolvedValue({ success: true, hcmRequestId: 'hcm-123' });
      balanceService.confirmDeduction.mockResolvedValue(makeBalance(7, 0));

      const result = await service.approve('req-uuid', 'mgr-1');

      expect(result.status).toBe(TimeOffStatus.HCM_CONFIRMED);
      expect(balanceService.reserveDays).toHaveBeenCalledWith('emp-1', 'loc-1', 3, 'req-uuid');
      expect(hcmService.deductBalance).toHaveBeenCalled();
      expect(balanceService.confirmDeduction).toHaveBeenCalled();
    });

    it('sets HCM_FAILED and releases reservation when HCM rejects deduct', async () => {
      const request = makeRequest({ status: TimeOffStatus.PENDING_APPROVAL, daysRequested: 3 });
      requestRepo.findOne.mockResolvedValue(request);
      balanceService.getBalance.mockResolvedValue(makeBalance(10, 0));
      hcmService.getBalance.mockResolvedValue({ balance: 10 });
      balanceService.reserveDays.mockResolvedValue(makeBalance(10, 3));
      hcmService.deductBalance.mockRejectedValue(
        new HcmInsufficientBalanceException('Insufficient'),
      );
      balanceService.releaseDays.mockResolvedValue(makeBalance(10, 0));

      await expect(service.approve('req-uuid', 'mgr-1')).rejects.toThrow();

      expect(balanceService.releaseDays).toHaveBeenCalledWith('emp-1', 'loc-1', 3, 'req-uuid');
      const savedCall = requestRepo.save.mock.calls.find(
        (call) => call[0].status === TimeOffStatus.HCM_FAILED,
      );
      expect(savedCall).toBeDefined();
    });

    it('throws BadRequestException if status is not PENDING_APPROVAL', async () => {
      const request = makeRequest({ status: TimeOffStatus.REJECTED });
      requestRepo.findOne.mockResolvedValue(request);

      await expect(service.approve('req-uuid', 'mgr-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('reject', () => {
    it('transitions to REJECTED', async () => {
      const request = makeRequest({ status: TimeOffStatus.PENDING_APPROVAL });
      requestRepo.findOne.mockResolvedValue(request);

      const result = await service.reject('req-uuid', 'mgr-1', 'Too many requests');

      expect(result.status).toBe(TimeOffStatus.REJECTED);
      expect(result.resolvedBy).toBe('mgr-1');
    });

    it('throws BadRequestException for invalid state', async () => {
      const request = makeRequest({ status: TimeOffStatus.CANCELLED });
      requestRepo.findOne.mockResolvedValue(request);

      await expect(service.reject('req-uuid', 'mgr-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('cancel', () => {
    it('cancels from PENDING_APPROVAL without HCM call', async () => {
      const request = makeRequest({ status: TimeOffStatus.PENDING_APPROVAL });
      requestRepo.findOne.mockResolvedValue(request);

      const result = await service.cancel('req-uuid');

      expect(result.status).toBe(TimeOffStatus.CANCELLED);
      expect(hcmService.restoreBalance).not.toHaveBeenCalled();
    });

    it('cancels from HCM_CONFIRMED and calls HCM restore', async () => {
      const request = makeRequest({ status: TimeOffStatus.HCM_CONFIRMED, daysRequested: 3 });
      requestRepo.findOne.mockResolvedValue(request);
      hcmService.restoreBalance.mockResolvedValue({ success: true });
      balanceService.confirmDeduction.mockResolvedValue(makeBalance(10, 0));

      const result = await service.cancel('req-uuid');

      expect(hcmService.restoreBalance).toHaveBeenCalledWith('emp-1', 'loc-1', 3, 'req-uuid');
      expect(balanceService.confirmDeduction).toHaveBeenCalled();
      expect(result.status).toBe(TimeOffStatus.CANCELLED);
    });

    it('throws BadRequestException for invalid state (REJECTED)', async () => {
      const request = makeRequest({ status: TimeOffStatus.REJECTED });
      requestRepo.findOne.mockResolvedValue(request);

      await expect(service.cancel('req-uuid')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid state (HCM_FAILED)', async () => {
      const request = makeRequest({ status: TimeOffStatus.HCM_FAILED });
      requestRepo.findOne.mockResolvedValue(request);

      await expect(service.cancel('req-uuid')).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      requestRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('returns all requests when no filters', async () => {
      const queryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([makeRequest()]),
      };
      requestRepo.createQueryBuilder.mockReturnValue(queryBuilder);

      const results = await service.findAll({});

      expect(results).toHaveLength(1);
    });

    it('applies filters', async () => {
      const queryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      requestRepo.createQueryBuilder.mockReturnValue(queryBuilder);

      await service.findAll({
        employeeId: 'emp-1',
        locationId: 'loc-1',
        status: TimeOffStatus.PENDING_APPROVAL,
      });

      expect(queryBuilder.andWhere).toHaveBeenCalledTimes(3);
    });
  });
});
