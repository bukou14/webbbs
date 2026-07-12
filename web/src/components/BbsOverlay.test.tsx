/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BbsOverlay } from './BbsOverlay';
import type { ParsedResult } from '../utils/bbsParser';
import React from 'react';

describe('BbsOverlay component', () => {
  it('renders "Waiting for BBS..." when parsedState is null', () => {
    render(<BbsOverlay parsedState={null} onCommand={vi.fn()} currentPath={[]} />);
    expect(screen.getByText('Waiting for BBS...')).not.toBeNull();
  });

  it('renders breadcrumbs', () => {
    render(<BbsOverlay parsedState={null} onCommand={vi.fn()} currentPath={['Main Menu', 'Board List']} />);
    expect(screen.getByText('Main Menu')).not.toBeNull();
    expect(screen.getByText('Board List')).not.toBeNull();
    expect(screen.getAllByText('>')).toHaveLength(1);
  });

  it('renders menu items and handles clicks', () => {
    const onCommand = vi.fn();
    const parsedState: ParsedResult = {
      type: 'menu',
      items: [
        { key: 'A', label: '精華公佈欄' },
        { key: 'B', label: 'Unknown Menu' }, // Not in COMMAND_MAP
      ],
    };

    render(<BbsOverlay parsedState={parsedState} onCommand={onCommand} currentPath={[]} />);

    expect(screen.getByText('(A)')).not.toBeNull();
    expect(screen.getByText('精華公佈欄')).not.toBeNull();
    expect(screen.getByText('(B)')).not.toBeNull();
    expect(screen.getByText('Unknown Menu')).not.toBeNull();

    // Known menu item
    fireEvent.click(screen.getByText('精華公佈欄'));
    expect(onCommand).toHaveBeenCalledWith('A\r');

    // Unknown menu item falls back to its key + \r
    fireEvent.click(screen.getByText('Unknown Menu'));
    expect(onCommand).toHaveBeenCalledWith('B\r');
  });

  it('renders board list and handles clicks', () => {
    const onCommand = vi.fn();
    const parsedState: ParsedResult = {
      type: 'boardList',
      cursor: 1,
      items: [
        { id: 1, boardName: 'SYSOP', description: '[站務] 巴哈姆特站務中心' },
        { id: 2, boardName: 'Gossiping', description: '[八卦] 綜合八卦版' },
      ],
    };

    render(<BbsOverlay parsedState={parsedState} onCommand={onCommand} currentPath={[]} />);

    const sysopBtns = screen.getAllByText('SYSOP');
    expect(sysopBtns.length).toBeGreaterThan(0);
    const gossipingBtns = screen.getAllByText('Gossiping');
    expect(gossipingBtns.length).toBeGreaterThan(0);

    // The cursor item should have a specific class (checked indirectly via matching DOM or classList if needed)
    const btn1 = sysopBtns[0].closest('button');
    expect(btn1?.classList.contains('bbs-cursor')).toBe(true);
    
    const btn2 = gossipingBtns[0].closest('button');
    expect(btn2?.classList.contains('bbs-cursor')).toBe(false);

    fireEvent.click(gossipingBtns[0]);
    // commandMapper maps 'boardList', 'Gossiping' -> 'Gossiping\r', which handles the `sBoardName\r` fallback in BbsOverlay
    expect(onCommand).toHaveBeenCalledWith('Gossiping\r');
  });

  it('renders post list and handles clicks', () => {
    const onCommand = vi.fn();
    const parsedState: ParsedResult = {
      type: 'postList',
      cursor: 2,
      items: [
        { id: 1, status: '~', date: '7/12', author: 'sysop', title: '[公告] 系統公告' },
        { id: 2, status: '', date: '7/12', author: 'user', title: 'Hello World' },
      ],
    };

    render(<BbsOverlay parsedState={parsedState} onCommand={onCommand} currentPath={[]} />);

    expect(screen.getByText('[公告] 系統公告')).not.toBeNull();
    expect(screen.getByText('Hello World')).not.toBeNull();

    const btn1 = screen.getByText('sysop').closest('button');
    expect(btn1?.classList.contains('bbs-cursor')).toBe(false);

    const btn2 = screen.getByText('user').closest('button');
    expect(btn2?.classList.contains('bbs-cursor')).toBe(true);

    fireEvent.click(screen.getByText('Hello World'));
    expect(onCommand).toHaveBeenCalledWith('2\r');
  });
});

  it('renders nothing for unknown parsedState type', () => {
    const onCommand = vi.fn();
    const parsedState = { type: 'unknown_type' } as any;
    const { container } = render(<BbsOverlay parsedState={parsedState} onCommand={onCommand} currentPath={[]} />);
    expect(container.querySelector('.bbs-overlay-content')?.innerHTML).toBe('');
  });
