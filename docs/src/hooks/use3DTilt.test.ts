import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { use3DTilt } from './use3DTilt';

describe('use3DTilt', () => {
  let mockElement: HTMLDivElement;
  let mockGetBoundingClientRect: ReturnType<typeof vi.fn>;
  let mockRAF: ReturnType<typeof vi.fn>;
  let mockCAF: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
    });

    mockElement = {
      getBoundingClientRect: mockGetBoundingClientRect,
    } as unknown as HTMLDivElement;

    mockRAF = vi.fn((cb: FrameRequestCallback) => {
      cb(0);

      return 1;
    });
    mockCAF = vi.fn();

    vi.stubGlobal('requestAnimationFrame', mockRAF);
    vi.stubGlobal('cancelAnimationFrame', mockCAF);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return initial state with no tilt', () => {
    const { result } = renderHook(() => use3DTilt());

    expect(result.current.isHovered).toBe(false);
    expect(result.current.style.transform).toContain('rotateX(0deg) rotateY(0deg)');
  });

  it('should set isHovered to true on mouse enter', () => {
    const { result } = renderHook(() => use3DTilt());

    // Simulate ref callback
    act(() => {
      result.current.ref(mockElement);
    });

    act(() => {
      result.current.onMouseEnter();
    });

    expect(result.current.isHovered).toBe(true);
  });

  it('should reset to initial state on mouse leave', () => {
    const { result } = renderHook(() => use3DTilt());

    act(() => {
      result.current.ref(mockElement);
      result.current.onMouseEnter();
    });

    act(() => {
      result.current.onMouseLeave();
    });

    expect(result.current.isHovered).toBe(false);
    expect(result.current.style.transform).toContain('rotateX(0deg) rotateY(0deg)');
  });

  it('should calculate tilt based on mouse position', () => {
    const { result } = renderHook(() => use3DTilt({ maxTilt: 20 }));

    act(() => {
      result.current.ref(mockElement);
      result.current.onMouseEnter();
    });

    // Mouse at center-right of element (200, 150 in 400x300 element)
    const mockEvent = {
      clientX: 300, // 75% from left
      clientY: 150, // 50% from top
    } as React.MouseEvent<HTMLDivElement>;

    act(() => {
      result.current.onMouseMove(mockEvent);
    });

    // With easing, 0.75 -> eased value that's slightly less than 0.75
    // The easing softens edge values by ~30% at extremes
    // rotateY should be positive (mouse right of center), slightly reduced from linear
    // rotateX should be near 0 (mouse at vertical center)
    const transform = result.current.style.transform as string;

    expect(transform).toMatch(/rotateY\([\d.]+deg\)/); // positive Y rotation
    expect(transform).toContain('rotateX(0deg)'); // (0.5 - 0.5) = 0, no change
  });

  it('should apply easing to soften tilt at edges', () => {
    const { result } = renderHook(() => use3DTilt({ maxTilt: 30 }));

    act(() => {
      result.current.ref(mockElement);
      result.current.onMouseEnter();
    });

    // Mouse at top-left corner (0, 0) - extreme position
    const mockEvent = {
      clientX: 0,
      clientY: 0,
    } as React.MouseEvent<HTMLDivElement>;

    act(() => {
      result.current.onMouseMove(mockEvent);
    });

    // With easing, corner values are softened by 30%
    // Linear would be -30/30, eased is -21/21
    expect(result.current.style.transform).toContain('rotateY(-21deg)');
    expect(result.current.style.transform).toContain('rotateX(21deg)');
  });

  it('should clamp mouse positions beyond element bounds', () => {
    const { result } = renderHook(() => use3DTilt({ maxTilt: 30 }));

    act(() => {
      result.current.ref(mockElement);
      result.current.onMouseEnter();
    });

    // Mouse beyond element bounds
    const mockEvent = {
      clientX: -100, // Way off left
      clientY: 500, // Way below
    } as React.MouseEvent<HTMLDivElement>;

    act(() => {
      result.current.onMouseMove(mockEvent);
    });

    // Should clamp to edge values (0, 1), then apply easing
    // Same as corner behavior, prevents extreme jumps
    expect(result.current.style.transform).toContain('rotateY(-21deg)');
    expect(result.current.style.transform).toContain('rotateX(-21deg)');
  });

  it('should apply scale on hover', () => {
    const { result } = renderHook(() => use3DTilt({ scale: 1.1 }));

    act(() => {
      result.current.ref(mockElement);
      result.current.onMouseEnter();
    });

    const mockEvent = {
      clientX: 200,
      clientY: 150,
    } as React.MouseEvent<HTMLDivElement>;

    act(() => {
      result.current.onMouseMove(mockEvent);
    });

    expect(result.current.style.transform).toContain('scale3d(1.1, 1.1, 1.1)');
  });

  it('should show glare on hover', () => {
    const { result } = renderHook(() => use3DTilt());

    act(() => {
      result.current.onMouseEnter();
    });

    expect(result.current.glareStyle.opacity).toBe(1);
  });

  it('should hide glare when not hovered', () => {
    const { result } = renderHook(() => use3DTilt());

    expect(result.current.glareStyle.opacity).toBe(0);
  });

  it('should use requestAnimationFrame for mouse move updates', () => {
    const { result } = renderHook(() => use3DTilt());

    act(() => {
      result.current.ref(mockElement);
    });

    const mockEvent = {
      clientX: 200,
      clientY: 150,
    } as React.MouseEvent<HTMLDivElement>;

    act(() => {
      result.current.onMouseMove(mockEvent);
    });

    expect(mockRAF).toHaveBeenCalled();
  });

  it('should cancel pending animation frame on mouse leave', () => {
    const { result } = renderHook(() => use3DTilt());

    act(() => {
      result.current.ref(mockElement);
      result.current.onMouseEnter();
    });

    const mockEvent = {
      clientX: 200,
      clientY: 150,
    } as React.MouseEvent<HTMLDivElement>;

    act(() => {
      result.current.onMouseMove(mockEvent);
    });

    act(() => {
      result.current.onMouseLeave();
    });

    expect(mockCAF).toHaveBeenCalled();
  });
});
