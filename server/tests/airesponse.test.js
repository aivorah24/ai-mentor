// tests/airesponse.test.js

function validateAIResponse(response) {
  const cleanResponse = (response || '').trim();

  return {
    hasText: cleanResponse.length > 0,

    notTooLong: cleanResponse.length < 300,

    containsEncouragement:
      /(great|good|nice|excellent|awesome|well done|amazing|correct|fantastic)/i.test(cleanResponse),

    containsAnswer:
      /(correct|answer|=|you have|result|total)/i.test(cleanResponse),

    childFriendly:
      cleanResponse.split(' ').length < 70,

    notRepetitive:
      !/(\b\w+\b)(\s+\1){2,}/i.test(cleanResponse),

    containsMathConcept:
      /(\+|\-|\*|\/|add|subtract|multiply|divide)/i.test(cleanResponse),

    noConfusingSymbols:
      !/[#@$%^&*_]{3,}/.test(cleanResponse),

    properSentenceStructure:
      /[.!?]$/.test(cleanResponse),

    hasPositiveTone:
      /(great|good|nice|excellent|awesome|amazing|proud|well done)/i.test(cleanResponse),

    readableLength:
      cleanResponse.split(' ').length >= 3,
  };
}

describe('AI Response Quality Tests', () => {

  test('valid optimized AI response should pass', () => {
    const response =
      'Correct! 2 + 1 = 3. You now have 3 pencils. Great job!';

    const result = validateAIResponse(response);

    expect(result.hasText).toBe(true);
    expect(result.notTooLong).toBe(true);
    expect(result.containsEncouragement).toBe(true);
    expect(result.containsAnswer).toBe(true);
    expect(result.childFriendly).toBe(true);
    expect(result.notRepetitive).toBe(true);
    expect(result.containsMathConcept).toBe(true);
    expect(result.noConfusingSymbols).toBe(true);
    expect(result.properSentenceStructure).toBe(true);
    expect(result.hasPositiveTone).toBe(true);
    expect(result.readableLength).toBe(true);
  });

  test('empty response should fail', () => {
    const result = validateAIResponse('');

    expect(result.hasText).toBe(false);
  });

  test('very long response should fail', () => {
    const response = 'Long AI response '.repeat(100);

    const result = validateAIResponse(response);

    expect(result.notTooLong).toBe(false);
  });

  test('missing encouragement should fail', () => {
    const result = validateAIResponse('2 + 1 = 3.');

    expect(result.containsEncouragement).toBe(false);
  });

  test('missing answer explanation should fail', () => {
    const result = validateAIResponse('Great job!');

    expect(result.containsAnswer).toBe(false);
  });

  test('repetitive response should fail', () => {
    const result = validateAIResponse('good good good');

    expect(result.notRepetitive).toBe(false);
  });

  test('math concept missing should fail', () => {
    const result = validateAIResponse('You are doing well today.');

    expect(result.containsMathConcept).toBe(false);
  });

  test('weird symbols should fail', () => {
    const result = validateAIResponse('### $$$ @@@');

    expect(result.noConfusingSymbols).toBe(false);
  });

  test('response without punctuation should fail', () => {
    const result = validateAIResponse('Correct answer is 3');

    expect(result.properSentenceStructure).toBe(false);
  });

  test('short unreadable response should fail', () => {
    const result = validateAIResponse('Yes');

    expect(result.readableLength).toBe(false);
  });

});