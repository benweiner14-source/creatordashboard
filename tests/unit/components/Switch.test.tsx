import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Switch } from '@/components/Switch';

describe('Switch', () => {
  it('renders as an accessible switch reflecting the checked prop', () => {
    render(<Switch checked={false} onChange={() => {}} label="Two-factor authentication" />);
    expect(screen.getByRole('switch', { name: 'Two-factor authentication' })).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects checked=true', () => {
    render(<Switch checked onChange={() => {}} label="Two-factor authentication" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange when clicked', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Two-factor authentication" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
