import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { scalarParams, scalarQuery, validateScalarRequest } from './scalarRequest.ts';

function app() {
  const app = express();
  app.set('query parser', 'extended');
  app.get('/legacy/:id', validateScalarRequest, (req, res) => {
    res.json({ query: scalarQuery(req), params: scalarParams(req) });
  });
  // Array-aware routes continue to use their own query contract.
  app.get('/arrays', (req, res) => { res.json(req.query); });
  return app;
}

describe('legacy scalar request boundary', () => {
  it('preserves scalar values, missing values, empty strings and decoded paths', async () => {
    const response = await request(app()).get('/legacy/a%20b?page=2&search=&q=a%2Bb');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      query: { page: '2', search: '', q: 'a+b' }, params: { id: 'a b' }
    });
    expect(scalarQuery({ query: {} })).toEqual({});
  });

  it.each(['search=one&search=two', 'search[name]=one', 'search[]=one'])('rejects non-scalar query input: %s', async (query) => {
    const response = await request(app()).get(`/legacy/id?${query}`);
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/single text values/);
  });

  it('does not restrict array-aware endpoints', async () => {
    const response = await request(app()).get('/arrays?category=one&category=two');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ category: ['one', 'two'] });
  });

  it('checks path values at runtime rather than asserting their type', () => {
    expect(() => scalarParams({ params: { id: ['one', 'two'] } })).toThrow();
  });
});
