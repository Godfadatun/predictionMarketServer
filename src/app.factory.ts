import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config } from '@/config';
import { AppModule } from '@/app.module';
import { AppExceptionFilter } from '@/common/filters/app-exception.filter';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: config.appEnv === 'test' ? ['error'] : undefined });
  app.enableCors({ origin: config.corsOrigin.split(','), credentials: true });
  app.useGlobalFilters(new AppExceptionFilter());
  return app;
}
