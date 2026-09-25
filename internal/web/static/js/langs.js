// Language names in their own language, as a reader looks for them.
export const NAMES = { en: 'English', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', it: 'Italiano' };

export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}
