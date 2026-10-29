# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build
RUN npm run build:server

# Runtime stage
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache libc6-compat wget
ENV TZ=Europe/Berlin
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --legacy-peer-deps
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
