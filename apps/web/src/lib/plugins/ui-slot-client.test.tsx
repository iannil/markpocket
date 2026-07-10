// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { registerSlot, Slot } from './ui-slot-client';

describe('ui slot client', () => {
  it('renders components registered under a slot id', () => {
    registerSlot('demo', () => <div>hello-slot</div>);
    render(<Slot id="demo" />);
    expect(screen.getByText('hello-slot')).toBeDefined();
  });

  it('renders nothing for an unknown slot id', () => {
    const { container } = render(<Slot id="empty" />);
    expect(container.textContent).toBe('');
  });
});
