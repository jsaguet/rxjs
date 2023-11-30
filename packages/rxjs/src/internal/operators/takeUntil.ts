import type { MonoTypeOperatorFunction, ObservableInput } from '../types.js';
import { Observable, operate, from } from '../Observable.js';
import { noop } from '../util/noop.js';

/**
 * Emits the values emitted by the source Observable until a `notifier`
 * Observable emits a value.
 *
 * <span class="informal">Lets values pass until a second Observable,
 * `notifier`, emits a value. Then, it completes.</span>
 *
 * ![](takeUntil.png)
 *
 * `takeUntil` subscribes and begins mirroring the source Observable. It also
 * monitors a second Observable, `notifier` that you provide. If the `notifier`
 * emits a value, the output Observable stops mirroring the source Observable
 * and completes. If the `notifier` doesn't emit any value and completes
 * then `takeUntil` will pass all values.
 *
 * ## Example
 *
 * Tick every second until the first click happens
 *
 * ```ts
 * import { interval, fromEvent, takeUntil } from 'rxjs';
 *
 * const source = interval(1000);
 * const clicks = fromEvent(document, 'click');
 * const result = source.pipe(takeUntil(clicks));
 * result.subscribe(x => console.log(x));
 * ```
 *
 * @see {@link take}
 * @see {@link takeLast}
 * @see {@link takeWhile}
 * @see {@link skip}
 *
 * @param notifier The `ObservableInput` whose first emitted value will cause the output
 * Observable of `takeUntil` to stop emitting values from the source Observable.
 * @return A function that returns an Observable that emits the values from the
 * source Observable until `notifier` emits its first value.
 */
export function takeUntil<T>(notifier: ObservableInput<unknown>): MonoTypeOperatorFunction<T> {
  return (source) =>
    new Observable((destination) => {
      from(notifier).subscribe(operate({ destination, next: () => destination.complete(), complete: noop }));
      !destination.closed && source.subscribe(destination);
    });
}
