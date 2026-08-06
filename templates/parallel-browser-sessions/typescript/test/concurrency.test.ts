import assert from 'node:assert/strict';
import test from 'node:test';
import { allSettledWithConcurrency } from '../src/concurrency.js';

test('never runs more tasks than the concurrency limit', async () => {
  let active = 0;
  let maximumActive = 0;
  const tasks = Array.from({ length: 8 }, (_, index) => async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return index;
  });

  const settled = await allSettledWithConcurrency(tasks, 3);
  assert.equal(maximumActive, 3);
  assert.deepEqual(
    settled.map((result) =>
      result.status === 'fulfilled' ? result.value : 'rejected'
    ),
    [0, 1, 2, 3, 4, 5, 6, 7]
  );
});

test('uses allSettled semantics so one failure does not stop the batch', async () => {
  const visited: number[] = [];
  const settled = await allSettledWithConcurrency(
    [0, 1, 2].map((index) => async () => {
      visited.push(index);
      if (index === 1) throw new Error('expected failure');
      return index;
    }),
    2
  );

  assert.deepEqual(visited.sort(), [0, 1, 2]);
  assert.deepEqual(
    settled.map((result) => result.status),
    ['fulfilled', 'rejected', 'fulfilled']
  );
});

test('rejects an invalid concurrency limit', async () => {
  await assert.rejects(
    allSettledWithConcurrency([], 0),
    /Concurrency must be a positive integer/
  );
});
