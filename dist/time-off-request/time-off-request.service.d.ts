import { Repository } from 'typeorm';
import { TimeOffRequest, TimeOffStatus } from './entities/time-off-request.entity';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { BalanceService } from '../balance/balance.service';
import { HcmService } from '../hcm/hcm.service';
export declare class TimeOffRequestService {
    private readonly requestRepo;
    private readonly balanceService;
    private readonly hcmService;
    private readonly logger;
    constructor(requestRepo: Repository<TimeOffRequest>, balanceService: BalanceService, hcmService: HcmService);
    create(dto: CreateTimeOffRequestDto, idempotencyKey: string): Promise<TimeOffRequest>;
    approve(id: string, managerId: string): Promise<TimeOffRequest>;
    reject(id: string, managerId: string, reason?: string): Promise<TimeOffRequest>;
    cancel(id: string): Promise<TimeOffRequest>;
    findOne(id: string): Promise<TimeOffRequest>;
    findAll(filters: {
        employeeId?: string;
        locationId?: string;
        status?: TimeOffStatus;
    }): Promise<TimeOffRequest[]>;
}
