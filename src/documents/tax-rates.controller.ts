import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentActor } from '../common/decorators/current-actor.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthActor } from '../common/types/auth-actor';
import { CreateTaxRateDto, UpdateTaxRateDto } from './dto/tax-rate-write.dto';
import { TaxRatesService } from './tax-rates.service';

@Controller('tax-rates')
@UseGuards(AuthGuard, RolesGuard)
export class TaxRatesController {
  constructor(private readonly taxRatesService: TaxRatesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findAll(@CurrentActor() actor: AuthActor) {
    if (actor.role === UserRole.ADMIN) {
      return this.taxRatesService.findAll(actor.organization_id);
    }
    return this.taxRatesService.findActive(actor.organization_id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findById(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.taxRatesService.findById(id, actor.organization_id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() payload: CreateTaxRateDto, @CurrentActor() actor: AuthActor) {
    return this.taxRatesService.create(payload, actor.organization_id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body() payload: UpdateTaxRateDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.taxRatesService.update(id, payload, actor.organization_id);
  }

  @Post(':id/deactivate')
  @Roles(UserRole.ADMIN)
  deactivate(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.taxRatesService.deactivate(id, actor.organization_id);
  }

  @Post(':id/set-default')
  @Roles(UserRole.ADMIN)
  setDefault(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.taxRatesService.setDefault(id, actor.organization_id);
  }
}
