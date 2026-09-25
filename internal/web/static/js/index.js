import { NAMES, el } from './langs.js';

function langItem(room, l) {
  return el('li', {},
    el('a', { className: 'lang-link', href: `/r/${room.id}?lang=${l}`, lang: l },
      el('span', {},
        el('strong', { textContent: NAMES[l] ?? l }),
        el('small', { lang: 'es', textContent: l === room.source ? 'Idioma original' : 'Traducción automática' }))));
}

function entry(room) {
  const status = el('span', { className: room.live ? 'status live' : 'status', textContent: room.live ? 'En vivo' : 'Sin transmisión' });
  const targets = room.targets.map((l) => NAMES[l] ?? l);
  const now = room.live && room.talkTitle ? `Ahora: ${room.talkTitle}. ` : '';
  const meta = `${now}Se habla en ${NAMES[room.source]}` + (targets.length ? `. Traducción a ${targets.join(' y ')}.` : '.');
  return el('li', { className: 'room' },
    el('div', { className: 'room-head' }, el('h2', { textContent: room.title }), status),
    el('p', { className: 'room-meta', textContent: meta }),
    el('ul', { className: 'lang-list', ariaLabel: `Idiomas de ${room.title}` },
      ...[room.source, ...room.targets].map((l) => langItem(room, l))));
}

async function load() {
  try {
    const rooms = await (await fetch('/api/rooms')).json();
    document.getElementById('rooms').replaceChildren(...rooms.map(entry));
  } catch {
    // keep the last rendered list; the next poll retries
  }
}

load();
setInterval(load, 10000);
