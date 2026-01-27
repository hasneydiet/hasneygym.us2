# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Build-time args (needed because Next.js reads NEXT_PUBLIC_* during build)
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

COPY package*.json ./
ENV NPM_CONFIG_INSTALL_LINKS=true
ENV NPM_CONFIG_BIN_LINKS=true
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- Run stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Runtime env (provide via platform env/secret manager)
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["npm","run","start"]
