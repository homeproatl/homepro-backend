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
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Controller('customers')
@UseGuards(AuthGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  create(@Body() payload: CreateCustomerDto) {
    return this.customersService.create(payload);
  }

  @Get()
  findAll(@Query() query: ListCustomersQueryDto) {
    if (query.paginated) {
      return this.customersService.findPage(query);
    }
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
  archive(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.customersService.archive(id, request.user?.sub);
  }

  @Patch(':id/unarchive')
  unarchive(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.customersService.unarchive(id, request.user?.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.customersService.remove(id, request.user?.sub);
  }

  @Get(':id/vehicles')
  findVehicles(@Param('id') id: string) {
    return this.customersService.findVehicles(id);
  }
}
