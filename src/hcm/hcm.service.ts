import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

export class HcmUnavailableException extends ServiceUnavailableException {
  constructor(message?: string) {
    super(message || 'HCM service is unavailable');
  }
}

export class HcmInsufficientBalanceException extends UnprocessableEntityException {
  constructor(message?: string) {
    super(message || 'HCM reports insufficient balance');
  }
}

export class HcmValidationException extends BadRequestException {
  constructor(message?: string) {
    super(message || 'HCM validation error');
  }
}

@Injectable()
export class HcmService {
  private readonly logger = new Logger(HcmService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryCount: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>('HCM_BASE_URL', 'http://localhost:3001');
    this.timeoutMs = this.configService.get<number>('HCM_TIMEOUT_MS', 5000);
    this.retryCount = this.configService.get<number>('HCM_RETRY_COUNT', 2);
  }

  async getBalance(employeeId: string, locationId: string): Promise<{ balance: number }> {
    return this.withRetry(async () => {
      try {
        const response = await firstValueFrom(
          this.httpService.get(`${this.baseUrl}/hcm/balances/${employeeId}/${locationId}`, {
            timeout: this.timeoutMs,
          }),
        );
        return response.data;
      } catch (error) {
        this.handleAxiosError(error, 'getBalance');
      }
    });
  }

  async deductBalance(
    employeeId: string,
    locationId: string,
    days: number,
    requestId: string,
  ): Promise<{ success: boolean; hcmRequestId: string }> {
    return this.withRetry(async () => {
      try {
        const response = await firstValueFrom(
          this.httpService.post(
            `${this.baseUrl}/hcm/balances/deduct`,
            { employeeId, locationId, days, requestId },
            { timeout: this.timeoutMs },
          ),
        );
        return response.data;
      } catch (error) {
        this.handleAxiosError(error, 'deductBalance');
      }
    }, false); // do not retry deduct - non-idempotent
  }

  async restoreBalance(
    employeeId: string,
    locationId: string,
    days: number,
    requestId: string,
  ): Promise<{ success: boolean }> {
    return this.withRetry(async () => {
      try {
        const response = await firstValueFrom(
          this.httpService.post(
            `${this.baseUrl}/hcm/balances/restore`,
            { employeeId, locationId, days, requestId },
            { timeout: this.timeoutMs },
          ),
        );
        return response.data;
      } catch (error) {
        this.handleAxiosError(error, 'restoreBalance');
      }
    });
  }

  private handleAxiosError(error: any, operation: string): never {
    if (error instanceof HcmInsufficientBalanceException ||
        error instanceof HcmUnavailableException ||
        error instanceof HcmValidationException) {
      throw error;
    }

    const axiosError = error as AxiosError;
    if (axiosError.response) {
      const status = axiosError.response.status;
      if (status === 422) {
        throw new HcmInsufficientBalanceException(
          `HCM reports insufficient balance during ${operation}`,
        );
      }
      if (status === 400) {
        throw new HcmValidationException(`HCM validation error during ${operation}`);
      }
      if (status >= 500) {
        throw new HcmUnavailableException(`HCM server error during ${operation}: ${status}`);
      }
      throw new HcmUnavailableException(`HCM error during ${operation}: ${status}`);
    }

    if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
      throw new HcmUnavailableException(`HCM timeout during ${operation}`);
    }

    if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
      throw new HcmUnavailableException(`HCM unreachable during ${operation}`);
    }

    this.logger.error(`HCM error during ${operation}:`, error?.message || error);
    throw new HcmUnavailableException(`HCM unavailable during ${operation}`);
  }

  private async withRetry<T>(fn: () => Promise<T>, retry = true): Promise<T> {
    const maxAttempts = retry ? this.retryCount + 1 : 1;
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (error instanceof HcmInsufficientBalanceException ||
            error instanceof HcmValidationException) {
          throw error; // Don't retry business logic errors
        }
        if (attempt < maxAttempts) {
          this.logger.warn(`HCM call attempt ${attempt} failed, retrying in 500ms...`);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    throw lastError;
  }
}
