import { Repository } from 'typeorm';
import { SyncLog } from './entities/sync-log.entity';
export declare class SyncService {
    private readonly syncLogRepo;
    constructor(syncLogRepo: Repository<SyncLog>);
    getLogs(employeeId?: string, locationId?: string): Promise<SyncLog[]>;
}
