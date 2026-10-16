# Endpoint Quality, hosted: the API serving the web app, in cloud mode (PostgreSQL, Redis,
# accounts, SSRF guard). The image holds only the bundle — one JavaScript file, the built web app,
# the examples and SQLite's WebAssembly — on a slim Node runtime.

FROM node:24-bookworm-slim AS build
WORKDIR /src
RUN npm install --global pnpm@11.3.0
COPY . .
RUN pnpm install --frozen-lockfile && pnpm run bundle

FROM node:24-bookworm-slim
ENV NODE_ENV=production EQ_MODE=cloud EQ_PORT=4400
WORKDIR /app
COPY --from=build /src/apps/cli/dist/ ./
USER node
EXPOSE 4400
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4400/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "eq.cjs", "serve", "--host", "0.0.0.0", "--port", "4400"]
