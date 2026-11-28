// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VoiceTestPage from './VoiceTestPage';
import { OPEN_MESSAGE, openSpeechTest } from './openSpeechTest';

describe('Admin → Voice Test', () => {
  it('outside the app there is nothing to open, and it says so', async () => {
    expect(await openSpeechTest(false)).toBe('not-in-app');
    render(<VoiceTestPage />);
    fireEvent.click(screen.getByRole('button', { name: /open speech test/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(OPEN_MESSAGE['not-in-app']));
  });

  it('an app build without the test says to update', async () => {
    // jsdom has no native bridge, so the plugin call fails the way an old build's would.
    expect(await openSpeechTest(true)).toBe('old-app');
  });
});
