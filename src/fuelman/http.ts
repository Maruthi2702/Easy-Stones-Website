import type { Request, Response, RequestHandler } from 'express';
import type { z } from 'zod';
import { handle as wrap, parse as read, HttpError } from '../server/http.js';
export { HttpError };
export const handle: (fn: (req: Request, res: Response) => Promise<unknown>) => RequestHandler = wrap;
export const parse: <T extends z.ZodTypeAny>(schema: T, data: unknown) => z.output<T> = read;
export const idParam = (req: Request) => {
  const id = String(req.params.id);
  if (!/^[a-f\d]{24}$/i.test(id)) throw new HttpError(404, 'Report not found');
  return id;
};
export const actor = (req: Request) => ({ id: String(req.user.id || ''), name: req.user.displayName || req.user.username || '' });
