import { describe, expect, it } from 'vitest';
import { keyboardSafeProps } from './webViewSettings';

describe('keyboardSafeProps', () => {
  it('stops the iPhone web view scrolling itself for the keyboard', () => {
    // Without these the page pans up when a text box takes focus: forms lose their header, search sheets go blank.
    expect(keyboardSafeProps('ios')).toEqual({
      scrollEnabled: false,
      automaticallyAdjustContentInsets: false,
      contentInsetAdjustmentBehavior: 'never'
    });
  });

  it('leaves Android alone (scrollEnabled is an iOS prop and its keyboard resizes the window itself)', () => {
    expect(keyboardSafeProps('android')).toEqual({});
  });
});
