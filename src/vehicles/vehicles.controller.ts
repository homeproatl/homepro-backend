import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import type { AuthenticatedRequest } from '../auth/guards/auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehiclesService } from './vehicles.service';

@Controller('vehicles')
@UseGuards(AuthGuard, RolesGuard)
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Post()
  create(@Body() payload: CreateVehicleDto) {
    return this.vehiclesService.create(payload);
  }

  @Get()
  findAll() {
    return this.vehiclesService.findAll();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.vehiclesService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: UpdateVehicleDto) {
    return this.vehiclesService.update(id, payload);
  }

  @Patch(':id/archive')
  @Roles(UserRole.SUPER_ADMIN)
  archive(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.vehiclesService.archive(id, request.user?.sub);
  }

  @Patch(':id/unarchive')
  @Roles(UserRole.SUPER_ADMIN)
  unarchive(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.vehiclesService.unarchive(id, request.user?.sub);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.vehiclesService.remove(id, request.user?.sub);
  }
}
