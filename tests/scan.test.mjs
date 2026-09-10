import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, scanText, privateValueRules, isAllowed, matchGlob, preview } from '../scripts/checks/scan.mjs';
import { SAMPLES, CORPUS } from './fixtures/known-bad.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rules = loadRules();

const FAKE_GITHUB_TOKEN = ['ghp', 'a'.repeat(36)].join('_');

function rulesFor(text) {
  return new Set(scanText('fixture.txt', text, rules).map((f) => f.rule));
}

test('every rule in patterns.json compiles and has the required fields', () => {
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    assert.ok(rule.id, 'rule needs an id');
    assert.ok(['secret', 'pii'].includes(rule.severity), `${rule.id} has severity ${rule.severity}`);
    assert.ok(rule.title, `${rule.id} needs a title`);
    assert.ok(rule.regex instanceof RegExp);
  }
});

test('rule ids are unique', () => {
  const ids = rules.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the known-bad corpus trips every secret rule', () => {
  const hit = rulesFor(CORPUS);
  const missed = rules.filter((r) => r.severity === 'secret' && !hit.has(r.id)).map((r) => r.id);
  assert.deepEqual(missed, [], `secret rules with no fixture coverage: ${missed.join(', ')}`);
});

test('the known-bad corpus trips every pii rule', () => {
  const hit = rulesFor(CORPUS);
  const missed = rules.filter((r) => r.severity === 'pii' && !hit.has(r.id)).map((r) => r.id);
  assert.deepEqual(missed, [], `pii rules with no fixture coverage: ${missed.join(', ')}`);
});

test('each sample trips the specific rule it was written for', () => {
  for (const sample of SAMPLES) {
    const hit = rulesFor(sample.text);
    assert.ok(hit.has(sample.rule), `sample for ${sample.rule} did not trip it: ${sample.text.slice(0, 24)}`);
  }
});

test('the corpus is assembled at runtime so nothing detectable is ever committed', () => {
  const source = fs.readFileSync(path.join(here, 'fixtures', 'known-bad.mjs'), 'utf8');
  const findings = scanText('known-bad.mjs', source, rules);
  assert.deepEqual(
    findings.map((f) => `${f.rule}:${f.line}`),
    [],
    'the fixture source must not contain a complete literal, or third-party push protection will reject it',
  );
});

test('the clean corpus produces no findings', () => {
  const text = fs.readFileSync(path.join(here, 'fixtures', 'clean.txt'), 'utf8');
  const findings = scanText('clean.txt', text, rules);
  assert.deepEqual(findings.map((f) => `${f.rule}:${f.line}:${f.preview}`), []);
});

test('findings carry file, line and a stable fingerprint', () => {
  const text = `x\n${FAKE_GITHUB_TOKEN}\n`;
  const findings = scanText('a.txt', text, rules);
  const token = findings.find((f) => f.rule === 'github-token');
  assert.ok(token);
  assert.equal(token.file, 'a.txt');
  assert.equal(token.line, 2);
  assert.match(token.fingerprint, /^[0-9a-f]{16}$/);
  const again = scanText('a.txt', text, rules);
  assert.equal(again.find((f) => f.rule === 'github-token').fingerprint, token.fingerprint);
});

test('secret previews do not reproduce the whole secret', () => {
  const findings = scanText('a.txt', FAKE_GITHUB_TOKEN, rules);
  const token = findings.find((f) => f.rule === 'github-token');
  assert.ok(!token.preview.includes(FAKE_GITHUB_TOKEN));
  assert.ok(token.preview.includes('...'));
});

test('preview leaves short matches alone', () => {
  assert.equal(preview('short'), 'short');
});

test('private values are detected verbatim and case-insensitively', () => {
  const rule = privateValueRules({ MSK: 'my-internal-cluster' });
  assert.equal(rule.length, 1);
  assert.equal(rule[0].severity, 'secret');
  assert.equal(scanText('f.md', 'uses My-Internal-Cluster today', rule).length, 1);
  assert.equal(scanText('f.md', 'uses {{MSK}} today', rule).length, 0);
});

test('short private values are ignored to avoid noise', () => {
  assert.deepEqual(privateValueRules({ SHORT: 'abc' }), []);
});

test('non-string private values are ignored', () => {
  assert.deepEqual(privateValueRules({ N: 42, B: true, O: {} }), []);
});

test('allowlist matches on rule, file glob and fingerprint', () => {
  const finding = { file: 'docs/security.md', rule: 'bearer-token', fingerprint: 'abc123' };
  assert.ok(isAllowed(finding, [{ file: 'docs/*', rule: 'bearer-token' }]));
  assert.ok(isAllowed(finding, [{ fingerprint: 'abc123' }]));
  assert.ok(!isAllowed(finding, [{ file: 'tools/*', rule: 'bearer-token' }]));
  assert.ok(!isAllowed(finding, [{ rule: 'jwt' }]));
});

test('an empty allowlist entry never matches', () => {
  assert.ok(!isAllowed({ file: 'a', rule: 'b', fingerprint: 'c' }, [{ reason: 'no criteria' }]));
});

test('glob matching is anchored', () => {
  assert.ok(matchGlob('tests/fixtures/*', 'tests/fixtures/known-bad.txt'));
  assert.ok(!matchGlob('tests/fixtures/*', 'other/tests/fixtures/x.txt'));
  assert.ok(matchGlob('docs/security.md', 'docs/security.md'));
});

test('every allowlist entry states a reason', () => {
  const file = path.join(here, '..', 'security', 'allowlist.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const entry of config.entries) {
    assert.ok(entry.reason && entry.reason.length > 20, `entry ${JSON.stringify(entry)} needs a real reason`);
  }
});

test('no allowlist entry suppresses nothing', async () => {
  const { scanRepo } = await import('../scripts/checks/scan.mjs');
  const { stale } = scanRepo();
  assert.deepEqual(
    stale.map((e) => `${e.file ?? '*'} [${e.rule ?? 'any'}]`),
    [],
    'a stale entry hides no real finding and should be deleted so the allowlist stays a record of live decisions',
  );
});

test('the repo itself is free of secret-severity findings', async () => {
  const { scanRepo } = await import('../scripts/checks/scan.mjs');
  const { findings } = scanRepo();
  const secrets = findings.filter((f) => f.severity === 'secret');
  assert.deepEqual(secrets.map((f) => `${f.file}:${f.line} ${f.rule}`), []);
});
