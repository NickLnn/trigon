import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Behind the Next.js rewrite / a reverse proxy: trust X-Forwarded-* for client IPs (rate limits).
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  // Imported pages (long scripts, big tables) easily exceed the 100 KB default.
  app.useBodyParser('json', { limit: '10mb' });
  app.enableCors({ origin: config.get('APP_URL') ?? 'http://localhost:3000', credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();

  const port = Number(config.get('API_PORT') ?? 4000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Trigon API listening on http://0.0.0.0:${port}`, 'Bootstrap');
}

bootstrap();
