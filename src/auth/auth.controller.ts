import { Body, Controller, Get, HttpCode, Post, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@/common/guards';
import { JoiValidationPipe } from '@/common/pipes/joi-validation.pipe';
import { AuthUser, CurrentUser } from '@/common/decorators';
import { registerSchema } from './dto/register.dto';
import { loginSchema } from './dto/login.dto';
import { AuthService } from './services/auth.service';
import { sanitizeSession, sanitizeUser } from './sanitizers/user.sanitizer';
import { LoginInput, RegisterInput } from './interfaces/auth.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('register')
  @UsePipes(new JoiValidationPipe(registerSchema))
  async register(@Body() body: RegisterInput) {
    return sanitizeSession(await this.service.register(body));
  }

  @Post('login')
  @HttpCode(200)
  @UsePipes(new JoiValidationPipe(loginSchema))
  async login(@Body() body: LoginInput) {
    return sanitizeSession(await this.service.login(body));
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    return sanitizeUser(await this.service.me(user));
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async logout(@CurrentUser() user: AuthUser) {
    return this.service.logout(user);
  }
}
