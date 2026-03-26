import { Module } from '@nestjs/common';
import { JobDomainService } from './job-domain.service';

@Module({
  providers: [JobDomainService],
  exports: [JobDomainService],
})
export class JobDomainModule {}
