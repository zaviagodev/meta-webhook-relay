/**
 * Extracts page/IG ID from Meta webhook payload
 * @param {Object} body - Parsed JSON body from webhook request
 * @returns {string|null} - The page/IG ID or null if not found
 */
export function extractId(body) {
  // Meta webhooks typically have entry[0].id for both Messenger and Instagram
  if (body?.entry && Array.isArray(body.entry) && body.entry.length > 0) {
    const firstEntry = body.entry[0];
    if (firstEntry.id) {
      return String(firstEntry.id);
    }
  }
  return null;
}

