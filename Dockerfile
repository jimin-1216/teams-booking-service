# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Production (base image already includes Chromium)
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

COPY package.json package-lock.json* ./
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY src/scraper/selectors.json ./dist/scraper/selectors.json
COPY src/bot/cards ./dist/bot/cards

# Create directories
RUN mkdir -p /app/data /app/logs/screenshots

ENV NODE_ENV=production
ENV PORT=3978

EXPOSE 3978

CMD ["node", "dist/index.js"]
