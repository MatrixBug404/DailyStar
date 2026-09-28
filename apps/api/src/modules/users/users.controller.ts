import { Controller, Get, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { Request } from 'express';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@Req() req: Request) {
    const userPayload = (req as unknown as { user: { sub: string } }).user;
    return this.usersService.getMe(userPayload.sub);
  }
}
