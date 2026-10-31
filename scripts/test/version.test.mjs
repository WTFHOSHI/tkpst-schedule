import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseVersion } from '../version.mjs';
test('release metadata uses the exact CI build and commit without environment secrets',()=>{
 assert.deepEqual(releaseVersion('312dc8cccca8c893df48ec4baaefa26a19d4c6c6','63'),{version:'1.1.63',commit:'312dc8cccca8c893df48ec4baaefa26a19d4c6c6',build:'63'});
 assert.throws(()=>releaseVersion('secret token','63'));assert.throws(()=>releaseVersion('development','token'));
});


test('a prior deployment of the same commit cannot satisfy a new build check',async()=>{
 const {assertRelease}=await import('../release-check.mjs');
 const sha='312dc8cccca8c893df48ec4baaefa26a19d4c6c6';
 assert.doesNotThrow(()=>assertRelease(releaseVersion(sha,'63'),sha,'63'));
 assert.throws(()=>assertRelease(releaseVersion(sha,'62'),sha,'63'));
 assert.throws(()=>assertRelease(releaseVersion('0'.repeat(40),'63'),sha,'63'));
});
