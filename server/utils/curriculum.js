function normalizeCurriculum(curriculum, fallback = 'IB PYP') {
  const value = String(curriculum || fallback).trim();

  // Map all known variants to their canonical Qdrant-stored form
  const canonicalMap = {
    'IB_PYP':        'IB PYP',
    'IB PYP':        'IB PYP',
    'IBPYP':         'IB PYP',
    'ib pyp':        'IB PYP',
    'ib_pyp':        'IB PYP',
    'NCERT':         'NCERT',
    'ncert':         'NCERT',
    'Cambridge':     'Cambridge',
    'Oxford':        'Oxford',
    'Pearson':       'Pearson',
    'Singapore MOE': 'Singapore MOE',
    'Singapore_MOE': 'Singapore MOE',
  };

  return canonicalMap[value] ?? value;
}

module.exports = { normalizeCurriculum };
