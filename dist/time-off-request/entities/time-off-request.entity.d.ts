export declare enum TimeOffStatus {
    PENDING_APPROVAL = "PENDING_APPROVAL",
    APPROVED = "APPROVED",
    REJECTED = "REJECTED",
    CANCELLED = "CANCELLED",
    HCM_SUBMITTING = "HCM_SUBMITTING",
    HCM_CONFIRMED = "HCM_CONFIRMED",
    HCM_FAILED = "HCM_FAILED"
}
export declare class TimeOffRequest {
    id: string;
    employeeId: string;
    locationId: string;
    startDate: string;
    endDate: string;
    daysRequested: number;
    status: TimeOffStatus;
    requestedAt: Date;
    resolvedAt: Date;
    resolvedBy: string;
    failureReason: string;
    idempotencyKey: string;
    createdAt: Date;
    updatedAt: Date;
}
