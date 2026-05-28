import { TimeOffRequestService } from './time-off-request.service';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { ApproveRequestDto } from './dto/approve-request.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { TimeOffStatus } from './entities/time-off-request.entity';
export declare class TimeOffRequestController {
    private readonly timeOffRequestService;
    constructor(timeOffRequestService: TimeOffRequestService);
    create(dto: CreateTimeOffRequestDto, idempotencyKey: string): Promise<import("./entities/time-off-request.entity").TimeOffRequest>;
    findAll(employeeId?: string, locationId?: string, status?: TimeOffStatus): Promise<import("./entities/time-off-request.entity").TimeOffRequest[]>;
    findOne(id: string): Promise<import("./entities/time-off-request.entity").TimeOffRequest>;
    approve(id: string, dto: ApproveRequestDto): Promise<import("./entities/time-off-request.entity").TimeOffRequest>;
    reject(id: string, dto: RejectRequestDto): Promise<import("./entities/time-off-request.entity").TimeOffRequest>;
    cancel(id: string): Promise<import("./entities/time-off-request.entity").TimeOffRequest>;
}
