
'use strict';

function notFound(req, res) {
  res.status(404).json({ error: 'Route not found' });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const candidate = Number(
    err.status || err.statusCode || (err.code === 'P2002' ? 409 : 500)
  );

  const status = candidate >= 400 && candidate <= 599 ? candidate : 500;

  if (status >= 500) {
    console.error('Customer API request failed:', {
      method: req.method,
      path: req.originalUrl,
      code: err.code || 'REQUEST_FAILED',
      name: err.name,
      message: process.env.NODE_ENV === 'production'
        ? undefined
        : err.message,
      stack: process.env.NODE_ENV === 'production'
        ? undefined
        : err.stack,
      meta: process.env.NODE_ENV === 'production'
        ? undefined
        : err.meta,
    });
  }

  res.status(status).json({
    error: status >= 500
      ? 'Internal server error'
      : err.code === 'P2002'
        ? 'A matching record already exists'
        : err.message,
    code: status >= 500
      ? 'REQUEST_FAILED'
      : err.code || 'REQUEST_REJECTED'
  });
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = { notFound, errorHandler, httpError };
