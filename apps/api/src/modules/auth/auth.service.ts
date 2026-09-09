import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UsersService } from '../users/users.service';
import { prisma } from '../../database/client';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await argon2.hash(registerDto.password);
    const user = await this.usersService.createUser({
      email: registerDto.email,
      passwordHash,
      displayName: registerDto.displayName,
    });

    return this.loginUser(user);
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, loginDto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.loginUser(user);
  }

  async refresh(refreshToken: string) {
    const session = await prisma.refreshSession.findFirst({
      where: {
        expiresAt: { gt: new Date() },
        revokedAt: null,
      },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh session');
    }

    // Wait, the above logic is wrong. I need to find the session that matches the hash of the provided refreshToken.
    // I will iterate or provide a way to lookup. A better approach is to include the session ID in the cookie.
    // Let's decode the opaque token format: "sessionId.randomBytes"
    const [sessionId, opaqueString] = refreshToken.split('.');

    if (!sessionId || !opaqueString) {
      throw new UnauthorizedException('Invalid refresh token format');
    }

    const activeSession = await prisma.refreshSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!activeSession || activeSession.revokedAt || activeSession.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh session');
    }

    if (!activeSession.user.isActive) {
      throw new UnauthorizedException('User inactive');
    }

    const isValidToken = await argon2.verify(activeSession.tokenHash, opaqueString);
    if (!isValidToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Revoke the old session
    await prisma.refreshSession.update({
      where: { id: activeSession.id },
      data: { revokedAt: new Date() },
    });

    return this.loginUser(activeSession.user);
  }

  async logout(refreshToken: string) {
    if (!refreshToken) return;
    const [sessionId] = refreshToken.split('.');
    if (!sessionId) return;

    await prisma.refreshSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async loginUser(user: {
    id: string;
    email: string;
    displayName: string | null;
    tokenVersion: number;
  }) {
    const payload = { sub: user.id, tokenVersion: user.tokenVersion };

    // Generate access token (approx 15 min)
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expiresIn: (process.env.JWT_ACCESS_EXPIRY || '15m') as any,
    });

    // Generate refresh token
    const opaqueString = crypto.randomBytes(64).toString('hex');
    const tokenHash = await argon2.hash(opaqueString);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const session = await prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const refreshToken = `${session.id}.${opaqueString}`;

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    };
  }
}
