/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { useState } from 'react';
import { BbsOverlay } from './components/BbsOverlay';
import { BbsStateProvider, useBbsState } from './hooks/useBbsState';
import { parseBbsOutput } from './utils/bbsParser';

// A mock App component to test integration of parser, state, and overlay
const MockApp = ({ initialOutput }: { initialOutput: string }) => {
  const [output, setOutput] = useState(initialOutput);
  const bbsState = useBbsState();
  const parsedState = parseBbsOutput(output);

  const handleCommand = (cmd: string) => {
    // Mock WebSocket sending command and Terminal receiving response
    if (cmd === 'A\r') {
      bbsState.setState('boardList');
      bbsState.pushPath('精華公佈欄');
      setOutput(`>   1  SYSOP        [站務] 巴哈姆特站務中心\n    2  Gossiping    [八卦] 綜合八卦版`);
    } else if (cmd === 'Gossiping\r') {
      bbsState.setState('postList');
      bbsState.pushPath('Gossiping');
      setOutput(`>   1 ~  7/12 sysop        [公告] 系統公告\n    2    7/12 user         Hello World`);
    }
  };

  return (
    <div>
      <div data-testid="status">{bbsState.status}</div>
      <BbsOverlay 
        parsedState={parsedState} 
        onCommand={handleCommand} 
        currentPath={bbsState.path} 
      />
    </div>
  );
};

describe('BbsIntegration', () => {
  it('integrates parser, state, and overlay correctly', () => {
    const { container } = render(
      <BbsStateProvider>
        <MockApp initialOutput="(A)精華公佈欄  (B)佈告討論區" />
      </BbsStateProvider>
    );

    // Initial state
    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(screen.getByText('精華公佈欄')).not.toBeNull();

    // Click menu item
    fireEvent.click(screen.getByText('精華公佈欄'));

    // State should update, output should change to boardList
    expect(screen.getByTestId('status').textContent).toBe('boardList');
    expect(screen.getByText('精華公佈欄')).not.toBeNull(); // Breadcrumb
    expect(screen.getByText('Gossiping')).not.toBeNull();

    // Click board item
    fireEvent.click(screen.getByText('Gossiping'));

    // State should update, output should change to postList
    expect(screen.getByTestId('status').textContent).toBe('postList');
    expect(screen.getByText('精華公佈欄')).not.toBeNull(); // Breadcrumb
    expect(screen.getByText('Gossiping')).not.toBeNull(); // Breadcrumb AND Board or just breadcrumb? Well, board name is not in postList but breadcrumb
    expect(screen.getAllByText('Gossiping').length).toBeGreaterThan(0);
    expect(screen.getByText('Hello World')).not.toBeNull();
  });
});
