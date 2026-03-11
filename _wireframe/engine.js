/*
  File: engine.js
  Purpose: Main game runtime. Loads stops.json, renders chat UI, validates answers, saves progress, and advances game state.
*/

const TEAMS = {
  beignet: { name: 'Beignet', color: '#6aaef7', cls: 'team-beignet', w3w: 'https://w3w.co/tend.snipped.national' },
  lagniappe: { name: 'Lagniappe', color: '#f5a623', cls: 'team-lagniappe', w3w: 'https://w3w.co/ideas.shorter.restore' },
  rougarou: { name: 'Rougarou', color: '#e85568', cls: 'team-rougarou', w3w: 'https://w3w.co/bearings.student.seats' },
  tch: { name: 'Tchoupitoulas', color: '#4ecf98', cls: 'team-tch', w3w: 'https://w3w.co/captures.sailor.clues' }
};

const TEAM_LETTER_MAP = { a: 'beignet', b: 'lagniappe', c: 'rougarou', d: 'tch' };
const TEAM_KEY_MAP = { beignet: 'beignet', lagniappe: 'lagniappe', tchoupitoulas: 'tch', rougarou: 'rougarou' };
const REVEAL_ALL = new URLSearchParams(location.search).has('reveal');
const START_STOP = new URLSearchParams(location.search).get('start');
const PREVIEW_MODE = new URLSearchParams(location.search).has('preview');

if (location.search.includes('reset')) {
  try {
    localStorage.clear();
  } catch (e) {}
  history.replaceState(null, '', location.pathname);
}

let state = { step: 0, team: null, vars: {} };
let stops = [];
let lastBubblePlaceholder = '';
let TYPING_THINK = 600;
let TYPING_PAUSE = 150;
let DEFAULT_PLACEHOLDER = 'Type here...';
const DEFAULT_HEADER = {
  title: 'Scavenger Hunt',
  subtitle: 'Mission Control',
  logoUrl: 'logo.png',
  logoAlt: 'Game Logo',
  pageTitle: 'Scavenger Hunt',
  status: 'online'
};

try {
  state.team = localStorage.getItem('nola360_team') || null;
  const savedStep = parseInt(localStorage.getItem('nola360_step') || '0', 10);
  if (!isNaN(savedStep) && savedStep > 0) state.step = savedStep;
  const savedVars = localStorage.getItem('nola360_vars');
  if (savedVars) state.vars = JSON.parse(savedVars);
} catch (e) {}

function saveState() {
  try {
    localStorage.setItem('nola360_step', String(state.step));
    if (state.team) localStorage.setItem('nola360_team', state.team);
    localStorage.setItem('nola360_vars', JSON.stringify(state.vars));
  } catch (e) {}
}

function interpolate(str) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return key in state.vars ? state.vars[key] : '{{' + key + '}}';
  });
}

const chatEl = document.getElementById('chat');
const inputAreaEl = document.getElementById('input-area');
const headerTitleEl = document.getElementById('header-title');
const headerSubtitleEl = document.getElementById('header-subtitle');
const headerLogoEl = document.getElementById('header-logo');
const headerStatusEl = document.getElementById('header-status');
const restartBtnEl = document.getElementById('restartBtn');

(function initLightbox() {
  const lb = document.createElement('div');
  lb.className = 'lb';
  const img = document.createElement('img');
  lb.appendChild(img);
  document.body.appendChild(lb);
  lb.addEventListener('click', () => lb.classList.remove('open'));
  document.addEventListener('click', (e) => {
    const bubbleImg = e.target.closest('.msg-bubble img');
    if (!bubbleImg) return;
    img.src = bubbleImg.src;
    img.alt = bubbleImg.alt;
    lb.classList.add('open');
  });
})();

function norm(s) {
  return String(s || '').toLowerCase().replace(/[$,.\s]/g, '');
}

function scrollBottom(smooth) {
  chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function addMsg(msg, animate) {
  if (!msg.html && !msg.text) return null;
  const wrap = document.createElement('div');
  const isCallToAction = !!msg.callToAction;
  wrap.className = 'msg ' + (msg.fromPlayer ? 'from-player' : 'from-game') + (isCallToAction ? ' call-to-action' : '');
  if (!animate) wrap.style.animation = 'none';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (msg.html) {
    bubble.innerHTML = interpolate(msg.html).replace(/\n/g, '<br>');
  } else {
    bubble.textContent = msg.text || '';
  }
  if (bubble.querySelector('img')) wrap.classList.add('has-img');
  wrap.appendChild(bubble);
  chatEl.appendChild(wrap);
  if (msg && Object.prototype.hasOwnProperty.call(msg, 'placeholder')) {
    lastBubblePlaceholder = typeof msg.placeholder === 'string' ? msg.placeholder : '';
  }
  return wrap;
}

function addTyping() {
  const el = document.createElement('div');
  el.className = 'typing';
  el.innerHTML = '<span></span><span></span><span></span>';
  chatEl.appendChild(el);
  scrollBottom(true);
  return el;
}

function showBubbles(bubbles, onDone, opts) {
  const think = (opts && opts.think) || TYPING_THINK;
  const pause = (opts && opts.pause) || TYPING_PAUSE;

  if (!bubbles.length) { if (onDone) onDone(); return; }

  const typing = addTyping();
  setTimeout(() => {
    typing.remove();
    function next(i) {
      addMsg(bubbles[i], true);
      scrollBottom(true);
      if (i < bubbles.length - 1) {
        setTimeout(() => next(i + 1), pause);
      } else if (onDone) {
        onDone();
      }
    }
    next(0);
  }, think);
}

function normalizeBubble(bubble) {
  if (!bubble || typeof bubble !== 'object') return null;
  return {
    html: bubble.html || '',
    callToAction: !!(bubble.callToAction || bubble.red || bubble.cmd),
    forAnswer: bubble.forAnswer || '',
    placeholder: typeof bubble.placeholder === 'string' ? bubble.placeholder : ''
  };
}

function normalizePlayerReply(playerReply) {
  if (!playerReply || typeof playerReply !== 'object') return { type: 'text', placeholder: '', answers: [], correct: [], incorrect: [] };
  const type = playerReply.type || 'text';
  const allBubbles = (arr) => Array.isArray(arr) ? arr.map(normalizeBubble).filter(Boolean) : [];

  if (type === 'button') {
    return {
      type: 'button',
      text: playerReply.text || 'Continue',
      playerText: playerReply.playerText || playerReply.text || 'Continue',
      correct: allBubbles(playerReply.correct),
      incorrect: allBubbles(playerReply.incorrect)
    };
  }

  if (type === 'win') {
    return {
      type: 'win',
      correct: allBubbles(playerReply.correct),
      incorrect: allBubbles(playerReply.incorrect)
    };
  }

  if (type === 'any') {
    return {
      type: 'any',
      placeholder: playerReply.placeholder || '',
      storesAs: playerReply.storesAs || '',
      correct: allBubbles(playerReply.correct),
      incorrect: allBubbles(playerReply.incorrect)
    };
  }

  return {
    type: 'text',
    placeholder: playerReply.placeholder || '',
    answers: Array.isArray(playerReply.answers) ? playerReply.answers.map((a) => String(a)) : [],
    setsTeam: !!playerReply.setsTeam,
    goTo: playerReply.goTo || undefined,
    correct: allBubbles(playerReply.correct),
    incorrect: allBubbles(playerReply.incorrect)
  };
}

function normalizeStop(stop, index) {
  const msgs = Array.isArray(stop && stop.messages)
    ? stop.messages.map(normalizeBubble).filter(Boolean)
    : Array.isArray(stop && stop.reveal)
      ? stop.reveal.map(normalizeBubble).filter(Boolean)
      : [];
  const playerReply = normalizePlayerReply((stop && stop.playerReply) || (stop && stop.action) || null);
  return {
    id: (stop && stop.id) || 'stop-' + (index + 1),
    messages: msgs,
    playerReply
  };
}

async function loadStops() {
  let payload;
  if (PREVIEW_MODE) {
    try {
      const raw = localStorage.getItem('nola360_preview_stops');
      if (raw) {
        localStorage.removeItem('nola360_preview_stops');
        payload = JSON.parse(raw);
      }
    } catch (e) {}
  }
  if (!payload) {
    const resp = await fetch('stops.json', { cache: 'no-store' });
    if (!resp.ok) throw new Error('Unable to load stops.json');
    payload = await resp.json();
  }
  const list = Array.isArray(payload) ? payload : payload && Array.isArray(payload.stops) ? payload.stops : [];
  const header = payload && typeof payload === 'object' && payload.header && typeof payload.header === 'object'
    ? payload.header
    : {};
  return {
    stops: list.map(normalizeStop),
    header
  };
}

function applyHeaderConfig(config) {
  const header = Object.assign({}, DEFAULT_HEADER, config || {});
  if (headerTitleEl) headerTitleEl.textContent = header.title;
  if (headerSubtitleEl) headerSubtitleEl.textContent = header.subtitle;
  if (headerStatusEl) headerStatusEl.textContent = header.status || 'online';
  if (headerLogoEl) {
    headerLogoEl.src = header.logoUrl || DEFAULT_HEADER.logoUrl;
    headerLogoEl.alt = header.logoAlt || header.title;
  }
  document.title = header.pageTitle || header.title || DEFAULT_HEADER.pageTitle;
  const opts = header.builderOptions || {};
  if (typeof opts.typingDelay === 'number') TYPING_THINK = opts.typingDelay;
  if (typeof opts.bubblePause === 'number') TYPING_PAUSE = opts.bubblePause;
  if (opts.defaultPlaceholder) DEFAULT_PLACEHOLDER = opts.defaultPlaceholder;
if (header.faviconUrl) {
    var link = document.querySelector("link[rel~='icon']") || document.createElement('link');
    link.rel = 'icon';
    link.href = header.faviconUrl;
    document.head.appendChild(link);
  }
}

if (restartBtnEl) {
  restartBtnEl.addEventListener('click', () => {
    try {
      localStorage.clear();
    } catch (e) {}
    location.reload();
  });
}

function renderInput(disabled) {
  inputAreaEl.innerHTML = '';
  if (state.step >= stops.length) return;

  const playerReply = stops[state.step].playerReply;
  if (playerReply.type === 'win') return;

  if (playerReply.type === 'button') {
    const wrap = document.createElement('div');
    wrap.className = 'btn-choices';
    const btn = document.createElement('button');
    btn.className = 'choice-btn neutral';
    btn.textContent = playerReply.text;
    btn.disabled = !!disabled;
    if (!disabled) {
      btn.addEventListener('click', () => {
        addMsg({ fromPlayer: true, text: playerReply.playerText || playerReply.text }, true);
        doAdvance();
      });
    }
    wrap.appendChild(btn);
    inputAreaEl.appendChild(wrap);
    return;
  }

  const row = document.createElement('div');
  row.className = 'answer-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'answer-input';
  input.placeholder = String(lastBubblePlaceholder || playerReply.placeholder || DEFAULT_PLACEHOLDER);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('autocapitalize', 'off');
  input.disabled = !!disabled;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'submit-btn';
  sendBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  sendBtn.disabled = !!disabled;

  if (playerReply.type === 'any') {
    const submitAny = () => {
      const val = input.value.trim();
      if (!val) return;
      if (playerReply.storesAs) {
        state.vars[playerReply.storesAs] = val;
        saveState();
      }
      addMsg({ fromPlayer: true, text: val }, true);
      doAdvance();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAny(); });
    sendBtn.addEventListener('click', submitAny);
    row.appendChild(input);
    row.appendChild(sendBtn);
    inputAreaEl.appendChild(row);
    if (!disabled) setTimeout(() => input.focus(), 150);
    return;
  }

  const submit = () => {
    const val = input.value.trim();
    if (!val) return;

    const matchedAnswer = playerReply.answers.find((a) => norm(val) === norm(a));
    const ok = !!matchedAnswer;
    if (!ok) {
      addMsg({ fromPlayer: true, text: val }, true);
      input.value = '';
      input.classList.add('wrong');
      setTimeout(() => input.classList.remove('wrong'), 400);

      inputAreaEl.querySelectorAll('input, button').forEach((el) => { el.disabled = true; });

      const pickedIncorrect = pickIncorrectBubble(playerReply.incorrect || [], val);
      const incorrectBubbles = pickedIncorrect.length
        ? pickedIncorrect
        : [{ html: playerReply.setsTeam
              ? 'Check that spelling. If needed, text <strong>504-581-5652</strong> for help from Mission Control.'
              : 'Not quite. Text <strong>504-581-5652</strong> and Mission Control will help.' }];

      const msgs = stops[state.step].messages || [];
      const lastSetup = msgs.length ? msgs[msgs.length - 1] : null;
      const toShow = lastSetup ? incorrectBubbles.concat([lastSetup]) : incorrectBubbles;

      lastBubblePlaceholder = '';
      showBubbles(toShow, () => renderInput());
      scrollBottom(true);
      return;
    }

    addMsg({ fromPlayer: true, text: matchedAnswer || val }, true);

    if (playerReply.goTo) {
      state.step += 1;
      saveState();
      scrollBottom(true);
      setTimeout(() => {
        location.href = playerReply.goTo;
      }, 400);
      return;
    }

    if (playerReply.setsTeam) {
      state.team = TEAM_LETTER_MAP[norm(val)] || TEAM_KEY_MAP[norm(val)] || norm(val);
      saveState();
    }

    doAdvance(matchedAnswer || val);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  sendBtn.addEventListener('click', submit);

  row.appendChild(input);
  row.appendChild(sendBtn);
  inputAreaEl.appendChild(row);
  if (!disabled) setTimeout(() => input.focus(), 150);
}

function pickCorrectBubble(correctBubbles, matchedAnswer) {
  if (!correctBubbles.length) return [];
  if (matchedAnswer) {
    const specific = correctBubbles.find((b) => b.forAnswer && norm(b.forAnswer) === norm(matchedAnswer));
    if (specific) return [specific];
  }
  const fallback = correctBubbles.find((b) => !b.forAnswer);
  return [fallback || correctBubbles[0]];
}

function pickIncorrectBubble(incorrectBubbles, submittedVal) {
  if (!incorrectBubbles.length) return [];
  if (submittedVal) {
    const specific = incorrectBubbles.find((b) => b.forAnswer && norm(b.forAnswer) === norm(submittedVal));
    if (specific) return [specific];
  }
  const fallback = incorrectBubbles.find((b) => !b.forAnswer);
  return [fallback || incorrectBubbles[0]];
}

function doAdvance(matchedAnswer) {
  const current = stops[state.step];
  const correctBubbles = pickCorrectBubble(
    (current && current.playerReply && current.playerReply.correct) || [],
    matchedAnswer
  );

  state.step += 1;
  saveState();

  inputAreaEl.querySelectorAll('input, button').forEach((el) => {
    el.disabled = true;
  });
  scrollBottom(true);

  if (state.step >= stops.length) {
    lastBubblePlaceholder = '';
    renderInput();
    return;
  }

  const nextMsgs = stops[state.step].messages || [];
  const allBubbles = correctBubbles.concat(nextMsgs);
  if (!allBubbles.length) {
    lastBubblePlaceholder = '';
    renderInput();
    return;
  }

  lastBubblePlaceholder = '';
  renderInput(true);
  showBubbles(allBubbles, () => renderInput());
}

function showNoStops(message) {
  addMsg({ html: message || 'No tour stops found in stops.json.' }, false);
  renderInput();
  scrollBottom(false);
}

function buildRevealPlayerReplyMessage(playerReply) {
  if (!playerReply || typeof playerReply !== 'object') return null;
  if (playerReply.type === 'win') {
    return { fromPlayer: true, text: 'WIN' };
  }
  if (playerReply.type === 'button') {
    return { fromPlayer: true, text: playerReply.playerText || playerReply.text || 'Continue' };
  }
  if (playerReply.type === 'any') {
    const stored = playerReply.storesAs && state.vars[playerReply.storesAs];
    return { fromPlayer: true, text: stored || '[any answer]' };
  }
  const answers = Array.isArray(playerReply.answers) ? playerReply.answers.filter(Boolean) : [];
  return { fromPlayer: true, text: answers.length ? answers.join(' / ') : 'Player reply' };
}

function revealAllBubbles() {
  chatEl.innerHTML = '';
  stops.forEach((stop) => {
    (stop.messages || []).forEach((msg) => addMsg(msg, false));
    const replyMsg = buildRevealPlayerReplyMessage(stop.playerReply);
    if (replyMsg) addMsg(replyMsg, false);
    ((stop.playerReply && stop.playerReply.correct) || []).forEach((msg) => addMsg(msg, false));
    ((stop.playerReply && stop.playerReply.incorrect) || []).forEach((msg) => addMsg(msg, false));
  });
  inputAreaEl.innerHTML = '';
  scrollBottom(false);
}

function replayProgress() {
  lastBubblePlaceholder = '';
  for (let i = 0; i <= state.step; i += 1) {
    if (i >= stops.length) break;
    (stops[i].messages || []).forEach((msg) => addMsg(msg, false));
    if (i < state.step && stops[i].playerReply) {
      const pr = stops[i].playerReply;
      if (pr.type === 'any' && pr.storesAs && state.vars[pr.storesAs]) {
        addMsg({ fromPlayer: true, text: state.vars[pr.storesAs] }, false);
      }
      if (pr.type === 'button') {
        addMsg({ fromPlayer: true, text: pr.playerText || pr.text || '' }, false);
      }
      pickCorrectBubble(pr.correct || [], '').forEach((msg) => addMsg(msg, false));
    }
  }
  renderInput();
  scrollBottom(false);
}

async function initGame() {
  try {
    const loaded = await loadStops();
    stops = loaded.stops;
    applyHeaderConfig(loaded.header);
  } catch (err) {
    showNoStops('Failed to load stops.json. Run a local server and verify the file exists.');
    return;
  }

  if (!stops.length) {
    showNoStops('No tour stops yet. Build stops in builder.html and save to stops.json.');
    return;
  }

  if (REVEAL_ALL) {
    revealAllBubbles();
    return;
  }

  if (state.step > stops.length - 1) {
    state.step = 0;
    saveState();
  }

// ?start=stop-id — jump directly to a specific stop without replaying history (for testing from builder)
  const jumpTo = START_STOP;
  if (jumpTo) {
    const startIdx = stops.findIndex((s) => s.id === jumpTo);
    if (startIdx >= 0) {
      state.step = startIdx;
      history.replaceState(null, '', location.pathname);
      lastBubblePlaceholder = '';
      renderInput(true);
      setTimeout(() => showBubbles(stops[startIdx].messages || [], () => renderInput()), 400);
      return;
    }
  }

  if (state.step > 0) {
    replayProgress();
    return;
  }

  lastBubblePlaceholder = '';
  renderInput(true);
  setTimeout(() => showBubbles(stops[0].messages || [], () => renderInput()), 400);
}

initGame();
