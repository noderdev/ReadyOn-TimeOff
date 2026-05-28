export declare class Balance {
    id: string;
    employeeId: string;
    locationId: string;
    hcmBalance: number;
    reservedDays: number;
    lastSyncedAt: Date;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    get availableDays(): number;
}
