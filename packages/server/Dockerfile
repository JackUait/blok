FROM node:24-bookworm-slim AS runtime-build
WORKDIR /workspace

COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/angular/package.json packages/angular/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/presets/package.json packages/presets/package.json
COPY packages/react/package.json packages/react/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/vue/package.json packages/vue/package.json
COPY . .
RUN corepack enable && yarn install --immutable
RUN node scripts/build-server-runtime.mjs

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS publish
WORKDIR /workspace

COPY --from=runtime-build /workspace/packages/server/dotnet/ packages/server/dotnet/

ARG BLOK_SERVER_VERSION=dev
RUN dotnet publish packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj \
    --configuration Release \
    --runtime linux-x64 \
    --self-contained true \
    --output /out \
    -p:PublishSingleFile=true \
    -p:DebugType=None \
    -p:DebugSymbols=false \
    -p:AssemblyName=blok-server \
    -p:BlokServerVersion=$BLOK_SERVER_VERSION \
    -p:ContinuousIntegrationBuild=true \
    -p:SkipBlokServerRuntimeBuild=true

FROM mcr.microsoft.com/dotnet/runtime-deps:10.0
COPY --from=publish /out/blok-server /blok-server

EXPOSE 4000
ENTRYPOINT ["/blok-server"]
