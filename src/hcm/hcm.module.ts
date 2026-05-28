import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HcmService } from './hcm.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        timeout: configService.get<number>('HCM_TIMEOUT_MS', 5000),
      }),
    }),
  ],
  providers: [HcmService],
  exports: [HcmService],
})
export class HcmModule {}
