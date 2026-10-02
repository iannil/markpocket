#!/usr/bin/env node
/**
 * markpocket API E2E test runner
 *
 * Parses YAML test files from tests/e2e/api/ and executes them against
 * a running markpocket instance.
 *
 * Usage:
 *   node tests/run-api-tests.cjs              # run all files
 *   node tests/run-api-tests.cjs 00-auth.yaml  # single file
 *   BASE_URL=http://localhost:3000 node tests/run-api-tests.cjs
 */

const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

// Declared root devDependency (see package.json) — resolvable in any checkout.
const yaml = require('js-yaml');

const BASE = process.env.BASE_URL ?? 'http://localhost:7420';
// The server enforces same-Origin on tRPC + auth routes, so the runner must
// send an Origin the target instance trusts — derived from BASE_URL, not
// hardcoded, so non-7420 targets (CI, compose) pass the check.
const ORIGIN = new URL(BASE).origin;
const TESTS_DIR = join(__dirname, 'e2e', 'api');

// ── State ──
const env = {};
let passed = 0,
  failed = 0,
  skipped = 0;
let authCookie = '';

const hasOwn = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

function resolve(val, ctx) {
  if (typeof val === 'string') {
    let m = val.match(/^\$ref:(\w+)$/);
    if (m) {
      if (!hasOwn(env, m[1]) && !hasOwn(ctx, m[1]))
        throw new Error(`Unknown variable reference: ${val}`);
      return env[m[1]] ?? ctx?.[m[1]] ?? null;
    }
    // $env:NAME — read from the runner's environment (documented in
    // tests/e2e/README.md).
    m = val.match(/^\$env:(\w+)$/);
    if (m) {
      if (!hasOwn(process.env, m[1])) throw new Error(`Unknown variable reference: ${val}`);
      return process.env[m[1]];
    }
    if (val.includes('$random_uuid')) return val.replace('$random_uuid', randomUUID().slice(0, 8));
    // $response.body[.result.data][.path...| [N]...] — the full path is
    // resolved via getByPath (dots + [N] indices). The old single-segment
    // regex let paths like `$response.body.user.email` fall through and
    // register as the literal string — a silent fake green. Unresolvable
    // references throw, same fail-loud rule as `Unknown assert`.
    m = val.match(/^\$response\.body(?:\.result\.data)?([.\[][\w.[\]]*)?$/);
    if (m) {
      const path = m[1];
      const resolved = path ? getByPath(ctx, path) : (ctx ?? null);
      if (path && (ctx == null || resolved === undefined))
        throw new Error(`Unknown variable reference: ${val}`);
      return resolved;
    }
    // Resolve any $ref:/ $env: occurrences inside longer strings
    val = val.replace(/\$ref:(\w+)/g, (_, k) => {
      if (!hasOwn(env, k) && !hasOwn(ctx, k))
        throw new Error(`Unknown variable reference: $ref:${k}`);
      return String(env[k] ?? ctx?.[k] ?? '');
    });
    val = val.replace(/\$env:(\w+)/g, (_, k) => {
      if (!hasOwn(process.env, k)) throw new Error(`Unknown variable reference: $env:${k}`);
      return process.env[k];
    });
  }
  return val;
}

function deepResolve(obj, ctx) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((v) => deepResolve(v, ctx));
  if (typeof obj === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(obj)) r[k] = deepResolve(v, ctx);
    return r;
  }
  if (typeof obj === 'string') return resolve(obj, ctx);
  return obj;
}

async function callTrpc(procedure, body, cookie) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  if (cookie) headers['Cookie'] = cookie;
  // tRPC batch format: wrap input as {"0": body}
  const batchInput = JSON.stringify({ 0: body ?? {} });
  const isQuery =
    /^(list|get|resolve|me|exportBase|getBase|getTables|getRecords|listByBase|listByTable|listUsers|getSession)$/.test(
      procedure.split('.').pop(),
    );
  // Queries carry their input in the URL (tRPC GET convention); mutations
  // POST it as the JSON body — large inputs would otherwise blow the request
  // line against the server's maxHeaderSize.
  const url = `${BASE}/api/trpc/${procedure}?batch=1`;
  if (isQuery) {
    const res = await fetch(`${url}&input=${encodeURIComponent(batchInput)}`, {
      method: 'GET',
      headers,
    });
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      return { status: res.status, body: Array.isArray(parsed) ? parsed[0] : parsed };
    } catch {
      return { status: res.status, body: text };
    }
  } else {
    const res = await fetch(url, { method: 'POST', headers, body: batchInput });
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      return { status: res.status, body: Array.isArray(parsed) ? parsed[0] : parsed };
    } catch {
      return { status: res.status, body: text };
    }
  }
}

async function callAuth(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  // Capture auth cookie from set-cookie header
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const m = setCookie.match(/(markpocket\.session_token[^;]+)/);
    if (m) authCookie = m[1];
  }
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

function extractResult(resp) {
  // tRPC batch envelope: [{ "result": { "data": ... } }] or { "result": { "data": ... } }
  return resp?.body?.result?.data ?? resp?.body?.data ?? resp?.body;
}

function extractHttpStatus(resp) {
  // tRPC returns HTTP 200 even for errors; check the body for a tRPC error
  if (resp?.body?.error?.data?.httpStatus) return resp.body.error.data.httpStatus;
  if (resp?.body?.error) return 400; // Generic tRPC error
  return resp.status;
}

// Walk "a.b[0].c" paths against an object (numeric segments index arrays).
function getByPath(obj, path) {
  if (!path) return obj;
  const segs = path
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/^\.+/, '')
    .split('.');
  return segs.reduce((o, k) => (o == null ? o : o[k]), obj);
}

function checkAssert(assertText, resp, result) {
  const s = typeof assertText === 'string' ? assertText : assertText.assert;
  if (!s) return true;
  const httpStatus = extractHttpStatus(resp);

  // `===`/`!==` are NOT supported operators. The matchers below would happily
  // match the `==`/`!=` inside them and shift the expected value —
  // `$x !== "y"` parsed as op `!=` expecting `"= y"` (always true), a silent
  // fake green. Reject before any matcher runs, same fail-loud rule as the
  // Unknown assert at the bottom.
  if (s.includes('===') || s.includes('!=='))
    throw new Error(`Unknown assert: ${JSON.stringify(s)}`);

  let m = s.match(/^\$status\s*(==|!=)\s*(\d+)/);
  if (m) {
    const expected = parseInt(m[2]);
    if (m[1] === '==' && httpStatus !== expected)
      throw new Error(
        `Status ${httpStatus} !== ${expected} (resp body: ${JSON.stringify(resp?.body).slice(0, 100)})`,
      );
    if (m[1] === '!=' && httpStatus === expected)
      throw new Error(`Status ${httpStatus} == ${expected} (expected !=)`);
    return true;
  }

  m = s.match(/^\$response\.body(?:\..+)?\s+(is not null|is null|is array)/);
  if (m) {
    if (m[1] === 'is not null' && result == null) throw new Error(`Expected result to be not null`);
    if (m[1] === 'is null' && result != null)
      throw new Error(`Expected result to be null, got ${JSON.stringify(result)}`);
    if (m[1] === 'is array' && !Array.isArray(result))
      throw new Error(`Expected array, got ${typeof result}`);
    return true;
  }

  m = s.match(
    /^\$response\.body(?:\.result\.data)?(?:\.result)?(?:\.data)?\.?([\w.[\]]+)?\s*(==|!=|contains|startswith|endswith)\s*(\S.*)?/,
  );
  if (m) {
    const fieldPath = m[1];
    const op = m[2];
    let expected = (m[3] ?? '').trim().replace(/^['"]|['"]$/g, '');
    let val = getByPath(result, fieldPath);
    let sVal = String(val ?? '');
    // Resolve $ref:/$env: in expected value
    if (/^\$(ref|env):/.test(expected)) {
      expected = resolve(expected, result) ?? '';
    }
    sVal = String(val ?? '');
    if (op === '==' && sVal !== expected)
      throw new Error(`Expected "${fieldPath || 'result'}" == "${expected}", got "${sVal}"`);
    if (op === '!=' && sVal === expected)
      throw new Error(`Expected "${fieldPath || 'result'}" != "${expected}"`);
    if (op === 'contains' && !sVal.includes(expected))
      throw new Error(`Expected "${sVal}" to contain "${expected}"`);
    if (op === 'startswith' && !sVal.startsWith(expected))
      throw new Error(`Expected "${sVal}" to start with "${expected}"`);
    if (op === 'endswith' && !sVal.endsWith(expected))
      throw new Error(`Expected "${sVal}" to end with "${expected}"`);
    return true;
  }

  m = s.match(/^\$response\.body\.(\w+)\s*(==|!=)\s*(.*)/);
  if (m) {
    const expected = m[3].trim().replace(/^['"]|['"]$/g, '');
    const val = String(result?.[m[1]] ?? '');
    if (m[2] === '==' && val !== expected)
      throw new Error(`Expected ${m[1]} == "${expected}", got "${val}"`);
    return true;
  }

  // Unrecognized assert syntax must NOT silently pass (fake green) — a typo'd
  // assert used to be a no-op.
  throw new Error(`Unknown assert: ${JSON.stringify(s)}`);
}

async function runTest(test) {
  const name = test.name || 'unnamed';
  process.stdout.write(`  ${name} ... `);

  // Optional gate: a test declaring `requires_env: VAR` (or
  // `requires_env: [VAR, ...]`) runs only when every listed env var is set to
  // a truthy value; otherwise it is skipped. Used for scenarios that need a
  // specially-configured server (e.g. DISABLE_SIGNUP) or pre-existing
  // accounts (E2E_EXISTING_*).
  if (test.requires_env) {
    const required = Array.isArray(test.requires_env) ? test.requires_env : [test.requires_env];
    const missing = required.filter((name) => {
      const v = (process.env[name] ?? '').trim();
      return !v || ['0', 'false', 'no', 'off'].includes(v.toLowerCase());
    });
    if (missing.length > 0) {
      process.stdout.write(`SKIP (requires_env ${missing.join(', ')} not set or falsy)\n`);
      skipped++;
      return;
    }
  }

  try {
    let lastResult = null;

    for (const step of test.steps || []) {
      const action = step.action || '';
      const body = deepResolve(step.body || {}, lastResult);
      // `no_auth: true` on a step sends it WITHOUT the captured session
      // cookie — otherwise the runner's sticky authCookie (from an earlier
      // sign-up in the same file) leaks into "unauthenticated" tests.
      const cookie = step.no_auth ? '' : authCookie;

      const m = action.match(/^POST\s+\/api\/trpc\/(.+)/);
      const authM = action.match(/^POST\s+\/api\/auth\/(.+)/);

      let resp;
      if (m) {
        resp = await callTrpc(m[1], body, cookie);
      } else if (authM) {
        resp = await callAuth(`/api/auth/${authM[1]}`, body);
      } else {
        throw new Error(`Unparseable action: ${action}`);
      }

      const result = extractResult(resp);
      lastResult = result;

      if (step.register) {
        for (const [k, v] of Object.entries(step.register)) {
          env[k] = resolve(v, result);
        }
      }

      for (const assert of step.asserts ?? test.asserts ?? []) {
        checkAssert(assert, resp, result);
      }
    }

    for (const assert of test.asserts || []) {
      checkAssert(assert, { status: 0 }, lastResult);
    }

    process.stdout.write('PASS\n');
    passed++;
  } catch (e) {
    process.stdout.write(`FAIL: ${e.message}\n`);
    failed++;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let files;
  if (args.length > 0 && !args[0].startsWith('--')) {
    files = args.filter((f) => f.endsWith('.yaml'));
  } else {
    files = readdirSync(TESTS_DIR)
      .filter((f) => f.endsWith('.yaml'))
      .sort();
  }

  console.log(`\n# markpocket API E2E tests\n`);
  console.log(`Base URL: ${BASE}`);
  console.log(`Files: ${files.length} (${files.join(', ')})\n`);

  for (const file of files) {
    const content = readFileSync(join(TESTS_DIR, file), 'utf-8');
    const raw = yaml.load(content);
    const tests = Array.isArray(raw) ? raw : [raw];
    console.log(`## ${file} (${tests.length} tests)`);
    for (const test of tests) {
      await runTest(test);
    }
    console.log('');
  }

  console.log(`---\nResult: ${passed} passed, ${failed} failed, ${skipped} skipped\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
