# Meta Webhook Relay

Express relay server that receives Meta (Messenger + Instagram) webhook requests, maps them to downstream URLs using a static JSON configuration, and forwards the request while mirroring the downstream response back to Meta.

## Features

- **Messenger + Instagram endpoints:** `/webhooks/messenger` and `/webhooks/instagram`
- **All methods forwarded:** forwards GET/POST (and others) to downstream with headers/body intact
- **Response mirroring:** returns downstream status code, body, and headers (excluding hop-by-hop) to Meta
- **Error handling:** proper HTTP status codes for missing mapping or downstream failures
- **Raw body preservation:** forwards exact request bytes to downstream (for signature validation)

## Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set:
   - `PORT` - Server port (default: 3000)
   - `MAPPING_PATH` - Path to mapping JSON file (default: `src/config/mapping.json`)
   - `FORWARD_TIMEOUT_MS` - Request timeout in milliseconds (default: 5000)

3. **Configure mapping:**
   Edit `src/config/mapping.json` to map page/IG IDs under platform keys:
   ```json
   {
     "messenger": {
       "123456789": "https://your-app.com/webhooks/messenger",
       "123456780": "https://your-app.com/webhooks/messenger"
     },
     "instagram": {
       "987654321": "https://your-app.com/webhooks/instagram",
       "987654320": "https://your-app.com/webhooks/instagram"
     }
   }
   ```

4. **Start server:**
   ```bash
   pnpm start
   ```

## Meta App Dashboard Configuration

1. Go to your Meta App Dashboard → Webhooks product
2. Set **Messenger Callback URL**: `https://your-relay-server.com/webhooks/messenger`
3. Set **Instagram Callback URL**: `https://your-relay-server.com/webhooks/instagram`
4. Subscribe to desired webhook fields (e.g., `messages`, `messaging_postbacks` for Messenger)

## Testing

### Test Messenger Forwarding (POST)

```bash
curl -X POST http://localhost:3000/webhooks/messenger \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{
    "object": "page",
    "entry": [{
      "id": "123456789",
      "messaging": [{
        "sender": {"id": "user123"},
        "recipient": {"id": "123456789"},
        "message": {"text": "Hello"}
      }]
    }]
  }'
```

**Note:** The relay will:
- Extract ID `123456789` from `entry[0].id`
- Look up downstream URL in `mapping.json`
- Forward the raw request to that URL
- Return the downstream server's response (status, body, headers) back to Meta

### Test Instagram Forwarding (GET passthrough)

```bash
curl "http://localhost:3000/webhooks/instagram?test=1"
```

The request (including query params and headers) will be forwarded to the mapped Instagram downstream URL.

### Test Health Check

```bash
curl http://localhost:3000/health
```

Expected response: `{"status":"ok"}`

## Response Behavior

- **/webhooks/messenger** and **/webhooks/instagram** (all methods):
  - **404**: Mapping key not found (tries `entry[0].id` → `?id`/`?page_id`/`?ig_id`; optional `default` key under each platform)
  - **502**: Downstream server error, timeout, or network failure
  - **Mirrors downstream response**: If downstream returns 200/204/etc., Meta receives the same status code, body, and headers (except hop-by-hop headers)

## Reloading Mapping

Send `SIGHUP` signal to reload mapping without restarting:
```bash
kill -HUP <process_id>
```

## References

- [Messenger Platform Webhooks](https://developers.facebook.com/docs/messenger-platform/webhooks)
- [Instagram Platform Webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks)

