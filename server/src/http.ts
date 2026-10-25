import { z, type ZodTypeAny } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);

export function parse<T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'validation_error', 'Request validation failed', result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })));
  }
  return result.data;
}

export const uuidParam = z.object({ id: z.string().uuid() });

export const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .url('Must be a valid URL')
  .refine((v) => /^https?:$/.test(new URL(v).protocol), 'Only http and https URLs are allowed');
