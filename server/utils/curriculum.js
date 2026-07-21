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
    'CBSE':          'NCERT',
    'cbse':          'NCERT',
    'Cbse':          'NCERT',
    // ICSE and NIOS are distinct boards with their own syllabi — content for
    // them has not been ingested yet. Map to their own canonical names (not
    // NCERT) so the UI can correctly show "Content Coming Soon" instead of
    // silently serving NCERT/CBSE content under the wrong board's label.
    'ICSE':          'ICSE',
    'icse':          'ICSE',
    'Icse':          'ICSE',
    'NIOS':          'NIOS',
    'nios':          'NIOS',
    'Nios':          'NIOS',
  };

  return canonicalMap[value] ?? value;
}

module.exports = { normalizeCurriculum };
