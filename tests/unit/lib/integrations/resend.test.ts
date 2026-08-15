import { describe, it, expect, vi, afterEach } from 'vitest';
import { createResendEmailClient } from '@/lib/integrations/resend';

describe('createResendEmailClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the email via a POST to the Resend API with the given from address', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const client = createResendEmailClient('test-api-key', 'Creator Dashboard <digest@example.com>');
    await client.sendEmail({ to: 'creator@example.com', subject: 'Your content ideas', html: '<p>Hi</p>' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      from: 'Creator Dashboard <digest@example.com>',
      to: 'creator@example.com',
      subject: 'Your content ideas',
      html: '<p>Hi</p>',
    });
  });

  it('throws when the API request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const client = createResendEmailClient('test-api-key', 'digest@example.com');
    await expect(client.sendEmail({ to: 'creator@example.com', subject: 's', html: '<p>x</p>' })).rejects.toThrow(
      'Resend API request failed with status 500'
    );
  });
});
