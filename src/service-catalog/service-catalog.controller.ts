import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServiceCatalogService } from './service-catalog.service';

@Controller('services')
@UseGuards(AuthGuard, RolesGuard)
export class ServiceCatalogController {
  constructor(private readonly serviceCatalogService: ServiceCatalogService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPERVISOR)
  create(@Body() payload: CreateServiceDto) {
    return this.serviceCatalogService.create(payload);
  }

  @Get()
  findAll() {
    return this.serviceCatalogService.findAll();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.serviceCatalogService.findById(id);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPERVISOR)
  update(@Param('id') id: string, @Body() payload: UpdateServiceDto) {
    return this.serviceCatalogService.update(id, payload);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPERVISOR)
  deactivate(@Param('id') id: string) {
    return this.serviceCatalogService.deactivate(id);
  }

  @Patch(':id/reactivate')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPERVISOR)
  reactivate(@Param('id') id: string) {
    return this.serviceCatalogService.reactivate(id);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPERVISOR)
  remove(@Param('id') id: string) {
    return this.serviceCatalogService.remove(id);
  }
}
