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
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Controller('customers')
@UseGuards(AuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  create(@Body() payload: CreateCustomerDto) {
    return this.customersService.create(payload);
  }

  @Get()
  findAll(@Query() query: ListCustomersQueryDto) {
    return this.customersService.findAll(query);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.customersService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() payload: UpdateCustomerDto) {
    return this.customersService.update(id, payload);
  }

  @Patch(':id/archive')
  @Roles(UserRole.SUPER_ADMIN)
  archive(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.customersService.archive(id, request.user?.sub);
  }

  @Patch(':id/unarchive')
  @Roles(UserRole.SUPER_ADMIN)
  unarchive(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.customersService.unarchive(id, request.user?.sub);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.customersService.remove(id, request.user?.sub);
  }

  @Get(':id/vehicles')
  findVehicles(@Param('id') id: string) {
    return this.customersService.findVehicles(id);
  }
}
