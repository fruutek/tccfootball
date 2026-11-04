import { describe, expect, it } from 'vitest';
import { parseSdkConfig, validateProjectId } from '../scripts/setup-firebase';

describe('setup-firebase helpers', () => {
  it('parses the JS snippet printed by `firebase apps:sdkconfig web`', () => {
    const out = `// Copy and paste this into your JavaScript code to initialize the Firebase SDK.
// See https://firebase.google.com/docs/web/setup for more details.

firebase.initializeApp({
  "projectId": "tcc-mnf",
  "appId": "1:123456:web:abcdef",
  "storageBucket": "tcc-mnf.appspot.com",
  "apiKey": "AIzaSyExample",
  "authDomain": "tcc-mnf.firebaseapp.com",
  "messagingSenderId": "123456"
});`;
    expect(parseSdkConfig(out)).toEqual({ projectId: 'tcc-mnf', appId: '1:123456:web:abcdef', apiKey: 'AIzaSyExample', authDomain: 'tcc-mnf.firebaseapp.com' });
  });

  it('parses a JS object literal with unquoted keys, and plain JSON', () => {
    expect(parseSdkConfig("const firebaseConfig = { apiKey: 'k', projectId: 'p-roject', appId: 'a', };")).toMatchObject({ apiKey: 'k', projectId: 'p-roject' });
    expect(parseSdkConfig('{"apiKey":"k","appId":"a"}')).toEqual({ apiKey: 'k', appId: 'a' });
  });

  it('rejects text with no config in it', () => {
    expect(() => parseSdkConfig('nothing here')).toThrow(/No config object/);
  });

  it('validates project ids', () => {
    expect(validateProjectId('tcc-monday-night-football')).toBeNull();
    expect(validateProjectId('Bad_ID')).not.toBeNull();
    expect(validateProjectId('abc')).not.toBeNull();
  });
});
