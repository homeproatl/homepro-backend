import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AuthGuard } from './guards/auth.guard';
import type { AuthenticatedRequest } from './guards/auth.guard';
import {
  clearRefreshTokenCookie,
  extractRefreshTokenFromRequest,
  setRefreshTokenCookie,
} from './auth-cookie';
import { CsrfOriginGuard } from './guards/csrf-origin.guard';
import { LoginRateLimitGuard } from './guards/login-rate-limit.guard';
import { RefreshRateLimitGuard } from './guards/refresh-rate-limit.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @UseGuards(CsrfOriginGuard, LoginRateLimitGuard)
  @Post('login')
  async login(
    @Body() payload: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(payload);
    setRefreshTokenCookie(response, this.configService, session.refreshToken);
    return {
      user: session.user,
      accessToken: session.accessToken,
    };
  }

  @UseGuards(AuthGuard, CsrfOriginGuard)
  @Post('logout')
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    clearRefreshTokenCookie(response, this.configService);
    return this.authService.logout(request.user!.sub);
  }

  @UseGuards(CsrfOriginGuard, RefreshRateLimitGuard)
  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = extractRefreshTokenFromRequest(request);

    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const session = await this.authService.refresh(refreshToken);
    setRefreshTokenCookie(response, this.configService, session.refreshToken);
    return {
      user: session.user,
      accessToken: session.accessToken,
    };
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return this.authService.me(request.user!.sub);
  }
}
