/* ==========================================================================
   퀴즈노트 — 모든 페이지 공통 스크립트
   담당: 다크 모드 토글, 모바일 네비게이션, 토스트 알림, 푸터 연도
   ========================================================================== */

/* --------------------------------------------------------------------------
   1) 다크 모드
   - 저장된 값이 있으면 그것을 따르고, 없으면 시스템 설정(prefers-color-scheme)을 따른다.
   - 깜빡임(FOUC)을 막기 위해 초기 적용은 각 HTML <head>의 인라인 스크립트가 먼저 수행한다.
   -------------------------------------------------------------------------- */
const THEME_KEY = 'quiznote-theme';

/** localStorage 는 시크릿 모드 등에서 접근이 막힐 수 있으므로 항상 try/catch 로 감싼다. */
function readStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch (e) {
    return null;
  }
}

function storeTheme(value) {
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch (e) {
    /* 저장 실패해도 현재 세션 동작에는 영향이 없으므로 무시한다 */
  }
}

/** 현재 실제로 보이는 테마를 계산한다. */
function currentTheme() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.querySelector('[data-theme-toggle]');
  if (btn) {
    btn.setAttribute('aria-label', theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}

function initTheme() {
  applyTheme(currentTheme());

  const btn = document.querySelector('[data-theme-toggle]');
  if (btn) {
    btn.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      storeTheme(next);
    });
  }

  // 사용자가 직접 토글한 적이 없다면 시스템 설정 변경을 그대로 따라간다.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!readStoredTheme()) applyTheme(e.matches ? 'dark' : 'light');
  });
}

/* --------------------------------------------------------------------------
   2) 모바일 네비게이션
   -------------------------------------------------------------------------- */
function initNav() {
  const toggle = document.querySelector('[data-nav-toggle]');
  const nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;

  const close = () => {
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  // 메뉴 안의 링크를 누르면 닫는다.
  nav.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));

  // ESC 또는 바깥 클릭으로 닫는다.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  document.addEventListener('click', (e) => {
    if (!nav.contains(e.target) && !toggle.contains(e.target)) close();
  });

  // 데스크톱 폭으로 넓어지면 열림 상태를 초기화한다.
  window.matchMedia('(min-width: 681px)').addEventListener('change', close);
}

/* --------------------------------------------------------------------------
   3) 토스트 (복사 완료 등 짧은 피드백)
   -------------------------------------------------------------------------- */
let toastTimer = null;

function showToast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = message;
  // 재호출 시 애니메이션을 다시 태우기 위해 한 프레임 쉰다.
  requestAnimationFrame(() => el.classList.add('is-on'));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2200);
}

/* --------------------------------------------------------------------------
   4) 푸터 연도 자동 채우기
   -------------------------------------------------------------------------- */
function initYear() {
  const el = document.querySelector('[data-year]');
  if (el) el.textContent = String(new Date().getFullYear());
}

/* --------------------------------------------------------------------------
   초기화
   -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNav();
  initYear();
});

// quiz.js 에서 쓸 수 있도록 전역에 노출한다.
window.QuizNote = { showToast };
