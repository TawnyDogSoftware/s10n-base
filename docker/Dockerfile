# The application image: the bundled server, serving the built web app, on Node.
#
#   docker build -f docker/Dockerfile --build-arg APP_VERSION=<version> -t <name> .
#
# One image, three commands (docs/deployment.md):
#   (default)                                     the server
#   apps/server/dist/migrate.mjs up | status      migrations, run before rolling out a version
#   apps/server/dist/set-role.mjs <email> <role>  make a user an admin
#
# Both bases are pinned by tag and digest. The tags must match .nvmrc and packageManager
# (scripts/version-sources.test.ts checks); the daily dependency update moves both tags and
# their digests with them, and Dependabot refreshes the digests of these tags.

FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS bun

FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS toolchain
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN test "$(node --version)" = "v26.13.1" && test "$(bun --version)" = "1.4.4"
WORKDIR /build
# Manifests and the lockfile only, so the install layers stay cached until they change. The
# mobile app is left out: a frozen install accepts a checkout without a workspace nothing else
# here depends on.
COPY package.json bun.lock bunfig.toml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/client/package.json packages/client/
COPY packages/contracts/package.json packages/contracts/
COPY packages/i18n/package.json packages/i18n/
COPY packages/shared/package.json packages/shared/
COPY packages/theme/package.json packages/theme/

# The packages the server needs at run time: a production install, from which only the
# server's dependencies and what they need are copied, in bun's own layout (see the script).
FROM toolchain AS production-dependencies
RUN bun install --production --frozen-lockfile --ignore-scripts
COPY scripts/container/runtime-dependencies.ts scripts/container/runtime-dependencies.main.ts scripts/container/
RUN bun scripts/container/runtime-dependencies.main.ts /build apps/server /runtime

FROM toolchain AS build
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/server apps/server
COPY apps/web apps/web
RUN bun run --cwd apps/server build && bun run --cwd apps/web build
RUN test -f apps/server/dist/bin.mjs \
  && test -f apps/server/dist/migrate.mjs \
  && test -f apps/server/dist/set-role.mjs \
  && test -f apps/web/dist/index.html
# The bundle must import exactly the packages the server declares, which are the ones copied.
COPY scripts/container/bundle-imports.ts scripts/container/bundle-imports.main.ts scripts/container/runtime-dependencies.ts scripts/container/
RUN bun scripts/container/bundle-imports.main.ts apps/server/dist apps/server/package.json

FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS runtime
# The image runs one program with node; package managers have no use in it.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
  /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/corepack /opt/yarn-* \
  /usr/local/bin/docker-entrypoint.sh
WORKDIR /app
COPY --from=production-dependencies /runtime/ ./
# The server finds the web build at ../../web/dist from its own directory, so the layout matches
# the repository's.
COPY --from=build /build/apps/server/dist/ apps/server/dist/
COPY --from=build /build/apps/web/dist/ apps/web/dist/
ARG APP_VERSION=""
# The same pattern as APP_VERSION_PATTERN in apps/server/src/config/index.ts (a test checks).
RUN test -z "$APP_VERSION" || node -e 'if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/.test(process.argv[1])) { console.error("APP_VERSION has characters outside [a-zA-Z0-9._+-]"); process.exit(1); }' "$APP_VERSION"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4210 APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.title="s10n-base" org.opencontainers.image.version=$APP_VERSION
EXPOSE 4210
USER node
STOPSIGNAL SIGTERM
# Liveness, with Node itself: the image has no shell tools to rely on.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --start-interval=1s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node"]
CMD ["apps/server/dist/bin.mjs"]
