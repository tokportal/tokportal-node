# @tokportal/node

[![npm](https://img.shields.io/npm/v/@tokportal/node.svg)](https://www.npmjs.com/package/@tokportal/node)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

TokPortal is the managed social infrastructure API: real TikTok, Instagram and YouTube accounts created, warmed and operated by human account managers in 16+ countries — exposed as a REST API and an MCP server. No OAuth per account, no 25-posts/day cap, no app review.

Docs https://developers.tokportal.com · API base https://app.tokportal.com/api/ext · OpenAPI https://developers.tokportal.com/openapi.json · MCP remote https://app.tokportal.com/api/ext/mcp · Get an API key https://app.tokportal.com/developer/api-keys · llms.txt https://developers.tokportal.com/llms.txt

---

`@tokportal/node` is the official TypeScript / Node.js SDK for the TokPortal API (Node 18+, ESM, fully typed, zero runtime dependencies). Every public operation is available as a typed method or through the generated `requestOperation` map.

## Install

```bash
npm install @tokportal/node
```

## 30-second quickstart

```ts
import { TokPortal } from "@tokportal/node";

const tokportal = new TokPortal({ apiKey: process.env.TOKPORTAL_API_KEY! });

// 1. Create a bundle: a fresh managed TikTok account in the USA + 1 video slot.
//    Credits are debited now; the account manager is assigned at publish time.
const bundle = await tokportal.bundles.create({
  bundle_type: "account_and_videos",
  platform: "tiktok",
  country: "USA",
  title: "US launch",
  videos_quantity: 1,
});
const bundleId = bundle.data.id;

// 2. Upload the video straight from disk -> public_url
const upload = await tokportal.uploads.videoDirectFile("./launch.mp4", bundleId, "video/mp4");

// 3. Configure the account profile and video slot 1, then publish
await tokportal.bundles.configureAccount(bundleId, {
  username: "mybrand.us",
  visible_name: "My Brand",
  biography: "Official account",
});
await tokportal.bundles.configureVideo(bundleId, 1, {
  video_type: "video",
  video_url: upload.data.public_url,
  description: "Day 1 — launching in the US 🚀 #launch",
  target_publish_date: "2026-09-01",
});
await tokportal.bundles.publish(bundleId);

// 4. Later (webhook `account.in_review` / `account.finalized`, or polling):
//    saved_account_id is the real delivered account -> read it back
const { data: current } = await tokportal.bundles.get(bundleId);
if (current.saved_account_id) {
  const { data: account } = await tokportal.accounts.get(current.saved_account_id);
  console.log(account.username, account.profile_url);
}
```

> Method names above follow the generated resource map (`bundles`, `uploads`, `accounts`, `analytics`, `webhooks`). If a helper does not exist for an operation, use `tokportal.requestOperation("<operationId>", { path, query, body })` — see below.

## Full example

```ts
import { TokPortal, TokPortalApiError } from "@tokportal/node";

const tokportal = new TokPortal({
  apiKey: process.env.TOKPORTAL_API_KEY!,
});

const me = await tokportal.me();

const bundle = await tokportal.bundles.create({
  bundle_type: "account_and_videos",
  country: "USA",
  videos_quantity: 5,
});

const csv = await tokportal.analytics.exportVideos({
  account: ["saved-account-id"],
});
const image = await tokportal.uploads.imageFromUrl({
  url: "https://cdn.example.com/photo.jpg",
  bundle_id: bundle.data.id,
});

console.log(me.data.email, bundle.data, csv, image.data);
```

Direct multipart uploads can use either a `Blob` or a local file path:

```ts
const uploaded = await tokportal.uploads.videoDirectFile(
  "./video.mp4",
  bundle.data.id,
  "video/mp4",
  { idempotencyKey: "video-upload-123" },
);
```

Manage TokPortal Coverage from the latest atomic quote. A zero-credit quote is
valid and still requires an explicit reactivation call:

```ts
const coverage = await tokportal.accounts.coverage("saved-account-id");
const quote = coverage.data.reactivation_quote;

if (quote) {
  await tokportal.accounts.reactivateCoverage(
    "saved-account-id",
    {
      expected_credits: quote.credits,
      expected_current_period_end: quote.current_period_end,
      expected_lock_version: quote.lock_version,
    },
    { idempotencyKey: "coverage-reactivate-saved-account-id-v4" },
  );
}

await tokportal.accounts.pauseCoverage("saved-account-id", {
  idempotencyKey: "coverage-pause-saved-account-id-v4",
});
```

Credential reveal and verification-code access use the same irreversible
two-step policy flow. First call without acceptance to receive HTTP 428 and
`error.details.policy_version`; then show those terms to the account owner and
retry with that exact version. The accepted request may debit credits and
permanently detach the account. These secret-bearing responses are never stored
for replay, so do not pass `idempotencyKey` or an `Idempotency-Key` custom
header. After an uncertain transport result, reconcile the safe account state
before deciding whether to call the endpoint again without a key:

If an accepted call returns HTTP 409 with
`CREDENTIAL_REVEAL_QUOTE_CHANGED`, no charge or reveal occurred. Read the
current policy and `expected_credit_cost` from `error.details`, show the new
terms to the owner, obtain fresh consent, and retry with the new version. Never
retry a 409 automatically.

```ts
try {
  await tokportal.accounts.revealCredentials("saved-account-id");
} catch (error) {
  if (!(error instanceof TokPortalApiError) || error.status !== 428) throw error;

  const policyVersion = String(error.details?.policy_version);
  const credentials = await tokportal.accounts.revealCredentials(
    "saved-account-id",
    {
      acknowledge_support_forfeit: true,
      policy_version: policyVersion,
    },
  );
  console.log(credentials.data);
}
```

The same no-replay rule applies to `webhooks.create`, `uploads.image`,
`uploads.video`, and `analytics.createReport` because they return a signing
secret, signed upload capability, or report access token. Their typed options
do not expose `idempotencyKey`, and the SDK rejects an injected
`Idempotency-Key` header locally.

Discover and operate webhooks without dropping to raw HTTP:

```ts
const catalog = await tokportal.webhooks.events();
const endpoints = await tokportal.webhooks.list({ event: "bundle.published" });
const retry = await tokportal.webhooks.retryDelivery(
  endpoints.data[0].id,
  "delivery-id",
);
```

Every OpenAPI operation is also reachable through the generated operation map:

```ts
const sameRetry = await tokportal.requestOperation("retryWebhookDelivery", {
  path: { id: endpoints.data[0].id, delivery_id: "delivery-id" },
});

const csvAgain = await tokportal.requestOperation<string>(
  "exportAnalyticsVideos",
  {
    query: { account: ["saved-account-id"] },
  },
);
```

The SDK sends `X-TokPortal-Client: tokportal-node/0.1.1` on API requests for observability and support diagnostics.

Verify signed webhook deliveries with the exact raw request body:

```ts
import { verifyWebhookSignature } from "@tokportal/node";

const valid = verifyWebhookSignature(
  rawBody,
  request.headers["tokportal-signature"],
  process.env.TOKPORTAL_WEBHOOK_SECRET!,
);
```

```ts
import { TokPortalApiError } from "@tokportal/node";

try {
  await tokportal.bundles.create({
    bundle_type: "account_and_videos",
    country: "USA",
    videos_quantity: 5,
  });
} catch (error) {
  if (error instanceof TokPortalApiError) {
    console.error(error.status, error.code, error.details, error.requestId);
    if (error.retryable) {
      const waitMs = (error.retryAfterSeconds ?? 1) * 1000;
      // Retry with backoff.
    }
    console.log(error.rateLimit?.remaining, error.rateLimit?.reset);
  }
}
```

API keys use the format `sk_` followed by 64 lowercase hex characters. TokPortal stores only a SHA-256 hash of the key and shows the raw key once at creation.

## Source of truth

This package is generated from the TokPortal public OpenAPI schema
(https://developers.tokportal.com/openapi.json) in the private TokPortal
monorepo. Generated files (`src/generated.ts`) are overwritten on every release — do not edit
them by hand. See [CONTRIBUTING.md](./CONTRIBUTING.md) for what we accept as PRs
and [SECURITY.md](./SECURITY.md) for vulnerability reporting.

## Links

- Documentation: https://developers.tokportal.com
- SDKs & CLI guide: https://developers.tokportal.com/sdks-cli
- MCP server: https://developers.tokportal.com/mcp · [`tokportal-mcp`](https://www.npmjs.com/package/tokportal-mcp)
- API reference (OpenAPI): https://developers.tokportal.com/openapi.json
- Other packages: [`@tokportal/node`](https://www.npmjs.com/package/@tokportal/node) · [`@tokportal/cli`](https://www.npmjs.com/package/@tokportal/cli) · [`tokportal` (PyPI)](https://pypi.org/project/tokportal/) · [`github.com/tokportal/tokportal-go`](https://github.com/tokportal/tokportal-go)

MIT © TokPortal
