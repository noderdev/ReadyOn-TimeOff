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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeOffRequest = exports.TimeOffStatus = void 0;
const typeorm_1 = require("typeorm");
var TimeOffStatus;
(function (TimeOffStatus) {
    TimeOffStatus["PENDING_APPROVAL"] = "PENDING_APPROVAL";
    TimeOffStatus["APPROVED"] = "APPROVED";
    TimeOffStatus["REJECTED"] = "REJECTED";
    TimeOffStatus["CANCELLED"] = "CANCELLED";
    TimeOffStatus["HCM_SUBMITTING"] = "HCM_SUBMITTING";
    TimeOffStatus["HCM_CONFIRMED"] = "HCM_CONFIRMED";
    TimeOffStatus["HCM_FAILED"] = "HCM_FAILED";
})(TimeOffStatus || (exports.TimeOffStatus = TimeOffStatus = {}));
let TimeOffRequest = class TimeOffRequest {
};
exports.TimeOffRequest = TimeOffRequest;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], TimeOffRequest.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 64 }),
    __metadata("design:type", String)
], TimeOffRequest.prototype, "employeeId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 64 }),
    __metadata("design:type", String)
], TimeOffRequest.prototype, "locationId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date' }),
    __metadata("design:type", String)
], TimeOffRequest.prototype, "startDate", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date' }),
    __metadata("design:type", String)
], TimeOffRequest.prototype, "endDate", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 8, scale: 2 }),
    __metadata("design:type", Number)
], TimeOffRequest.prototype, "daysRequested", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'varchar',
        enum: TimeOffStatus,
        default: TimeOffStatus.PENDING_APPROVAL,
    }),
    __metadata("design:type", String)
], TimeOffRequest.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'datetime' }),
    __metadata("design:type", Date)
], TimeOffRequest.prototype, "requestedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'datetime', nullable: true }),
    __metadata("design:type", Date)
], TimeOffRequest.prototype, "resolvedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 64, nullable: true }),
    __metadata("design:type", String)
], TimeOffRequest.prototype, "resolvedBy", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], TimeOffRequest.prototype, "failureReason", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 128, nullable: true, unique: true }),
    __metadata("design:type", String)
], TimeOffRequest.prototype, "idempotencyKey", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], TimeOffRequest.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], TimeOffRequest.prototype, "updatedAt", void 0);
exports.TimeOffRequest = TimeOffRequest = __decorate([
    (0, typeorm_1.Entity)('time_off_requests'),
    (0, typeorm_1.Index)(['employeeId', 'locationId', 'status'])
], TimeOffRequest);
//# sourceMappingURL=time-off-request.entity.js.map