function normalizeCurriculum(curriculum, fallback = 'IB_PYP') {
  return String(curriculum || fallback).trim().replace(/ /g, '_');
}

module.exports = { normalizeCurriculum };
