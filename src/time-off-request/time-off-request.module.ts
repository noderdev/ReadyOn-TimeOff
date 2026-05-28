import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffRequestController } from './time-off-request.controller';
import { TimeOffRequestService } from './time-off-request.service';
import { TimeOffRequest } from './entities/time-off-request.entity';
import { BalanceModule } from '../balance/balance.module';
import { HcmModule } from '../hcm/hcm.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest]),
    BalanceModule,
    HcmModule,
  ],
  controllers: [TimeOffRequestController],
  providers: [TimeOffRequestService],
  exports: [TimeOffRequestService],
})
export class TimeOffRequestModule {}
