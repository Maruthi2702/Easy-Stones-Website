// sendEmail: Amazon SES first, Gmail SMTP as the backup (owner, 2026-11-08).
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Sent = { from?: { name: string; address: string }; to?: string; replyTo?: string; subject?: string; attachments?: { filename: string; content: Buffer }[]; ses?: { ConfigurationSetName: string } };
const sesSend = vi.fn<(m: Sent) => Promise<unknown>>(async () => ({}));
const smtpSend = vi.fn<(m: Sent) => Promise<unknown>>(async () => ({}));
const transports: Loose[] = [];
type Loose = Record<string, any>;
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: Loose) => {
      transports.push(options);
      return { sendMail: options.SES ? sesSend : smtpSend };
    }
  }
}));

const { sendEmail } = await import('./emailService.ts');

const mail = { to: ['a@x.com', 'b@x.com'], subject: 'Daily report', html: '<p>hi</p>', replyTo: 'rep@easystones.com', defaultSenderName: 'Easy Surfaces Seattle', attachments: [{ filename: 'report.pdf', content: new Uint8Array([1, 2, 3]) }] };

beforeEach(() => {
  sesSend.mockReset().mockResolvedValue({});
  smtpSend.mockReset().mockResolvedValue({});
  transports.length = 0;
  for (const k of ['SES_FROM_EMAIL', 'SES_REGION', 'SES_CONFIGURATION_SET', 'AWS_REGION', 'SMTP_USER', 'SMTP_PASS', 'SMTP_HOST', 'SMTP_PORT']) delete process.env[k];
  process.env.SES_FROM_EMAIL = 'noreply@easystones.com';
  process.env.SMTP_USER = 'backup@gmail.com';
  process.env.SMTP_PASS = 'app-password';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('sendEmail', () => {
  it('sends through SES and never touches Gmail when SES takes it', async () => {
    process.env.SES_CONFIGURATION_SET = 'easy-surfaces-dev-email';
    const result = await sendEmail(mail);
    expect(result).toEqual({ success: true, error: null, via: 'ses' });
    expect(smtpSend).not.toHaveBeenCalled();
    const sent = sesSend.mock.calls[0]![0];
    expect(sent.from).toEqual({ name: 'Easy Surfaces Seattle', address: 'noreply@easystones.com' });
    expect(sent.to).toBe('a@x.com, b@x.com');
    expect(sent.replyTo).toBe('rep@easystones.com');
    expect(sent.attachments?.[0]).toEqual({ filename: 'report.pdf', content: Buffer.from([1, 2, 3]) });
    expect(sent.ses).toEqual({ ConfigurationSetName: 'easy-surfaces-dev-email' });
  });

  it('uses the SES region asked for, else the AWS region, else us-east-2', async () => {
    process.env.SES_REGION = 'us-east-2';
    await sendEmail(mail);
    const ses = transports.find(t => t.SES)!.SES;
    expect(await ses.sesClient.config.region()).toBe('us-east-2');
    expect(typeof ses.SendEmailCommand).toBe('function');
  });

  it('falls back to Gmail when SES refuses (e.g. sandbox: recipient not verified)', async () => {
    sesSend.mockRejectedValue(new Error('Email address is not verified.'));
    const result = await sendEmail(mail);
    expect(result).toEqual({ success: true, error: null, via: 'smtp' });
    const sent = smtpSend.mock.calls[0]![0];
    expect(sent.from).toEqual({ name: 'Easy Surfaces Seattle', address: 'backup@gmail.com' });
    expect(sent.attachments?.[0]?.filename).toBe('report.pdf');
    expect(sent.ses).toBeUndefined();
  });

  it('goes straight to Gmail when SES is not set up', async () => {
    delete process.env.SES_FROM_EMAIL;
    const result = await sendEmail(mail);
    expect(result.via).toBe('smtp');
    expect(sesSend).not.toHaveBeenCalled();
  });

  it('reports both failures when neither gets it out', async () => {
    sesSend.mockRejectedValue(new Error('Throttling'));
    smtpSend.mockRejectedValue(new Error('535-5.7.8 Username and Password not accepted'));
    const result = await sendEmail(mail);
    expect(result).toEqual({ success: false, via: null, error: 'SES error: Throttling | SMTP error: 535-5.7.8 Username and Password not accepted' });
  });

  it('says what is missing when nothing is set up', async () => {
    delete process.env.SES_FROM_EMAIL;
    delete process.env.SMTP_USER;
    const result = await sendEmail(mail);
    expect(result).toEqual({ success: false, via: null, error: 'SES not set up (SES_FROM_EMAIL) | SMTP auth details missing' });
  });

  it('signs as Easy Surfaces when no sender name is given', async () => {
    await sendEmail({ to: 'a@x.com', subject: 's', html: 'h' });
    expect(sesSend.mock.calls[0]![0].from).toEqual({ name: 'Easy Surfaces', address: 'noreply@easystones.com' });
  });
});
