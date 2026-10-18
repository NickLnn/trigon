import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { requestContextMiddleware } from './activity/request-context';
import { AppModule } from './app.module';
import { allowedOrigins } from './common/origins';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Behind the Next.js rewrite / a reverse proxy: trust X-Forwarded-* from the first hop.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // The API only returns JSON and files, never pages: the strictest policy fits. Files set their own
  // (sandbox) CSP, which replaces this one.
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
      xFrameOptions: { action: 'deny' },
    }),
  );
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  // Imported pages (long scripts, big tables) easily exceed the 100 KB default; forms are tiny.
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: false });
  // The browser normally calls the API through the web app's own origin (no CORS at all); direct
  // cross-origin calls are only accepted from Trigon's own configured addresses.
  const origins = allowedOrigins(config.get('APP_URL'), config.get('PUBLIC_URL'));
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || origins.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();

  const port = Number(config.get('API_PORT') ?? 4000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Trigon API listening on http://0.0.0.0:${port}`, 'Bootstrap');
}

bootstrap();
