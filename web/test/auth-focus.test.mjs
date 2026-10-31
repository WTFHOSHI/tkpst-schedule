import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const bootstrap = source.slice(source.lastIndexOf('render();\nif (!staticHosting)'));
function setup(path) {
  let status = 'unavailable', user = null, renders = 0, settle;
  const listeners = {};
  const form = { enteredText: 'student', focused: true };
  const context = {
    staticHosting: false, currentPath: () => path,
    authPages: new Set(['account', 'login', 'register']),
    auth: { state: () => ({ user, status }), restore: () => new Promise(resolve => { settle = (nextUser = null) => { user = nextUser; status = 'ready'; resolve(); }; }) },
    $app: { querySelector: () => form },
    render: () => { renders++; },
    document: { hidden: false, addEventListener: (event, handler) => { listeners[event] = handler; } },
  };
  vm.runInNewContext(bootstrap, context);
  return { settle: user => settle(user), listeners, unavailable: () => { status = 'unavailable'; }, renders: () => renders };
}
for (const path of ['account', 'login', 'register']) {
  test('background session completion preserves the focused signed-out form at /' + path, async () => {
    const app = setup(path);
    app.settle(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.renders(), 1, 'must not replace the entered form');
  });
  test('return from keyboard/settings preserves the signed-out form at /' + path, async () => {
    const app = setup(path);
    app.settle(); await new Promise(resolve => setImmediate(resolve));
    const before = app.renders(); app.unavailable();
    const pending = app.listeners.visibilitychange(); app.settle(); await pending;
    assert.equal(app.renders(), before);
  });
}


test('successful session restoration still replaces the signed-out form', async () => {
  const app = setup('account');
  app.settle({ id: 'student' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.renders(), 2);
});
