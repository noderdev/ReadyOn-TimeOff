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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var TimeOffRequestService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeOffRequestService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const time_off_request_entity_1 = require("./entities/time-off-request.entity");
const balance_service_1 = require("../balance/balance.service");
const hcm_service_1 = require("../hcm/hcm.service");
let TimeOffRequestService = TimeOffRequestService_1 = class TimeOffRequestService {
    constructor(requestRepo, balanceService, hcmService) {
        this.requestRepo = requestRepo;
        this.balanceService = balanceService;
        this.hcmService = hcmService;
        this.logger = new common_1.Logger(TimeOffRequestService_1.name);
    }
    async create(dto, idempotencyKey) {
        const existing = await this.requestRepo.findOne({
            where: { idempotencyKey },
        });
        if (existing) {
            return existing;
        }
        const balance = await this.balanceService.getBalance(dto.employeeId, dto.locationId);
        if (balance.availableDays < dto.daysRequested) {
            throw new common_1.UnprocessableEntityException({
                error: {
                    code: 'INSUFFICIENT_BALANCE',
                    message: `Available days (${balance.availableDays}) is less than requested (${dto.daysRequested})`,
                    details: {
                        availableDays: balance.availableDays,
                        requestedDays: dto.daysRequested,
                    },
                },
            });
        }
        const request = this.requestRepo.create({
            employeeId: dto.employeeId,
            locationId: dto.locationId,
            startDate: dto.startDate,
            endDate: dto.endDate,
            daysRequested: dto.daysRequested,
            status: time_off_request_entity_1.TimeOffStatus.PENDING_APPROVAL,
            requestedAt: new Date(),
            idempotencyKey,
        });
        return this.requestRepo.save(request);
    }
    async approve(id, managerId) {
        const request = await this.findOne(id);
        if (request.status !== time_off_request_entity_1.TimeOffStatus.PENDING_APPROVAL) {
            throw new common_1.BadRequestException(`Request ${id} is not in PENDING_APPROVAL status (current: ${request.status})`);
        }
        const balance = await this.balanceService.getBalance(request.employeeId, request.locationId);
        if (balance.availableDays < Number(request.daysRequested)) {
            throw new common_1.UnprocessableEntityException({
                error: {
                    code: 'INSUFFICIENT_BALANCE',
                    message: `Available days (${balance.availableDays}) is less than requested (${request.daysRequested})`,
                    details: {
                        availableDays: balance.availableDays,
                        requestedDays: Number(request.daysRequested),
                    },
                },
            });
        }
        let hcmBalance;
        try {
            const hcmData = await this.hcmService.getBalance(request.employeeId, request.locationId);
            hcmBalance = hcmData.balance;
        }
        catch (error) {
            if (error instanceof hcm_service_1.HcmUnavailableException) {
                throw error;
            }
            throw new hcm_service_1.HcmUnavailableException('Failed to fetch HCM balance');
        }
        if (hcmBalance < Number(request.daysRequested)) {
            throw new common_1.UnprocessableEntityException({
                error: {
                    code: 'INSUFFICIENT_BALANCE',
                    message: `HCM balance (${hcmBalance}) is less than requested (${request.daysRequested})`,
                    details: {
                        hcmBalance,
                        requestedDays: Number(request.daysRequested),
                    },
                },
            });
        }
        await this.balanceService.reserveDays(request.employeeId, request.locationId, Number(request.daysRequested), id);
        request.status = time_off_request_entity_1.TimeOffStatus.HCM_SUBMITTING;
        request.resolvedBy = managerId;
        await this.requestRepo.save(request);
        try {
            await this.hcmService.deductBalance(request.employeeId, request.locationId, Number(request.daysRequested), id);
            await this.balanceService.confirmDeduction(request.employeeId, request.locationId, Number(request.daysRequested), id);
            request.status = time_off_request_entity_1.TimeOffStatus.HCM_CONFIRMED;
            request.resolvedAt = new Date();
            await this.requestRepo.save(request);
        }
        catch (error) {
            await this.balanceService.releaseDays(request.employeeId, request.locationId, Number(request.daysRequested), id);
            const errorMessage = error instanceof Error ? error.message : String(error);
            request.status = time_off_request_entity_1.TimeOffStatus.HCM_FAILED;
            request.failureReason = errorMessage;
            await this.requestRepo.save(request);
            throw error;
        }
        return request;
    }
    async reject(id, managerId, reason) {
        const request = await this.findOne(id);
        if (request.status !== time_off_request_entity_1.TimeOffStatus.PENDING_APPROVAL &&
            request.status !== time_off_request_entity_1.TimeOffStatus.HCM_FAILED) {
            throw new common_1.BadRequestException(`Request ${id} cannot be rejected from status ${request.status}`);
        }
        request.status = time_off_request_entity_1.TimeOffStatus.REJECTED;
        request.resolvedBy = managerId;
        request.resolvedAt = new Date();
        if (reason) {
            request.failureReason = reason;
        }
        return this.requestRepo.save(request);
    }
    async cancel(id) {
        const request = await this.findOne(id);
        if (request.status !== time_off_request_entity_1.TimeOffStatus.PENDING_APPROVAL &&
            request.status !== time_off_request_entity_1.TimeOffStatus.HCM_CONFIRMED) {
            throw new common_1.BadRequestException(`Request ${id} cannot be cancelled from status ${request.status}`);
        }
        if (request.status === time_off_request_entity_1.TimeOffStatus.HCM_CONFIRMED) {
            await this.hcmService.restoreBalance(request.employeeId, request.locationId, Number(request.daysRequested), id);
            await this.balanceService.confirmDeduction(request.employeeId, request.locationId, -Number(request.daysRequested), id);
        }
        request.status = time_off_request_entity_1.TimeOffStatus.CANCELLED;
        request.resolvedAt = new Date();
        return this.requestRepo.save(request);
    }
    async findOne(id) {
        const request = await this.requestRepo.findOne({ where: { id } });
        if (!request) {
            throw new common_1.NotFoundException(`Time-off request ${id} not found`);
        }
        return request;
    }
    async findAll(filters) {
        const query = this.requestRepo.createQueryBuilder('request');
        if (filters.employeeId) {
            query.andWhere('request.employeeId = :employeeId', {
                employeeId: filters.employeeId,
            });
        }
        if (filters.locationId) {
            query.andWhere('request.locationId = :locationId', {
                locationId: filters.locationId,
            });
        }
        if (filters.status) {
            query.andWhere('request.status = :status', { status: filters.status });
        }
        return query.getMany();
    }
};
exports.TimeOffRequestService = TimeOffRequestService;
exports.TimeOffRequestService = TimeOffRequestService = TimeOffRequestService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(time_off_request_entity_1.TimeOffRequest)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        balance_service_1.BalanceService,
        hcm_service_1.HcmService])
], TimeOffRequestService);
//# sourceMappingURL=time-off-request.service.js.map