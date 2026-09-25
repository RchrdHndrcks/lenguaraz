// Writes a realistic transcript for sala-a (EN → ES, PT) and sala-b (ES → EN)
// into the directory given as argv[2], so the captured screens show real
// translations instead of the -fake engine's "[es] …" tags.
import fs from 'node:fs';

const dir = process.argv[2];
const a = [
  ['Good morning, Nerdearla!', '¡Buen día, Nerdearla!', 'Bom dia, Nerdearla!'],
  ['Today I want to talk about why open source needs accessibility.', 'Hoy quiero hablar de por qué el open source necesita accesibilidad.', 'Hoje quero falar sobre por que o open source precisa de acessibilidade.'],
  ['Every talk here is streamed to thousands of people.', 'Cada charla de acá se transmite a miles de personas.', 'Cada palestra aqui é transmitida para milhares de pessoas.'],
  ['But not everyone can hear it, and not everyone speaks English.', 'Pero no todos pueden escucharla, y no todos hablan inglés.', 'Mas nem todos podem ouvi-la, e nem todos falam inglês.'],
  ['Captions and translation should be part of the stage, not an extra.', 'Los subtítulos y la traducción tienen que ser parte del escenario, no un extra.', 'Legendas e tradução devem fazer parte do palco, não um extra.'],
  ["So let's see how we run Kubernetes and eBPF in production.", 'Así que veamos cómo corremos Kubernetes y eBPF en producción.', 'Então vamos ver como rodamos Kubernetes e eBPF em produção.'],
];
const b = [
  ['Bienvenidos a la Sala B.', 'Welcome to Room B.'],
  ['Vamos a hablar de observabilidad con eBPF.', 'We are going to talk about observability with eBPF.'],
  ['Arranquemos por un ejemplo real.', "Let's start with a real example."],
];
const t0 = Date.parse('2026-09-25T14:00:00Z');
const at = (i) => new Date(t0 + 4000 * i).toISOString();
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(`${dir}/sala-a.jsonl`, a.map(([en, es, pt], i) => JSON.stringify({ id: i, room: 'sala-a', talk: 1, talkTitle: 'Open source para todos', at: at(i), t0: 4 * i, t1: 4 * i + 4, lang: 'en', text: en, translations: { es, pt } })).join('\n') + '\n');
fs.writeFileSync(`${dir}/sala-b.jsonl`, b.map(([es, en], i) => JSON.stringify({ id: i, room: 'sala-b', talk: 1, talkTitle: 'Observabilidad con eBPF', at: at(i), t0: 4 * i, t1: 4 * i + 4, lang: 'es', text: es, translations: { en } })).join('\n') + '\n');
