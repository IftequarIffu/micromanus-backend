import type { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function notImplemented(_req: Request, res: Response): void {
  res.status(501).json({ error: "not_implemented", code: "not_implemented" });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }

  console.error("Unhandled error", err);
  res.status(500).json({ error: "internal_server_error", code: "internal_error" });
}
