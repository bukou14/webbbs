import { describe, it, expect } from 'vitest';
import { parseBbsOutput } from './bbsParser';

describe('bbsParser', () => {
  it('should parse post list correctly', () => {
    const input = `>   1 ~  7/12 sysop        [公告] 系統公告
    2    7/12 user         Hello World
>   3 +M 7/12 admin        Sticky Post
`;
    const result = parseBbsOutput(input);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('postList');
    if (result?.type === 'postList') {
      expect(result.cursor).toBe(3); // The last one with cursor >
      expect(result.items).toHaveLength(3);
      expect(result.items[0]).toEqual({
        id: 1, status: '~', date: '7/12', author: 'sysop', title: '[公告] 系統公告'
      });
      expect(result.items[1]).toEqual({
        id: 2, status: '', date: '7/12', author: 'user', title: 'Hello World'
      });
      expect(result.items[2]).toEqual({
        id: 3, status: '+M', date: '7/12', author: 'admin', title: 'Sticky Post'
      });
    }
  });

  it('should parse board list correctly', () => {
    const input = `>   1  SYSOP        [站務] 巴哈姆特站務中心
    2  Gossiping    [八卦] 綜合八卦版
`;
    const result = parseBbsOutput(input);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('boardList');
    if (result?.type === 'boardList') {
      expect(result.cursor).toBe(1);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        id: 1, boardName: 'SYSOP', description: '[站務] 巴哈姆特站務中心'
      });
      expect(result.items[1]).toEqual({
        id: 2, boardName: 'Gossiping', description: '[八卦] 綜合八卦版'
      });
    }
  });

  it('should parse main menu correctly', () => {
    const input = `(A)精華公佈欄  (B)佈告討論區
(C)分組討論區  (M)私人信件`;
    const result = parseBbsOutput(input);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('menu');
    if (result?.type === 'menu') {
      expect(result.items).toHaveLength(4);
      expect(result.items[0]).toEqual({ key: 'A', label: '精華公佈欄' });
      expect(result.items[1]).toEqual({ key: 'B', label: '佈告討論區' });
      expect(result.items[2]).toEqual({ key: 'C', label: '分組討論區' });
      expect(result.items[3]).toEqual({ key: 'M', label: '私人信件' });
    }
  });

  it('should handle empty or unrecognized input', () => {
    expect(parseBbsOutput('')).toBeNull();
    expect(parseBbsOutput('Just some random text')).toBeNull();
    expect(parseBbsOutput('   \n  \n')).toBeNull();
  });

  it('should strip ANSI escape codes before parsing', () => {
    const input = `\x1B[1;33m(A)精華公佈欄\x1B[0m  (B)佈告討論區`;
    const result = parseBbsOutput(input);
    expect(result?.type).toBe('menu');
    if (result?.type === 'menu') {
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({ key: 'A', label: '精華公佈欄' });
    }
  });

  it('should prefer postList over boardList if consecutivePosts >= consecutiveBoards', () => {
    // Both regexes might accidentally trigger on weird lines, test priority
    // For our simple mock, we'll just check it parses post list successfully
    const input = `>   1 ~  7/12 sysop        [公告] 系統公告\n    1  SYSOP        [站務] 巴哈姆特站務中心`;
    const result = parseBbsOutput(input);
    expect(result?.type).toBe('postList');
  });
});
