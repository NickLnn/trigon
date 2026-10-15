# Build from the monorepo root:  docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @trigon/shared --workspace @trigon/api --include-workspace-root=false --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @trigon/shared && npm run build -w @trigon/api

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @trigon/shared --workspace @trigon/api --include-workspace-root=false --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production
# Backups: pg_dump/pg_restore matching the PostgreSQL 17 server, and smbclient for SMB destinations.
# Search: poppler-utils reads text out of PDFs; tesseract-ocr reads scanned pages and images (no language data from apk).
RUN apk add --no-cache postgresql17-client samba-client tar poppler-utils tesseract-ocr
# OCR languages shipped by default: English + Greek, Tesseract's small "fast" models (~5.5 MB together).
# More can be added at runtime by dropping .traineddata files into data/tessdata (see docs/ocr-languages.md).
ADD https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/eng.traineddata \
    https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/ell.traineddata \
    /usr/share/trigon/tessdata/
RUN cd /usr/share/trigon/tessdata \
 && printf '%s  %s\n' \
      7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2 eng.traineddata \
      4fba8a0b461038d51f1c20d043d4f2ac38c4e778f1b90830847f7bd8fa3ba726 ell.traineddata \
    | sha256sum -c - \
 && chmod 644 *.traineddata
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
WORKDIR /app/apps/api
RUN mkdir -p /data/storage /data/backups /data/backups-nfs /data/tessdata && chown -R node:node /data
USER node
ENV STORAGE_DIR=/data/storage
EXPOSE 4000 4001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
# Apply pending migrations, then start the API + collaboration server.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/main.js"]
