import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TimeOffRequest,
  TimeOffStatus,
} from './entities/time-off-request.entity';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { BalanceService } from '../balance/balance.service';
import { HcmService, HcmUnavailableException, HcmInsufficientBalanceException } from '../hcm/hcm.service';

@Injectable()
export class TimeOffRequestService {
  private readonly logger = new Logger(TimeOffRequestService.name);

  constructor(
    @InjectRepository(TimeOffRequest)
    private readonly requestRepo: Repository<TimeOffRequest>,
    private readonly balanceService: BalanceService,
    private readonly hcmService: HcmService,
  ) {}

  async create(
    dto: CreateTimeOffRequestDto,
    idempotencyKey: string,
  ): Promise<TimeOffRequest> {
    // Check idempotency key
    const existing = await this.requestRepo.findOne({
      where: { idempotencyKey },
    });

    if (existing) {
      return existing;
    }

    // Check local balance
    const balance = await this.balanceService.getBalance(
      dto.employeeId,
      dto.locationId,
    );

    if (balance.availableDays < dto.daysRequested) {
      throw new UnprocessableEntityException({
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
      status: TimeOffStatus.PENDING_APPROVAL,
      requestedAt: new Date(),
      idempotencyKey,
    });

    return this.requestRepo.save(request);
  }

  async approve(id: string, managerId: string): Promise<TimeOffRequest> {
    const request = await this.findOne(id);

    if (request.status !== TimeOffStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        `Request ${id} is not in PENDING_APPROVAL status (current: ${request.status})`,
      );
    }

    // Local balance check
    const balance = await this.balanceService.getBalance(
      request.employeeId,
      request.locationId,
    );

    if (balance.availableDays < Number(request.daysRequested)) {
      throw new UnprocessableEntityException({
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

    // HCM real-time balance check
    let hcmBalance: number;
    try {
      const hcmData = await this.hcmService.getBalance(
        request.employeeId,
        request.locationId,
      );
      hcmBalance = hcmData.balance;
    } catch (error) {
      if (error instanceof HcmUnavailableException) {
        throw error;
      }
      throw new HcmUnavailableException('Failed to fetch HCM balance');
    }

    if (hcmBalance < Number(request.daysRequested)) {
      throw new UnprocessableEntityException({
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

    // Reserve days
    await this.balanceService.reserveDays(
      request.employeeId,
      request.locationId,
      Number(request.daysRequested),
      id,
    );

    // Update status to HCM_SUBMITTING
    request.status = TimeOffStatus.HCM_SUBMITTING;
    request.resolvedBy = managerId;
    await this.requestRepo.save(request);

    // Call HCM deduct
    try {
      await this.hcmService.deductBalance(
        request.employeeId,
        request.locationId,
        Number(request.daysRequested),
        id,
      );

      // Confirm deduction
      await this.balanceService.confirmDeduction(
        request.employeeId,
        request.locationId,
        Number(request.daysRequested),
        id,
      );

      request.status = TimeOffStatus.HCM_CONFIRMED;
      request.resolvedAt = new Date();
      await this.requestRepo.save(request);
    } catch (error) {
      // Release reservation on failure
      await this.balanceService.releaseDays(
        request.employeeId,
        request.locationId,
        Number(request.daysRequested),
        id,
      );

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      request.status = TimeOffStatus.HCM_FAILED;
      request.failureReason = errorMessage;
      await this.requestRepo.save(request);

      throw error;
    }

    return request;
  }

  async reject(
    id: string,
    managerId: string,
    reason?: string,
  ): Promise<TimeOffRequest> {
    const request = await this.findOne(id);

    if (
      request.status !== TimeOffStatus.PENDING_APPROVAL &&
      request.status !== TimeOffStatus.HCM_FAILED
    ) {
      throw new BadRequestException(
        `Request ${id} cannot be rejected from status ${request.status}`,
      );
    }

    request.status = TimeOffStatus.REJECTED;
    request.resolvedBy = managerId;
    request.resolvedAt = new Date();
    if (reason) {
      request.failureReason = reason;
    }

    return this.requestRepo.save(request);
  }

  async cancel(id: string): Promise<TimeOffRequest> {
    const request = await this.findOne(id);

    if (
      request.status !== TimeOffStatus.PENDING_APPROVAL &&
      request.status !== TimeOffStatus.HCM_CONFIRMED
    ) {
      throw new BadRequestException(
        `Request ${id} cannot be cancelled from status ${request.status}`,
      );
    }

    if (request.status === TimeOffStatus.HCM_CONFIRMED) {
      // Call HCM restore
      await this.hcmService.restoreBalance(
        request.employeeId,
        request.locationId,
        Number(request.daysRequested),
        id,
      );

      // Restore local balance
      await this.balanceService.confirmDeduction(
        request.employeeId,
        request.locationId,
        -Number(request.daysRequested), // negative to restore
        id,
      );
    }

    request.status = TimeOffStatus.CANCELLED;
    request.resolvedAt = new Date();

    return this.requestRepo.save(request);
  }

  async findOne(id: string): Promise<TimeOffRequest> {
    const request = await this.requestRepo.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Time-off request ${id} not found`);
    }
    return request;
  }

  async findAll(filters: {
    employeeId?: string;
    locationId?: string;
    status?: TimeOffStatus;
  }): Promise<TimeOffRequest[]> {
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
}
