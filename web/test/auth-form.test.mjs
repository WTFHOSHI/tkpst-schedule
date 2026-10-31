import test from 'node:test';
import assert from 'node:assert/strict';
import { authFormMarkup } from '../js/auth-view.js';

test('registration permits six-character passwords and preserves longer ones', () => {
  const markup = authFormMarkup('register');
  const passwords = [...markup.matchAll(/<input[^>]*type="password"[^>]*>/g)].map(m => m[0]);
  assert.equal(passwords.length, 2);
  for (const input of passwords) { assert.match(input, /minlength="6"/); assert.match(input, /maxlength="128"/); }
  assert.match(markup, /От 6 до 128/);
  assert.doesNotMatch(authFormMarkup('login'), /minlength=/);
});
