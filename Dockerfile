# Use the official lightweight Bun image
FROM oven/bun:1.2-alpine AS runner
WORKDIR /app

# Copy root workspace definition and lockfile
COPY package.json bun.lock ./

# Copy all monorepo packages and modules needed by the API
COPY packages ./packages
COPY modules ./modules
COPY apps/api ./apps/api

# Install workspace dependencies
RUN bun install --frozen-lockfile || bun install

# Switch to the API directory
WORKDIR /app/apps/api

# Render injects PORT dynamically (defaults to 3001 if unset)
ENV PORT=3001
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3001

# Start the Bun server
CMD ["bun", "run", "src/index.ts"]
