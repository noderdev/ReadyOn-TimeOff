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
var BalanceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BalanceService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const balance_entity_1 = require("./entities/balance.entity");
const sync_log_entity_1 = require("../sync/entities/sync-log.entity");
const hcm_service_1 = require("../hcm/hcm.service");
const processedBatchIds = new Set();
let BalanceService = BalanceService_1 = class BalanceService {
    constructor(balanceRepo, syncLogRepo, dataSource, hcmService) {
        this.balanceRepo = balanceRepo;
        this.syncLogRepo = syncLogRepo;
        this.dataSource = dataSource;
        this.hcmService = hcmService;
        this.logger = new common_1.Logger(BalanceService_1.name);
    }
    async getBalance(employeeId, locationId, refresh = false) {
        if (refresh) {
            return this.syncFromHcm(employeeId, locationId);
        }
        const balance = await this.balanceRepo.findOne({
            where: { employeeId, locationId },
        });
        if (!balance) {
            try {
                return await this.syncFromHcm(employeeId, locationId);
            }
            catch (error) {
                throw new common_1.NotFoundException(`Balance not found for employee ${employeeId} at location ${locationId}`);
            }
        }
        return balance;
    }
    async syncFromHcm(employeeId, locationId) {
        const hcmData = await this.hcmService.getBalance(employeeId, locationId);
        const existing = await this.balanceRepo.findOne({
            where: { employeeId, locationId },
        });
        const previousHcmBalance = existing ? Number(existing.hcmBalance) : null;
        const previousReserved = existing ? Number(existing.reservedDays) : null;
        let balance;
        if (existing) {
            existing.hcmBalance = hcmData.balance;
            existing.lastSyncedAt = new Date();
            balance = await this.balanceRepo.save(existing);
        }
        else {
            balance = await this.balanceRepo.save(this.balanceRepo.create({
                employeeId,
                locationId,
                hcmBalance: hcmData.balance,
                reservedDays: 0,
                lastSyncedAt: new Date(),
                version: 1,
            }));
        }
        await this.syncLogRepo.save(this.syncLogRepo.create({
            employeeId,
            locationId,
            syncType: sync_log_entity_1.SyncType.REALTIME_FETCH,
            previousHcmBalance,
            newHcmBalance: hcmData.balance,
            previousReserved,
            newReserved: Number(balance.reservedDays),
            triggeredBy: 'realtime-fetch',
        }));
        return balance;
    }
    async processBatch(batchId, generatedAt, balances) {
        if (processedBatchIds.has(batchId)) {
            return {
                batchId,
                status: 'ACCEPTED',
                recordCount: balances.length,
            };
        }
        for (const record of balances) {
            const existing = await this.balanceRepo.findOne({
                where: {
                    employeeId: record.employeeId,
                    locationId: record.locationId,
                },
            });
            const previousHcmBalance = existing ? Number(existing.hcmBalance) : null;
            const previousReserved = existing ? Number(existing.reservedDays) : 0;
            if (existing) {
                existing.hcmBalance = record.balance;
                existing.lastSyncedAt = new Date(generatedAt);
                await this.balanceRepo.save(existing);
            }
            else {
                await this.balanceRepo.save(this.balanceRepo.create({
                    employeeId: record.employeeId,
                    locationId: record.locationId,
                    hcmBalance: record.balance,
                    reservedDays: 0,
                    lastSyncedAt: new Date(generatedAt),
                    version: 1,
                }));
            }
            await this.syncLogRepo.save(this.syncLogRepo.create({
                employeeId: record.employeeId,
                locationId: record.locationId,
                syncType: sync_log_entity_1.SyncType.BATCH_INGEST,
                previousHcmBalance,
                newHcmBalance: record.balance,
                previousReserved,
                newReserved: previousReserved,
                triggeredBy: batchId,
            }));
        }
        processedBatchIds.add(batchId);
        return {
            batchId,
            status: 'ACCEPTED',
            recordCount: balances.length,
        };
    }
    async reserveDays(employeeId, locationId, days, triggeredBy) {
        const maxRetries = 3;
        let lastError;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const balance = await this.balanceRepo.findOne({
                where: { employeeId, locationId },
            });
            if (!balance) {
                throw new common_1.NotFoundException(`Balance not found for employee ${employeeId} at location ${locationId}`);
            }
            const previousReserved = Number(balance.reservedDays);
            const newReserved = previousReserved + days;
            const expectedVersion = balance.version;
            const result = await this.dataSource.query(`UPDATE balances
         SET reservedDays = ?, version = version + 1, updatedAt = ?
         WHERE employeeId = ? AND locationId = ? AND version = ?`, [
                newReserved.toFixed(2),
                new Date().toISOString(),
                employeeId,
                locationId,
                expectedVersion,
            ]);
            const affected = result?.changes ?? result?.[0]?.affectedRows ?? (Array.isArray(result) ? result[1] : result);
            const rowsAffected = typeof affected === 'number' ? affected : 0;
            if (rowsAffected > 0) {
                await this.syncLogRepo.save(this.syncLogRepo.create({
                    employeeId,
                    locationId,
                    syncType: sync_log_entity_1.SyncType.REQUEST_RESERVATION,
                    previousHcmBalance: Number(balance.hcmBalance),
                    newHcmBalance: Number(balance.hcmBalance),
                    previousReserved,
                    newReserved,
                    triggeredBy: triggeredBy || 'reservation',
                }));
                const updated = await this.balanceRepo.findOne({
                    where: { employeeId, locationId },
                });
                return updated;
            }
            lastError = new common_1.ConflictException('Concurrent modification detected, retrying...');
            this.logger.warn(`Version conflict on reserveDays attempt ${attempt + 1} for ${employeeId}/${locationId}`);
        }
        throw lastError || new common_1.ConflictException('Failed to reserve days after retries');
    }
    async releaseDays(employeeId, locationId, days, triggeredBy) {
        const balance = await this.balanceRepo.findOne({
            where: { employeeId, locationId },
        });
        if (!balance) {
            throw new common_1.NotFoundException(`Balance not found for employee ${employeeId} at location ${locationId}`);
        }
        const previousReserved = Number(balance.reservedDays);
        const newReserved = Math.max(0, previousReserved - days);
        await this.dataSource.query(`UPDATE balances
       SET reservedDays = ?, updatedAt = ?
       WHERE employeeId = ? AND locationId = ?`, [newReserved.toFixed(2), new Date().toISOString(), employeeId, locationId]);
        await this.syncLogRepo.save(this.syncLogRepo.create({
            employeeId,
            locationId,
            syncType: sync_log_entity_1.SyncType.REQUEST_RELEASE,
            previousHcmBalance: Number(balance.hcmBalance),
            newHcmBalance: Number(balance.hcmBalance),
            previousReserved,
            newReserved,
            triggeredBy: triggeredBy || 'release',
        }));
        const updated = await this.balanceRepo.findOne({
            where: { employeeId, locationId },
        });
        return updated;
    }
    async confirmDeduction(employeeId, locationId, days, triggeredBy) {
        const balance = await this.balanceRepo.findOne({
            where: { employeeId, locationId },
        });
        if (!balance) {
            throw new common_1.NotFoundException(`Balance not found for employee ${employeeId} at location ${locationId}`);
        }
        const previousHcmBalance = Number(balance.hcmBalance);
        const previousReserved = Number(balance.reservedDays);
        const newHcmBalance = previousHcmBalance - days;
        const newReserved = Math.max(0, previousReserved - days);
        await this.dataSource.query(`UPDATE balances
       SET hcmBalance = ?, reservedDays = ?, updatedAt = ?
       WHERE employeeId = ? AND locationId = ?`, [
            newHcmBalance.toFixed(2),
            newReserved.toFixed(2),
            new Date().toISOString(),
            employeeId,
            locationId,
        ]);
        await this.syncLogRepo.save(this.syncLogRepo.create({
            employeeId,
            locationId,
            syncType: sync_log_entity_1.SyncType.HCM_DEDUCT_CONFIRMED,
            previousHcmBalance,
            newHcmBalance,
            previousReserved,
            newReserved,
            triggeredBy: triggeredBy || 'deduction',
        }));
        const updated = await this.balanceRepo.findOne({
            where: { employeeId, locationId },
        });
        return updated;
    }
    clearProcessedBatchIds() {
        processedBatchIds.clear();
    }
};
exports.BalanceService = BalanceService;
exports.BalanceService = BalanceService = BalanceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(balance_entity_1.Balance)),
    __param(1, (0, typeorm_1.InjectRepository)(sync_log_entity_1.SyncLog)),
    __param(2, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource,
        hcm_service_1.HcmService])
], BalanceService);
//# sourceMappingURL=balance.service.js.map