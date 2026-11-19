// Zod validation middleware. Validates req[part] and replaces it with parsed data.
function validate(part, schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return res.status(422).json({
        error: 'Validation failed',
        details: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req[part] = result.data;
    next();
  };
}
module.exports = { validate };
