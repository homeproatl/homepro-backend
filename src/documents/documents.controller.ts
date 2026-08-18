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
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import {
  RestoreDocumentDto,
  TransitionDocumentStatusDto,
} from './dto/transition-document-status.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

/**
 * Shared estimate/invoice document aggregate (Release 1 foundation).
 * ADMIN + TECHNICIAN: create, read, update, status, restore
 * ADMIN only: hard delete
 */
@Controller('documents')
@UseGuards(AuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  create(@Body() payload: CreateDocumentDto, @CurrentActor() actor: AuthActor) {
    return this.documentsService.create(
      payload,
      actor.organization_id,
      actor.user_id,
    );
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findAll(
    @Query() query: ListDocumentsQueryDto,
    @CurrentActor() actor: AuthActor,
  ) {
    if (query.paginated) {
      return this.documentsService.findPage(query, actor.organization_id);
    }
    return this.documentsService.findAll(query, actor.organization_id, {
      includeInternalFields: actor.role === UserRole.ADMIN,
    });
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  findById(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.documentsService.findById(id, actor.organization_id, {
      includeInternalFields: actor.role === UserRole.ADMIN,
    });
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  update(
    @Param('id') id: string,
    @Body() payload: UpdateDocumentDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentsService.update(
      id,
      payload,
      actor.organization_id,
      actor.user_id,
      { includeInternalFields: actor.role === UserRole.ADMIN },
    );
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  transitionStatus(
    @Param('id') id: string,
    @Body() payload: TransitionDocumentStatusDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentsService.transitionStatus(
      id,
      payload,
      actor.organization_id,
      actor.user_id,
    );
  }

  @Patch(':id/restore')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  restore(
    @Param('id') id: string,
    @Body() payload: RestoreDocumentDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.documentsService.restoreArchived(
      id,
      payload,
      actor.organization_id,
      actor.user_id,
    );
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.documentsService.remove(
      id,
      actor.organization_id,
      actor.user_id,
    );
  }
}
