import express from 'express';
import dotenv from 'dotenv';
import pino from 'pino';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { extractId } from './lib/extractId.js';
import { forwardRequest } from './lib/forward.js';

// Load environment variables
dotenv.config();

// Get current directory (ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize logger
const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

// Load mapping configuration
const MAPPING_PATH = process.env.MAPPING_PATH || join(__dirname, 'config', 'mapping.json');
let mapping = {};

function loadMapping() {
  try {
    const mappingContent = readFileSync(MAPPING_PATH, 'utf-8');
    mapping = JSON.parse(mappingContent);
    logger.info({ mappingPath: MAPPING_PATH, count: Object.keys(mapping).length }, 'Mapping loaded');
  } catch (error) {
    logger.error({ error: error.message, path: MAPPING_PATH }, 'Failed to load mapping file');
    process.exit(1);
  }
}

// Load mapping on startup
loadMapping();

// Reload mapping on SIGHUP (optional, for hot-reload)
process.on('SIGHUP', () => {
  logger.info('Received SIGHUP, reloading mapping...');
  loadMapping();
});

const app = express();
const PORT = process.env.PORT || 3000;
const FORWARD_TIMEOUT_MS = parseInt(process.env.FORWARD_TIMEOUT_MS || '5000', 10);
const WEBHOOK_PATHS = ['/webhooks/messenger', '/webhooks/instagram'];

// Middleware to capture raw body (all content types) and parse JSON when possible
app.use(WEBHOOK_PATHS, express.raw({ type: '*/*', limit: '10mb' }), (req, res, next) => {
  // Ensure rawBody is a Buffer
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
  } else if (typeof req.body === 'string') {
    req.rawBody = Buffer.from(req.body);
  } else {
    req.rawBody = Buffer.alloc(0);
  }

  const contentType = req.headers['content-type'] || '';

  // Only attempt JSON parsing for JSON-ish content types
  if (contentType.includes('application/json') && req.rawBody.length > 0) {
    try {
      req.parsedBody = JSON.parse(req.rawBody.toString());
    } catch (error) {
      req.parsedBody = null;
    }
  } else {
    req.parsedBody = null;
  }

  next();
});

function resolveDownstream(req, platform) {
  const platformMap = mapping[platform];

  // If platform mapping is missing or not an object, fail fast
  if (!platformMap || typeof platformMap !== 'object') {
    return { key: null, url: null };
  }

  const candidates = [];

  // Try to extract id from parsed JSON body
  if (req.parsedBody && typeof req.parsedBody === 'object') {
    const extractedId = extractId(req.parsedBody);
    if (extractedId) {
      candidates.push(extractedId);
    }
  }

  // Allow explicit query-based mapping keys (e.g., ?id=123)
  const queryId = req.query?.id || req.query?.page_id || req.query?.ig_id;
  if (Array.isArray(queryId)) {
    candidates.push(...queryId);
  } else if (queryId) {
    candidates.push(queryId);
  }

  for (const candidate of candidates) {
    if (candidate && platformMap[candidate]) {
      return { key: candidate, url: platformMap[candidate] };
    }
  }

  // Optional platform-level default entry
  if (platformMap.default) {
    return { key: 'default', url: platformMap.default };
  }

  return { key: candidates[0] || null, url: null };
}

function appendQueryParams(baseUrl, query) {
  const url = new URL(baseUrl);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((v) => url.searchParams.append(key, v));
    } else if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });
  return url.toString();
}

function createWebhookHandler(platform) {
  return async (req, res) => {
    try {
      const { key: mappingKey, url: downstreamBaseUrl } = resolveDownstream(req, platform);

      if (!downstreamBaseUrl) {
        logger.warn({ platform, mappingKey }, 'No mapping found for request');
        return res.status(404).json({ error: `No downstream URL mapped for key: ${mappingKey || 'unknown'}` });
      }

      const targetUrl = appendQueryParams(downstreamBaseUrl, req.query);

      const downstreamResponse = await forwardRequest({
        downstreamUrl: targetUrl,
        method: req.method,
        rawBody: req.rawBody || Buffer.alloc(0),
        incomingHeaders: req.headers,
        relayId: mappingKey,
        timeoutMs: FORWARD_TIMEOUT_MS
      });

      res.status(downstreamResponse.status);

      Object.entries(downstreamResponse.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });

      res.send(downstreamResponse.body);

      logger.info(
        { platform, mappingKey, targetUrl, status: downstreamResponse.status },
        'Webhook forwarded successfully'
      );
    } catch (error) {
      logger.error({ platform, error: error.message, stack: error.stack }, 'Error forwarding webhook');
      res.status(502).json({ error: 'Failed to forward webhook to downstream server' });
    }
  };
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Messenger and Instagram webhook handlers (all HTTP methods)
app.all('/webhooks/messenger', createWebhookHandler('messenger'));
app.all('/webhooks/instagram', createWebhookHandler('instagram'));

// Start server
app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Meta Webhook Relay server started');
});

