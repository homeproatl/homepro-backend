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
import { CreateItemDto } from './dto/create-item.dto';
import { ListItemsQueryDto } from './dto/list-items-query.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemsService } from './items.service';

/**
 * Item grants (Release 1):
 * - ADMIN + TECHNICIAN: create, read, update, deactivate, reactivate
 * - ADMIN only: hard delete
 * - TECHNICIAN responses omit default_internal_unit_cost_minor
 */
@Controller('items')
@UseGuards(AuthGuard, RolesGuard)
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  private serializeOptions(actor: AuthActor) {
    return {
      includeInternalFields: actor.role === UserRole.ADMIN,
    };
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  create(@Body() payload: CreateItemDto, @CurrentActor() actor: AuthActor) {
    return this.itemsService.create(
      payload,
      actor.organization_id,
      this.serializeOptions(actor),
    );
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findAll(@Query() query: ListItemsQueryDto, @CurrentActor() actor: AuthActor) {
    const options = this.serializeOptions(actor);
    return this.itemsService.findPage(query, actor.organization_id, options);
  }

  @Get('all')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findAllForPicker(
    @Query() query: ListItemsQueryDto,
    @CurrentActor() actor: AuthActor,
  ) {
    const options = this.serializeOptions(actor);
    return this.itemsService.findAll(query, actor.organization_id, options);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findById(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.itemsService.findById(
      id,
      actor.organization_id,
      this.serializeOptions(actor),
    );
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  update(
    @Param('id') id: string,
    @Body() payload: UpdateItemDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.itemsService.update(
      id,
      payload,
      actor.organization_id,
      this.serializeOptions(actor),
    );
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  deactivate(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.itemsService.deactivate(
      id,
      actor.organization_id,
      this.serializeOptions(actor),
    );
  }

  @Patch(':id/reactivate')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  reactivate(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.itemsService.reactivate(
      id,
      actor.organization_id,
      this.serializeOptions(actor),
    );
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.itemsService.remove(id, actor.organization_id);
  }
}
