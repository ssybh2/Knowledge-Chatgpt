import test from 'node:test';
import assert from 'node:assert/strict';
import { scanRestrictedText, scanCandidateFields } from '../src/policy.js';

test('blocks credential-like content without returning the secret', () => {
  assert.ok(scanRestrictedText('Authorization: Bearer abc123').includes('credential_secret'));
  assert.ok(scanRestrictedText('我的 API key 是 sk-example-value').includes('credential_secret'));
  assert.ok(scanRestrictedText('一次性验证码 OTP 123456').includes('credential_secret'));
});

test('detects valid payment card candidates with Luhn and ignores invalid digit runs', () => {
  assert.ok(scanRestrictedText('card 4242 4242 4242 4242').includes('payment_card'));
  assert.ok(!scanRestrictedText('number 4242 4242 4242 4241').includes('payment_card'));
});

test('does not treat opaque ids embedded in longer numeric runs as payment/contact data', () => {
  assert.deepEqual(scanRestrictedText('sm_00000000000000000000000000000001'), []);
  assert.deepEqual(scanRestrictedText('mem_00000000000000000000000000000001'), []);
});

test('blocks health/PHI-like content conservatively', () => {
  assert.ok(scanRestrictedText('体检报告和同型半胱氨酸结果').includes('health_phi'));
  assert.ok(scanRestrictedText('patient diagnosis and lab result').includes('health_phi'));
});

test('blocks authentication records, contact details and raw attachment markers', () => {
  assert.ok(scanRestrictedText('authentication login history').includes('auth_security_record'));
  assert.ok(scanRestrictedText('contact me at person@example.com').includes('precise_contact_or_address'));
  assert.ok(scanRestrictedText('file://private/report.pdf').includes('attachment_or_unreviewed_binary'));
});

test('does not block ordinary technical project text', () => {
  assert.deepEqual(scanRestrictedText('EtherCAT PWM 舵机控制项目进度'), []);
});

test('candidate field scan returns unique reason codes across fields', () => {
  assert.deepEqual(
    scanCandidateFields({ title: 'Project', summary: 'safe summary', keywords: ['EtherCAT'] }),
    []
  );
  assert.deepEqual(
    scanCandidateFields({ title: 'API key', summary: 'Authorization: Bearer value', keywords: [] }),
    ['credential_secret']
  );
});
