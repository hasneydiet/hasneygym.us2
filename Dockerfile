# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# ⛔ DO NOT REQUIRE SUPABASE ENV AT BUILD
ENV NEXT_PUBLIC_SUPABASE_URL="build-time-placeholder"
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY="build-time-placeholder"

RUN npm run build

# ---- Run stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app ./

EXPOSE 3000
CMD ["npm","run","start"]
