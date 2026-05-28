import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncLog } from './entities/sync-log.entity';

@Injectable()
export class SyncService {
  constructor(
    @InjectRepository(SyncLog)
    private readonly syncLogRepo: Repository<SyncLog>,
  ) {}

  async getLogs(employeeId?: string, locationId?: string): Promise<SyncLog[]> {
    const query = this.syncLogRepo.createQueryBuilder('log');

    if (employeeId) {
      query.andWhere('log.employeeId = :employeeId', { employeeId });
    }

    if (locationId) {
      query.andWhere('log.locationId = :locationId', { locationId });
    }

    return query.orderBy('log.createdAt', 'DESC').getMany();
  }
}
