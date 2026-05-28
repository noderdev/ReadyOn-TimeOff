import { IsString, IsNotEmpty, IsArray, ValidateNested, IsDateString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class BalanceRecordDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;

  @IsNumber()
  balance: number;
}

export class BatchSyncDto {
  @IsString()
  @IsNotEmpty()
  batchId: string;

  @IsDateString()
  generatedAt: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BalanceRecordDto)
  balances: BalanceRecordDto[];
}
