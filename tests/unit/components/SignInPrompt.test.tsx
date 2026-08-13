import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SignInPrompt } from '@/components/SignInPrompt';
import type { SignInFlowState } from '@/lib/auth/sign-in-flow-state';

function renderPrompt(state: Extract<SignInFlowState, { status: 'needsSignIn' | 'submittingMagicLink' | 'checkEmail' | 'magicLinkError' }>) {
  const handlers = {
    onEmailChange: vi.fn(),
    onSubmitEmail: vi.fn(),
    onEditUrl: vi.fn(),
    onResend: vi.fn(),
    onRetryEmail: vi.fn(),
  };
  render(<SignInPrompt state={state} {...handlers} />);
  return handlers;
}

describe('SignInPrompt', () => {
  it('shows the pasted url and an email field in needsSignIn', () => {
    renderPrompt({ status: 'needsSignIn', url: 'https://tiktok.com/x', email: '', notice: null });
    expect(screen.getByText(/checking:/i)).toHaveTextContent('https://tiktok.com/x');
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('shows the notice message when present', () => {
    renderPrompt({
      status: 'needsSignIn',
      url: 'https://tiktok.com/x',
      email: '',
      notice: 'That sign-in link expired or was already used. Enter your email again to get a new one.',
    });
    expect(screen.getByText(/expired or was already used/i)).toBeInTheDocument();
  });

  it('shows a validation error on blur for an invalid email and does not call onSubmitEmail', () => {
    const handlers = renderPrompt({ status: 'needsSignIn', url: 'https://tiktok.com/x', email: 'not-an-email', notice: null });
    fireEvent.blur(screen.getByLabelText('Email'));
    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }));
    expect(handlers.onSubmitEmail).not.toHaveBeenCalled();
  });

  it('calls onSubmitEmail when the email is valid', () => {
    const handlers = renderPrompt({ status: 'needsSignIn', url: 'https://tiktok.com/x', email: 'creator@example.com', notice: null });
    fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }));
    expect(handlers.onSubmitEmail).toHaveBeenCalledTimes(1);
  });

  it('calls onEditUrl when the edit link is clicked', () => {
    const handlers = renderPrompt({ status: 'needsSignIn', url: 'https://tiktok.com/x', email: '', notice: null });
    fireEvent.click(screen.getByRole('button', { name: /not this link\? edit/i }));
    expect(handlers.onEditUrl).toHaveBeenCalledTimes(1);
  });

  it('disables the email field and shows a spinner while submittingMagicLink', () => {
    renderPrompt({ status: 'submittingMagicLink', url: 'https://tiktok.com/x', email: 'creator@example.com' });
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Sending…');
  });

  it('shows the confirmation message and a resend button in checkEmail', () => {
    const handlers = renderPrompt({ status: 'checkEmail', url: 'https://tiktok.com/x', email: 'creator@example.com' });
    expect(screen.getByText(/check your email/i)).toHaveTextContent('creator@example.com');
    fireEvent.click(screen.getByRole('button', { name: /resend/i }));
    expect(handlers.onResend).toHaveBeenCalledTimes(1);
  });

  it('shows the server error message and preserves the email in magicLinkError', () => {
    renderPrompt({
      status: 'magicLinkError',
      url: 'https://tiktok.com/x',
      email: 'creator@example.com',
      error: "You've requested a few sign-in links in a row. Wait a minute and try again.",
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Wait a minute');
    expect(screen.getByLabelText('Email')).toHaveValue('creator@example.com');
  });
});
