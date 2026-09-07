FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

FROM base AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Fumadocs runs from the package postinstall hook and needs its source
# configuration and documents to be present while dependencies are installed.
COPY source.config.ts ./
COPY content ./content
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
