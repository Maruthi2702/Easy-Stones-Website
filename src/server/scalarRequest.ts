import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import type { ScalarParams, ScalarQuery } from '../types/server.ts';

const querySchema = z.record(z.string().optional());
const paramsSchema = z.record(z.string());

/** Only for legacy endpoints whose query contract consists of scalar strings. */
export function scalarQuery(req: Pick<Request, 'query'>): ScalarQuery {
  return querySchema.parse(req.query);
}

export function scalarParams(req: Pick<Request, 'params'>): ScalarParams {
  return paramsSchema.parse(req.params);
}

/** Run before the controller's local error handling so bad input answers 400. */
export const validateScalarRequest: RequestHandler = (req, res, next) => {
  const query = querySchema.safeParse(req.query);
  const params = paramsSchema.safeParse(req.params);
  if (!query.success || !params.success) {
    return res.status(400).json({ message: 'Query and path parameters must be single text values.' });
  }
  next();
};
