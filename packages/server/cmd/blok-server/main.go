package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/JackUait/blok/packages/server/internal/httpapi"
)

// version is stamped at build time via -ldflags.
var version = "dev"

func main() {
	listen := flag.String("listen", "127.0.0.1:4000", "address to listen on")
	flag.Parse()

	log.Printf("blok-server %s listening on %s", version, *listen)

	if err := http.ListenAndServe(*listen, httpapi.New(httpapi.Options{Version: version})); err != nil {
		log.Fatal(err)
	}
}
