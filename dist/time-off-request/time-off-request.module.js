"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeOffRequestModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const time_off_request_controller_1 = require("./time-off-request.controller");
const time_off_request_service_1 = require("./time-off-request.service");
const time_off_request_entity_1 = require("./entities/time-off-request.entity");
const balance_module_1 = require("../balance/balance.module");
const hcm_module_1 = require("../hcm/hcm.module");
let TimeOffRequestModule = class TimeOffRequestModule {
};
exports.TimeOffRequestModule = TimeOffRequestModule;
exports.TimeOffRequestModule = TimeOffRequestModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([time_off_request_entity_1.TimeOffRequest]),
            balance_module_1.BalanceModule,
            hcm_module_1.HcmModule,
        ],
        controllers: [time_off_request_controller_1.TimeOffRequestController],
        providers: [time_off_request_service_1.TimeOffRequestService],
        exports: [time_off_request_service_1.TimeOffRequestService],
    })
], TimeOffRequestModule);
//# sourceMappingURL=time-off-request.module.js.map