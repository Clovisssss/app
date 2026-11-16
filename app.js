'use strict';

/* =====================================================================
   Undercover : une seule application, un seul téléphone qu'on se passe.
   Phases d'une partie : reveal -> play -> vote -> (guess) -> result -> ... -> end
   ===================================================================== */

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const MIN_FOR_WHITE = 5; // Mr White n'est proposé qu'à partir de 5 joueurs
const ROLE_LABEL = { civil: 'Civil', undercover: 'Undercover', white: 'Mr White' };

const $app = document.getElementById('app');

/* ---------- Utilitaires ---------- */

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
  }
};

const esc = s => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Comparaison tolérante (accents, majuscules, espaces, ponctuation)
const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/* ---------- Réglages (mémorisés sur le téléphone) ---------- */

function loadSettings() {
  const s = store.get('uc_settings', {});
  let names = Array.isArray(s.names) ? s.names.map(n => String(n).slice(0, 16)) : [];
  names = names.slice(0, MAX_PLAYERS);
  while (names.length < MIN_PLAYERS) names.push('');
  return { names, white: !!s.white, error: '' };
}

let ui = loadSettings();
let game = null;

const saveSettings = () => store.set('uc_settings', { names: ui.names, white: ui.white });
const whiteActive = () => ui.white && ui.names.length >= MIN_FOR_WHITE;

/* ---------- Logique du jeu ---------- */

// Répartition des rôles selon le nombre de joueurs
function composition(n, white) {
  const w = white && n >= MIN_FOR_WHITE ? 1 : 0;
  const u = n <= 6 ? 1 : n <= 9 ? 2 : 3;
  return { civils: n - u - w, undercovers: u, white: w };
}

// Tire une paire de mots en évitant de répéter celles déjà jouées
// Les paires jouées sont mémorisées par leur texte (et non par leur position),
// ce qui reste valable même si vous modifiez ou réordonnez words.js.
function pickPair() {
  const keyOf = p => `${p[0]}|${p[1]}`;
  let used = new Set(store.get('uc_used_v2', []));
  let pool = PAIRES.filter(p => !used.has(keyOf(p)));
  if (!pool.length) { used = new Set(); pool = PAIRES; } // tout a été joué : on repart de zéro
  const pair = pool[Math.floor(Math.random() * pool.length)];
  used.add(keyOf(pair));
  store.set('uc_used_v2', [...used]);
  return pair;
}

function startGame(names, white) {
  const comp = composition(names.length, white);
  const [a, b] = pickPair();
  const [civilWord, underWord] = Math.random() < 0.5 ? [a, b] : [b, a];
  const roles = shuffle([
    ...Array(comp.civils).fill('civil'),
    ...Array(comp.undercovers).fill('undercover'),
    ...Array(comp.white).fill('white')
  ]);
  game = {
    names, white, civilWord, underWord,
    players: names.map((name, i) => ({ name, role: roles[i], alive: true })),
    phase: 'reveal',
    revealIndex: 0,
    revealed: false,
    round: 1,
    starter: 0,
    selected: null,
    lastOut: null,
    message: '',
    winner: null
  };
  render();
}

const wordOf = p =>
  p.role === 'civil' ? game.civilWord : p.role === 'undercover' ? game.underWord : null;

const aliveIdx = () => game.players.map((p, i) => (p.alive ? i : -1)).filter(i => i >= 0);

// Au premier tour, Mr White ne commence pas (il n'aurait aucun indice à imiter)
function pickStarter() {
  let candidates = aliveIdx();
  if (game.round === 1) {
    const others = candidates.filter(i => game.players[i].role !== 'white');
    if (others.length) candidates = others;
  }
  game.starter = candidates[Math.floor(Math.random() * candidates.length)];
}

function speakingOrder() {
  const n = game.players.length;
  const order = [];
  for (let k = 0; k < n; k++) {
    const i = (game.starter + k) % n;
    if (game.players[i].alive) order.push(i);
  }
  return order;
}

// Renvoie 'civils', 'infiltres' ou null si la partie continue
function checkWin() {
  const alive = game.players.filter(p => p.alive);
  const civils = alive.filter(p => p.role === 'civil').length;
  const infiltres = alive.length - civils;
  if (infiltres === 0) return 'civils';
  if (infiltres >= civils) return 'infiltres';
  return null;
}

function eliminate(i) {
  const p = game.players[i];
  p.alive = false;
  game.lastOut = i;
  game.selected = null;
  game.message = '';
  game.phase = p.role === 'white' ? 'guess' : 'result';
  render();
}

function nextAfterResult() {
  const w = checkWin();
  if (w) {
    game.winner = w;
    game.phase = 'end';
  } else {
    game.round += 1;
    pickStarter();
    game.phase = 'play';
  }
  render();
}

/* ---------- Écrans ---------- */

function screenSetup() {
  const n = ui.names.length;
  const canWhite = n >= MIN_FOR_WHITE;
  const comp = composition(n, whiteActive());
  const rows = ui.names.map((nm, i) => `
    <li>
      <input type="text" data-idx="${i}" value="${esc(nm)}" placeholder="Joueur ${i + 1}"
             maxlength="16" autocomplete="off" autocapitalize="words">
      <button class="icon" data-action="remove" data-idx="${i}" aria-label="Retirer ce joueur"
              ${n <= MIN_PLAYERS ? 'disabled' : ''}>✕</button>
    </li>`).join('');

  return `
    <header>
      <h1>🕵️ Undercover</h1>
      <p class="sub">Trouvez l'imposteur !</p>
    </header>

    <section class="card">
      <h2>Joueurs <span class="count">${n} / ${MAX_PLAYERS}</span></h2>
      <ul class="players">${rows}</ul>
      <button class="secondary" data-action="add" ${n >= MAX_PLAYERS ? 'disabled' : ''}>+ Ajouter un joueur</button>
    </section>

    <section class="card">
      <label class="toggle">
        <input type="checkbox" data-action="toggle-white" ${whiteActive() ? 'checked' : ''} ${canWhite ? '' : 'disabled'}>
        <span>Ajouter Mr White</span>
      </label>
      <p class="hint">${canWhite
        ? 'Mr White ne reçoit aucun mot et doit bluffer.'
        : `Disponible à partir de ${MIN_FOR_WHITE} joueurs.`}</p>
      <p class="comp">${plural(comp.civils, 'civil', 'civils')} · ${plural(comp.undercovers, 'undercover', 'undercovers')}${comp.white ? ' · 1 Mr White' : ''}</p>
    </section>

    ${ui.error ? `<p class="error">${esc(ui.error)}</p>` : ''}
    <button class="primary" data-action="start">Commencer la partie</button>`;
}

function screenReveal() {
  const i = game.revealIndex;
  const total = game.players.length;
  const p = game.players[i];
  const isLast = i === total - 1;

  if (!game.revealed) {
    return `
      <p class="progress">Joueur ${i + 1} / ${total}</p>
      <div class="card center">
        <p>Passe le téléphone à</p>
        <p class="big-name">${esc(p.name)}</p>
        <p class="muted">Les autres, ne regardez pas l'écran !</p>
      </div>
      <button class="primary" data-action="show-word">Voir mon mot</button>`;
  }

  const secret = p.role === 'white'
    ? `<p class="label">Tu es</p>
       <p class="white">Mr White</p>
       <p class="muted">Tu n'as pas de mot. Écoute les autres et bluffe !</p>`
    : `<p class="label">Ton mot est</p>
       <p class="word">${esc(wordOf(p))}</p>
       <p class="muted">Mémorise-le, puis masque l'écran.</p>`;

  return `
    <p class="progress">${esc(p.name)} · joueur ${i + 1} / ${total}</p>
    <div class="card secret">${secret}</div>
    <button class="primary" data-action="hide-word">
      ${isLast ? 'Masquer et lancer la partie' : 'Masquer et passer au suivant'}
    </button>`;
}

function screenPlay() {
  const order = speakingOrder();
  const items = order.map(i => `<li>${esc(game.players[i].name)}</li>`).join('');
  return `
    <header>
      <h1>Manche ${game.round}</h1>
      <p class="sub">${plural(order.length, 'joueur en jeu', 'joueurs en jeu')}</p>
    </header>
    <div class="card">
      <p><strong>${esc(game.players[game.starter].name)}</strong> commence.</p>
      <p class="hint" style="margin-top:6px">
        Chacun son tour, donnez un indice (un mot ou une courte phrase) sur votre mot,
        sans le prononcer.
      </p>
    </div>
    <ol class="order">${items}</ol>
    <button class="primary" data-action="to-vote">Passer au vote</button>
    <button class="danger" data-action="quit">Abandonner la partie</button>`;
}

function screenVote() {
  const buttons = aliveIdx().map(i => `
    <button class="pick ${game.selected === i ? 'selected' : ''}" data-action="select" data-idx="${i}">
      ${esc(game.players[i].name)}
    </button>`).join('');
  return `
    <header>
      <h1>Vote</h1>
      <p class="sub">Qui le groupe élimine-t-il ?</p>
    </header>
    <div class="pick-list">${buttons}</div>
    <button class="primary" data-action="confirm-vote" ${game.selected === null ? 'disabled' : ''}>
      Éliminer ce joueur
    </button>
    <button class="secondary" data-action="back-play">Retour</button>`;
}

function screenGuess() {
  const p = game.players[game.lastOut];
  return `
    <header>
      <h1>Mr White démasqué !</h1>
    </header>
    <div class="card center">
      <p><strong>${esc(p.name)}</strong> était Mr White.</p>
      <p class="hint" style="margin-top:8px">
        Dernière chance : devine le mot des civils pour remporter la partie.
      </p>
    </div>
    <input type="text" id="guess" placeholder="Le mot des civils…" autocomplete="off" autocapitalize="none">
    <button class="primary" data-action="submit-guess" id="guess-btn">Valider ma réponse</button>`;
}

function screenResult() {
  const p = game.players[game.lastOut];
  return `
    <header><h1>Élimination</h1></header>
    <div class="card center">
      <p><strong>${esc(p.name)}</strong> est éliminé(e).</p>
      <p class="role role-${p.role}">${ROLE_LABEL[p.role]}</p>
      ${game.message ? `<p>${esc(game.message)}</p>` : ''}
    </div>
    <button class="primary" data-action="continue">Continuer</button>`;
}

function screenEnd() {
  const titles = {
    civils: '🎉 Les civils gagnent !',
    infiltres: '😈 Les infiltrés gagnent !',
    white: '🎭 Mr White gagne en devinant le mot !'
  };
  const rows = game.players.map(p => `
    <li class="${p.alive ? '' : 'dead'}">
      <span>${esc(p.name)}<small>${p.role === 'white' ? 'Pas de mot' : esc(wordOf(p))}</small></span>
      <span class="role role-${p.role}" style="margin:0">${ROLE_LABEL[p.role]}</span>
    </li>`).join('');
  return `
    <div class="card winner ${game.winner}">${titles[game.winner]}</div>
    <div class="card">
      <div class="words">
        <div><span class="muted">Mot des civils</span><strong>${esc(game.civilWord)}</strong></div>
        <div><span class="muted">Mot de l'undercover</span><strong>${esc(game.underWord)}</strong></div>
      </div>
    </div>
    <ul class="recap">${rows}</ul>
    <button class="primary" data-action="replay">Rejouer avec les mêmes joueurs</button>
    <button class="secondary" data-action="new">Changer les joueurs</button>`;
}

/* ---------- Rendu ---------- */

function render(scrollTop = true) {
  let html;
  if (!game) {
    html = screenSetup();
  } else {
    switch (game.phase) {
      case 'reveal': html = screenReveal(); break;
      case 'play': html = screenPlay(); break;
      case 'vote': html = screenVote(); break;
      case 'guess': html = screenGuess(); break;
      case 'result': html = screenResult(); break;
      case 'end': html = screenEnd(); break;
    }
  }
  $app.innerHTML = html;
  if (scrollTop) window.scrollTo(0, 0);
}

/* ---------- Événements ---------- */

$app.addEventListener('input', e => {
  const el = e.target;
  if (el.matches('input[data-idx]')) {
    ui.names[Number(el.dataset.idx)] = el.value;
    ui.error = '';
    saveSettings();
  }
});

$app.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'guess') {
    document.getElementById('guess-btn').click();
  }
});

$app.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const idx = Number(el.dataset.idx);

  switch (el.dataset.action) {
    /* Écran de configuration */
    case 'add':
      if (ui.names.length < MAX_PLAYERS) {
        ui.names.push('');
        saveSettings();
        render(false);
        const inputs = $app.querySelectorAll('input[data-idx]');
        inputs[inputs.length - 1]?.focus();
      }
      break;
    case 'remove':
      if (ui.names.length > MIN_PLAYERS) {
        ui.names.splice(idx, 1);
        saveSettings();
        render(false);
      }
      break;
    case 'toggle-white':
      ui.white = el.checked;
      saveSettings();
      render(false);
      break;
    case 'start': {
      const names = ui.names.map((n, i) => n.trim() || `Joueur ${i + 1}`);
      if (new Set(names.map(n => n.toLowerCase())).size !== names.length) {
        ui.error = 'Deux joueurs ont le même nom.';
        render(false);
        return;
      }
      ui.error = '';
      startGame(names, whiteActive());
      break;
    }

    /* Distribution des mots */
    case 'show-word':
      game.revealed = true;
      render();
      break;
    case 'hide-word':
      game.revealed = false;
      game.revealIndex += 1;
      if (game.revealIndex >= game.players.length) {
        pickStarter();
        game.phase = 'play';
      }
      render();
      break;

    /* Déroulement */
    case 'to-vote':
      game.selected = null;
      game.phase = 'vote';
      render();
      break;
    case 'back-play':
      game.phase = 'play';
      render();
      break;
    case 'select':
      game.selected = idx;
      render(false);
      break;
    case 'confirm-vote':
      if (game.selected !== null) eliminate(game.selected);
      break;
    case 'submit-guess': {
      const guess = document.getElementById('guess').value.trim();
      if (!guess) return;
      if (normalize(guess) === normalize(game.civilWord)) {
        game.winner = 'white';
        game.phase = 'end';
      } else {
        game.message = `Mr White a proposé « ${guess} » : raté !`;
        game.phase = 'result';
      }
      render();
      break;
    }
    case 'continue':
      nextAfterResult();
      break;
    case 'quit':
      if (confirm('Abandonner la partie en cours ?')) {
        game = null;
        render();
      }
      break;

    /* Fin de partie */
    case 'replay':
      startGame(game.names, game.white);
      break;
    case 'new':
      game = null;
      render();
      break;
  }
});

/* ---------- Démarrage + service worker (PWA) ---------- */

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* hors HTTPS : ignoré */ });
  });
}
