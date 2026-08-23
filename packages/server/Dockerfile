# goreleaser has already cross-compiled the binary and placed it at the root of
# the build context — this image never compiles anything, which is why there is
# no builder stage and no Go toolchain here.
FROM gcr.io/distroless/static-debian12
COPY blok-server /blok-server
EXPOSE 4000
ENTRYPOINT ["/blok-server"]
