import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentActor } from '../common/decorators/current-actor.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthActor } from '../common/types/auth-actor';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';
import { UpdateClientDto } from './dto/update-client.dto';

/**
 * Client write grants (Release 1):
 * - ADMIN + TECHNICIAN: create, read, update, archive, unarchive
 * - ADMIN only: hard delete
 * TECHNICIAN may manage operational client records but cannot manage users,
 * settings, taxes, contracts, payment configuration, or hard-delete clients.
 */
@Controller('clients')
@UseGuards(AuthGuard, RolesGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  create(@Body() payload: CreateClientDto, @CurrentActor() actor: AuthActor) {
    return this.clientsService.create(payload, actor.organization_id);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findAll(
    @Query() query: ListClientsQueryDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.clientsService.findPage(query, actor.organization_id);
  }

  @Get('all')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findAllForPicker(
    @Query() query: ListClientsQueryDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.clientsService.findAll(query, actor.organization_id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findById(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.clientsService.findById(id, actor.organization_id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  update(
    @Param('id') id: string,
    @Body() payload: UpdateClientDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.clientsService.update(id, payload, actor.organization_id);
  }

  @Patch(':id/archive')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  archive(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.clientsService.archive(
      id,
      actor.organization_id,
      actor.user_id,
    );
  }

  @Patch(':id/unarchive')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  unarchive(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.clientsService.unarchive(
      id,
      actor.organization_id,
      actor.user_id,
    );
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.clientsService.remove(id, actor.organization_id, actor.user_id);
  }
}
