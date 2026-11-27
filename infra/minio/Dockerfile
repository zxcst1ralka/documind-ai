
FROM golang:1.26-alpine AS build
RUN apk add --no-cache git
ARG GOPROXY="https://proxy.golang.org|https://goproxy.cn|direct"
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 GOPROXY="$GOPROXY" go install -trimpath github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && addgroup -g 10002 minio && adduser -D -H -u 10002 -G minio minio && mkdir /data && chown minio:minio /data
COPY --from=build /go/bin/minio /usr/local/bin/minio
ENV MINIO_UPDATE=off MINIO_BROWSER=off
USER minio
ENTRYPOINT ["minio"]
CMD ["server", "/data"]
