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
exports.TimeOffRequestController = void 0;
const common_1 = require("@nestjs/common");
const time_off_request_service_1 = require("./time-off-request.service");
const create_time_off_request_dto_1 = require("./dto/create-time-off-request.dto");
const approve_request_dto_1 = require("./dto/approve-request.dto");
const reject_request_dto_1 = require("./dto/reject-request.dto");
const time_off_request_entity_1 = require("./entities/time-off-request.entity");
let TimeOffRequestController = class TimeOffRequestController {
    constructor(timeOffRequestService) {
        this.timeOffRequestService = timeOffRequestService;
    }
    async create(dto, idempotencyKey) {
        if (!idempotencyKey) {
            throw new common_1.BadRequestException('Idempotency-Key header is required');
        }
        const existing = await this.timeOffRequestService
            .findAll({})
            .then((all) => all.find((r) => r.idempotencyKey === idempotencyKey));
        if (existing) {
            throw new common_1.ConflictException({
                message: 'Duplicate idempotency key',
                data: existing,
            });
        }
        return this.timeOffRequestService.create(dto, idempotencyKey);
    }
    async findAll(employeeId, locationId, status) {
        return this.timeOffRequestService.findAll({
            employeeId,
            locationId,
            status,
        });
    }
    async findOne(id) {
        return this.timeOffRequestService.findOne(id);
    }
    async approve(id, dto) {
        return this.timeOffRequestService.approve(id, dto.managerId);
    }
    async reject(id, dto) {
        return this.timeOffRequestService.reject(id, dto.managerId, dto.reason);
    }
    async cancel(id) {
        return this.timeOffRequestService.cancel(id);
    }
};
exports.TimeOffRequestController = TimeOffRequestController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('idempotency-key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_time_off_request_dto_1.CreateTimeOffRequestDto, String]),
    __metadata("design:returntype", Promise)
], TimeOffRequestController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('employeeId')),
    __param(1, (0, common_1.Query)('locationId')),
    __param(2, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], TimeOffRequestController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], TimeOffRequestController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(':id/approve'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, approve_request_dto_1.ApproveRequestDto]),
    __metadata("design:returntype", Promise)
], TimeOffRequestController.prototype, "approve", null);
__decorate([
    (0, common_1.Post)(':id/reject'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, reject_request_dto_1.RejectRequestDto]),
    __metadata("design:returntype", Promise)
], TimeOffRequestController.prototype, "reject", null);
__decorate([
    (0, common_1.Post)(':id/cancel'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], TimeOffRequestController.prototype, "cancel", null);
exports.TimeOffRequestController = TimeOffRequestController = __decorate([
    (0, common_1.Controller)('api/v1/time-off-requests'),
    __metadata("design:paramtypes", [time_off_request_service_1.TimeOffRequestService])
], TimeOffRequestController);
//# sourceMappingURL=time-off-request.controller.js.map