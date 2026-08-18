import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../../auth/guards/auth.guard';
import { AuthActor } from '../types/auth-actor';

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthActor => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.actor) {
      throw new Error('Authenticated actor context is missing');
    }
    return request.actor;
  },
);
