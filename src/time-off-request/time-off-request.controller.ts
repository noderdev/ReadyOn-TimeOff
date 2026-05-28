import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { TimeOffRequestService } from './time-off-request.service';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { ApproveRequestDto } from './dto/approve-request.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { TimeOffStatus } from './entities/time-off-request.entity';

@Controller('api/v1/time-off-requests')
export class TimeOffRequestController {
  constructor(
    private readonly timeOffRequestService: TimeOffRequestService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateTimeOffRequestDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const existing = await this.timeOffRequestService
      .findAll({})
      .then((all) => all.find((r) => r.idempotencyKey === idempotencyKey));

    if (existing) {
      throw new ConflictException({
        message: 'Duplicate idempotency key',
        data: existing,
      });
    }

    return this.timeOffRequestService.create(dto, idempotencyKey);
  }

  @Get()
  async findAll(
    @Query('employeeId') employeeId?: string,
    @Query('locationId') locationId?: string,
    @Query('status') status?: TimeOffStatus,
  ) {
    return this.timeOffRequestService.findAll({
      employeeId,
      locationId,
      status,
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.timeOffRequestService.findOne(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id') id: string,
    @Body() dto: ApproveRequestDto,
  ) {
    return this.timeOffRequestService.approve(id, dto.managerId);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
  ) {
    return this.timeOffRequestService.reject(id, dto.managerId, dto.reason);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id') id: string) {
    return this.timeOffRequestService.cancel(id);
  }
}
