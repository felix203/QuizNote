/* ==========================================================================
   퀴즈노트 — AI 퀴즈 생성 페이지 스크립트
   흐름: 입력 → (프론트 검증) → fetch('/api/quiz') → 응답 렌더링 / 오류 안내
   ========================================================================== */

/* ---- 상수 ---------------------------------------------------------------- */
const MIN_LEN = 30;       // 최소 입력 길이
const MAX_LEN = 8000;     // 최대 입력 길이 (백엔드와 동일하게 맞춘다)
const TIMEOUT_MS = 25000; // 프론트 타임아웃. 백엔드(45초)보다 짧게 잡아 먼저 끊는다.

const TYPE_LABEL = { multiple: '객관식', ox: 'OX', short: '주관식' };

/* ---- DOM 참조 ------------------------------------------------------------ */
const form = document.getElementById('quiz-form');
const notesEl = document.getElementById('notes');
const counterEl = document.getElementById('counter');
const submitBtn = document.getElementById('submit-btn');
const submitLabel = document.getElementById('submit-label');
const alertBox = document.getElementById('alert-box');
const resultArea = document.getElementById('result-area');
const sampleBtn = document.getElementById('sample-btn');
const clearBtn = document.getElementById('clear-btn');

/** 마지막 생성 결과 — 복사/다운로드에 재사용한다. */
let lastResult = null;

/* ---- 샘플 노트 ------------------------------------------------------------ */
const SAMPLE_NOTE = `[운영체제 - CPU 스케줄링]

1. 스케줄링의 목적
- CPU 이용률 최대화, 처리량(throughput) 증가
- 대기시간, 응답시간, 반환시간 최소화
- 목표들이 서로 충돌하므로 상황에 따라 균형을 잡아야 한다.

2. 선점형과 비선점형
- 비선점형(Non-preemptive): 프로세스가 CPU를 스스로 반납할 때까지 뺏지 못한다.
  예) FCFS, SJF(비선점), 우선순위(비선점)
- 선점형(Preemptive): OS가 실행 중인 프로세스에게서 CPU를 강제로 회수할 수 있다.
  예) Round Robin, SRTF, 우선순위(선점)
- 선점형은 응답성이 좋지만 문맥 교환(context switch) 비용이 늘어난다.

3. 주요 알고리즘
- FCFS(First Come First Served): 도착 순서대로 처리. 구현이 단순하지만,
  긴 작업이 앞에 오면 뒤의 짧은 작업들이 오래 기다리는 호위 효과(convoy effect)가 생긴다.
- SJF(Shortest Job First): 실행 시간이 짧은 작업부터 처리. 평균 대기시간이 최소가 되지만
  실행 시간을 미리 알 수 없고, 긴 작업이 계속 밀리는 기아(starvation)가 발생한다.
- Round Robin: 각 프로세스에 타임 퀀텀(time quantum)을 할당하고, 만료되면 CPU를 회수해
  준비 큐 맨 뒤로 보낸다. 퀀텀이 너무 크면 FCFS처럼 동작하고, 너무 작으면
  문맥 교환 오버헤드가 커진다.
- 우선순위 스케줄링: 우선순위가 높은 프로세스부터 실행. 기아 문제는 오래 기다린
  프로세스의 우선순위를 점차 올려주는 에이징(aging)으로 완화한다.

4. 평가 지표
- 대기시간(Waiting time): 준비 큐에서 기다린 총 시간
- 응답시간(Response time): 요청 후 첫 응답이 나오기까지의 시간
- 반환시간(Turnaround time): 제출부터 완료까지의 총 시간`;

/* ==========================================================================
   유틸
   ========================================================================== */

/** 화면 상단에 오류/경고/안내 배너를 띄운다. */
function showAlert(type, title, message) {
  alertBox.innerHTML = '';

  const box = document.createElement('div');
  box.className = `alert alert--${type}`;
  box.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.className = 'alert__icon';
  icon.textContent = type === 'error' ? '⚠️' : type === 'warn' ? '⏳' : 'ℹ️';

  const body = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('span');
  p.textContent = message;
  body.append(strong, p);

  box.append(icon, body);
  alertBox.appendChild(box);
  alertBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function clearAlert() {
  alertBox.innerHTML = '';
  notesEl.classList.remove('is-invalid');
  notesEl.removeAttribute('aria-invalid');
}

/** 전송 중에는 버튼을 잠가 중복 호출(=중복 과금)을 막는다. */
function setLoading(on) {
  submitBtn.disabled = on;
  submitLabel.textContent = on ? '문제 만드는 중…' : '퀴즈 생성하기';
  const sp = submitBtn.querySelector('.spinner');
  if (on && !sp) {
    const s = document.createElement('span');
    s.className = 'spinner';
    submitBtn.prepend(s);
  } else if (!on && sp) {
    sp.remove();
  }
}

/** 로딩 중 결과 영역에 보여줄 스켈레톤 */
function renderSkeleton(count) {
  resultArea.innerHTML = '';
  for (let i = 0; i < Math.min(count, 3); i++) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    [70, 95, 88, 45].forEach((w) => {
      const line = document.createElement('div');
      line.className = 'skeleton-line';
      line.style.width = `${w}%`;
      card.appendChild(line);
    });
    resultArea.appendChild(card);
  }
}

function renderEmpty() {
  resultArea.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'result-empty';
  box.innerHTML =
    '<span class="emoji">📝</span>' +
    '<p style="margin:0 0 4px;font-weight:600;color:var(--text-muted)">아직 만든 문제가 없어요</p>' +
    '<p style="margin:0;font-size:0.9rem">왼쪽에 강의노트를 붙여넣고 <strong>퀴즈 생성하기</strong>를 눌러보세요.</p>';
  resultArea.appendChild(box);
}

/* ==========================================================================
   결과 렌더링
   ========================================================================== */

function renderResult(data) {
  lastResult = data;
  resultArea.innerHTML = '';

  const quizzes = Array.isArray(data.quizzes) ? data.quizzes : [];
  if (quizzes.length === 0) {
    showAlert(
      'warn',
      '문제를 만들지 못했어요',
      '노트에서 출제할 만한 내용을 찾지 못했습니다. 개념 설명이 담긴 부분을 조금 더 넣어 주세요.'
    );
    renderEmpty();
    return;
  }

  /* 결과 헤더 */
  const head = document.createElement('div');
  head.className = 'result-head';

  const h = document.createElement('h2');
  h.textContent = data.topic ? `${data.topic} · 문제 ${quizzes.length}개` : `생성된 문제 ${quizzes.length}개`;

  const actions = document.createElement('div');
  actions.className = 'result-actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn btn--ghost btn--sm';
  copyBtn.textContent = '전체 복사';
  copyBtn.addEventListener('click', copyAll);

  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.className = 'btn btn--ghost btn--sm';
  dlBtn.textContent = 'txt 저장';
  dlBtn.addEventListener('click', downloadTxt);

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'btn btn--ghost btn--sm';
  openBtn.textContent = '정답 모두 보기';
  openBtn.addEventListener('click', () => {
    const boxes = resultArea.querySelectorAll('.answer-box');
    const anyHidden = Array.from(boxes).some((b) => b.hidden);
    boxes.forEach((b) => {
      b.hidden = !anyHidden;
      const tg = b.previousElementSibling;
      if (tg && tg.classList.contains('answer-toggle')) {
        tg.textContent = anyHidden ? '정답 · 해설 접기' : '정답 · 해설 보기';
        tg.setAttribute('aria-expanded', String(anyHidden));
      }
    });
    openBtn.textContent = anyHidden ? '정답 모두 접기' : '정답 모두 보기';
  });

  actions.append(copyBtn, dlBtn, openBtn);
  head.append(h, actions);
  resultArea.appendChild(head);

  /* 문제 카드 */
  quizzes.forEach((q, i) => {
    resultArea.appendChild(buildCard(q, i));
  });

  resultArea.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function buildCard(q, index) {
  const card = document.createElement('article');
  card.className = 'quiz-card';
  card.style.animationDelay = `${index * 45}ms`;

  /* 상단: 번호 + 유형 배지 */
  const top = document.createElement('div');
  top.className = 'quiz-card__top';

  const no = document.createElement('span');
  no.className = 'quiz-card__no';
  no.textContent = `Q${q.no || index + 1}`;

  const type = ['multiple', 'ox', 'short'].includes(q.type) ? q.type : 'short';
  const badge = document.createElement('span');
  badge.className = `badge badge--${type}`;
  badge.textContent = TYPE_LABEL[type];

  top.append(no, badge);

  /* 질문 */
  const question = document.createElement('p');
  question.className = 'quiz-card__q';
  question.textContent = q.question || '(문항 없음)';

  card.append(top, question);

  /* 보기 */
  if (Array.isArray(q.choices) && q.choices.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'choices';
    q.choices.forEach((c, ci) => {
      const li = document.createElement('li');
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = type === 'ox' ? String(c).trim().charAt(0) : `${ci + 1}.`;
      const txt = document.createElement('span');
      txt.textContent = type === 'ox' ? '' : String(c);
      li.append(mark, txt);
      ul.appendChild(li);
    });
    card.appendChild(ul);
  }

  /* 정답/해설 (기본은 접힘 — 인출 연습을 위해 일부러 가린다) */
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'answer-toggle';
  toggle.textContent = '정답 · 해설 보기';
  toggle.setAttribute('aria-expanded', 'false');

  const answerBox = document.createElement('div');
  answerBox.className = 'answer-box';
  answerBox.hidden = true;

  answerBox.appendChild(row('정답', q.answer || '—'));
  if (q.explanation) answerBox.appendChild(row('해설', q.explanation));
  if (q.evidence) {
    const ev = row('노트 근거', q.evidence);
    ev.classList.add('evidence');
    answerBox.appendChild(ev);
  }

  toggle.addEventListener('click', () => {
    answerBox.hidden = !answerBox.hidden;
    toggle.textContent = answerBox.hidden ? '정답 · 해설 보기' : '정답 · 해설 접기';
    toggle.setAttribute('aria-expanded', String(!answerBox.hidden));
  });

  card.append(toggle, answerBox);
  return card;
}

function row(key, value) {
  const div = document.createElement('div');
  div.className = 'row';
  const k = document.createElement('span');
  k.className = 'k';
  k.textContent = `${key}`;
  const v = document.createElement('span');
  v.textContent = value;
  div.append(k, v);
  return div;
}

/* ==========================================================================
   복사 / 다운로드
   ========================================================================== */

function resultToText() {
  if (!lastResult) return '';
  const lines = [`# ${lastResult.topic || '퀴즈노트'} — 생성 문제`, ''];
  lastResult.quizzes.forEach((q, i) => {
    lines.push(`## Q${q.no || i + 1}. [${TYPE_LABEL[q.type] || '문제'}] ${q.question}`);
    if (Array.isArray(q.choices) && q.choices.length) {
      q.choices.forEach((c, ci) => lines.push(`  ${ci + 1}) ${c}`));
    }
    lines.push(`  정답: ${q.answer || '-'}`);
    if (q.explanation) lines.push(`  해설: ${q.explanation}`);
    if (q.evidence) lines.push(`  근거: ${q.evidence}`);
    lines.push('');
  });
  lines.push('— 퀴즈노트(QuizNote)로 생성');
  return lines.join('\n');
}

async function copyAll() {
  const text = resultToText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    window.QuizNote.showToast('클립보드에 복사했어요');
  } catch (e) {
    // https 가 아니거나 권한이 없으면 클립보드 API가 막힌다 → 수동 복사로 대체
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      window.QuizNote.showToast('클립보드에 복사했어요');
    } catch (err) {
      window.QuizNote.showToast('복사에 실패했어요. 직접 드래그해 복사해 주세요');
    }
    ta.remove();
  }
}

function downloadTxt() {
  const text = resultToText();
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quiznote-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  window.QuizNote.showToast('txt 파일로 저장했어요');
}

/* ==========================================================================
   입력 보조 (글자 수 카운터, 샘플, 비우기)
   ========================================================================== */

function updateCounter() {
  const len = notesEl.value.trim().length;
  counterEl.textContent = `${len.toLocaleString()} / ${MAX_LEN.toLocaleString()}자`;
  counterEl.classList.toggle('is-warn', len > MAX_LEN);
}

/* ==========================================================================
   제출 처리
   ========================================================================== */

async function handleSubmit(e) {
  e.preventDefault();
  clearAlert();

  const notes = notesEl.value.trim();
  const difficulty = document.getElementById('difficulty').value;
  const count = Number(document.getElementById('count').value);
  const types = Array.from(document.querySelectorAll('input[name="type"]:checked')).map((el) => el.value);

  /* --- 실패 처리 ① 빈 입력 / 길이 검증 (요청을 보내기 전에 막는다) --- */
  if (notes.length === 0) {
    notesEl.classList.add('is-invalid');
    notesEl.setAttribute('aria-invalid', 'true');
    showAlert('error', '강의노트를 먼저 붙여넣어 주세요.', ' 정리된 필기나 교재 요약 텍스트면 충분합니다.');
    notesEl.focus();
    return;
  }
  if (notes.length < MIN_LEN) {
    notesEl.classList.add('is-invalid');
    notesEl.setAttribute('aria-invalid', 'true');
    showAlert(
      'error',
      '내용이 너무 짧아요.',
      ` 문제를 만들려면 ${MIN_LEN}자 이상이 필요합니다. (현재 ${notes.length}자)`
    );
    notesEl.focus();
    return;
  }
  if (notes.length > MAX_LEN) {
    notesEl.classList.add('is-invalid');
    showAlert(
      'error',
      '노트가 너무 깁니다.',
      ` ${MAX_LEN.toLocaleString()}자 이하로 나눠서 시도해 주세요. (현재 ${notes.length.toLocaleString()}자)`
    );
    notesEl.focus();
    return;
  }
  if (types.length === 0) {
    showAlert('error', '문제 유형을 선택해 주세요.', ' 객관식 / OX / 주관식 중 최소 하나가 필요합니다.');
    return;
  }

  /* --- 요청 --- */
  setLoading(true);
  renderSkeleton(count);

  // 실패 처리 ③ 타임아웃: AbortController 로 25초에서 직접 끊는다.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch('/api/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes, difficulty, count, types }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    // 서버가 JSON 이 아닌 응답(예: 플랫폼 오류 페이지)을 줄 수도 있다.
    let data = null;
    try {
      data = await res.json();
    } catch (parseErr) {
      data = null;
    }

    /* --- 실패 처리 ② API 오류 (4xx / 5xx) --- */
    if (!res.ok) {
      const map = {
        400: ['요청을 처리할 수 없습니다.', ' 입력한 내용을 확인한 뒤 다시 시도해 주세요.'],
        413: ['노트가 너무 깁니다.', ` ${MAX_LEN.toLocaleString()}자 이하로 나눠서 시도해 주세요.`],
        429: ['요청이 몰리고 있어요.', ' 30초 정도 뒤에 다시 시도해 주세요.'],
        500: ['서버 설정에 문제가 있습니다.', ' 잠시 후 다시 시도하거나 관리자에게 알려 주세요.'],
        502: ['AI 서버가 응답하지 않습니다.', ' 잠시 후 다시 시도해 주세요.'],
        504: ['AI 응답이 너무 늦어졌습니다.', ' 노트를 줄이거나 문제 수를 줄여 다시 시도해 주세요.'],
      };
      const fallback = ['문제가 발생했습니다.', ` 잠시 후 다시 시도해 주세요. (오류 코드 ${res.status})`];
      const [title, msg] = map[res.status] || fallback;
      showAlert('error', title, (data && data.message ? ` ${data.message}` : msg));
      renderEmpty();
      return;
    }

    if (!data || !data.ok) {
      showAlert('error', 'AI 응답 형식이 올바르지 않습니다.', ' 다시 시도해 주세요.');
      renderEmpty();
      return;
    }

    renderResult(data);
  } catch (err) {
    clearTimeout(timer);

    if (err.name === 'AbortError') {
      /* --- 실패 처리 ③ 지연/타임아웃 --- */
      showAlert(
        'warn',
        `응답이 ${TIMEOUT_MS / 1000}초를 넘었습니다.`,
        ' 노트를 조금 줄이거나 문제 수를 줄여서 다시 시도해 주세요.'
      );
    } else {
      /* 네트워크 단절 */
      showAlert('error', '서버에 연결하지 못했습니다.', ' 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    }
    renderEmpty();
  } finally {
    setLoading(false);
  }
}

/* ==========================================================================
   초기화
   ========================================================================== */
if (form) {
  form.addEventListener('submit', handleSubmit);
  notesEl.addEventListener('input', () => {
    updateCounter();
    if (notesEl.classList.contains('is-invalid') && notesEl.value.trim().length >= MIN_LEN) clearAlert();
  });

  sampleBtn.addEventListener('click', () => {
    notesEl.value = SAMPLE_NOTE;
    updateCounter();
    clearAlert();
    notesEl.focus();
    window.QuizNote.showToast('예시 노트를 채웠어요');
  });

  clearBtn.addEventListener('click', () => {
    notesEl.value = '';
    updateCounter();
    clearAlert();
    lastResult = null;
    renderEmpty();
    notesEl.focus();
  });

  updateCounter();
  renderEmpty();
}
