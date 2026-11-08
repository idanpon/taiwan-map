import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeApiBase,readClientConfiguration,sessionStores,escapeHtml,trackTouchInput} from '../public/client-runtime.js';

test('both pages and the build share exact API origin/path validation',()=>{
  for(const good of ['', 'https://api.example.com','https://api.example.com/taiwan']) {
    assert.equal(normalizeApiBase(good),good);
    assert.equal(readClientConfiguration({apiBase:good}).configurationError,'');
  }
  for(const bad of ['http://api.example.com','https://api.example.com/','https://user:password@api.example.com','https://api.example.com?token=x','https://api.example.com/#x','https://api.example.com/../private']) {
    assert.throws(()=>normalizeApiBase(bad));
    assert.notEqual(readClientConfiguration({apiBase:bad}).configurationError,'');
  }
  assert.notEqual(readClientConfiguration({requiresApi:true}).configurationError,'');
  assert.notEqual(readClientConfiguration({authMode:'invalid'}).configurationError,'');
  assert.equal(escapeHtml('<script>"&\''),'&lt;script&gt;&quot;&amp;&#39;');
});

test('startup selects session storage when persistent storage is blocked',()=>{
  const sessionStorage={},localStorage={setItem(){throw Error('denied')}};
  assert.deepEqual(sessionStores({sessionStorage,localStorage}),{storage:sessionStorage,legacyStorage:sessionStorage});
  const blocked={get sessionStorage(){throw Error('blocked')}};
  assert.deepEqual(sessionStores(blocked),{storage:undefined,legacyStorage:undefined});
});

test('touch input remains distinct from keyboard navigation and a mouse on a hybrid device',()=>{
  const document=new EventTarget();
  const attributes=new Set();
  document.documentElement={
    setAttribute:name=>attributes.add(name),
    removeAttribute:name=>attributes.delete(name),
    hasAttribute:name=>attributes.has(name),
    toggleAttribute:(name,force)=>force?attributes.add(name):attributes.delete(name)
  };
  trackTouchInput(document);
  document.dispatchEvent(Object.assign(new Event('pointerdown'),{pointerType:'touch'}));
  assert.equal(attributes.has('data-ui-touch'),true);
  document.dispatchEvent(new Event('keydown'));
  assert.equal(attributes.has('data-ui-touch'),false);
  document.dispatchEvent(new Event('touchstart'));
  assert.equal(attributes.has('data-ui-touch'),true);
  document.dispatchEvent(Object.assign(new Event('pointermove'),{pointerType:'mouse'}));
  assert.equal(attributes.has('data-ui-touch'),false);
});
