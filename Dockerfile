# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS deps
WORKDIR /app

# Enable pnpm via Corepack and install production deps
ENV PNPM_HOME=/usr/local/share/.pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV MAPPING_PATH=/config/mapping.json
ENV FORWARD_TIMEOUT_MS=5000

# Copy only what is needed to run
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY src ./src

USER node
EXPOSE 3000

CMD ["node", "src/server.js"]

