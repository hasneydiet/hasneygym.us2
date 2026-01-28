# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Build must NOT depend on runtime secrets.
# Supabase env vars are provided at runtime by your platform (Portainer/Unraid).
RUN npm run build

# ---- Run stage ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app ./

EXPOSE 3000
CMD ["npm","run","start"]
