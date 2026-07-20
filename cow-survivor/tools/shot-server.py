import http.server, base64, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n).decode()
        # body is a dataURL: data:image/jpeg;base64,XXXX  OR raw base64
        if ',' in body[:50]:
            body = body.split(',', 1)[1]
        try:
            data = base64.b64decode(body)
            open('/tmp/shot.jpg', 'wb').write(data)
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'OK %d' % len(data))
        except Exception as e:
            self.send_response(500); self.end_headers(); self.wfile.write(str(e).encode())
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','*')
        self.end_headers()
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', 7799), H).serve_forever()
