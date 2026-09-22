# 퀴즈노트 (QuizNote)

> 강의노트를 붙여넣으면 AI가 시험 문제와 해설을 만들어 주는 웹 서비스

읽기만 반복하는 공부는 내용을 **익숙하게** 만들 뿐 기억에서 꺼내는 힘을 길러주지 못합니다.
퀴즈노트는 학생이 이미 가진 노트에서 곧바로 문제를 뽑아내, 그 확인 과정을 30초로 줄입니다.

**배포 URL**: [https://quiz-note-blue.vercel.app/quiz.html]

---

## 목차

- [주요 기능](#주요-기능)
- [기술 스택](#기술-스택)
- [프로젝트 구조](#프로젝트-구조)
- [동작 구조](#동작-구조)
- [환경 변수 설정](#환경-변수-설정)
- [로컬에서 실행하기](#로컬에서-실행하기)
- [배포하기 (Vercel)](#배포하기-vercel)
- [API 명세](#api-명세)
- [실패 처리](#실패-처리)
- [보안 주의사항](#보안-주의사항)
- [문제 해결](#문제-해결)

---

## 주요 기능

| 기능 | 설명 |
|---|---|
| **AI 퀴즈 생성** | 강의노트를 입력하면 객관식·OX·주관식 문제와 해설, 노트 근거를 생성 |
| 난이도 / 문제 수 선택 | 쉬움·보통·어려움, 3~10개 |
| **직접 풀이 · 자동 채점** | 객관식·OX는 보기 버튼으로 선택, 주관식은 직접 입력. 즉시 정오 판정과 해설 표시 |
| 점수 집계 | 상단 진행 막대에 푼 개수·맞은 개수·최종 정답률 표시 |
| 다시 풀기 | 문항별 또는 전체를 처음 상태로 되돌려 재도전 |
| 결과 복사 / 저장 | 마크다운 복사, `.txt` 다운로드, 인쇄(PDF) 지원 |
| 다크 모드 | 라이트/다크 토글, 시스템 설정 자동 감지, `localStorage` 저장 |
| 반응형 | 모바일(390px) · 태블릿(820px) · 데스크톱(1440px) 대응 |
| 실패 안내 | 빈 입력 / API 오류 / 타임아웃 모두 사용자 친화적 메시지로 안내 |

페이지는 4개입니다: **홈 · 퀴즈 만들기 · 사용법 · 소개**

---

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 프론트엔드 | HTML5, CSS3, Vanilla JavaScript (ES6+) — 프레임워크·빌드 도구 없음 |
| 백엔드 | Vercel Serverless Functions (Python 3.12, `BaseHTTPRequestHandler`) |
| AI | OpenAI Chat Completions API (`gpt-4o-mini`, JSON 응답 모드) |
| HTTP 클라이언트 | `requests` |
| 배포 | Vercel (GitHub 연동 자동 배포) |

---

## 프로젝트 구조

```
quiznote/
├── index.html              # 홈 — 서비스 소개
├── quiz.html               # 퀴즈 만들기 (AI 핵심 기능)
├── guide.html              # 사용법 · FAQ
├── about.html              # 소개 · 기술 구조 · 개인정보 처리
│
├── css/
│   └── style.css           # 전체 스타일 (디자인 토큰 · 다크 모드 · 반응형)
│
├── js/
│   ├── main.js             # 공통 — 다크 모드, 모바일 메뉴, 토스트
│   └── quiz.js             # 퀴즈 페이지 — 검증, fetch, 렌더링, 오류 처리
│
├── api/
│   └── quiz.py             # ★ Vercel Serverless Function (Python)
│
├── images/
│   └── favicon.svg
│
├── docs/
│   ├── 기획서.md            # 서비스 기획서
│   └── screenshots/        # 증빙 스크린샷
│
├── dev_server.py           # 로컬 개발용 서버 (배포에는 사용되지 않음)
├── requirements.txt        # Python 의존성
├── vercel.json             # Vercel 설정 (런타임, 함수 타임아웃)
├── .env.example            # 필요한 환경 변수 예시
└── .gitignore
```

**프론트엔드와 백엔드의 경계**

- `index.html` / `css/` / `js/` / `images/` → 브라우저에서 실행되는 정적 자원
- `api/` → 서버에서만 실행되는 코드. **API 키는 여기서만 읽습니다.**

---

## 동작 구조

```
브라우저 (quiz.html + js/quiz.js)
    │  ① 사용자가 노트 입력 → 프론트 유효성 검사 (빈 값·길이·유형)
    │
    │  ② fetch('/api/quiz', { method: 'POST', body: JSON })
    ▼
Vercel Serverless Function (api/quiz.py)
    │  ③ 환경 변수에서 OPENAI_API_KEY 를 읽음  ← 브라우저는 이 값을 볼 수 없음
    │  ④ 프롬프트 구성 후 AI API 호출 (읽기 타임아웃 50초)
    ▼
OpenAI Chat Completions API
    │  ⑤ JSON 모드로 문제 생성
    ▲
    │  ⑥ 응답 검증·정규화 (불량 문항 제거, 번호 재부여)
    │
브라우저
       ⑦ 문제 카드로 렌더링 → 사용자가 직접 풀면 화면에서 즉시 채점
```

**왜 백엔드가 필요한가?**
브라우저에서 직접 OpenAI를 호출하면 API 키가 개발자 도구의 Network 탭에 그대로 노출됩니다.
누구나 그 키를 복사해 쓸 수 있고, 요금은 키 주인에게 청구됩니다.
그래서 키를 아는 코드는 서버(`api/quiz.py`)에만 두고, 브라우저는 우리 서버만 호출합니다.

---

## 환경 변수 설정

| 이름 | 필수 | 설명 | 예시 |
|---|:---:|---|---|
| `OPENAI_API_KEY` | ✅ | API 키 | `sk-proj-xxxxxxxx...` |
| `OPENAI_BASE_URL` | ❌ | API 서버 주소. 비우면 `https://api.openai.com/v1` | `https://프록시주소/v1` |
| `OPENAI_MODEL` | ❌ | 사용할 모델. 비우면 `gpt-4o-mini` | `gpt-4o-mini` |
| `OPENAI_PARAM_STYLE` | ❌ | 파라미터 조합 고정. 비우면 자동 탐색 | `gpt5` |

> **모델마다 받는 파라미터가 다릅니다**
> GPT-4 계열은 `max_tokens` 와 `temperature` 를 받지만, GPT-5 계열은
> `max_completion_tokens` 를 쓰고 `temperature` 조절을 허용하지 않습니다.
> 호환 프록시 중에는 `response_format`(JSON 모드) 자체를 모르는 곳도 있습니다.
> 그래서 서버가 400을 주면 조합을 단계적으로 줄이며 자동으로 맞는 것을 찾습니다.
> 터미널에 `'gpt5' 조합에서 성공` 이 뜨면 `OPENAI_PARAM_STYLE=gpt5` 로 고정해
> 불필요한 실패 요청을 없앨 수 있습니다.

> **OpenAI 호환 프록시를 쓰는 경우**
> 학교·회사에서 제공하는 게이트웨이처럼 OpenAI와 같은 규격이지만 주소만 다른 서버를 쓴다면
> `OPENAI_BASE_URL` 에 그 주소(보통 `.../v1` 까지)를 넣으세요.
> 코드가 뒤에 `/chat/completions` 를 붙여 호출합니다.
> 주소를 지정하지 않으면 OpenAI 본사로 가고, 본사 키가 아니면 `invalid_api_key` 로 거부됩니다.

### 1) 키 발급

1. https://platform.openai.com/api-keys 접속
2. **Create new secret key** 클릭
3. 생성된 키를 복사 (창을 닫으면 다시 볼 수 없습니다)
4. Billing 에 결제 수단이 등록되어 있어야 호출이 됩니다

### 2) 로컬 설정

프로젝트 루트에 `.env.example` 을 복사해 `.env` 를 만들고 값을 채웁니다.

```bash
cp .env.example .env
```

`dev_server.py` 는 실행할 때 이 `.env` 파일을 자동으로 읽습니다.
또는 셸에서 직접 지정해도 됩니다. (셸 값이 `.env` 보다 우선합니다)

```bash
# macOS / Linux
export OPENAI_API_KEY="sk-..."

# Windows PowerShell — export 가 아니라 $env: 입니다
$env:OPENAI_API_KEY="sk-..."

# Windows 명령 프롬프트(cmd)
set OPENAI_API_KEY=sk-...
```

> `.env` 는 `.gitignore` 에 등록되어 있어 커밋되지 않습니다.

### 3) Vercel 설정 (배포 환경)

1. Vercel 프로젝트 → **Settings** → **Environment Variables**
2. `OPENAI_API_KEY` 이름으로 키 값을 추가
3. **Production / Preview / Development** 세 환경에 모두 체크
4. **Save** 후 **Deployments** 탭에서 최신 배포를 **Redeploy**

> 환경 변수는 빌드 시점에 주입되므로, 추가한 뒤 반드시 재배포해야 적용됩니다.

---

## 로컬에서 실행하기

### 방법 A — 포함된 개발 서버 (Vercel CLI 없이)

```bash
# 1. 의존성 설치
pip install -r requirements.txt

# 2. 환경 변수 지정
export OPENAI_API_KEY="sk-..."

# 3. 실행
python dev_server.py
```

→ 브라우저에서 http://localhost:3000 접속

`dev_server.py` 는 정적 파일을 서빙하면서 `/api/quiz` POST 요청을 `api/quiz.py` 의 로직으로 넘깁니다.
즉 Vercel이 배포 환경에서 자동으로 해주는 라우팅을 로컬에서 흉내 낸 것입니다.

### 방법 B — Vercel CLI (실제 배포 환경과 동일)

```bash
npm i -g vercel
vercel dev
```

→ http://localhost:3000

`vercel dev` 는 `vercel.json` 설정과 서버리스 런타임을 그대로 재현하므로,
**배포 전 최종 확인은 이 방법을 권장합니다.**

### 로컬과 배포 환경의 차이

| 항목 | 로컬 | Vercel |
|---|---|---|
| API 라우팅 | `dev_server.py` 가 직접 분기 | `api/` 폴더 구조로 자동 생성 |
| 환경 변수 | `.env` 또는 셸 변수 | Vercel 대시보드에 등록한 값 |
| 실행 방식 | 프로세스가 계속 떠 있음 | 요청마다 함수가 새로 뜸 (콜드 스타트) |
| 함수 실행 시간 | 제한 없음 | `vercel.json` 의 `maxDuration` (60초) |
| 프로토콜 | `http://` | `https://` |

---

## 배포하기 (Vercel)

### 1) GitHub에 올리기

```bash
git init
git add .
git commit -m "feat: 퀴즈노트 초기 버전"
git branch -M main
git remote add origin https://github.com/<사용자명>/quiznote.git
git push -u origin main
```

### 2) Vercel에 연결

1. https://vercel.com 에서 GitHub 계정으로 로그인
2. **Add New...** → **Project**
3. 방금 올린 저장소를 **Import**
4. Framework Preset: **Other** (빌드 명령 없음, Root Directory 는 기본값)
5. **Environment Variables** 에 `OPENAI_API_KEY` 추가
6. **Deploy**

### 3) 동작 확인

배포 URL에 접속해 다음을 확인합니다.

- [ ] 4개 페이지 이동이 모두 되는가
- [ ] 모바일 폭에서 햄버거 메뉴가 열리고 레이아웃이 깨지지 않는가
- [ ] 다크 모드 토글이 동작하고 새로고침해도 유지되는가
- [ ] 빈 상태로 **퀴즈 생성하기** → 안내 메시지가 뜨는가
- [ ] **예시 노트 넣기** → **퀴즈 생성하기** → 문제가 나오는가
- [ ] 개발자 도구 Network 탭에서 `/api/quiz` 요청에 **API 키가 보이지 않는가**

### 4) 수정 후 재배포

```bash
git add .
git commit -m "fix: 오류 메시지 문구 수정"
git push
```

`main` 브랜치에 push 하면 Vercel이 자동으로 다시 배포합니다. (보통 1분 이내)

---

## API 명세

### `POST /api/quiz`

**요청**

```json
{
  "notes": "선점형 스케줄링은 OS가 실행 중인 프로세스에게서 CPU를 회수할 수 있는 방식이다...",
  "difficulty": "normal",
  "count": 5,
  "types": ["multiple", "ox", "short"]
}
```

| 필드 | 타입 | 필수 | 제약 |
|---|---|:---:|---|
| `notes` | string | ✅ | 30 ~ 8,000자 |
| `difficulty` | string | ❌ | `easy` / `normal` / `hard` (기본 `normal`) |
| `count` | number | ❌ | 3 ~ 10 (기본 5, 범위를 벗어나면 자동 보정) |
| `types` | string[] | ❌ | `multiple` / `ox` / `short` (기본 전체) |

**성공 응답 `200`**

```json
{
  "ok": true,
  "topic": "CPU 스케줄링",
  "quizzes": [
    {
      "no": 1,
      "type": "multiple",
      "question": "다음 중 선점형 스케줄링에 해당하는 것은?",
      "choices": ["FCFS", "SJF(비선점)", "Round Robin", "우선순위(비선점)"],
      "answer": "Round Robin",
      "explanation": "타임 퀀텀이 만료되면 OS가 CPU를 강제로 회수하므로 선점형이다.",
      "evidence": "타임 퀀텀 만료 시 준비 큐 맨 뒤로 보냄"
    }
  ]
}
```

**실패 응답**

```json
{ "ok": false, "error": "too_short", "message": "문제를 만들기엔 내용이 너무 짧아요. 30자 이상 입력해 주세요. (현재 12자)" }
```

`message` 는 그대로 사용자에게 보여줄 수 있도록 작성되어 있습니다.

---

## 실패 처리

과제 요구사항의 3가지(빈 입력 / API 오류 / 타임아웃)를 **모두** 구현했습니다.

| 상황 | 처리 위치 | 상태 코드 | 사용자에게 보이는 메시지 |
|---|---|:---:|---|
| 빈 입력 | 프론트 (요청 전 차단) | — | 강의노트를 먼저 붙여넣어 주세요. |
| 30자 미만 | 프론트 + 백엔드 | 400 | 내용이 너무 짧아요. 30자 이상 입력해 주세요. |
| 8,000자 초과 | 프론트 + 백엔드 | 413 | 노트가 너무 깁니다. 나눠서 시도해 주세요. |
| 유형 미선택 | 프론트 | — | 문제 유형을 최소 하나 선택해 주세요. |
| 서버 키 미설정 | 백엔드 | 500 | 서버 설정에 문제가 있습니다. |
| OpenAI 인증 실패 | 백엔드 | 502 | AI 서비스 인증에 실패했습니다. |
| 호출 한도 초과 | 백엔드 | 429 | 요청이 몰리고 있어요. 30초 뒤에 다시 시도해 주세요. |
| AI 서버 오류 | 백엔드 | 502 | AI 서버가 응답하지 않습니다. |
| 응답 지연 | 백엔드 50초 / 프론트 55초 | 504 | 응답이 너무 늦어졌습니다. 노트나 문제 수를 줄여 주세요. |
| 응답 형식 오류 | 백엔드 | 502 | AI 응답 형식이 올바르지 않습니다. |
| 네트워크 끊김 | 프론트 | — | 서버에 연결하지 못했습니다. |

**공통 원칙**

- 오류가 나도 **입력한 노트는 지우지 않습니다.**
- 요청 중에는 버튼을 비활성화해 중복 호출(=중복 과금)을 막습니다.
- 내부 오류 메시지(스택 트레이스, 키, 내부 URL)는 화면에 노출하지 않습니다.

---

## 보안 주의사항

- **API 키는 환경 변수로만 관리합니다.** 코드·README·스크린샷 어디에도 키를 넣지 마세요.
- `.env` 는 `.gitignore` 에 등록되어 있습니다. 커밋 전 `git status` 로 확인하세요.
- 키가 노출된 것 같다면:
  1. https://platform.openai.com/api-keys 에서 해당 키를 **즉시 폐기(Revoke)**
  2. 새 키를 발급해 Vercel 환경 변수를 교체하고 재배포
  3. 커밋 이력에 남았다면 `git filter-repo` 등으로 이력을 정리하거나, 저장소를 새로 만드세요
     (한 번 push 된 키는 이력에서 지워도 유출된 것으로 간주하고 반드시 폐기해야 합니다)
- AI API 호출에는 **실제 비용이 발생합니다.** OpenAI 대시보드에서 usage limit 을 설정해 두세요.

---

## 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| 배포 후 500 오류 | 환경 변수 미등록 | Vercel Settings 에 `OPENAI_API_KEY` 추가 후 **Redeploy** |
| 환경 변수를 넣었는데도 500 | 재배포를 하지 않음 | Deployments → ⋯ → Redeploy |
| `/api/quiz` 404 | 파일 위치가 잘못됨 | `api/quiz.py` 경로와 `handler` 클래스 이름 확인 |
| `invalid_api_key` | 키가 해당 서버의 것이 아님 | 키 발급처와 `OPENAI_BASE_URL` 이 짝이 맞는지 확인 |
| `unsupported_feature` / `Requested feature is not supported` | 모델이 안 받는 파라미터를 보냄 | 자동 재시도로 해결됨. 계속 실패하면 `OPENAI_MODEL` 이름 확인 |
| 502 인증 실패 | 키가 잘못됐거나 폐기됨 | 키 재발급 후 환경 변수 교체 |
| 주소가 올바르지 않다는 안내 (404) | `OPENAI_BASE_URL` 경로 오류 | `.../v1` 까지만 넣었는지 확인 |
| PowerShell에서 `export` 오류 | bash 문법을 씀 | `$env:이름="값"` 으로 지정 |
| 429 | 무료 크레딧 소진 또는 호출 과다 | OpenAI Billing 확인, 잠시 후 재시도 |
| 로컬은 되는데 배포는 안 됨 | 로컬 `.env` 값만 있고 Vercel 에 없음 | Vercel 환경 변수 등록 |
| 함수 타임아웃 | 노트가 너무 길거나 문제 수가 많음 | 노트를 줄이거나 `vercel.json` 의 `maxDuration` 조정 |

---

## 라이선스 및 안내

학습 목적으로 만든 개인 프로젝트입니다.
AI가 생성한 문제는 복습 보조 도구이며 공식 기출문제가 아닙니다.
입력한 노트는 서버에 저장되지 않지만 OpenAI 서버로 전송되므로, 기밀 자료는 입력하지 마세요.
