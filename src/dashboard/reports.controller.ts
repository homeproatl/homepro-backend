import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentActor } from '../common/decorators/current-actor.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthActor } from '../common/types/auth-actor';
import { DashboardService } from './dashboard.service';
import { ReportDateRangeDto } from './dto/report-date-range.dto';

@Controller('reports')
@UseGuards(AuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @Roles(UserRole.ADMIN)
  summary(
    @Query() query: ReportDateRangeDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.dashboardService.getReportsSummary(
      actor.organization_id,
      query,
    );
  }
}
