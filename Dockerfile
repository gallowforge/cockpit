# Cockpit in a container. The default command is the demo, so
#   docker run --rm -p 8080:8080 ghcr.io/gallowforge/cockpit
# shows the dashboard on synthetic data. For a real host, run the binary under
# systemd instead (see deploy/): the collector needs the host's journal,
# systemd and Docker socket, which a container should not be handed.
#
# Every build step runs on the builder's own platform: the UI is plain
# JavaScript and Go cross-compiles, so the arm64 image needs no emulation.
FROM --platform=$BUILDPLATFORM node:22-alpine AS ui
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN mkdir -p ../internal/web/ui/dist && npm run build

FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS bin
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod ./
COPY . .
COPY --from=ui /src/internal/web/ui/dist ./internal/web/ui/dist
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /cockpit ./cmd/cockpit \
 && mkdir -p /rootfs/tmp && chmod 1777 /rootfs/tmp

FROM scratch
LABEL org.opencontainers.image.source="https://github.com/gallowforge/cockpit" \
      org.opencontainers.image.description="Cockpit demo: a read-only homelab dashboard on synthetic data" \
      org.opencontainers.image.licenses="MIT"
COPY --from=bin /rootfs/ /
COPY --from=bin /cockpit /cockpit
USER 65534:65534
EXPOSE 8080
ENTRYPOINT ["/cockpit"]
CMD ["demo", "-listen", "0.0.0.0:8080"]
