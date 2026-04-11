import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CreateTagDto } from './dto/create-tag.dto';
import { ListTagsQueryDto } from './dto/list-tags-query.dto';
import { TagsService } from './tags.service';

@Controller('tags')
@UseGuards(AuthGuard)
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  findAll(@Query() query: ListTagsQueryDto) {
    return this.tagsService.findAll(query.scope);
  }

  @Post()
  create(@Body() payload: CreateTagDto) {
    return this.tagsService.create(payload);
  }
}
