'use client';

import { useState } from 'react';
import { Spinner } from './Spinner';
import { isValidEmailFormat, type SignInFlowState } from '@/lib/auth/sign-in-flow-state';

type SignInPromptState = Extract<
  SignInFlowState,
  { status: 'needsSignIn' | 'submittingMagicLink' | 'checkEmail' | 'magicLinkError' }
>;

export interface SignInPromptProps {
  state: SignInPromptState;
  onEmailChange: (email: string) => void;
  onSubmitEmail: () => void;
  onEditUrl: () => void;
  onResend: () => void;
  onRetryEmail: () => void;
}

export function SignInPrompt({ state, onEmailChange, onSubmitEmail, onEditUrl, onResend }: SignInPromptProps) {
  const [blurError, setBlurError] = useState<string | null>(null);
  const email = state.status === 'checkEmail' ? state.email : state.email;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          Checking: <span className="font-medium text-gray-900">{state.url}</span>
        </span>
        {state.status !== 'checkEmail' && (
          <button type="button" onClick={onEditUrl} className="text-indigo-700 underline">
            Not this link? Edit
          </button>
        )}
      </div>

      {state.status === 'needsSignIn' && state.notice && (
        <p className="text-sm text-amber-700">{state.notice}</p>
      )}

      {state.status === 'checkEmail' ? (
        <div className="flex flex-col gap-2">
          <p>
            Check your email — we sent a sign-in link to <strong>{email}</strong>. Click it to continue, then
            we&apos;ll bring you back here with your diagnostic ready to go.
          </p>
          <button type="button" onClick={onResend} className="self-start text-sm text-indigo-700 underline">
            Resend
          </button>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (state.status === 'submittingMagicLink') return;
            if (!isValidEmailFormat(state.email)) {
              setBlurError('Enter a valid email address, like you@example.com');
              return;
            }
            onSubmitEmail();
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm text-gray-700">Sign in with a one-time email link to get your report.</p>
          <label htmlFor="sign-in-email" className="text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="sign-in-email"
            name="email"
            type="email"
            required
            value={state.email}
            onChange={(e) => {
              setBlurError(null);
              onEmailChange(e.target.value);
            }}
            onBlur={() => {
              if (state.email && !isValidEmailFormat(state.email)) {
                setBlurError('Enter a valid email address, like you@example.com');
              } else {
                setBlurError(null);
              }
            }}
            disabled={state.status === 'submittingMagicLink'}
            className="rounded-lg border border-gray-300 px-4 py-2"
          />
          <button
            type="submit"
            disabled={state.status === 'submittingMagicLink'}
            className="rounded-full bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {state.status === 'submittingMagicLink' ? <Spinner label="Sending…" /> : 'Send sign-in link'}
          </button>
          {blurError && (
            <p role="alert" className="text-sm text-red-600">
              {blurError}
            </p>
          )}
          {state.status === 'magicLinkError' && (
            <p role="alert" className="text-sm text-red-600">
              {state.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
