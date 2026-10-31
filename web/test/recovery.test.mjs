import test from 'node:test';
import assert from 'node:assert/strict';
import { authFormMarkup } from '../js/auth-view.js';
import { createAuthClient } from '../js/auth-client.js';
test('recovery asks only login and a new password and is reachable from login',()=>{
 const html=authFormMarkup('reset-password');
 assert.match(html,/data-auth-form="reset-password"/);
 assert.match(html,/autocomplete="new-password"/);
 assert.match(html,/minlength="6"/);
 assert.doesNotMatch(html,/name="(?:displayName|confirm|email)"/);
 assert.match(authFormMarkup('login'),/#\/reset-password/);
});
test('recovery client posts to private endpoint and clears its stale user',async()=>{
 let last;
 const c=createAuthClient(async(path,options)=>{last={path,options};return Response.json(path.endsWith('login')?{user:{id:'old'}}:{ok:true});});
 await c.authenticate('login',{});
 await c.resetPassword({username:'student',password:'новый6'});
 assert.equal(last.path,'/api/auth/reset-password');assert.equal(last.options.method,'POST');
 assert.equal(c.state().user,null);
});
