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
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServiceCatalogService } from './service-catalog.service';

@Controller('services')
@UseGuards(AuthGuard)
export class ServiceCatalogController {
  constructor(private readonly serviceCatalogService: ServiceCatalogService) {}

  @Post()
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
  update(@Param('id') id: string, @Body() payload: UpdateServiceDto) {
    return this.serviceCatalogService.update(id, payload);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.serviceCatalogService.deactivate(id);
  }

  @Patch(':id/reactivate')
  reactivate(@Param('id') id: string) {
    return this.serviceCatalogService.reactivate(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.serviceCatalogService.remove(id);
  }
}
