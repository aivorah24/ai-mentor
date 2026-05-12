function normalizeCurriculum(curriculum, fallback = 'IB_PYP') {
  const value = String(curriculum || fallback).trim();
  const knownCurricula = new Set([
    'NCERT',
    'Cambridge',
    'Oxford',
    'Pearson',
    'Hodder',
    'Arrow',
    'Singapore MOE',
  ]);

  if (knownCurricula.has(value)) return value;
  if (value === 'Singapore_MOE') return 'Singapore MOE';

  return value.replace(/ /g, '_');
}

module.exports = { normalizeCurriculum };
