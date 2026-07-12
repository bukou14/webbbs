/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBbsState, BbsStateProvider } from './useBbsState';
import React from 'react';

describe('useBbsState hook', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <BbsStateProvider>{children}</BbsStateProvider>
  );

  it('should throw if used outside provider', () => {
    // Suppress console.error for this specific test
    const originalError = console.error;
    console.error = () => {};
    expect(() => renderHook(() => useBbsState())).toThrow('useBbsState must be used within a BbsStateProvider');
    console.error = originalError;
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useBbsState(), { wrapper });

    expect(result.current.status).toBe('idle');
    expect(result.current.path).toEqual([]);
    expect(result.current.cursor).toBe(0);
  });

  it('should update status via setState', () => {
    const { result } = renderHook(() => useBbsState(), { wrapper });

    act(() => {
      result.current.setState('menu');
    });

    expect(result.current.status).toBe('menu');
  });

  it('should add to path via pushPath', () => {
    const { result } = renderHook(() => useBbsState(), { wrapper });

    act(() => {
      result.current.pushPath('main');
    });
    expect(result.current.path).toEqual(['main']);

    act(() => {
      result.current.pushPath('board');
    });
    expect(result.current.path).toEqual(['main', 'board']);
  });

  it('should remove from path via popPath', () => {
    const { result } = renderHook(() => useBbsState(), { wrapper });

    act(() => {
      result.current.pushPath('main');
      result.current.pushPath('board');
    });
    expect(result.current.path).toEqual(['main', 'board']);

    act(() => {
      result.current.popPath();
    });
    expect(result.current.path).toEqual(['main']);

    act(() => {
      result.current.popPath();
    });
    expect(result.current.path).toEqual([]);

    act(() => {
      result.current.popPath(); // popping empty path should be safe
    });
    expect(result.current.path).toEqual([]);
  });

  it('should update cursor via setCursor', () => {
    const { result } = renderHook(() => useBbsState(), { wrapper });

    act(() => {
      result.current.setCursor(5);
    });

    expect(result.current.cursor).toBe(5);
  });

  it('should reset state completely', () => {
    const { result } = renderHook(() => useBbsState(), { wrapper });

    act(() => {
      result.current.setState('postList');
      result.current.pushPath('Gossiping');
      result.current.setCursor(42);
    });

    expect(result.current.status).toBe('postList');
    expect(result.current.path).toEqual(['Gossiping']);
    expect(result.current.cursor).toBe(42);

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.path).toEqual([]);
    expect(result.current.cursor).toBe(0);
  });
});
