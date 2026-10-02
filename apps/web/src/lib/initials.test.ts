import { describe, expect, it } from 'vitest';

import { initials } from './initials';

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
  });

  it('handles single names', () => {
    expect(initials('ada')).toBe('A');
  });

  it('treats emails as two parts', () => {
    expect(initials('jane@example.com')).toBe('JE');
  });

  it('is empty for blank input', () => {
    expect(initials('')).toBe('');
    expect(initials('  ')).toBe('');
  });

  it('uppercases lowercase input', () => {
    expect(initials('john doe')).toBe('JD');
  });
});
