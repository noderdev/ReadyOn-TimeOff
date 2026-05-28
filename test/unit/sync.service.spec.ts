import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SyncService } from '../../src/sync/sync.service';
import { SyncLog, SyncType } from '../../src/sync/entities/sync-log.entity';

function makeSyncLog(overrides: Partial<SyncLog> = {}): SyncLog {
  const log = new SyncLog();
  log.id = 'log-uuid-1';
  log.employeeId = 'emp-1';
  log.locationId = 'loc-1';
  log.syncType = SyncType.REALTIME_FETCH;
  log.createdAt = new Date();
  Object.assign(log, overrides);
  return log;
}

describe('SyncService', () => {
  let service: SyncService;
  let syncLogRepo: {
    createQueryBuilder: jest.Mock;
  };

  let queryBuilder: {
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    getMany: jest.Mock;
  };

  beforeEach(async () => {
    queryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    syncLogRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: getRepositoryToken(SyncLog), useValue: syncLogRepo },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLogs', () => {
    it('returns all logs when no filters provided', async () => {
      const logs = [makeSyncLog(), makeSyncLog({ id: 'log-uuid-2' })];
      queryBuilder.getMany.mockResolvedValue(logs);

      const result = await service.getLogs();

      expect(result).toHaveLength(2);
      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('log.createdAt', 'DESC');
    });

    it('filters by employeeId when provided', async () => {
      const logs = [makeSyncLog()];
      queryBuilder.getMany.mockResolvedValue(logs);

      const result = await service.getLogs('emp-1');

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'log.employeeId = :employeeId',
        { employeeId: 'emp-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });

    it('filters by locationId when provided', async () => {
      queryBuilder.getMany.mockResolvedValue([makeSyncLog()]);

      await service.getLogs(undefined, 'loc-1');

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'log.locationId = :locationId',
        { locationId: 'loc-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledTimes(1);
    });

    it('filters by both employeeId and locationId', async () => {
      queryBuilder.getMany.mockResolvedValue([makeSyncLog()]);

      await service.getLogs('emp-1', 'loc-1');

      expect(queryBuilder.andWhere).toHaveBeenCalledTimes(2);
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'log.employeeId = :employeeId',
        { employeeId: 'emp-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'log.locationId = :locationId',
        { locationId: 'loc-1' },
      );
    });

    it('returns empty array when no logs match', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      const result = await service.getLogs('emp-nonexistent', 'loc-none');

      expect(result).toEqual([]);
    });

    it('orders results by createdAt DESC', async () => {
      await service.getLogs();

      expect(queryBuilder.orderBy).toHaveBeenCalledWith('log.createdAt', 'DESC');
    });
  });
});
