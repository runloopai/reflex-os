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
# `pnpm install`, and both Git and `.dockerignore` exclude it. Rather than
# install the whole monorepo to get it, run the one orval project the SDK's
# entry point re-exports.
FROM node:22-slim AS sdk-client
WORKDIR /gen
# The generator version decides the shape of the client, so it comes from the
# repo's own pin rather than a second one that can drift. Copied under
# another name: a package.json here would make npm install the whole root
# dependency list alongside orval.
COPY package.json ./root-package.json
# orval.config.ts imports `defineConfig` from orval, so orval has to resolve
# from this directory. Installed before the sources are copied, so editing the
# SDK does not re-download the generator.
RUN npm install --no-save "orval@$(node -p "require('./root-package.json').devDependencies.orval")"
COPY orval.config.ts ./
COPY openapi/openapi.public.json ./openapi/
COPY sdk/client/package.json ./sdk/client/
COPY sdk/client/src ./sdk/client/src
COPY sdk/client/scripts ./sdk/client/scripts
RUN npx orval --config orval.config.ts --project reflexSdk

# The web bundle needs the dev toolchain (Vite, Tailwind, the React plugin);
# the running container does not, so it is built here and only `web/dist`
# crosses into the image that gets pulled on every deploy.
FROM node:22-slim AS web
WORKDIR /app/sdk/examples/arcade
COPY sdk/examples/arcade/package.json sdk/examples/arcade/package-lock.json ./
RUN npm ci --include=dev
COPY --from=sdk-client /gen/sdk/client /app/sdk/client
# Both dirs: `web/vite.config.ts` loads the share-card plugin, which reads
# `server/share.ts`.
COPY sdk/examples/arcade/server ./server
COPY sdk/examples/arcade/web ./web
RUN npm run build

FROM node:22-slim

# HOST because the server otherwise binds loopback and nothing outside the
# container could reach it; NODE_ENV because that is what makes it serve the
# built web app rather than expecting the Vite dev server.
ENV NODE_ENV=production \
    HOST=0.0.0.0

WORKDIR /app/sdk/examples/arcade

COPY sdk/examples/arcade/package.json sdk/examples/arcade/package-lock.json ./
RUN npm ci --omit=dev

# The SDK's package.json travels with its sources: without it Node reads
# those .ts files as CommonJS and every named import from the client fails.
COPY --from=sdk-client /gen/sdk/client /app/sdk/client
# Copied by path rather than wholesale, to leave a local `.data` dir (and any
# other untracked working-tree state) out of the image. `web/` comes along as
# source, not just as its build output: `server/routes.ts` imports
# `web/src/lib/share.ts`, the one list of share sources both sides read.
COPY sdk/examples/arcade/server ./server
COPY sdk/examples/arcade/web ./web
COPY --from=web /app/sdk/examples/arcade/web/dist ./web/dist

# Not root. The process runs code it does not control the inputs to — agent
# art it fetches and rasterizes, JSON from every visitor — and the image has
# nothing in it this user needs to write to: rows live in Postgres and the
# web bundle is baked in. `node` ships with the base image.
USER node

EXPOSE 8790
CMD ["npm", "start"]
