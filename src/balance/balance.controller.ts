import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { BalanceService } from './balance.service';
import { SyncBalanceDto } from './dto/sync-balance.dto';
import { BatchSyncDto } from './dto/batch-sync.dto';

@Controller('api/v1/balances')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get(':employeeId/:locationId')
  async getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Query('refresh') refresh?: string,
  ) {
    const shouldRefresh = refresh === 'true';
    const balance = await this.balanceService.getBalance(
      employeeId,
      locationId,
      shouldRefresh,
    );

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

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async syncBalance(@Body() dto: SyncBalanceDto) {
    const balance = await this.balanceService.syncFromHcm(
      dto.employeeId,
      dto.locationId,
    );

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

  @Post('batch')
  @HttpCode(HttpStatus.ACCEPTED)
  async processBatch(@Body() dto: BatchSyncDto) {
    return this.balanceService.processBatch(
      dto.batchId,
      dto.generatedAt,
      dto.balances,
    );
  }
}
