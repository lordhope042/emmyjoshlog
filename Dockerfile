FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY legacy-api/package.json ./legacy-api/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run db:generate && pnpm run build
ENV PORT=3000 SERVE_DIST=1 NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "server.js"]
