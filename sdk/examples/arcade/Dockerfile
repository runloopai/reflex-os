# The hosted arcade: one container serving the API, the WebSocket hub, the
# Reflex proxy, and the built web app. Rows live in Postgres (`DATABASE_URL`),
# because nothing written to this filesystem survives a deploy.
#
# Build context is the repository root, not this directory: the server and the
# web app import the client SDK straight from `sdk/client/src` (see README),
# so both trees have to land at the paths those relative imports expect.
#
#   docker build -f sdk/examples/arcade/Dockerfile .

# Half of `sdk/client/src` does not exist in a fresh checkout: the generated
# client is written from the committed OpenAPI spec during the repo's
# `pnpm install`, and Git ignores it. Rather than install the whole monorepo
# to get it, run the one orval project the SDK's entry point re-exports.
FROM node:22-slim AS sdk-client
WORKDIR /gen
COPY orval.config.ts ./
COPY openapi/openapi.public.json ./openapi/
COPY sdk/client/package.json ./sdk/client/
COPY sdk/client/src ./sdk/client/src
COPY sdk/client/scripts ./sdk/client/scripts
# orval.config.ts imports `defineConfig` from orval, so it has to resolve
# from this directory. Keep the version in step with the root package.json.
RUN npm install --no-save orval@8.18.0 \
  && npx orval --config orval.config.ts --project reflexSdk

FROM node:22-slim

# HOST because the server otherwise binds loopback and nothing outside the
# container could reach it; NODE_ENV because that is what makes it serve the
# built web app rather than expecting the Vite dev server.
ENV NODE_ENV=production \
    HOST=0.0.0.0

WORKDIR /app/sdk/examples/arcade

# Dependencies first, so a source-only change reuses this layer. Dev
# dependencies are not optional here: `npm start` runs the server through
# tsx, and the web build runs through Vite.
COPY sdk/examples/arcade/package.json sdk/examples/arcade/package-lock.json ./
RUN npm ci --include=dev

# The SDK's package.json travels with its sources: without it Node reads
# those .ts files as CommonJS and every named import from the client fails.
COPY --from=sdk-client /gen/sdk/client /app/sdk/client

# Copied by path rather than wholesale: it keeps a local node_modules, .data
# dir, or stale web/dist out of the image without a repo-root .dockerignore
# that the app's own image builds would then have to live with.
COPY sdk/examples/arcade/server ./server
COPY sdk/examples/arcade/web ./web

RUN npm run build

EXPOSE 8790
CMD ["npm", "start"]
