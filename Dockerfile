# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage: Node serves SPA + /api (quote, snapshots DB, 23:59 daily job)
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY server ./server
EXPOSE 80
CMD ["node", "server/index.js"]
