// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ContactPage from './ContactPage';

const request = vi.fn<typeof fetch>();
beforeEach(() => vi.stubGlobal('fetch', request));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); request.mockReset(); });

function fill() {
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Alex Stone' } });
  fireEvent.change(screen.getByPlaceholderText('Company Name'), { target: { value: 'Harbor' } });
  fireEvent.change(screen.getByPlaceholderText('E-Mail'), { target: { value: 'alex@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('(555) 000-0000'), { target: { value: '2065550123' } });
  fireEvent.change(screen.getByPlaceholderText('How can we help you?'), { target: { value: 'Please send a quote.' } });
}

describe('Contact page', () => {
  it('requires name, email and message before a browser can submit', () => {
    render(<ContactPage />);
    expect((screen.getByRole('button', { name: /Send Message/ }).closest('form') as HTMLFormElement).checkValidity()).toBe(false);
    fill();
    expect((document.querySelector('form') as HTMLFormElement).checkValidity()).toBe(true);
    expect((screen.getByPlaceholderText('(555) 000-0000') as HTMLInputElement).value).toBe('(206) 555-0123');
  });

  it('posts the message and clears the form after success', async () => {
    request.mockResolvedValue(Response.json({ success: true }));
    render(<ContactPage />); fill();
    fireEvent.click(screen.getByRole('button', { name: /Send Message/ }));
    expect(await screen.findByText(/Message sent successfully/)).toBeTruthy();
    const [url, options] = request.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/contact$/);
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual({ name: 'Alex Stone', company: 'Harbor', email: 'alex@example.com', phone: '(206) 555-0123', message: 'Please send a quote.' });
    expect((screen.getByPlaceholderText('Name') as HTMLInputElement).value).toBe('');
  });

  it.each(['server', 'network'])('keeps the message available for retry on a %s failure', async kind => {
    if (kind === 'server') request.mockResolvedValue(Response.json({ message: 'Please try later' }, { status: 503 }));
    else request.mockRejectedValue(new Error('offline'));
    render(<ContactPage />); fill();
    fireEvent.click(screen.getByRole('button', { name: /Send Message/ }));
    await screen.findByText(kind === 'server' ? 'Please try later' : 'Failed to send message. Please try again.');
    expect((screen.getByPlaceholderText('Name') as HTMLInputElement).value).toBe('Alex Stone');
    await waitFor(() => expect((screen.getByRole('button', { name: /Send Message/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('disables submission while the request is pending', () => {
    request.mockReturnValue(new Promise(() => {}));
    render(<ContactPage />); fill();
    fireEvent.click(screen.getByRole('button', { name: /Send Message/ }));
    expect((screen.getByRole('button', { name: /Sending/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
