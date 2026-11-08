# make            build the UI, then the binary with the UI inside
# make test       Go and UI tests
# make release    static binaries for linux/amd64 and linux/arm64 in dist/
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
export CGO_ENABLED = 0

.PHONY: all ui build test e2e release clean demo

all: build

ui:
	cd web && npm ci --no-audit --no-fund && npm run build

build: ui
	go build -trimpath -ldflags '$(LDFLAGS)' -o bin/cockpit ./cmd/cockpit

test:
	go vet ./...
	go test -race ./...
	cd web && npm run typecheck && npm test

e2e: build
	sudo scripts/e2e.sh bin/cockpit

demo: build
	bin/cockpit demo

release: ui
	mkdir -p dist
	GOOS=linux GOARCH=amd64 go build -trimpath -ldflags '$(LDFLAGS)' -o dist/cockpit-linux-amd64 ./cmd/cockpit
	GOOS=linux GOARCH=arm64 go build -trimpath -ldflags '$(LDFLAGS)' -o dist/cockpit-linux-arm64 ./cmd/cockpit
	cd dist && sha256sum cockpit-linux-* > SHA256SUMS

clean:
	rm -rf bin dist internal/web/ui/dist/assets internal/web/ui/dist/index.html internal/web/ui/dist/favicon.svg
