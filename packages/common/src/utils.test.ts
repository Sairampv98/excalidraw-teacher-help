import {
  isTransparent,
  mapFind,
  reduceToCommonValue,
} from "@excalidraw/common";
import { vi } from "vitest";

// Import directly to avoid the @excalidraw/common throttleRAF mock from setupTests.ts.
import { getPointerSamples, throttleRAF } from "./utils";

type RafCallback = FrameRequestCallback;

describe("@excalidraw/common/utils", () => {
  describe("isTransparent()", () => {
    it("should return true when color is rgb transparent", () => {
      expect(isTransparent("#ff00")).toEqual(true);
      expect(isTransparent("#fff00000")).toEqual(true);
      expect(isTransparent("transparent")).toEqual(true);
    });

    it("should return false when color is not transparent", () => {
      expect(isTransparent("#ced4da")).toEqual(false);
    });
  });

  describe("reduceToCommonValue()", () => {
    it("should return the common value when all values are the same", () => {
      expect(reduceToCommonValue([1, 1])).toEqual(1);
      expect(reduceToCommonValue([0, 0])).toEqual(0);
      expect(reduceToCommonValue(["a", "a"])).toEqual("a");
      expect(reduceToCommonValue(new Set([1]))).toEqual(1);
      expect(reduceToCommonValue([""])).toEqual("");
      expect(reduceToCommonValue([0])).toEqual(0);

      const o = {};
      expect(reduceToCommonValue([o, o])).toEqual(o);

      expect(
        reduceToCommonValue([{ a: 1 }, { a: 1, b: 2 }], (o) => o.a),
      ).toEqual(1);
      expect(
        reduceToCommonValue(new Set([{ a: 1 }, { a: 1, b: 2 }]), (o) => o.a),
      ).toEqual(1);
    });

    it("should return `null` when values are different", () => {
      expect(reduceToCommonValue([1, 2, 3])).toEqual(null);
      expect(reduceToCommonValue(new Set([1, 2]))).toEqual(null);
      expect(reduceToCommonValue([{ a: 1 }, { a: 2 }], (o) => o.a)).toEqual(
        null,
      );
    });

    it("should return `null` when some values are nullable", () => {
      expect(reduceToCommonValue([1, null, 1])).toEqual(null);
      expect(reduceToCommonValue([null, 1])).toEqual(null);
      expect(reduceToCommonValue([1, undefined])).toEqual(null);
      expect(reduceToCommonValue([undefined, 1])).toEqual(null);
      expect(reduceToCommonValue([null])).toEqual(null);
      expect(reduceToCommonValue([undefined])).toEqual(null);
      expect(reduceToCommonValue([])).toEqual(null);
    });
  });

  describe("mapFind()", () => {
    it("should return the first mapped non-null element", () => {
      {
        let counter = 0;

        const result = mapFind(["a", "b", "c"], (value) => {
          counter++;
          return value === "b" ? 42 : null;
        });
        expect(result).toEqual(42);
        expect(counter).toBe(2);
      }

      expect(mapFind([1, 2], (value) => value * 0)).toBe(0);
      expect(mapFind([1, 2], () => false)).toBe(false);
      expect(mapFind([1, 2], () => "")).toBe("");
    });

    it("should return undefined if no mapped element is found", () => {
      expect(mapFind([1, 2], () => undefined)).toBe(undefined);
      expect(mapFind([1, 2], () => null)).toBe(undefined);
    });
  });

  describe("getPointerSamples()", () => {
    const makeSample = (x: number, y: number) =>
      ({ clientX: x, clientY: y, pressure: 0.25 } as unknown as PointerEvent);

    it("AC-13 returns every coalesced sample, not only the last one", () => {
      const samples = [
        makeSample(1, 1),
        makeSample(2, 2),
        makeSample(3, 3),
        makeSample(4, 4),
      ];

      const event = {
        clientX: 4,
        clientY: 4,
        getCoalescedEvents: () => samples,
      } as unknown as PointerEvent;

      const result = getPointerSamples(event);

      expect(result).toHaveLength(samples.length);
      expect([...result]).toEqual(samples);
    });

    it("AC-13 falls back to the single event when getCoalescedEvents is absent", () => {
      const event = { clientX: 7, clientY: 9 } as unknown as PointerEvent;

      expect(
        typeof (event as { getCoalescedEvents?: unknown }).getCoalescedEvents,
      ).toBe("undefined");

      const result = getPointerSamples(event);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(event);
    });
  });

  describe("throttleRAF()", () => {
    let frameCallbacks: Map<number, RafCallback>;
    let nextFrameId: number;

    const runScheduledFrame = (timestamp = 16) => {
      const callbacks = [...frameCallbacks.values()];
      frameCallbacks.clear();
      callbacks.forEach((callback) => callback(timestamp));
    };

    beforeEach(() => {
      frameCallbacks = new Map();
      nextFrameId = 0;

      vi.spyOn(window, "requestAnimationFrame").mockImplementation(
        (callback) => {
          const frameId = ++nextFrameId;
          frameCallbacks.set(frameId, callback);
          return frameId;
        },
      );

      vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frameId) => {
        frameCallbacks.delete(frameId);
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should invoke the callback with the last args from the same frame", () => {
      const fn = vi.fn();
      const throttled = throttleRAF(fn);

      throttled("first", 1);
      throttled("second", 2);
      throttled("last", 3);

      expect(fn).not.toHaveBeenCalled();
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);

      runScheduledFrame();

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("last", 3);
    });

    it("should flush the pending callback immediately", () => {
      const fn = vi.fn();
      const throttled = throttleRAF(fn);

      throttled("first");
      throttled("last");

      throttled.flush();

      expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("last");

      runScheduledFrame();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should cancel the pending callback", () => {
      const fn = vi.fn();
      const throttled = throttleRAF(fn);

      throttled("first");
      throttled("last");

      throttled.cancel();

      expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);

      runScheduledFrame();

      expect(fn).not.toHaveBeenCalled();
    });
  });
});
