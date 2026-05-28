"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var HcmService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HcmService = exports.HcmValidationException = exports.HcmInsufficientBalanceException = exports.HcmUnavailableException = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const config_1 = require("@nestjs/config");
const rxjs_1 = require("rxjs");
class HcmUnavailableException extends common_1.ServiceUnavailableException {
    constructor(message) {
        super(message || 'HCM service is unavailable');
    }
}
exports.HcmUnavailableException = HcmUnavailableException;
class HcmInsufficientBalanceException extends common_1.UnprocessableEntityException {
    constructor(message) {
        super(message || 'HCM reports insufficient balance');
    }
}
exports.HcmInsufficientBalanceException = HcmInsufficientBalanceException;
class HcmValidationException extends common_1.BadRequestException {
    constructor(message) {
        super(message || 'HCM validation error');
    }
}
exports.HcmValidationException = HcmValidationException;
let HcmService = HcmService_1 = class HcmService {
    constructor(httpService, configService) {
        this.httpService = httpService;
        this.configService = configService;
        this.logger = new common_1.Logger(HcmService_1.name);
        this.baseUrl = this.configService.get('HCM_BASE_URL', 'http://localhost:3001');
        this.timeoutMs = this.configService.get('HCM_TIMEOUT_MS', 5000);
        this.retryCount = this.configService.get('HCM_RETRY_COUNT', 2);
    }
    async getBalance(employeeId, locationId) {
        return this.withRetry(async () => {
            try {
                const response = await (0, rxjs_1.firstValueFrom)(this.httpService.get(`${this.baseUrl}/hcm/balances/${employeeId}/${locationId}`, {
                    timeout: this.timeoutMs,
                }));
                return response.data;
            }
            catch (error) {
                this.handleAxiosError(error, 'getBalance');
            }
        });
    }
    async deductBalance(employeeId, locationId, days, requestId) {
        return this.withRetry(async () => {
            try {
                const response = await (0, rxjs_1.firstValueFrom)(this.httpService.post(`${this.baseUrl}/hcm/balances/deduct`, { employeeId, locationId, days, requestId }, { timeout: this.timeoutMs }));
                return response.data;
            }
            catch (error) {
                this.handleAxiosError(error, 'deductBalance');
            }
        }, false);
    }
    async restoreBalance(employeeId, locationId, days, requestId) {
        return this.withRetry(async () => {
            try {
                const response = await (0, rxjs_1.firstValueFrom)(this.httpService.post(`${this.baseUrl}/hcm/balances/restore`, { employeeId, locationId, days, requestId }, { timeout: this.timeoutMs }));
                return response.data;
            }
            catch (error) {
                this.handleAxiosError(error, 'restoreBalance');
            }
        });
    }
    handleAxiosError(error, operation) {
        if (error instanceof HcmInsufficientBalanceException ||
            error instanceof HcmUnavailableException ||
            error instanceof HcmValidationException) {
            throw error;
        }
        const axiosError = error;
        if (axiosError.response) {
            const status = axiosError.response.status;
            if (status === 422) {
                throw new HcmInsufficientBalanceException(`HCM reports insufficient balance during ${operation}`);
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
    async withRetry(fn, retry = true) {
        const maxAttempts = retry ? this.retryCount + 1 : 1;
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            }
            catch (error) {
                lastError = error;
                if (error instanceof HcmInsufficientBalanceException ||
                    error instanceof HcmValidationException) {
                    throw error;
                }
                if (attempt < maxAttempts) {
                    this.logger.warn(`HCM call attempt ${attempt} failed, retrying in 500ms...`);
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
            }
        }
        throw lastError;
    }
};
exports.HcmService = HcmService;
exports.HcmService = HcmService = HcmService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [axios_1.HttpService,
        config_1.ConfigService])
], HcmService);
//# sourceMappingURL=hcm.service.js.map