import { describe, it, expect } from 'vitest';
import { isDeliveryWrite, deliveriesWritesPaused } from './deliveriesWritesPause.ts';

describe('deliveries pause', () => {
  it('is on only for the word true', () => {
    expect(deliveriesWritesPaused({ DELIVERIES_WRITES_PAUSED: 'true' } as never)).toBe(true);
    expect(deliveriesWritesPaused({ DELIVERIES_WRITES_PAUSED: ' TRUE ' } as never)).toBe(true);
    expect(deliveriesWritesPaused({} as never)).toBe(false);
    expect(deliveriesWritesPaused({ DELIVERIES_WRITES_PAUSED: '1' } as never)).toBe(false);
  });
  it('stops delivery and truck writes, never reads or other areas', () => {
    expect(isDeliveryWrite('POST', '/api/deliveries')).toBe(true);
    expect(isDeliveryWrite('PATCH', '/api/deliveries/abc/status?x=1')).toBe(true);
    expect(isDeliveryWrite('DELETE', '/api/deliveries/abc/pod')).toBe(true);
    expect(isDeliveryWrite('POST', '/api/trucks')).toBe(true);
    expect(isDeliveryWrite('GET', '/api/deliveries')).toBe(false);
    expect(isDeliveryWrite('PUT', '/api/delivery-columns/Seattle')).toBe(false);
    expect(isDeliveryWrite('POST', '/api/customers')).toBe(false);
  });
});
