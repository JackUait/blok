/**
 * Class allows to make a queue of async jobs and wait until they all will be finished one by one
 *
 * @example const queue = new PromiseQueue();
 *            queue.add(async () => { ... });
 *            queue.add(async () => { ... });
 *            await queue.completed;
 */
export default class PromiseQueue {
  /**
   * Tail promise representing the queued operations chain
   */
  private tail: Promise<void> = Promise.resolve();

  /**
   * Stored failure that should be propagated to consumers
   */
  private failure: unknown;

  /**
   * Expose completion promise that rejects if any queued task failed
   */
  public get completed(): Promise<void> {
    return this.failure ? Promise.reject(this.failure) : this.tail;
  }

  /**
   * Add new promise to queue
   *
   * @param operation - promise should be added to queue
   */
  public add(operation: () => void | PromiseLike<void>): Promise<void> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }

    const task = this.tail.then(() => operation());

    this.tail = task.catch((error) => {
      this.failure = error;
    });

    return task;
  }
}
