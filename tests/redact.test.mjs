import test from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../tools/claude/hooks/lib/hook-io.mjs';

const j = (...parts) => parts.join('');

const CASES = [
  ['aws access key', j('AK', 'IA', 'IOSFODNN7EXAMPLE')],
  ['aws session key', j('AS', 'IA', 'IOSFODNN7EXAMPLE')],
  ['github token', j('gh', 'p', '_', 'a'.repeat(36))],
  ['github pat', j('github', '_pat_', 'b'.repeat(24))],
  ['llm api key', j('s', 'k', '-', 'c'.repeat(32))],
  ['slack token', j('xo', 'xb', '-', '1'.repeat(12), '-', 'd'.repeat(20))],
  ['google api key', j('AI', 'za', 'Sy', 'E'.repeat(33))],
  ['npm token', j('npm', '_', 'f'.repeat(36))],
  ['jwt', j('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJ4In0', '.', 'g'.repeat(20))],
  ['private key header', j('-----BEGIN ', 'RSA', ' PRIVATE KEY-----')],
];

test('every secret shape is fully removed, not merely annotated', () => {
  for (const [label, secret] of CASES) {
    const out = redact(`prefix ${secret} suffix`);
    assert.ok(!out.includes(secret), `${label}: the secret survived redaction -> ${out}`);
    assert.ok(out.includes('[REDACTED]'), `${label}: nothing was redacted -> ${out}`);
    assert.ok(out.startsWith('prefix ') && out.endsWith(' suffix'), `${label}: surrounding text was damaged -> ${out}`);
  }
});

test('a keyed assignment keeps its key and loses its value', () => {
  assert.equal(redact(j('token', '=', 'abcdefghijklmnop')), 'token=[REDACTED]');
  assert.equal(redact(j('password', ': ', 'hunter2hunter2')), 'password: [REDACTED]');
  assert.equal(redact(j('api_key', ' = "', 's3cr3tvalue', '"')), 'api_key = "[REDACTED]"');
  assert.equal(redact(j('Authorization', ': ', 'Bearer ', 'abcdefghijklmnopqrst')), 'Authorization: [REDACTED]');
});

test('keyed redaction is case insensitive', () => {
  assert.equal(redact(j('PASSWORD', '=', 'hunter2hunter2')), 'PASSWORD=[REDACTED]');
  assert.equal(redact(j('ApiKey', ': ', 'abcdefghijkl')), 'ApiKey: [REDACTED]');
});

test('several secrets in one string are all removed', () => {
  const a = j('gh', 'p', '_', 'a'.repeat(36));
  const b = j('AK', 'IA', 'IOSFODNN7EXAMPLE');
  const out = redact(`${a} and ${b}`);
  assert.ok(!out.includes(a));
  assert.ok(!out.includes(b));
  assert.equal(out, '[REDACTED] and [REDACTED]');
});

test('ordinary text is left alone', () => {
  for (const safe of [
    'deploy the service',
    'see https://example.com/docs',
    'skill=engineering:utilities:ship',
    'the password policy requires rotation',
    '',
  ]) {
    assert.equal(redact(safe), safe);
  }
});

test('non-string input does not throw', () => {
  assert.equal(redact(null), '');
  assert.equal(redact(undefined), '');
  assert.equal(redact(42), '42');
});

test('a secret reaching the audit record is redacted end to end', async () => {
  const { buildRecord } = await import('../tools/claude/hooks/skill-audit.mjs');
  const secret = j('AK', 'IA', 'IOSFODNN7EXAMPLE');

  const fromArgs = buildRecord({ tool_name: 'Skill', tool_input: { skill: 'x', args: `deploy with ${secret}` } }, 'now');
  assert.ok(!fromArgs.args.includes(secret), `args leaked the secret: ${fromArgs.args}`);

  const fromUnresolved = buildRecord({ tool_name: 'Skill', tool_input: { mystery: secret } }, 'now');
  assert.ok(!fromUnresolved.unresolved_input.includes(secret), `unresolved_input leaked the secret: ${fromUnresolved.unresolved_input}`);
});
