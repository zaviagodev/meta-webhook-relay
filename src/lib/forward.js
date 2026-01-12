
/**
 * Headers that should not be forwarded (hop-by-hop headers)
 */
const HOP_BY_HOP_HEADERS = [
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'upgrade',
  'content-length',
  'host'
];

/**
 * Filters headers to drop hop-by-hop headers while keeping everything else
 * @param {Headers} headers - Response headers from downstream
 * @returns {Object} - Filtered headers object
 */
function filterHeaders(headers) {
  const filtered = {};
  for (const [key, value] of headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.includes(lowerKey)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Sanitize incoming headers before forwarding downstream
 * @param {Object} incomingHeaders
 * @returns {Object}
 */
function sanitizeIncomingHeaders(incomingHeaders = {}) {
  const sanitized = {};
  Object.entries(incomingHeaders).forEach(([key, value]) => {
    const lowerKey = key.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.includes(lowerKey)) {
      sanitized[key] = value;
    }
  });
  return sanitized;
}

/**
 * Forwards a webhook request to downstream server and mirrors the response
 * @param {Object} options
 * @param {string} options.downstreamUrl - Target URL to forward to
 * @param {Buffer} options.rawBody - Raw request body bytes
 * @param {Object} options.incomingHeaders - Headers from incoming request
 * @param {string} options.relayId - Mapping key used (page/IG/platform)
 * @param {number} options.timeoutMs - Request timeout in milliseconds
 * @param {string} options.method - HTTP method to use when forwarding
 * @returns {Promise<{status: number, body: Buffer, headers: Object}>}
 */
export async function forwardRequest({
  downstreamUrl,
  rawBody,
  incomingHeaders,
  relayId,
  timeoutMs = 5000,
  method = 'POST'
}) {
  const sanitizedHeaders = sanitizeIncomingHeaders(incomingHeaders);

  if (relayId) {
    sanitizedHeaders['x-relay-key'] = relayId;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const upperMethod = method.toUpperCase();
  const shouldIncludeBody = !['GET', 'HEAD'].includes(upperMethod);

  const fetchOptions = {
    method: upperMethod,
    headers: sanitizedHeaders,
    signal: controller.signal
  };

  if (shouldIncludeBody) {
    fetchOptions.body = rawBody || Buffer.alloc(0);
    // Node fetch requires duplex when sending a body with non-GET methods for streaming
    fetchOptions.duplex = 'half';
  }

  try {
    const response = await fetch(downstreamUrl, fetchOptions);

    clearTimeout(timeoutId);

    const arrayBuffer = await response.arrayBuffer();
    const body = Buffer.from(arrayBuffer);

    const filteredHeaders = filterHeaders(response.headers);

    return {
      status: response.status,
      body,
      headers: filteredHeaders
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}


