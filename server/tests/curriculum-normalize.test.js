const { normalizeCurriculum } = require('../utils/curriculum');

describe('normalizeCurriculum()', () => {
  test('normalizes IB PYP with spaces to underscore', () => {
    expect(normalizeCurriculum('IB PYP')).toBe('IB_PYP');
  });

  test('keeps already-normalized values unchanged', () => {
    expect(normalizeCurriculum('IB_PYP')).toBe('IB_PYP');
    expect(normalizeCurriculum('NCERT')).toBe('NCERT');
  });

  test('falls back when value is missing', () => {
    expect(normalizeCurriculum(undefined)).toBe('IB_PYP');
    expect(normalizeCurriculum('', 'CBSE')).toBe('CBSE');
  });
});
