FROM --platform=$BUILDPLATFORM node:26-bookworm-slim AS web-build
WORKDIR /build
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/patches .yarn/patches
COPY packages/angular/package.json packages/angular/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/presets/package.json packages/presets/package.json
COPY packages/react/package.json packages/react/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/vue/package.json packages/vue/package.json
RUN npm install --global corepack@0.35.0 && corepack enable && yarn install --immutable
COPY desktop/package.json desktop/package-lock.json desktop/.npmrc desktop/
RUN npm ci --prefix desktop
COPY . .
ARG VITE_REACT_GRAB=false
RUN VITE_REACT_GRAB=$VITE_REACT_GRAB npm run build --prefix desktop

FROM --platform=$BUILDPLATFORM golang:1.27.4-alpine AS service-build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /build
COPY packages/server/go packages/server/go
COPY apps/service apps/service
WORKDIR /build/apps/service
RUN go mod download && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -o /out/blok-cloud ./cmd/server

FROM alpine:3.22 AS service
RUN apk add --no-cache ca-certificates wget && addgroup -g 65532 app && adduser -D -u 65532 -G app app && mkdir /data && chown app:app /data
COPY --from=service-build /out/blok-cloud /usr/local/bin/blok-cloud
USER 65532:65532
WORKDIR /data
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/blok-cloud"]

FROM caddy:2-alpine AS web
COPY --from=web-build /build/desktop/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
