/*
  File: engine.js
  Purpose: Main game runtime. Loads stops.json, renders chat UI, validates answers, saves progress, and advances game state.
*/

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
let routes = [];
let stepEntry = null;
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

// Seed vars from URL params — URL values override saved state.
// System params (reset, reveal, start, preview) are ignored.
(function() {
  const SYSTEM_PARAMS = new Set(['reset', 'reveal', 'start', 'preview']);
  new URLSearchParams(location.search).forEach(function(value, key) {
    if (!SYSTEM_PARAMS.has(key)) state.vars[key] = value;
  });
})();

function saveState() {
  try {
    localStorage.setItem('nola360_step', String(state.step));
    if (state.team) localStorage.setItem('nola360_team', state.team);
    localStorage.setItem('nola360_vars', JSON.stringify(state.vars));
  } catch (e) {}
}

function interpolate(str) {
  // Support both {variable} and {{variable}} placeholders in authored HTML.
  return String(str || '').replace(/\{\{\s*([A-Za-z_]\w*)\s*\}\}|\{\s*([A-Za-z_]\w*)\s*\}/g, (match, keyDouble, keySingle) => {
    const key = keyDouble || keySingle;
    const value = getStateVar(key);
    if (value !== undefined && value !== null) return value;
    return match;
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

function normalizeVarKey(raw) {
  const str = String(raw || '').trim();
  if (!str) return '';
  const wrapped = str.match(/^\{\{\s*([A-Za-z_]\w*)\s*\}\}$|^\{\s*([A-Za-z_]\w*)\s*\}$/);
  if (wrapped) return wrapped[1] || wrapped[2];
  return str;
}

function getStateVar(key) {
  const k = normalizeVarKey(key);
  if (!k) return undefined;
  if (Object.prototype.hasOwnProperty.call(state.vars, k)) return state.vars[k];
  const legacySingle = '{' + k + '}';
  if (Object.prototype.hasOwnProperty.call(state.vars, legacySingle)) return state.vars[legacySingle];
  const legacyDouble = '{{' + k + '}}';
  if (Object.prototype.hasOwnProperty.call(state.vars, legacyDouble)) return state.vars[legacyDouble];
  return undefined;
}

function parseExpectedReplies(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item || '').split(/\n|;|,/g))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return String(value || '')
    .split(/\n|;|,/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeBranchRule(rule) {
  const src = rule && typeof rule === 'object' ? rule : {};
  const answers = parseExpectedReplies(
    src.answers !== undefined ? src.answers : (src.answer !== undefined ? src.answer : src.forAnswer)
  );
  return {
    answers,
    goToBubbleId: String(src.goToBubbleId || src.goToBubble || '').trim(),
    goToStopId: String(src.goToStopId || src.goTo || src.nextStop || '').trim(),
    reply: String(src.reply || src.replyBack || src.html || '')
  };
}

function pickBranchRule(rules, submittedValue) {
  if (!Array.isArray(rules) || !rules.length) return null;
  const submittedNorm = norm(submittedValue);
  for (let i = 0; i < rules.length; i += 1) {
    const rule = normalizeBranchRule(rules[i]);
    if (!rule.answers.length) continue;
    if (rule.answers.some((a) => norm(a) === submittedNorm)) return rule;
  }
  return null;
}

function resolveStopIndexById(stopId) {
  const target = String(stopId || '').trim();
  if (!target) return -1;
  return stops.findIndex((s) => String((s && s.id) || '').trim() === target);
}

function resolveBubbleTargetById(bubbleId) {
  const target = String(bubbleId || '').trim();
  if (!target) return null;
  for (let sIdx = 0; sIdx < stops.length; sIdx += 1) {
    const msgs = Array.isArray(stops[sIdx] && stops[sIdx].messages) ? stops[sIdx].messages : [];
    for (let bIdx = 0; bIdx < msgs.length; bIdx += 1) {
      const bubble = msgs[bIdx];
      if (!bubble || typeof bubble !== 'object') continue;
      if (String(bubble.bubbleId || '').trim() === target) {
        return { stopIndex: sIdx, bubbleIndex: bIdx };
      }
    }
  }
  return null;
}

function getEntryStartIndexForStop(stopIndex) {
  if (!stepEntry || stepEntry.stopIndex !== stopIndex) return 0;
  return Math.max(0, parseInt(stepEntry.bubbleIndex, 10) || 0);
}

function isReplyExpectedMode(mode) {
  const v = String(mode || '').toLowerCase();
  return v === 'word' || v === 'any' || v === 'branch';
}

function getReplyTriggerIndex(stop, fromIndex) {
  if (!stop || !Array.isArray(stop.messages)) return -1;
  const start = Math.max(0, parseInt(fromIndex, 10) || 0);
  for (let i = start; i < stop.messages.length; i += 1) {
    const m = stop.messages[i];
    if (m && isReplyExpectedMode(m.replyExpected)) return i;
  }
  return -1;
}

function getInitialStopMessages(stop, stopIndex) {
  const msgs = (stop && Array.isArray(stop.messages)) ? stop.messages : [];
  const startIndex = getEntryStartIndexForStop(stopIndex);
  const idx = getReplyTriggerIndex(stop, startIndex);
  if (idx < 0) return msgs.slice(startIndex);
  return msgs.slice(startIndex, idx + 1);
}

function getPostReplyMessages(stop, stopIndex) {
  const msgs = (stop && Array.isArray(stop.messages)) ? stop.messages : [];
  const startIndex = getEntryStartIndexForStop(stopIndex);
  const idx = getReplyTriggerIndex(stop, startIndex);
  if (idx < 0) return [];
  return msgs.slice(idx + 1);
}

function getReplyPromptBubble(stop, stopIndex) {
  const startIndex = getEntryStartIndexForStop(stopIndex);
  const idx = getReplyTriggerIndex(stop, startIndex);
  if (idx < 0 || !stop || !Array.isArray(stop.messages)) return null;
  return stop.messages[idx] || null;
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
  const hasReplyExpected = bubble.replyExpected !== undefined && bubble.replyExpected !== null;
  const replyExpectedRaw = String(bubble.replyExpected || '').toLowerCase();
  const replyExpected = isReplyExpectedMode(replyExpectedRaw) ? replyExpectedRaw : 'no';
  const needsReply = hasReplyExpected ? isReplyExpectedMode(replyExpected) : !!(bubble.callToAction || bubble.red || bubble.cmd);
  return {
    bubbleId: typeof bubble.bubbleId === 'string' ? bubble.bubbleId : '',
    html: bubble.html || '',
    callToAction: needsReply,
    forAnswer: bubble.forAnswer || '',
    placeholder: typeof bubble.placeholder === 'string' ? bubble.placeholder : '',
    replyExpected,
    answers: parseExpectedReplies(bubble.answers),
    replyCorrect: typeof bubble.replyCorrect === 'string' ? bubble.replyCorrect : '',
    replyIncorrect: typeof bubble.replyIncorrect === 'string' ? bubble.replyIncorrect : '',
    storesAs: normalizeVarKey(typeof bubble.storesAs === 'string' ? bubble.storesAs : ''),
    replyResponse: typeof bubble.replyResponse === 'string' ? bubble.replyResponse : '',
    branches: Array.isArray(bubble.branches)
      ? bubble.branches.map(normalizeBranchRule)
      : Array.isArray(bubble.branchMap)
        ? bubble.branchMap.map(normalizeBranchRule)
        : []
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
      nextStopId: String(playerReply.nextStopId || '').trim(),
      correct: allBubbles(playerReply.correct),
      incorrect: allBubbles(playerReply.incorrect)
    };
  }

  if (type === 'win') {
    return {
      type: 'win',
      nextStopId: String(playerReply.nextStopId || '').trim(),
      correct: allBubbles(playerReply.correct),
      incorrect: allBubbles(playerReply.incorrect)
    };
  }

  if (type === 'any') {
    return {
      type: 'any',
      placeholder: playerReply.placeholder || '',
      storesAs: normalizeVarKey(playerReply.storesAs || ''),
      nextStopId: String(playerReply.nextStopId || '').trim(),
      correct: allBubbles(playerReply.correct),
      incorrect: allBubbles(playerReply.incorrect)
    };
  }

  return {
    type: 'text',
    placeholder: playerReply.placeholder || '',
    answers: parseExpectedReplies(playerReply.answers),
    setsTeam: !!playerReply.setsTeam,
    anytime: !!playerReply.anytime,
    goTo: playerReply.goTo || undefined,
    nextStopId: String(playerReply.nextStopId || '').trim(),
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

function getStopReply(stop) {
  if (!stop || !Array.isArray(stop.messages)) return (stop && stop.playerReply) || { type: 'text', placeholder: '', answers: [], correct: [], incorrect: [] };
  const replyBubble = stop.messages.find((m) => m && isReplyExpectedMode(m.replyExpected));
  if (!replyBubble) return (stop && stop.playerReply) || { type: 'text', placeholder: '', answers: [], correct: [], incorrect: [] };

  if (replyBubble.replyExpected === 'branch') {
    return {
      type: 'branch',
      placeholder: replyBubble.placeholder || '',
      storesAs: normalizeVarKey(replyBubble.storesAs || ''),
      branches: Array.isArray(replyBubble.branches) ? replyBubble.branches.map(normalizeBranchRule) : [],
      incorrect: replyBubble.replyIncorrect ? [{ html: replyBubble.replyIncorrect }] : []
    };
  }

  if (replyBubble.replyExpected === 'any') {
    return {
      type: 'any',
      placeholder: replyBubble.placeholder || '',
      storesAs: normalizeVarKey(replyBubble.storesAs || ''),
      correct: replyBubble.replyResponse ? [{ html: replyBubble.replyResponse }] : [],
      incorrect: []
    };
  }

  return {
    type: 'text',
    placeholder: replyBubble.placeholder || '',
    answers: parseExpectedReplies(replyBubble.answers),
    setsTeam: false,
    goTo: undefined,
    correct: replyBubble.replyCorrect ? [{ html: replyBubble.replyCorrect }] : [],
    incorrect: replyBubble.replyIncorrect ? [{ html: replyBubble.replyIncorrect }] : []
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
    header,
    routes: Array.isArray(payload && payload.routes) ? payload.routes : []
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

  const playerReply = getStopReply(stops[state.step]);
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

  // Shared anytime check — returns true if an anytime stop matched and was triggered.
  // State.step is NOT changed; the player stays at their current stop after the reply.
  const tryAnytime = (val) => {
    for (let ai = 0; ai < stops.length; ai++) {
      if (ai === state.step) continue;
      const anytimeStop = stops[ai];
      if (!anytimeStop || !anytimeStop.playerReply || !anytimeStop.playerReply.anytime) continue;
      const anytimeMatch = (anytimeStop.playerReply.answers || []).find((a) => norm(a) === norm(val));
      if (!anytimeMatch) continue;
      addMsg({ fromPlayer: true, text: anytimeMatch || val }, true);
      input.value = '';
      inputAreaEl.querySelectorAll('input, button').forEach((el) => { el.disabled = true; });
      scrollBottom(true);
      const correctBubbles = pickCorrectBubble(anytimeStop.playerReply.correct || [], anytimeMatch);
      const promptBubble = getReplyPromptBubble(stops[state.step], state.step);
      const toShow = promptBubble ? correctBubbles.concat([promptBubble]) : correctBubbles;
      showBubbles(toShow, () => {
        lastBubblePlaceholder = '';
        renderInput();
      });
      return true;
    }
    return false;
  };

  if (playerReply.type === 'any') {
    const submitAny = () => {
      const val = input.value.trim();
      if (!val) return;
      if (tryAnytime(val)) return;
      const varKey = normalizeVarKey(playerReply.storesAs);
      if (varKey) {
        state.vars[varKey] = val;
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

  if (playerReply.type === 'branch') {
    const submitBranch = () => {
      const val = input.value.trim();
      if (!val) return;
      if (tryAnytime(val)) return;

      const varKey = normalizeVarKey(playerReply.storesAs);
      if (varKey) {
        state.vars[varKey] = val;
        saveState();
      }

      const matchedBranch = pickBranchRule(playerReply.branches || [], val);
      if (!matchedBranch) {
        addMsg({ fromPlayer: true, text: val }, true);
        input.value = '';
        input.classList.add('wrong');
        setTimeout(() => input.classList.remove('wrong'), 400);

        inputAreaEl.querySelectorAll('input, button').forEach((el) => { el.disabled = true; });

        const incorrectBubbles = (playerReply.incorrect && playerReply.incorrect.length)
          ? playerReply.incorrect
          : [{ html: 'Not one of the expected branch replies. Try again.' }];
        const promptBubble = getReplyPromptBubble(stops[state.step], state.step);
        const toShow = promptBubble ? incorrectBubbles.concat([promptBubble]) : incorrectBubbles;

        lastBubblePlaceholder = '';
        showBubbles(toShow, () => renderInput());
        scrollBottom(true);
        return;
      }

      addMsg({ fromPlayer: true, text: val }, true);
      const branchReply = String(matchedBranch.reply || '').trim();
      const branchBubbles = branchReply ? [{ html: branchReply }] : [];
      doAdvance(val, {
        forcedCorrectBubbles: branchBubbles,
        goToBubbleId: matchedBranch.goToBubbleId || '',
        goToStopId: matchedBranch.goToStopId || ''
      });
    };

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBranch(); });
    sendBtn.addEventListener('click', submitBranch);
    row.appendChild(input);
    row.appendChild(sendBtn);
    inputAreaEl.appendChild(row);
    if (!disabled) setTimeout(() => input.focus(), 150);
    return;
  }

  const submit = () => {
    const val = input.value.trim();
    if (!val) return;

    if (tryAnytime(val)) return;

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

      const promptBubble = getReplyPromptBubble(stops[state.step], state.step);
      const toShow = promptBubble ? incorrectBubbles.concat([promptBubble]) : incorrectBubbles;

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

function stopNeedsReply(stop, stopIndex) {
  const startIndex = getEntryStartIndexForStop(stopIndex);
  if (getReplyTriggerIndex(stop, startIndex) >= 0) return true;
  const tail = stop && Array.isArray(stop.messages) ? stop.messages.slice(startIndex) : [];
  return !!tail.some((m) => m && m.callToAction);
}

function renderInputOrAutoAdvance() {
  const stop = stops[state.step];
  if (stop && !stopNeedsReply(stop, state.step)) {
    doAdvance();
  } else {
    renderInput();
  }
}

function doAdvance(matchedAnswer, options) {
  const opts = options || {};
  const currentStep = state.step;
  const current = stops[currentStep];
  const currentReply = getStopReply(current);
  const trailingCurrentMsgs = getPostReplyMessages(current, currentStep);
  const correctBubbles = Array.isArray(opts.forcedCorrectBubbles)
    ? opts.forcedCorrectBubbles
    : pickCorrectBubble(
        (currentReply && currentReply.correct) || [],
        matchedAnswer
      );

  let nextIndex = currentStep + 1;
  let nextEntry = null;
  const goToBubbleId = String(opts.goToBubbleId || '').trim();
  if (goToBubbleId) {
    const bubbleTarget = resolveBubbleTargetById(goToBubbleId);
    if (bubbleTarget) {
      nextIndex = bubbleTarget.stopIndex;
      nextEntry = { stopIndex: bubbleTarget.stopIndex, bubbleIndex: bubbleTarget.bubbleIndex };
    }
  }
  const goToStopId = String(opts.goToStopId || (currentReply && currentReply.nextStopId) || '').trim();
  if (nextEntry === null && goToStopId === '__prev__') {
    nextIndex = Math.max(0, state.step - 1);
  } else if (nextEntry === null && goToStopId) {
    const resolved = resolveStopIndexById(goToStopId);
    if (resolved >= 0) nextIndex = resolved;
  }

  // Per-stop variable routing: playerReply.varRoutes = { varName, map: { value: stopId } }
  if (nextEntry === null && !goToStopId && currentReply && currentReply.varRoutes && currentReply.varRoutes.varName) {
    var vrVal = (state.vars && state.vars[currentReply.varRoutes.varName]) || '';
    if (vrVal && currentReply.varRoutes.map) {
      Object.keys(currentReply.varRoutes.map).forEach(function(k) {
        if (k.toLowerCase() === vrVal.toLowerCase()) {
          var vrIdx = resolveStopIndexById(currentReply.varRoutes.map[k]);
          if (vrIdx >= 0) nextIndex = vrIdx;
        }
      });
    }
  }

  // Route-based next stop: if the current stop is in a route, jump to the
  // next stop in this team's variant order instead of the default next index.
  if (nextEntry === null && !goToStopId && routes.length) {
    const currentStopId = current && current.id;
    for (var ri = 0; ri < routes.length; ri++) {
      var route = routes[ri];
      var varVal = (state.vars && route.matchVar && state.vars[route.matchVar]) || state.team || '';
      if (!varVal || !route.variants) continue;
      // Case-insensitive variant match
      var matchedVariant = null;
      Object.keys(route.variants).forEach(function(k) {
        if (!matchedVariant && k.toLowerCase() === varVal.toLowerCase()) {
          matchedVariant = route.variants[k];
        }
      });
      if (!Array.isArray(matchedVariant)) continue;
      var posInRoute = matchedVariant.indexOf(currentStopId);
      if (posInRoute >= 0 && posInRoute < matchedVariant.length - 1) {
        var nIdx = resolveStopIndexById(matchedVariant[posInRoute + 1]);
        if (nIdx >= 0) { nextIndex = nIdx; break; }
      }
    }
  }

  state.step = nextIndex;
  stepEntry = nextEntry;
  saveState();

  inputAreaEl.querySelectorAll('input, button').forEach((el) => {
    el.disabled = true;
  });
  scrollBottom(true);

  if (state.step >= stops.length) {
    const finalBubbles = correctBubbles.concat(trailingCurrentMsgs);
    if (!finalBubbles.length) {
      lastBubblePlaceholder = '';
      renderInput();
      return;
    }
    showBubbles(finalBubbles, () => {
      lastBubblePlaceholder = '';
      renderInput();
    });
    return;
  }

  const nextMsgs = getInitialStopMessages(stops[state.step], state.step);
  const allBubbles = correctBubbles.concat(trailingCurrentMsgs, nextMsgs);
  if (!allBubbles.length) {
    lastBubblePlaceholder = '';
    renderInputOrAutoAdvance();
    return;
  }

  lastBubblePlaceholder = '';
  if (stopNeedsReply(stops[state.step], state.step)) renderInput(true);
  showBubbles(allBubbles, renderInputOrAutoAdvance);
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
    const stored = playerReply.storesAs ? getStateVar(playerReply.storesAs) : undefined;
    return { fromPlayer: true, text: stored || '[any answer]' };
  }
  if (playerReply.type === 'branch') {
    const stored = playerReply.storesAs ? getStateVar(playerReply.storesAs) : undefined;
    return { fromPlayer: true, text: stored || '[branch answer]' };
  }
  const answers = Array.isArray(playerReply.answers) ? playerReply.answers.filter(Boolean) : [];
  return { fromPlayer: true, text: answers.length ? answers.join(' / ') : 'Player reply' };
}

function revealAllBubbles() {
  chatEl.innerHTML = '';
  stops.forEach((stop) => {
    (stop.messages || []).forEach((msg) => addMsg(msg, false));
    const stopReply = getStopReply(stop);
    const replyMsg = buildRevealPlayerReplyMessage(stopReply);
    if (replyMsg) addMsg(replyMsg, false);
    ((stopReply && stopReply.correct) || []).forEach((msg) => addMsg(msg, false));
    ((stopReply && stopReply.incorrect) || []).forEach((msg) => addMsg(msg, false));
  });
  inputAreaEl.innerHTML = '';
  scrollBottom(false);
}

function replayProgress() {
  lastBubblePlaceholder = '';
  for (let i = 0; i <= state.step; i += 1) {
    if (i >= stops.length) break;
    const stopMsgs = (i < state.step)
      ? (stops[i].messages || [])
      : getInitialStopMessages(stops[i], i);
    stopMsgs.forEach((msg) => addMsg(msg, false));
    if (i < state.step) {
      const pr = getStopReply(stops[i]);
      const stored = (pr.type === 'any' || pr.type === 'branch') && pr.storesAs
        ? getStateVar(pr.storesAs)
        : undefined;
      if (stored) {
        addMsg({ fromPlayer: true, text: stored }, false);
      }
      if (pr.type === 'branch' && stored) {
        const matchedBranch = pickBranchRule(pr.branches || [], stored);
        if (matchedBranch && String(matchedBranch.reply || '').trim()) {
          addMsg({ html: matchedBranch.reply }, false);
        }
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
    routes = loaded.routes || [];
    applyHeaderConfig(loaded.header);
    stepEntry = null;
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
      if (stopNeedsReply(stops[startIdx], startIdx)) renderInput(true);
      setTimeout(() => showBubbles(getInitialStopMessages(stops[startIdx], startIdx), renderInputOrAutoAdvance), 400);
      return;
    }
  }

  if (state.step > 0) {
    replayProgress();
    return;
  }

  lastBubblePlaceholder = '';
  if (stopNeedsReply(stops[0], 0)) renderInput(true);
  setTimeout(() => showBubbles(getInitialStopMessages(stops[0], 0), renderInputOrAutoAdvance), 400);
}

initGame();
