import { ServiceUnavailableException, UnprocessableEntityException, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
export declare class HcmUnavailableException extends ServiceUnavailableException {
    constructor(message?: string);
}
export declare class HcmInsufficientBalanceException extends UnprocessableEntityException {
    constructor(message?: string);
}
export declare class HcmValidationException extends BadRequestException {
    constructor(message?: string);
}
export declare class HcmService {
    private readonly httpService;
    private readonly configService;
    private readonly logger;
    private readonly baseUrl;
    private readonly timeoutMs;
    private readonly retryCount;
    constructor(httpService: HttpService, configService: ConfigService);
    getBalance(employeeId: string, locationId: string): Promise<{
        balance: number;
    }>;
    deductBalance(employeeId: string, locationId: string, days: number, requestId: string): Promise<{
        success: boolean;
        hcmRequestId: string;
    }>;
    restoreBalance(employeeId: string, locationId: string, days: number, requestId: string): Promise<{
        success: boolean;
    }>;
    private handleAxiosError;
    private withRetry;
}
