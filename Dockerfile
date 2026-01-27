# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Build-time args (needed because Next.js reads NEXT_PUBLIC_* during build)
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=https://fgtilnlpcardkbdellyy.supabase.co
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZndGlsbmxwY2FyZGtiZGVsbHl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczMjAwMTQsImV4cCI6MjA4Mjg5NjAxNH0.BAPXw8TNmBRoCiwyOIsEJc__TzQ1ZgdUrO7J4nuiKfE

COPY package*.json ./
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
ENV NEXT_PUBLIC_SUPABASE_URL=https://fgtilnlpcardkbdellyy.supabase.co
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZndGlsbmxwY2FyZGtiZGVsbHl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczMjAwMTQsImV4cCI6MjA4Mjg5NjAxNH0.BAPXw8TNmBRoCiwyOIsEJc__TzQ1ZgdUrO7J4nuiKfE

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["npm","run","start"]
