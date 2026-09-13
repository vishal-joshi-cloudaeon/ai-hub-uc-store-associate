/**
 * Small FastAPI-shaped HTTP helpers so the converted routers keep returning
 * the same `{ "detail": ... }` error bodies the frontend (and the Foundry
 * agent's OpenAPI tools) already expect from the Python service.
 */
import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express'
import { AxiosError } from 'axios'
import { z } from 'zod'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown
  ) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail))
    this.name = 'HttpError'
  }
}

/** Validate a request body, rejecting with 422 like FastAPI does. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  const result = schema.safeParse(req.body)
  if (!result.success) {
    throw new HttpError(
      422,
      result.error.issues.map((issue) => ({
        loc: ['body', ...issue.path],
        msg: issue.message,
        type: issue.code,
      }))
    )
  }
  return result.data
}

/** Express 4 doesn't forward a rejected promise from an async handler to the
 * error middleware — every route is wrapped in this so a failed Databricks
 * call becomes a 500 with a readable body instead of a hung request. */
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next)
  }
}

export const approvalsErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ detail: err.detail })
    return
  }
  // A Databricks REST call that came back non-2xx — surface its own message
  // rather than a bare "Request failed with status code 403".
  if (err instanceof AxiosError && err.response) {
    console.error('Databricks API error', err.response.status, err.response.data)
    res.status(502).json({
      detail: `Databricks API error (${err.response.status}): ${
        (err.response.data as { message?: string })?.message ?? err.message
      }`,
    })
    return
  }
  console.error(err)
  res.status(500).json({ detail: err instanceof Error ? err.message : 'Unknown error' })
}
