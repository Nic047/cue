export class WaitTimeoutError extends Error {}

/** Bounds waiting, not execution. Use an AbortSignal when the API supports it.
 * Resource-producing calls must supply onLateResult to dispose abandoned results.
 */
export function waitWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onLateResult?: (value: T) => void | Promise<unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new WaitTimeoutError(`${label} timeout ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        if (timedOut) {
          if (onLateResult)
            void Promise.resolve()
              .then(() => onLateResult(value))
              .catch(() => {});
        } else resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        if (!timedOut) reject(error);
      },
    );
  });
}
