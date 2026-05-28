import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalanceModule } from './balance/balance.module';
import { TimeOffRequestModule } from './time-off-request/time-off-request.module';
import { SyncModule } from './sync/sync.module';
import { HcmModule } from './hcm/hcm.module';
import { Balance } from './balance/entities/balance.entity';
import { TimeOffRequest } from './time-off-request/entities/time-off-request.entity';
import { SyncLog } from './sync/entities/sync-log.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'better-sqlite3',
        database: configService.get<string>('DB_PATH', './data/timeoff.sqlite'),
        entities: [Balance, TimeOffRequest, SyncLog],
        synchronize: true,
        logging: false,
      }),
    }),
    HcmModule,
    BalanceModule,
    TimeOffRequestModule,
    SyncModule,
  ],
})
export class AppModule {}
