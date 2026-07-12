import { describe, it, expect } from 'vitest';
import { getCommand } from './commandMapper';

describe('commandMapper', () => {
  it('should return special keys when single argument matches', () => {
    expect(getCommand('back')).toBe('\x1b[D');
    expect(getCommand('up')).toBe('\x1b[A');
    expect(getCommand('down')).toBe('\x1b[B');
    expect(getCommand('right')).toBe('\x1b[C');
    expect(getCommand('escape')).toBe('\x1b');
    expect(getCommand('enter')).toBe('\r');
  });

  it('should return main menu commands when single argument matches', () => {
    expect(getCommand('精華公佈欄')).toBe('A\r');
    expect(getCommand('(A)nnounce')).toBe('A\r');
  });

  it('should return null for unknown single argument', () => {
    expect(getCommand('unknown_action')).toBeNull();
  });

  it('should handle mainMenu context with action', () => {
    expect(getCommand('mainMenu', '佈告討論區')).toBe('B\r');
    expect(getCommand('mainMenu', 'unknown')).toBeNull();
  });

  it('should handle boardList context with action', () => {
    expect(getCommand('boardList', 'Gossiping')).toBe('Gossiping\r');
    expect(getCommand('boardList')).toBeNull(); // Missing action
  });

  it('should handle postList context with action', () => {
    expect(getCommand('postList', '123')).toBe('123\r');
    expect(getCommand('postList')).toBeNull(); // Missing action
  });

  it('should return null for unknown context', () => {
    expect(getCommand('unknownContext', 'action')).toBeNull();
  });
});

  it('should handle empty string action for contexts', () => {
    expect(getCommand('boardList', '')).toBeNull();
    expect(getCommand('postList', '')).toBeNull();
  });
