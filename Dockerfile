# The production image: compiled JavaScript and production dependencies, run by the
# unprivileged `node` user. Debian-based slim images, not Alpine: argon2 is a native module,
# and its prebuilt binaries target glibc, which Alpine's musl doesn't provide.

# Compile the TypeScript, with every dependency installed.
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Install the production dependencies alone, so no compiler or test tool reaches the image.
FROM node:26-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM node:26-slim
LABEL org.opencontainers.image.source="https://github.com/bakirsobashy/kursi"
LABEL org.opencontainers.image.description="Kursi: a REST API for booking seats at events"
LABEL org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production
WORKDIR /app
# Owned by root and read-only to `node`: the app can't rewrite its own code.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# package.json marks dist/ as ES modules; migrations/ and public/ are read at run time.
COPY package.json ./
COPY migrations ./migrations
COPY public ./public
# The image's `node` user, by number: Kubernetes' runAsNonRoot can only check a numeric user
# isn't root, and refuses to start the container otherwise.
USER 1000:1000
EXPOSE 3000
# Slim images have no curl, so the check is one line of Node.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT ?? 3000) + '/health').then((res) => process.exit(res.ok ? 0 : 1), () => process.exit(1))"]
# node itself, not npm start: as PID 1 it receives Docker's SIGTERM and shuts down gracefully.
CMD ["node", "dist/server.js"]
