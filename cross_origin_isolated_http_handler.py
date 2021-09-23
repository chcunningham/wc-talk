#!/usr/bin/env python

# Overrides SimpleHTTPRequestHandler to serve requests w/ COOP and COEP, which
# enables access to SharedArrayBuffer and Atomics.
# credit: https://stackoverflow.com/questions/12499171/can-i-set-a-header-with-pythons-simplehttpserver

try:
    from http import server # Python 3
except ImportError:
    import SimpleHTTPServer as server # Python 2

class CrossOriginIsolatedHttpRequestHandler(server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_my_headers()

        server.SimpleHTTPRequestHandler.end_headers(self)

    def send_my_headers(self):
        # self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")


if __name__ == '__main__':
    server.test(HandlerClass=CrossOriginIsolatedHttpRequestHandler)