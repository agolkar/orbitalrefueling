// tests/run.mjs
// Small local test runner. Runs with both Node and Deno.

import { tests as physicsTests } from './physics.test.mjs';
import { tests as rulesTests } from './rules.test.mjs';
import { tests as challengeTests } from './challenge.test.mjs';
import { tests as refuelTests } from './refuel.test.mjs';
import { tests as audioTests } from './audio.test.mjs';
import { tests as inputTests } from './input.test.mjs';

const tests = [...physicsTests, ...rulesTests, ...challengeTests, ...refuelTests, ...audioTests, ...inputTests];

let failed = 0;
let passed = 0;

for (const test of tests) {
  try {
    test.fn();
    passed += 1;
    console.log(`PASS ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${test.name}: ${error && error.message ? error.message : error}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  if (typeof Deno !== 'undefined') {
    Deno.exit(1);
  } else if (typeof process !== 'undefined') {
    process.exitCode = 1;
  }
}
