import { COLORS } from '../config/constants.js';

export function safeLabelColor(v) {
  const [base, mode] = String(v ?? 'black').split('_');
  return COLORS.some(c => c[0] === base)
    ? base + (mode === 'light' || mode === 'dark' ? '_' + mode : '')
    : 'black';
}

export function colorOpts(sel) {
  return COLORS.map(c => `<option value="${c[0]}"${c[0] === sel ? ' selected' : ''}>${c[1]}</option>`).join('');
}
