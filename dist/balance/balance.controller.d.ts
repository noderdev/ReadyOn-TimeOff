import { BalanceService } from './balance.service';
import { SyncBalanceDto } from './dto/sync-balance.dto';
import { BatchSyncDto } from './dto/batch-sync.dto';
export declare class BalanceController {
    private readonly balanceService;
    constructor(balanceService: BalanceService);
    getBalance(employeeId: string, locationId: string, refresh?: string): Promise<{
        id: string;
        employeeId: string;
        locationId: string;
        hcmBalance: number;
        reservedDays: number;
        availableDays: number;
        lastSyncedAt: Date;
        updatedAt: Date;
    }>;
    syncBalance(dto: SyncBalanceDto): Promise<{
        id: string;
        employeeId: string;
        locationId: string;
        hcmBalance: number;
        reservedDays: number;
        availableDays: number;
        lastSyncedAt: Date;
        updatedAt: Date;
    }>;
    processBatch(dto: BatchSyncDto): Promise<{
        batchId: string;
        status: string;
        recordCount: number;
    }>;
}
