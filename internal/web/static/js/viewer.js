import { NAMES } from './langs.js';

const MAX_LINES = { mobile: 500, screen: 3, overlay: 2 };

// The page speaks the language the reader chose for the captions.
const UI = {
  es: {
    back: '‹ Salas', language: 'Idioma', settings: 'Ajustes de lectura', 'settings-short': 'Ajustes', captions: 'Subtítulos',
    'waiting-title': 'Todavía no hay subtítulos', waiting: 'Van a aparecer acá apenas empiece la charla.',
    scan: 'Escaneá para leer en tu idioma', follow: '↓ Ir a lo último', close: 'Cerrar', size: 'Tamaño del texto',
    'size-0': 'Normal', 'size-1': 'Grande', 'size-2': 'Muy grande', 'size-3': 'Enorme',
    colors: 'Colores', 'theme-auto': 'Como el dispositivo', 'theme-light': 'Fondo claro', 'theme-dark': 'Fondo oscuro',
    'theme-contrast': 'Alto contraste', 'theme-contrast-hint': 'Blanco y amarillo sobre negro',
    text: 'Texto', spacing: 'Más espacio entre letras y líneas', 'spacing-hint': 'Puede ayudar con dislexia o baja visión',
    'show-original': 'Mostrar el original debajo de la traducción', untranslated: '(sin traducir)',
    live: 'En vivo', offline: 'Sin transmisión', download: 'Descargar la transcripción', 'this-talk': 'Esta charla', 'whole-room': 'Toda la sala', notfound: 'No encontramos esa sala.',
  },
  en: {
    back: '‹ Rooms', language: 'Language', settings: 'Reading settings', 'settings-short': 'Settings', captions: 'Captions',
    'waiting-title': 'No captions yet', waiting: 'They will show up here as soon as the talk starts.',
    scan: 'Scan to read in your language', follow: '↓ Jump to latest', close: 'Close', size: 'Text size',
    'size-0': 'Normal', 'size-1': 'Large', 'size-2': 'Very large', 'size-3': 'Huge',
    colors: 'Colors', 'theme-auto': 'Same as my device', 'theme-light': 'Light background', 'theme-dark': 'Dark background',
    'theme-contrast': 'High contrast', 'theme-contrast-hint': 'White and yellow on black',
    text: 'Text', spacing: 'More space between letters and lines', 'spacing-hint': 'Can help with dyslexia or low vision',
    'show-original': 'Show the original under the translation', untranslated: '(not translated)',
    live: 'Live', offline: 'Not streaming', download: 'Download the transcript', 'this-talk': 'This talk', 'whole-room': 'The whole room', notfound: 'We could not find that room.',
  },
  pt: {
    back: '‹ Salas', language: 'Idioma', settings: 'Ajustes de leitura', 'settings-short': 'Ajustes', captions: 'Legendas',
    'waiting-title': 'Ainda não há legendas', waiting: 'Elas vão aparecer aqui assim que a palestra começar.',
    scan: 'Escaneie para ler no seu idioma', follow: '↓ Ir para o mais recente', close: 'Fechar', size: 'Tamanho do texto',
    'size-0': 'Normal', 'size-1': 'Grande', 'size-2': 'Muito grande', 'size-3': 'Enorme',
    colors: 'Cores', 'theme-auto': 'Igual ao dispositivo', 'theme-light': 'Fundo claro', 'theme-dark': 'Fundo escuro',
    'theme-contrast': 'Alto contraste', 'theme-contrast-hint': 'Branco e amarelo sobre preto',
    text: 'Texto', spacing: 'Mais espaço entre letras e linhas', 'spacing-hint': 'Pode ajudar com dislexia ou baixa visão',
    'show-original': 'Mostrar o original abaixo da tradução', untranslated: '(sem tradução)',
    live: 'Ao vivo', offline: 'Sem transmissão', download: 'Baixar a transcrição', 'this-talk': 'Esta palestra', 'whole-room': 'A sala inteira', notfound: 'Não encontramos essa sala.',
  },
  fr: {
    back: '‹ Salles', language: 'Langue', settings: 'Réglages de lecture', 'settings-short': 'Réglages', captions: 'Sous-titres',
    'waiting-title': 'Pas encore de sous-titres', waiting: 'Ils apparaîtront ici dès le début de la conférence.',
    scan: 'Scannez pour lire dans votre langue', follow: '↓ Aller au plus récent', close: 'Fermer', size: 'Taille du texte',
    'size-0': 'Normale', 'size-1': 'Grande', 'size-2': 'Très grande', 'size-3': 'Énorme',
    colors: 'Couleurs', 'theme-auto': 'Comme mon appareil', 'theme-light': 'Fond clair', 'theme-dark': 'Fond sombre',
    'theme-contrast': 'Contraste élevé', 'theme-contrast-hint': 'Blanc et jaune sur noir',
    text: 'Texte', spacing: "Plus d'espace entre les lettres et les lignes", 'spacing-hint': 'Peut aider en cas de dyslexie ou de basse vision',
    'show-original': "Afficher l'original sous la traduction", untranslated: '(non traduit)',
    live: 'En direct', offline: 'Pas de diffusion', download: 'Télécharger la transcription', 'this-talk': 'Cette conférence', 'whole-room': 'Toute la salle',
    notfound: 'Salle introuvable.',
  },
  de: {
    back: '‹ Säle', language: 'Sprache', settings: 'Leseeinstellungen', 'settings-short': 'Einstellungen', captions: 'Untertitel',
    'waiting-title': 'Noch keine Untertitel', waiting: 'Sie erscheinen hier, sobald der Vortrag beginnt.',
    scan: 'Scannen, um in Ihrer Sprache zu lesen', follow: '↓ Zum Neuesten', close: 'Schließen', size: 'Textgröße',
    'size-0': 'Normal', 'size-1': 'Groß', 'size-2': 'Sehr groß', 'size-3': 'Riesig',
    colors: 'Farben', 'theme-auto': 'Wie mein Gerät', 'theme-light': 'Heller Hintergrund', 'theme-dark': 'Dunkler Hintergrund',
    'theme-contrast': 'Hoher Kontrast', 'theme-contrast-hint': 'Weiß und Gelb auf Schwarz',
    text: 'Text', spacing: 'Mehr Abstand zwischen Buchstaben und Zeilen', 'spacing-hint': 'Kann bei Legasthenie oder Sehschwäche helfen',
    'show-original': 'Original unter der Übersetzung anzeigen', untranslated: '(nicht übersetzt)',
    live: 'Live', offline: 'Keine Übertragung', download: 'Transkript herunterladen', 'this-talk': 'Dieser Vortrag', 'whole-room': 'Der ganze Saal',
    notfound: 'Diesen Saal gibt es nicht.',
  },
  it: {
    back: '‹ Sale', language: 'Lingua', settings: 'Impostazioni di lettura', 'settings-short': 'Impostazioni', captions: 'Sottotitoli',
    'waiting-title': 'Ancora nessun sottotitolo', waiting: 'Appariranno qui non appena inizia il talk.',
    scan: 'Scansiona per leggere nella tua lingua', follow: '↓ Vai al più recente', close: 'Chiudi', size: 'Dimensione del testo',
    'size-0': 'Normale', 'size-1': 'Grande', 'size-2': 'Molto grande', 'size-3': 'Enorme',
    colors: 'Colori', 'theme-auto': 'Come il dispositivo', 'theme-light': 'Sfondo chiaro', 'theme-dark': 'Sfondo scuro',
    'theme-contrast': 'Alto contrasto', 'theme-contrast-hint': 'Bianco e giallo su nero',
    text: 'Testo', spacing: 'Più spazio tra lettere e righe', 'spacing-hint': 'Può aiutare con dislessia o ipovisione',
    'show-original': "Mostra l'originale sotto la traduzione", untranslated: '(non tradotto)',
    live: 'In diretta', offline: 'Nessuna trasmissione', download: 'Scarica la trascrizione', 'this-talk': 'Questo talk', 'whole-room': 'Tutta la sala',
    notfound: 'Sala non trovata.',
  },
};

const params = new URLSearchParams(location.search);
const roomId = decodeURIComponent(location.pathname.split('/').pop());
const mode = Object.hasOwn(MAX_LINES, params.get('mode')) ? params.get('mode') : 'mobile';
document.body.dataset.mode = mode;
if (mode === 'overlay') document.documentElement.classList.add('transparent');
if (mode === 'screen') document.documentElement.dataset.theme = params.get('theme') ?? 'dark';
// OBS and projector setups are configured by URL, not by the settings dialog.
if (/^[0-3]$/.test(params.get('size') ?? '')) document.documentElement.dataset.size = params.get('size');
if (mode !== 'mobile' && /^[1-5]$/.test(params.get('lines') ?? '')) MAX_LINES[mode] = Number(params.get('lines'));
// Seconds a line stays up with nothing new (overlay default 8; 0 = forever),
// so a pause or the end of a talk does not leave old text burned in the stream.
const HOLD = Number(params.get('hold') ?? (mode === 'overlay' ? 8 : 0)) || 0;

const $ = (id) => document.getElementById(id);
const segments = new Map(); // id → segment
let room;
let lang;
let interim = '';
let live = false;
let talk = { n: 0, title: '' }; // the room's current talk, from its status

// ---------- preferences ----------
const PREFS_KEY = 'lenguaraz.prefs';
const prefs = { theme: 'auto', size: 0, spacing: false, orig: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* private mode */ }

function applyPrefs() {
  const d = document.documentElement;
  if (mode === 'mobile') {
    if (prefs.theme === 'auto') delete d.dataset.theme;
    else d.dataset.theme = prefs.theme;
  }
  if (prefs.spacing) d.dataset.spacing = 'wide';
  else delete d.dataset.spacing;
  if (prefs.size > 0) d.dataset.size = String(prefs.size);
  else delete d.dataset.size;
  for (const b of $('sizes').children) b.setAttribute('aria-pressed', String(Number(b.dataset.size) === prefs.size));
  for (const input of $('prefs').querySelectorAll('input[type=radio]')) input.checked = prefs[input.name] === input.value;
  $('pref-orig').checked = prefs.orig;
  $('pref-spacing').checked = prefs.spacing;
}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  applyPrefs();
  renderLines();
}

function wirePrefs() {
  $('prefs-open').onclick = () => $('prefs').showModal();
  for (const b of $('sizes').children) b.onclick = () => { prefs.size = Number(b.dataset.size); savePrefs(); };
  $('prefs').addEventListener('change', (e) => {
    const t = e.target;
    if (t.type === 'radio') prefs[t.name] = t.value;
    if (t.id === 'pref-orig') prefs.orig = t.checked;
    if (t.id === 'pref-spacing') prefs.spacing = t.checked;
    savePrefs();
  });
  // A click on the backdrop closes the sheet.
  $('prefs').addEventListener('click', (e) => { if (e.target === $('prefs')) $('prefs').close(); });
  applyPrefs();
}

// ---------- language of the page ----------
function t(key) {
  return (UI[lang] ?? UI.es)[key] ?? UI.es[key];
}

function translatePage() {
  document.documentElement.lang = lang;
  $('captions').lang = lang;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  }
  $('orig-row').hidden = lang === room.source;
  setLive(live);
}

function pickLang(langs) {
  if (langs.includes(params.get('lang'))) return params.get('lang');
  if (mode === 'mobile') {
    // A QR code or a shared link without ?lang: follow the reader's browser.
    for (const l of navigator.languages ?? []) {
      const code = l.slice(0, 2).toLowerCase();
      if (langs.includes(code)) return code;
    }
  }
  return room.targets[0] ?? room.source;
}

// ---------- captions ----------
function line(seg) {
  const p = document.createElement('p');
  const span = document.createElement('span');
  const translated = seg.lang === lang ? seg.text : seg.translations?.[lang];
  span.textContent = translated ?? seg.text;
  if (!translated) span.lang = seg.lang;
  p.append(span);
  if (!translated && seg.lang !== lang) {
    const note = document.createElement('small');
    note.className = 'note';
    note.textContent = t('untranslated');
    p.append(note);
  }
  if (translated && seg.lang !== lang && prefs.orig && mode === 'mobile') {
    const orig = document.createElement('small');
    orig.className = 'orig';
    orig.lang = seg.lang;
    orig.textContent = seg.text;
    p.append(orig);
  }
  return p;
}

function showsInterim() {
  return lang === room.source && interim !== '';
}

function nearBottom() {
  return window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
}

function renderLines({ fresh = false } = {}) {
  if (!room) return;
  const stick = nearBottom();
  const keep = Math.max(1, MAX_LINES[mode] - (mode !== 'mobile' && showsInterim() ? 1 : 0));
  const ordered = [...segments.values()].sort((a, b) => a.id - b.id).slice(-keep);
  $('lines').replaceChildren(...ordered.map(line));
  renderInterim();
  if (mode !== 'mobile') return;
  if (stick) window.scrollTo(0, document.body.scrollHeight);
  else if (fresh) $('follow').hidden = false;
}

function renderInterim() {
  const span = document.createElement('span');
  span.textContent = interim;
  $('interim').replaceChildren(...(showsInterim() ? [span] : []));
  $('empty').hidden = mode === 'overlay' || segments.size > 0 || showsInterim();
}

function setLive(on) {
  live = on;
  const badge = $('status');
  badge.textContent = on ? t('live') : t('offline');
  badge.classList.toggle('live', on);
}

function renderLangs() {
  const langs = [room.source, ...room.targets];
  $('langs').replaceChildren(...langs.map((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = NAMES[l] ?? l;
    b.lang = l;
    b.setAttribute('aria-pressed', String(l === lang));
    b.onclick = () => {
      lang = l;
      params.set('lang', l);
      history.replaceState(null, '', `?${params}`);
      renderAll();
    };
    return b;
  }));
}

function renderExports() {
  const names = { vtt: 'VTT (subtítulos web)', srt: 'SRT (subtítulos de video)', txt: 'TXT (texto)' };
  const group = (label, query) => {
    const links = ['txt', 'srt', 'vtt'].map((f) => {
      const a = document.createElement('a');
      a.href = `/export/${roomId}/${f}?lang=${lang}${query}`;
      a.textContent = f.toUpperCase();
      a.title = names[f];
      a.download = '';
      const li = document.createElement('li');
      li.append(a);
      return li;
    });
    const h = document.createElement('h3');
    h.textContent = label;
    const ul = document.createElement('ul');
    ul.append(...links);
    const div = document.createElement('div');
    div.append(h, ul);
    return div;
  };
  const groups = [group(t('whole-room'), '')];
  if (talk.n > 0) groups.unshift(group(talk.title ? `${t('this-talk')}: ${talk.title}` : t('this-talk'), `&talk=${talk.n}`));
  $('exports').replaceChildren(...groups);
}

function renderAll() {
  translatePage();
  renderLangs();
  renderExports();
  renderLines();
  $('screen-title').textContent = `${room.title} · ${NAMES[lang] ?? lang}`;
}

async function showQR() {
  if (mode !== 'screen' || params.get('qr') === '0') return;
  const img = $('qr').querySelector('img');
  img.src = `/qr/${encodeURIComponent(roomId)}`;
  img.alt = `QR: ${room.title}`;
  $('qr').hidden = false;
  try {
    const { url } = await (await fetch('/api/site')).json();
    const p = document.createElement('p');
    p.textContent = `${url.replace(/^https?:\/\//, '')}/r/${roomId}`;
    $('qr').append(p);
  } catch { /* the QR alone is enough */ }
}

function wireFollow() {
  window.addEventListener('scroll', () => { if (nearBottom()) $('follow').hidden = true; }, { passive: true });
  $('follow').onclick = () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    $('follow').hidden = true;
  };
}

async function main() {
  lang = UI[params.get('lang')] ? params.get('lang') : 'es';
  const rooms = await loadRooms();
  room = rooms.find((r) => r.id === roomId);
  if (!room) {
    const p = document.createElement('p');
    p.textContent = t('notfound');
    $('lines').replaceChildren(p);
    return;
  }
  lang = pickLang([room.source, ...room.targets]);
  document.title = `${room.title} · Lenguaraz`;
  $('title').textContent = room.title;
  wirePrefs();
  wireFollow();
  setLive(room.live);
  renderAll();
  showQR();
  keepOverlayLoadable();

  const events = new EventSource(`/events/${encodeURIComponent(roomId)}`);
  events.addEventListener('final', (e) => {
    const seg = JSON.parse(e.data);
    const fresh = !segments.has(seg.id);
    segments.set(seg.id, seg);
    if (segments.size > MAX_LINES.mobile + 50) segments.delete(Math.min(...segments.keys()));
    interim = '';
    renderLines({ fresh });
    if (fresh) freshText();
  });
  events.addEventListener('interim', (e) => {
    interim = JSON.parse(e.data).text;
    if (lang === room.source) {
      renderInterim();
      if (interim) freshText();
    }
  });
  events.addEventListener('status', (e) => {
    const st = JSON.parse(e.data);
    // The operator says which language is spoken in each transmission;
    // that one is the original, the room's others are translations.
    if (st.source && st.source !== room.source) {
      room.source = st.source;
      room.targets = st.targets ?? [];
      renderAll();
    }
    if (st.talk !== talk.n || (st.talkTitle ?? '') !== talk.title) {
      talk = { n: st.talk ?? 0, title: st.talkTitle ?? '' };
      renderExports();
    }
    setLive(st.live);
    if (!live) {
      interim = '';
      renderInterim();
    }
  });
  events.addEventListener('caught-up', () => { caughtUp = true; });
  events.onerror = () => { setLive(false); caughtUp = false; };
}

// ---------- hold: fade out after silence ----------
let caughtUp = false;
let holdTimer;
function freshText() {
  if (!HOLD || !caughtUp) return;
  $('captions').classList.remove('idle');
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => $('captions').classList.add('idle'), HOLD * 1000);
}

// OBS often loads its sources before the server is up: keep retrying.
async function loadRooms() {
  for (let wait = 1000; ; wait = Math.min(wait * 2, 10000)) {
    try {
      const res = await fetch('/api/rooms');
      if (res.ok) return await res.json();
    } catch { /* server not up yet */ }
    await new Promise((r) => setTimeout(r, wait));
  }
}

// ...but if the server is down when OBS loads the page itself, the retry
// above never runs. Save this page and what it loaded so /sw.js can serve
// them next time; the saved copy then waits in loadRooms. Needs a secure
// origin (localhost or https); elsewhere the overlay reloads by hand.
async function keepOverlayLoadable() {
  if (mode !== 'overlay' || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
    await document.fonts.ready; // so the saved copy has the typeface too
    const assets = performance.getEntriesByType('resource').map((e) => e.name)
      .filter((u) => new URL(u).origin === location.origin && new URL(u).pathname.startsWith('/static/'));
    await (await caches.open('overlay')).addAll([location.href, ...assets]);
  } catch { /* the overlay works without it */ }
}

if (HOLD) $('captions').classList.add('idle');
main();
