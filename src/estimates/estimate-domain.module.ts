import { Module } from '@nestjs/common';
import { EstimateDomainService } from './estimate-domain.service';

@Module({
  providers: [EstimateDomainService],
  exports: [EstimateDomainService],
})
export class EstimateDomainModule {}
