# ─────────────────────────────────────────
# Stage 1: dependencias
# ─────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && cp -R node_modules /prod_modules
RUN npm install

# ─────────────────────────────────────────
# Stage 2: build
# ─────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ─────────────────────────────────────────
# Stage 3: desarrollo (con hot reload)
# ─────────────────────────────────────────
FROM node:20-alpine AS development
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3100 9229
CMD ["npm", "run", "start:dev"]

# ─────────────────────────────────────────
# Stage 4: producción (imagen mínima)
# ─────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Solo usuario no-root
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

COPY --from=deps /prod_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

RUN mkdir -p /app/temp && chown nestjs:nodejs /app/temp

USER nestjs
EXPOSE 3100
CMD ["node", "dist/main"]
