"""개발용 정적 서버. 모듈이 캐시되지 않도록 no-store 헤더를 붙인다.

tools/baseline.html이 계산한 기준 연도 결과(data/baseline.json, data/baseline.bin)를
PUT으로 받아 저장하는 기능도 있다. 이 두 경로 말고는 쓰기를 받지 않는다.

실행: python tools/serve.py [포트]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WRITABLE = {"/data/baseline.json", "/data/baseline.bin"}


class DevHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_PUT(self):
        if self.path not in WRITABLE:
            self.send_error(403, "write not allowed")
            return
        n = int(self.headers.get("Content-Length", 0))
        (ROOT / self.path.lstrip("/")).write_bytes(self.rfile.read(n))
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(DevHandler, directory=str(ROOT))
    print(f"http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
