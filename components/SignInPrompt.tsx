'use client';

import { useState } from 'react';
import { Spinner } from './Spinner';
import { isValidEmailFormat } from '@/lib/auth/sign-in-flow-state';

/**
 * Structural shape this component needs, rather than an Extract of one
 * flow's state, so any flow that mirrors the magic-link states can drive
 * it. `url` is the subject line of the diagnostic flow ("Checking: …");
 * flows without one (the recap page) simply omit it.
 */
export type SignInPromptState =
  | { status: 'needsSignIn'; url?: string; email: string; notice: string | null }
  | { status: 'submittingMagicLink'; url?: string; email: string }
  | { status: 'checkEmail'; url?: string; email: string }
  | { status: 'magicLinkError'; url?: string; email: string; error: string };

export interface SignInPromptProps {
  state: SignInPromptState;
  onEmailChange: (email: string) => void;
  onSubmitEmail: () => void;
  onResend: () => void;
  onRetryEmail: () => void;
  onEditUrl?: () => void;
  /** Why the creator is being asked to sign in. */
  introCopy?: string;
  /** What happens after they click the emailed link. */
  returnCopy?: string;
}

export function SignInPrompt({
  state,
  onEmailChange,
  onSubmitEmail,
  onEditUrl,
  onResend,
  onRetryEmail,
  introCopy = 'Sign in with a one-time email link to get your report.',
  returnCopy = "Click it to continue, then we'll bring you back here with your diagnostic ready to go.",
}: SignInPromptProps) {
  const [blurError, setBlurError] = useState<string | null>(null);
  const email = state.email;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-gray-200 p-4">
      {state.url && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Checking: <span className="font-medium text-gray-900">{state.url}</span>
          </span>
          {onEditUrl && state.status !== 'checkEmail' && state.status !== 'submittingMagicLink' && (
            <button type="button" onClick={onEditUrl} className="text-indigo-700 underline">
              Not this link? Edit
            </button>
          )}
        </div>
      )}

      {state.status === 'needsSignIn' && state.notice && (
        <p className="text-sm text-amber-700">{state.notice}</p>
      )}

      {state.status === 'checkEmail' ? (
        <div className="flex flex-col gap-2">
          <p>
            Check your email — we sent a sign-in link to <strong>{email}</strong>. {returnCopy}
          </p>
          <button type="button" onClick={onResend} className="self-start text-sm text-indigo-700 underline">
            Resend
          </button>
          <button type="button" onClick={onRetryEmail} className="self-start text-sm text-indigo-700 underline">
            Wrong address? Change it
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
          <p className="text-sm text-gray-700">{introCopy}</p>
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
