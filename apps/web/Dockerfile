# Build from the monorepo root:  docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @trigon/shared --workspace @trigon/web --include-workspace-root=false --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/web apps/web
# Rewrites and NEXT_PUBLIC_* values are baked in at build time.
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_COLLAB_URL=
ARG GIT_SHA=dev
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_PUBLIC_COLLAB_URL=$NEXT_PUBLIC_COLLAB_URL GIT_SHA=$GIT_SHA NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @trigon/shared && npm run build -w @trigon/web

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
