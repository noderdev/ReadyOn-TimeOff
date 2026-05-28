export declare class BalanceRecordDto {
    employeeId: string;
    locationId: string;
    balance: number;
}
export declare class BatchSyncDto {
    batchId: string;
    generatedAt: string;
    balances: BalanceRecordDto[];
}
