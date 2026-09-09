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
    const user = await this.usersService.findById(userPayload.sub);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Never return password hash
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  }
}
