import { describe, expect, test } from 'vitest';
import { classifyUrl } from './urls';

describe('classifyUrl', () => {
  test.each(['https://a.example/x?y=1', 'http://b.example'])('opens %s', (u) => expect(classifyUrl(u)).toBe('open'));

  test.each([
    'javascript:alert(1)', 'file:///Users/x/a.pdf', 'chrome://settings', 'edge://flags',
    'about:blank', 'data:text/html,hi', 'chrome-extension://abc/page.html',
  ])('keeps %s as bookmark only', (u) => expect(classifyUrl(u)).toBe('bookmarkOnly'));

  test.each(['', 'not a url', 'ftp://old.example', 'arc://boost/1', 'HTTPS//missing-colon'])('skips %s', (u) =>
    expect(classifyUrl(u)).toBe('skip'));

  test('scheme is case-insensitive', () => expect(classifyUrl('HTTPS://A.EXAMPLE')).toBe('open'));
});
