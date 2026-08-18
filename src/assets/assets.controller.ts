import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentActor } from '../common/decorators/current-actor.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthActor } from '../common/types/auth-actor';
import { AssetsService } from './assets.service';
import { CreateAssetDirectSessionDto } from './dto/create-asset-direct-session.dto';
import { CreateAssetUploadDto } from './dto/create-asset-upload.dto';

@Controller('assets')
@UseGuards(AuthGuard, RolesGuard)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  upload(
    @Body() payload: CreateAssetUploadDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.assetsService.createFromMultipart(
      payload,
      file,
      actor.organization_id,
      actor.user_id,
    );
  }

  @Post('direct-sessions')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  createDirectSession(
    @Body() payload: CreateAssetDirectSessionDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.assetsService.createDirectSession(
      payload,
      actor.organization_id,
      actor.user_id,
    );
  }

  @Post('direct-sessions/:assetId/confirm')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  confirmDirectSession(
    @Param('assetId') assetId: string,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.assetsService.confirmDirectSession(
      assetId,
      actor.organization_id,
      actor.user_id,
    );
  }

  @Get(':assetId/access')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  getAccess(
    @Param('assetId') assetId: string,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.assetsService.getAccess(assetId, actor.organization_id);
  }

  @Get(':assetId/content')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  @Header('Cache-Control', 'private, max-age=0, no-store')
  async getLocalContent(
    @Param('assetId') assetId: string,
    @CurrentActor() actor: AuthActor,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { asset, buffer } = await this.assetsService.readLocalContent(
      assetId,
      actor.organization_id,
    );
    response.setHeader('Content-Type', asset.mime_type);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${asset.filename.replace(/["\r\n\\/]/g, '_')}"`,
    );
    return new StreamableFile(buffer);
  }

  @Delete(':assetId')
  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  remove(@Param('assetId') assetId: string, @CurrentActor() actor: AuthActor) {
    return this.assetsService.remove(
      assetId,
      actor.organization_id,
      actor.user_id,
    );
  }
}
