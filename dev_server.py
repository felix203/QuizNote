"""
로컬 개발용 서버 (Vercel CLI 없이 바로 테스트하고 싶을 때)

실행
    pip install -r requirements.txt
    export OPENAI_API_KEY=sk-...        # Windows PowerShell: $env:OPENAI_API_KEY="sk-..."
    python dev_server.py
    → http://localhost:3000

하는 일
    - / 로 오는 요청은 프로젝트 폴더의 정적 파일(html/css/js/images)을 그대로 내려준다.
    - /api/quiz 로 오는 POST 요청은 api/quiz.py 의 로직으로 넘긴다.
      (Vercel 배포 환경에서 서버리스 함수가 하는 일을 흉내 낸 것)

주의
    이 파일은 개발 편의용이며 배포에는 쓰이지 않는다.
    Vercel은 api/ 폴더의 파일을 자동으로 엔드포인트로 만들기 때문에 이런 라우팅 코드가 필요 없다.
"""

import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "api"))

from quiz import handle_request, MAX_BODY_BYTES  # noqa: E402

PORT = int(os.environ.get("PORT", 3000))


class DevHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path.rstrip("/") != "/api/quiz":
            self._json(404, {"ok": False, "error": "not_found", "message": "없는 경로입니다."})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0

        if length <= 0:
            self._json(400, {"ok": False, "error": "empty_body", "message": "요청 본문이 비어 있습니다."})
            return
        if length > MAX_BODY_BYTES:
            self._json(413, {"ok": False, "error": "too_long", "message": "요청이 너무 큽니다."})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._json(400, {"ok": False, "error": "bad_json", "message": "요청 형식이 올바르지 않습니다."})
            return

        status, response = handle_request(payload)
        self._json(status, response)

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    if not os.environ.get("OPENAI_API_KEY"):
        print("⚠️  OPENAI_API_KEY 가 설정되지 않았습니다. 화면은 뜨지만 퀴즈 생성은 500 오류가 납니다.\n")

    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"▶ http://localhost:{PORT} 에서 실행 중입니다. (Ctrl+C 로 종료)")
    ThreadingHTTPServer(("0.0.0.0", PORT), DevHandler).serve_forever()
