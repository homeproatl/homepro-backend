import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import type { AuthenticatedRequest } from '../auth/guards/auth.guard';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { LookupVehicleQueryDto } from './dto/lookup-vehicle-query.dto';
import { ListVehiclesQueryDto } from './dto/list-vehicles-query.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleLookupService } from './vehicle-lookup.service';
import { VehiclesService } from './vehicles.service';

@Controller('vehicles')
@UseGuards(AuthGuard)
export class VehiclesController {
  constructor(
    private readonly vehiclesService: VehiclesService,
    private readonly vehicleLookupService: VehicleLookupService,
  ) {}

  @Post()
  create(@Body() payload: CreateVehicleDto) {
    return this.vehiclesService.create(payload);
  }

  @Get()
  findAll(@Query() query: ListVehiclesQueryDto) {
    if (query.paginated) {
      return this.vehiclesService.findPage(query);
    }
    return this.vehiclesService.findAll(query);
  }

  @Get('lookup')
  lookup(@Query() query: LookupVehicleQueryDto) {
    return this.vehicleLookupService.lookupByVin(query.vin);
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
  archive(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.vehiclesService.archive(id, request.user?.sub);
  }

  @Patch(':id/unarchive')
  unarchive(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.vehiclesService.unarchive(id, request.user?.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.vehiclesService.remove(id, request.user?.sub);
  }
}
