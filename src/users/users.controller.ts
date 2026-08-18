import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentActor } from '../common/decorators/current-actor.decorator';
import type { AuthActor } from '../common/types/auth-actor';
import { UserRole } from '../common/enums/user-role.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  createUser(@Body() payload: CreateUserDto, @CurrentActor() actor: AuthActor) {
    return this.usersService.createUser(
      payload,
      actor.user_id,
      actor.organization_id,
    );
  }

  @Get()
  getUsers(@CurrentActor() actor: AuthActor) {
    return this.usersService.getUsers(actor.organization_id);
  }

  @Get(':id')
  getUserById(@Param('id') id: string, @CurrentActor() actor: AuthActor) {
    return this.usersService.getUserById(id, actor.organization_id);
  }

  @Patch(':id')
  updateUser(
    @Param('id') id: string,
    @Body() payload: UpdateUserDto,
    @CurrentActor() actor: AuthActor,
  ) {
    return this.usersService.updateUser(id, payload, actor.organization_id);
  }
}
