/**
 * A tiny event emitter.
 *
 * The VS Code `EventEmitter` lives in the `vscode` module, which only exists
 * inside the editor. The pseudoterminal needs an emitter that can be built and
 * driven in a test, so it has its own - and it is structurally the same shape
 * as `vscode.Event<T>`, so the editor accepts it.
 */

export interface Disposable {
  dispose: () => void;
}

export type Event<T> = (listener: (data: T) => void) => Disposable;

export class Emitter<T> {
  private listeners = new Set<(data: T) => void>();

  readonly event: Event<T> = (listener: (data: T) => void): Disposable => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  fire(data: T): void {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
