ARG BUILDPLATFORM
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS publish
WORKDIR /workspace

COPY packages/server/dotnet/ packages/server/dotnet/

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
      -p:IncludeNativeLibrariesForSelfExtract=true \
      -p:DebugType=None \
      -p:DebugSymbols=false \
      -p:AssemblyName=blok-server \
      -p:BlokServerVersion=$BLOK_SERVER_VERSION \
      -p:ContinuousIntegrationBuild=true \
    && mkdir /data \
    && chown 65532:65532 /data

FROM mcr.microsoft.com/dotnet/runtime-deps:10.0
COPY --from=publish --chown=65532:65532 /data /data
COPY --from=publish --chown=65532:65532 /out/blok-server /blok-server

# USER 65532 has no home directory and cannot write /, so the single-file
# host's self-extraction fails outright ("Default extraction directory
# [/] ... not accessible") without somewhere writable to unpack into. NOT
# under /data: LocalFileEndpoint serves that directory publicly.
RUN mkdir -p /var/tmp/.net && chown 65532:65532 /var/tmp/.net
ENV DOTNET_BUNDLE_EXTRACT_BASE_DIR=/var/tmp/.net

WORKDIR /data
USER 65532:65532
EXPOSE 4000
ENTRYPOINT ["/blok-server"]
