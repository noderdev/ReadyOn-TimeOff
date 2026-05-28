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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BalanceController = void 0;
const common_1 = require("@nestjs/common");
const balance_service_1 = require("./balance.service");
const sync_balance_dto_1 = require("./dto/sync-balance.dto");
const batch_sync_dto_1 = require("./dto/batch-sync.dto");
let BalanceController = class BalanceController {
    constructor(balanceService) {
        this.balanceService = balanceService;
    }
    async getBalance(employeeId, locationId, refresh) {
        const shouldRefresh = refresh === 'true';
        const balance = await this.balanceService.getBalance(employeeId, locationId, shouldRefresh);
        return {
            id: balance.id,
            employeeId: balance.employeeId,
            locationId: balance.locationId,
            hcmBalance: Number(balance.hcmBalance),
            reservedDays: Number(balance.reservedDays),
            availableDays: balance.availableDays,
            lastSyncedAt: balance.lastSyncedAt,
            updatedAt: balance.updatedAt,
        };
    }
    async syncBalance(dto) {
        const balance = await this.balanceService.syncFromHcm(dto.employeeId, dto.locationId);
        return {
            id: balance.id,
            employeeId: balance.employeeId,
            locationId: balance.locationId,
            hcmBalance: Number(balance.hcmBalance),
            reservedDays: Number(balance.reservedDays),
            availableDays: balance.availableDays,
            lastSyncedAt: balance.lastSyncedAt,
            updatedAt: balance.updatedAt,
        };
    }
    async processBatch(dto) {
        return this.balanceService.processBatch(dto.batchId, dto.generatedAt, dto.balances);
    }
};
exports.BalanceController = BalanceController;
__decorate([
    (0, common_1.Get)(':employeeId/:locationId'),
    __param(0, (0, common_1.Param)('employeeId')),
    __param(1, (0, common_1.Param)('locationId')),
    __param(2, (0, common_1.Query)('refresh')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], BalanceController.prototype, "getBalance", null);
__decorate([
    (0, common_1.Post)('sync'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [sync_balance_dto_1.SyncBalanceDto]),
    __metadata("design:returntype", Promise)
], BalanceController.prototype, "syncBalance", null);
__decorate([
    (0, common_1.Post)('batch'),
    (0, common_1.HttpCode)(common_1.HttpStatus.ACCEPTED),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [batch_sync_dto_1.BatchSyncDto]),
    __metadata("design:returntype", Promise)
], BalanceController.prototype, "processBatch", null);
exports.BalanceController = BalanceController = __decorate([
    (0, common_1.Controller)('api/v1/balances'),
    __metadata("design:paramtypes", [balance_service_1.BalanceService])
], BalanceController);
//# sourceMappingURL=balance.controller.js.map