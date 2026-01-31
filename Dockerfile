# ---- Build stage ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Build-time args (Next.js inlines NEXT_PUBLIC_* into the client bundle at build time)
# Defaults prevent build-time crashes if args are not provided.
ARG NEXT_PUBLIC_SUPABASE_URL=https://fgtilnlpcardkbdellyy.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZndGlsbmxwY2FyZGtiZGVsbHl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczMjAwMTQsImV4cCI6MjA4Mjg5NjAxNH0.BAPXw8TNmBRoCiwyOIsEJc__TzQ1ZgdUrO7J4nuiKfE

ENV NEXT_PUBLIC_SUPABASE_URL=https://fgtilnlpcardkbdellyy.supabase.co
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZndGlsbmxwY2FyZGtiZGVsbHl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczMjAwMTQsImV4cCI6MjA4Mjg5NjAxNH0.BAPXw8TNmBRoCiwyOIsEJc__TzQ1ZgdUrO7J4nuiKfE
ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---- Run stage ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Runtime env (kept for server-side routes; client bundle uses build-time values)
ARG NEXT_PUBLIC_SUPABASE_URL=https://fgtilnlpcardkbdellyy.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZndGlsbmxwY2FyZGtiZGVsbHl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczMjAwMTQsImV4cCI6MjA4Mjg5NjAxNH0.BAPXw8TNmBRoCiwyOIsEJc__TzQ1ZgdUrO7J4nuiKfE
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["npm","run","start"]
