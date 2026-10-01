import { validateAndSanitizePayload } from "../services/core/validationSchema.js";

export function enforceCleanPayload(req, res, next) {
  const items = req.body.items || [];
  const taxId = req.body.clientTaxId;

  // If no items were sent, let the route handler apply its internal fallbacks
  if (Array.isArray(items) && items.length === 0) {
    return next();
  }

  const validation = validateAndSanitizePayload(items, taxId);

  if (!validation.isValid) {
    return res.status(422).json({
      success: false,
      error: "SCHEMA_VALIDATION_FAILED",
      details: validation.errors
    });
  }

  // Bind validated, clean items directly onto req.body
  req.body.items = validation.sanitizedItems;
  next();
}