export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Lucide 0.468.0, local assets; license in icons/lucide/LICENSE.
const names = new Set(['chart-no-axes-column', 'user-round', 'log-out', 'calendar-check', 'bus-front', 'settings', 'chevron-right', 'arrow-left', 'eye', 'eye-off']);
export function icon(name) {
  return names.has(name) ? `<span class="asset-icon icon-${name}" aria-hidden="true"></span>` : '';
}

export function bottomNav(section) {
  return [
    ['schedule', 'Расписание', 'calendar-check'],
    ['grades', 'Успеваемость', 'chart-no-axes-column'],
    ['buses', 'Автобусы', 'bus-front'],
  ].map(([path, label, glyph]) => `<a class="nav-item ${section === path ? 'active' : ''}" href="#/${path}" ${section === path ? 'aria-current="page"' : ''}><span class="nav-glyph">${icon(glyph)}</span><span>${label}</span></a>`).join('');
}
