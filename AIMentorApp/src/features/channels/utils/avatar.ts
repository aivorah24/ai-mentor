// Shared avatar helpers for channels/messages — Toddle-style: first letter of
// first name + first letter of last name (e.g. "Prathyusha Eadala" -> "PE"),
// on a pastel background keyed off the name so it's stable per person.

export function initials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const PASTELS = ['#FDE2E2', '#FFF1D6', '#E2F5E9', '#E1F0FF', '#F0E6FA', '#FFE8F0', '#E6F7F5', '#F5F0DC'];
const PASTEL_TEXT = ['#B5504F', '#B5822B', '#3E8E63', '#3A6EA5', '#7A57A0', '#B54D82', '#3D8B84', '#8A7A2B'];

export function pastelBg(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PASTELS[h % PASTELS.length];
}
export function pastelText(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PASTEL_TEXT[h % PASTEL_TEXT.length];
}
