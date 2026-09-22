"""
퀴즈노트 — AI 퀴즈 생성 API
Vercel Serverless Function (Python)

엔드포인트
    POST /api/quiz

역할
    브라우저에서 받은 강의노트를 OpenAI API에 보내 문제를 생성하고, 검증된 JSON을 돌려준다.
    API 키는 이 파일(서버)에서만 읽으므로, 브라우저에는 절대 노출되지 않는다.

요청 본문 (JSON)
    {
      "notes": "강의노트 본문",            # 필수, 30 ~ 8000자
      "difficulty": "easy|normal|hard",   # 선택, 기본 normal
      "count": 5,                         # 선택, 3 ~ 10, 기본 5
      "types": ["multiple", "ox", "short"]# 선택, 기본 전체
    }

응답 본문 (JSON)
    성공 200 → { "ok": true, "topic": "...", "quizzes": [ ... ] }
    실패     → { "ok": false, "error": "코드", "message": "사용자에게 보여줄 안내" }

환경 변수
    OPENAI_API_KEY   (필수)  API 키
    OPENAI_BASE_URL  (선택)  기본값 https://api.openai.com/v1
                             OpenAI 호환 프록시를 쓸 때 그 주소를 넣는다.
    OPENAI_MODEL     (선택)  기본값 gpt-4o-mini
"""

from http.server import BaseHTTPRequestHandler
import json
import os

import requests

# ---------------------------------------------------------------------------
# 설정값
# ---------------------------------------------------------------------------
MIN_NOTES_LEN = 30
MAX_NOTES_LEN = 8000
MIN_COUNT = 3
MAX_COUNT = 10
MAX_BODY_BYTES = 200_000          # 본문 크기 상한 (약 200KB)
UPSTREAM_TIMEOUT = (5, 45)        # (연결 타임아웃, 읽기 타임아웃) 초

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-4o-mini"


def chat_completions_url() -> str:
    """
    호출할 엔드포인트 주소를 만든다.

    OpenAI 본사 API 대신 OpenAI 호환 프록시(사내/교육용 게이트웨이 등)를 쓰는 경우가 있어
    베이스 주소를 환경 변수로 뺐다. OPENAI_BASE_URL 을 지정하지 않으면 OpenAI 본사로 간다.

    예)
        OPENAI_BASE_URL=https://api.openai.com/v1          → 본사
        OPENAI_BASE_URL=https://example.com/v1             → 호환 프록시
    """
    base = (os.environ.get("OPENAI_BASE_URL") or DEFAULT_BASE_URL).strip().rstrip("/")

    # 주소 끝에 이미 /chat/completions 까지 적어 둔 경우도 그대로 받아준다.
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"

VALID_TYPES = ("multiple", "ox", "short")
VALID_DIFFICULTY = ("easy", "normal", "hard")

DIFFICULTY_GUIDE = {
    "easy": "용어의 정의와 사실 확인 위주로 낸다. 노트를 한 번 읽은 사람이 풀 수 있어야 한다.",
    "normal": "개념의 이해와 원리를 확인한다. 단순 암기보다 '왜 그런가'를 묻는다.",
    "hard": "개념 간 비교, 조건이 바뀔 때의 결과, 사례 적용을 묻는다. 헷갈리기 쉬운 지점을 노린다.",
}

TYPE_GUIDE = {
    "multiple": "multiple(객관식): choices 에 보기 4개를 넣는다. 오답은 명백히 틀린 것이 아니라 헷갈릴 만한 것으로 만든다.",
    "ox": 'ox(O/X): choices 는 ["O", "X"] 로 고정하고, answer 는 "O" 또는 "X" 로만 쓴다.',
    "short": "short(주관식): choices 는 빈 배열로 두고, answer 는 한 단어 또는 한 문장으로 짧게 쓴다.",
}


# ---------------------------------------------------------------------------
# 프롬프트
# ---------------------------------------------------------------------------
def build_system_prompt(difficulty: str, count: int, types: list) -> str:
    type_lines = "\n".join(f"- {TYPE_GUIDE[t]}" for t in types)

    return f"""너는 학생이 제출한 강의노트만 보고 시험 문제를 만드는 출제자다.

[가장 중요한 규칙]
- 노트에 적힌 내용 안에서만 출제한다. 노트에 없는 일반 상식이나 배경 지식으로 문제를 만들지 않는다.
- 근거가 부족하면 요청받은 개수보다 적게 만들어도 된다. 억지로 채우지 않는다.
- 노트에 쓰인 언어를 그대로 따른다. 한국어 노트면 한국어로, 영어 노트면 영어로 출제한다.

[난이도]
{DIFFICULTY_GUIDE.get(difficulty, DIFFICULTY_GUIDE["normal"])}

[문제 유형] — 아래 유형만 사용하고, 요청한 개수 안에서 골고루 섞는다.
{type_lines}

[출제 품질]
- 같은 개념을 두 번 묻지 않는다.
- 질문만 읽고도 무엇을 묻는지 알 수 있게 쓴다. "다음 중 옳은 것은?" 처럼 맥락 없는 표현은 피한다.
- explanation 에는 왜 그 답이 맞는지를 1~2문장으로 쓴다.
- evidence 에는 노트에서 근거가 된 부분을 20자 내외로 인용하거나 요약한다.

[출력 형식] — 반드시 아래 구조의 JSON 객체 하나만 출력한다. 설명이나 마크다운을 덧붙이지 않는다.
{{
  "topic": "노트 전체를 아우르는 주제 (15자 이내)",
  "quizzes": [
    {{
      "no": 1,
      "type": "multiple",
      "question": "질문 문장",
      "choices": ["보기1", "보기2", "보기3", "보기4"],
      "answer": "정답",
      "explanation": "왜 그 답인지 1~2문장",
      "evidence": "노트에서 근거가 된 부분"
    }}
  ]
}}

quizzes 배열에는 최대 {count}개를 담는다."""


def build_user_prompt(notes: str, count: int) -> str:
    return f"다음 강의노트를 읽고 문제 {count}개를 만들어라.\n\n---\n{notes}\n---"


# ---------------------------------------------------------------------------
# 입력 검증
# ---------------------------------------------------------------------------
class InputError(Exception):
    """사용자 입력이 규격에 맞지 않을 때 발생. (status, code, message)"""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def validate(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise InputError(400, "bad_request", "요청 형식이 올바르지 않습니다.")

    # notes ------------------------------------------------------------------
    notes = payload.get("notes")
    if not isinstance(notes, str) or not notes.strip():
        raise InputError(400, "empty_notes", "강의노트를 입력해 주세요.")

    notes = notes.strip()
    if len(notes) < MIN_NOTES_LEN:
        raise InputError(
            400,
            "too_short",
            f"문제를 만들기엔 내용이 너무 짧아요. {MIN_NOTES_LEN}자 이상 입력해 주세요. (현재 {len(notes)}자)",
        )
    if len(notes) > MAX_NOTES_LEN:
        raise InputError(
            413,
            "too_long",
            f"노트가 너무 깁니다. {MAX_NOTES_LEN:,}자 이하로 나눠서 시도해 주세요. (현재 {len(notes):,}자)",
        )

    # difficulty -------------------------------------------------------------
    difficulty = payload.get("difficulty", "normal")
    if difficulty not in VALID_DIFFICULTY:
        difficulty = "normal"

    # count ------------------------------------------------------------------
    try:
        count = int(payload.get("count", 5))
    except (TypeError, ValueError):
        count = 5
    count = max(MIN_COUNT, min(MAX_COUNT, count))

    # types ------------------------------------------------------------------
    types = payload.get("types")
    if not isinstance(types, list):
        types = list(VALID_TYPES)
    types = [t for t in types if t in VALID_TYPES]
    if not types:
        raise InputError(400, "no_type", "문제 유형을 최소 하나 선택해 주세요.")

    return {"notes": notes, "difficulty": difficulty, "count": count, "types": types}


# ---------------------------------------------------------------------------
# 응답 정규화
#   모델이 형식을 살짝 어겨도 프론트가 깨지지 않도록 서버에서 한 번 정리한다.
# ---------------------------------------------------------------------------
def normalize(raw: dict, allowed_types: list, count: int) -> dict:
    quizzes_raw = raw.get("quizzes")
    if not isinstance(quizzes_raw, list):
        quizzes_raw = []

    quizzes = []
    for item in quizzes_raw:
        if not isinstance(item, dict):
            continue

        question = str(item.get("question", "")).strip()
        answer = str(item.get("answer", "")).strip()
        if not question or not answer:
            continue  # 질문이나 정답이 비면 버린다

        qtype = item.get("type")
        if qtype not in allowed_types:
            qtype = allowed_types[0]

        choices = item.get("choices")
        if not isinstance(choices, list):
            choices = []
        choices = [str(c).strip() for c in choices if str(c).strip()]

        if qtype == "ox":
            choices = ["O", "X"]
            answer = "O" if answer.upper().startswith(("O", "T", "참")) else "X"
        elif qtype == "short":
            choices = []
        elif len(choices) < 2:
            continue  # 객관식인데 보기가 없으면 쓸 수 없다

        quizzes.append(
            {
                "no": len(quizzes) + 1,
                "type": qtype,
                "question": question,
                "choices": choices,
                "answer": answer,
                "explanation": str(item.get("explanation", "")).strip(),
                "evidence": str(item.get("evidence", "")).strip(),
            }
        )

        if len(quizzes) >= count:
            break

    topic = str(raw.get("topic", "")).strip()[:40]
    return {"ok": True, "topic": topic, "quizzes": quizzes}


# ---------------------------------------------------------------------------
# OpenAI 호출
# ---------------------------------------------------------------------------
def call_openai(params: dict) -> dict:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        # 배포 환경에 환경 변수를 등록하지 않은 경우
        raise InputError(500, "missing_key", "서버 설정에 문제가 있습니다. 잠시 후 다시 시도해 주세요.")

    model = os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)

    url = chat_completions_url()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    def body(json_mode: bool) -> dict:
        b = {
            "model": model,
            "messages": [
                {"role": "system", "content": build_system_prompt(params["difficulty"], params["count"], params["types"])},
                {"role": "user", "content": build_user_prompt(params["notes"], params["count"])},
            ],
            "temperature": 0.7,
            "max_tokens": 2600,
        }
        if json_mode:
            # OpenAI JSON 모드. 호환 프록시 중에는 이 옵션을 모르는 곳이 있어 실패 시 빼고 재시도한다.
            b["response_format"] = {"type": "json_object"}
        return b

    def post(json_mode: bool):
        try:
            return requests.post(url, headers=headers, json=body(json_mode), timeout=UPSTREAM_TIMEOUT)
        except requests.exceptions.Timeout:
            raise InputError(504, "upstream_timeout", "AI 응답이 너무 늦어졌습니다. 노트를 줄이거나 문제 수를 줄여 다시 시도해 주세요.")
        except requests.exceptions.RequestException:
            raise InputError(502, "upstream_unreachable", "AI 서버에 연결하지 못했습니다. 주소 설정과 네트워크를 확인해 주세요.")

    res = post(True)

    # response_format 을 지원하지 않는 서버라면 400을 준다. 한 번만 빼고 다시 시도한다.
    if res.status_code == 400 and "response_format" in res.text:
        print("[quiz] response_format 미지원으로 판단, JSON 모드 없이 재시도")
        res = post(False)

    # --- 상태 코드별 처리 ---------------------------------------------------
    if res.status_code in (401, 403):
        print(f"[quiz] auth {res.status_code} at {url}: {res.text[:200]}")
        raise InputError(502, "upstream_auth", "AI 서비스 인증에 실패했습니다. API 키와 주소 설정을 확인해 주세요.")
    if res.status_code == 404:
        print(f"[quiz] 404 at {url}")
        raise InputError(502, "upstream_not_found", "AI 서버 주소가 올바르지 않습니다. OPENAI_BASE_URL 설정을 확인해 주세요.")
    if res.status_code == 429:
        raise InputError(429, "rate_limited", "요청이 몰리고 있어요. 30초 정도 뒤에 다시 시도해 주세요.")
    if res.status_code >= 500:
        print(f"[quiz] upstream {res.status_code} at {url}")
        raise InputError(502, "upstream_error", "AI 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.")
    if res.status_code >= 400:
        # 400대 나머지 (잘못된 모델명, 컨텍스트 초과 등). 내부 메시지는 화면에 노출하지 않는다.
        print(f"[quiz] upstream {res.status_code} at {url}: {res.text[:300]}")
        raise InputError(502, "upstream_bad_request", "AI 요청이 거부되었습니다. 모델 이름과 노트 길이를 확인해 주세요.")

    # --- 본문 파싱 ----------------------------------------------------------
    try:
        content = res.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        print(f"[quiz] 예상과 다른 응답 구조: {res.text[:300]}")
        raise InputError(502, "bad_upstream_json", "AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.")

    parsed = extract_json(content)
    if not isinstance(parsed, dict):
        print(f"[quiz] JSON 추출 실패: {str(content)[:300]}")
        raise InputError(502, "bad_upstream_json", "AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.")

    return parsed


def extract_json(content: str):
    """
    모델 응답에서 JSON 객체를 꺼낸다.

    JSON 모드를 쓰면 보통 본문 전체가 JSON이지만, 프록시가 JSON 모드를 지원하지 않으면
    ```json ... ``` 코드블록으로 감싸서 오거나 앞뒤에 설명이 붙어 오기도 한다.
    그래서 그대로 파싱해 보고, 실패하면 가장 바깥 중괄호 구간만 잘라 다시 시도한다.
    """
    if not isinstance(content, str):
        return None

    text = content.strip()

    # ```json ... ``` 코드블록 벗기기
    if text.startswith("```"):
        text = text.split("```")[1] if len(text.split("```")) > 1 else text
        if text.lstrip().lower().startswith("json"):
            text = text.lstrip()[4:]
        text = text.strip()

    try:
        return json.loads(text)
    except ValueError:
        pass

    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except ValueError:
            return None
    return None


# ---------------------------------------------------------------------------
# 요청 처리의 본체 — HTTP 계층과 분리해 두어 테스트하기 쉽게 만든다.
# ---------------------------------------------------------------------------
def handle_request(payload: dict) -> tuple:
    """(status_code, response_dict) 를 돌려준다."""
    try:
        params = validate(payload)
        raw = call_openai(params)
        result = normalize(raw, params["types"], params["count"])
        # 노트 본문은 로그에 남기지 않는다. 길이와 결과 개수만 기록한다.
        print(f"[quiz] ok len={len(params['notes'])} count={len(result['quizzes'])}")
        return 200, result
    except InputError as e:
        return e.status, {"ok": False, "error": e.code, "message": e.message}
    except Exception as e:  # 예상하지 못한 오류
        print(f"[quiz] unexpected: {type(e).__name__}")
        return 500, {"ok": False, "error": "internal", "message": "알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."}


# ---------------------------------------------------------------------------
# Vercel 진입점
# ---------------------------------------------------------------------------
class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0

        if length <= 0:
            self._send(400, {"ok": False, "error": "empty_body", "message": "요청 본문이 비어 있습니다."})
            return

        if length > MAX_BODY_BYTES:
            self._send(413, {"ok": False, "error": "too_long", "message": "요청이 너무 큽니다. 노트를 나눠서 시도해 주세요."})
            return

        raw = self.rfile.read(length)

        try:
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send(400, {"ok": False, "error": "bad_json", "message": "요청 형식이 올바르지 않습니다."})
            return

        status, response = handle_request(payload)
        self._send(status, response)

    def do_GET(self):
        # 브라우저 주소창으로 직접 열어봤을 때를 위한 안내
        self._send(405, {"ok": False, "error": "method_not_allowed", "message": "이 엔드포인트는 POST 요청만 받습니다."})

    def log_message(self, fmt, *args):
        # 기본 접근 로그를 끈다 (본문 노출 방지 및 로그 소음 감소)
        return
