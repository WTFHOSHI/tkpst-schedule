import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticInfo, reportText } from '../js/support.js';
test('diagnostics retain versions but exclude personal/session data and full user agent',()=>{
 const info=diagnosticInfo({platform:'Android',osVersion:'15',appVersion:'1.0.63',build:'63',engine:'WebView 150.0',username:'secret-user',password:'secret-pass',token:'secret-token'},'Mozilla/5.0 (Linux; Android 15; private-model) AppleWebKit/537.36 Chrome/150.0.1.2 Mobile Safari/537.36');
 const text=reportText(info);
 assert.match(text,/Android/);assert.match(text,/1.0.63/);
 for(const secret of ['secret-user','secret-pass','secret-token','private-model','Mozilla'])assert.ok(!text.includes(secret));
 assert.ok(!Object.hasOwn(info,'username'));
});
test('browser fallback reports OS/engine and never copies arbitrary data',()=>{
 const text=reportText(diagnosticInfo(null,'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15'));
 assert.match(text,/iOS 18.4/);assert.match(text,/WebKit 605.1.15/);
 assert.doesNotMatch(text,/iPhone;/);
});
