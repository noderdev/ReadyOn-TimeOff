import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncService } from './sync.service';
import { SyncLog } from './entities/sync-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SyncLog])],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
