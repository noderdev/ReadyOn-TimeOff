import { Repository, DataSource } from 'typeorm';
import { Balance } from './entities/balance.entity';
import { SyncLog } from '../sync/entities/sync-log.entity';
import { HcmService } from '../hcm/hcm.service';
import { BalanceRecordDto } from './dto/batch-sync.dto';
export declare class BalanceService {
    private readonly balanceRepo;
    private readonly syncLogRepo;
    private readonly dataSource;
    private readonly hcmService;
    private readonly logger;
    constructor(balanceRepo: Repository<Balance>, syncLogRepo: Repository<SyncLog>, dataSource: DataSource, hcmService: HcmService);
    getBalance(employeeId: string, locationId: string, refresh?: boolean): Promise<Balance>;
    syncFromHcm(employeeId: string, locationId: string): Promise<Balance>;
    processBatch(batchId: string, generatedAt: string, balances: BalanceRecordDto[]): Promise<{
        batchId: string;
        status: string;
        recordCount: number;
    }>;
    reserveDays(employeeId: string, locationId: string, days: number, triggeredBy?: string): Promise<Balance>;
    releaseDays(employeeId: string, locationId: string, days: number, triggeredBy?: string): Promise<Balance>;
    confirmDeduction(employeeId: string, locationId: string, days: number, triggeredBy?: string): Promise<Balance>;
    clearProcessedBatchIds(): void;
}
