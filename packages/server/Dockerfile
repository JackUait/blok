ARG BUILDPLATFORM
# The embedded document runtime is JavaScript, so it is built once on the build
# host — the .NET SDK image has no node, and the bundle is the same for every
# target architecture.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS runtime-build
WORKDIR /workspace

COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/angular/package.json packages/angular/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/presets/package.json packages/presets/package.json
COPY packages/react/package.json packages/react/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/vue/package.json packages/vue/package.json
RUN corepack enable && yarn install --immutable
COPY . .
RUN node scripts/build-server-runtime.mjs

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS publish
WORKDIR /workspace

COPY --from=runtime-build /workspace/packages/server/dotnet/ packages/server/dotnet/

ARG BLOK_SERVER_VERSION=dev
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) rid=linux-x64 ;; \
      arm64) rid=linux-arm64 ;; \
      *) echo "unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && dotnet publish packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj \
      --configuration Release \
      --runtime "$rid" \
      --self-contained true \
      --output /out \
      -p:PublishSingleFile=true \
      -p:DebugType=None \
      -p:DebugSymbols=false \
      -p:AssemblyName=blok-server \
      -p:BlokServerVersion=$BLOK_SERVER_VERSION \
      -p:ContinuousIntegrationBuild=true \
      -p:SkipBlokServerRuntimeBuild=true \
    && mkdir /data \
    && chown 65532:65532 /data

FROM mcr.microsoft.com/dotnet/runtime-deps:10.0
COPY --from=publish --chown=65532:65532 /data /data
COPY --from=publish --chown=65532:65532 /out/blok-server /blok-server

WORKDIR /data
USER 65532:65532
EXPOSE 4000
ENTRYPOINT ["/blok-server"]
