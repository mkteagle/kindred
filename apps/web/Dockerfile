FROM node:24-alpine AS base
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
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/dist/standalone ./
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
