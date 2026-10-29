import assert from 'node:assert/strict';
import {
  AI_TURN_DELAY_MAX_MS,
  AI_TURN_DELAY_MIN_MS,
  TRICK_RESOLVED_DELAY_MS,
  getAiTurnDelayMs,
  getTrickResolvedDelayMs,
} from './constants';

const KEYS = ['AI_TURN_DELAY_MIN_MS', 'AI_TURN_DELAY_MAX_MS', 'TRICK_RESOLVED_DELAY_MS'];

describe('delay env overrides', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('defaults are kept when nothing is set', () => {
    assert.equal(getTrickResolvedDelayMs(), TRICK_RESOLVED_DELAY_MS);
    assert.equal(getAiTurnDelayMs(() => 0), AI_TURN_DELAY_MIN_MS);
    assert.equal(getAiTurnDelayMs(() => 1), AI_TURN_DELAY_MAX_MS);
  });

  test('env values override the defaults', () => {
    process.env.TRICK_RESOLVED_DELAY_MS = '5';
    process.env.AI_TURN_DELAY_MIN_MS = '10';
    process.env.AI_TURN_DELAY_MAX_MS = '20';
    assert.equal(getTrickResolvedDelayMs(), 5);
    assert.equal(getAiTurnDelayMs(() => 0), 10);
    assert.equal(getAiTurnDelayMs(() => 1), 20);
  });

  test('0 is a valid override', () => {
    process.env.AI_TURN_DELAY_MIN_MS = '0';
    process.env.AI_TURN_DELAY_MAX_MS = '0';
    process.env.TRICK_RESOLVED_DELAY_MS = '0';
    assert.equal(getAiTurnDelayMs(), 0);
    assert.equal(getTrickResolvedDelayMs(), 0);
  });

  test('invalid values fall back to the defaults', () => {
    for (const bad of ['', 'abc', '-5', '1.5', '10ms']) {
      process.env.TRICK_RESOLVED_DELAY_MS = bad;
      process.env.AI_TURN_DELAY_MIN_MS = bad;
      process.env.AI_TURN_DELAY_MAX_MS = bad;
      assert.equal(getTrickResolvedDelayMs(), TRICK_RESOLVED_DELAY_MS, bad);
      assert.equal(getAiTurnDelayMs(() => 0), AI_TURN_DELAY_MIN_MS, bad);
      assert.equal(getAiTurnDelayMs(() => 1), AI_TURN_DELAY_MAX_MS, bad);
    }
  });

  test('the max never drops below an overridden min', () => {
    process.env.AI_TURN_DELAY_MIN_MS = '3000';
    assert.equal(getAiTurnDelayMs(() => 0), 3000);
    assert.equal(getAiTurnDelayMs(() => 1), 3000);
  });
});
