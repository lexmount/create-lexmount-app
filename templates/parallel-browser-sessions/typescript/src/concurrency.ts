type AsyncTask<T> = () => Promise<T>;

export async function allSettledWithConcurrency<T>(
  tasks: AsyncTask<T>[],
  concurrency: number
): Promise<PromiseSettledResult<T>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Concurrency must be a positive integer.');
  }

  const limit = createLimiter(concurrency);
  const scheduled = tasks.map((task) => limit(task));
  return Promise.allSettled(scheduled);
}

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function startNext(): void {
    while (active < concurrency && queue.length > 0) {
      const start = queue.shift();
      start?.();
    }
  }

  return function limit<T>(task: AsyncTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active += 1;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            startNext();
          });
      });
      startNext();
    });
  };
}
