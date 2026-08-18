import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  OPERATION_DEFINITIONS,
  TOKPORTAL_BASE_URL,
  type AccountCorrectionsRequest,
  type CreateAnalyticsReportRequest,
  type CreateBulkBundlesRequest,
  type CreateBundleRequest,
  type CreateWebhookEndpointRequest,
  type FixVideoDownloadRequest,
  type PatchBundleRequest,
  type RefreshAnalyticsRequest,
  type UploadImageFromUrlRequest,
  type UploadImageRequest,
  type UploadVideoRequest,
  type UpdateWebhookEndpointRequest,
  type VideoCorrectionsRequest,
  type OperationId,
} from "./generated.js";

export * from "./generated.js";

export const TOKPORTAL_SDK_VERSION = "0.1.1";
export const TOKPORTAL_CLIENT_HEADER = `tokportal-node/${TOKPORTAL_SDK_VERSION}`;

export type TokPortalClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export type RequestOptions = {
  idempotencyKey?: string;
  headers?: Record<string, string>;
};

export type SensitiveResponseRequestOptions = {
  headers?: Record<string, string>;
};

const SENSITIVE_RESPONSE_OPERATION_IDS = new Set<OperationId>([
  "retrieveAccountVerificationCode",
  "revealAccountCredentials",
  "createWebhookEndpoint",
  "uploadImage",
  "uploadVideo",
  "createAnalyticsReport",
]);

export type OperationBinaryValue = Blob | ArrayBuffer | Uint8Array;

export type OperationFormValue =
  | string
  | number
  | boolean
  | OperationBinaryValue
  | { value: OperationBinaryValue; filename: string; contentType?: string };

export type OperationRequest = {
  path?: Record<string, string | number>;
  query?: ListParams;
  body?: unknown;
  form?: Record<string, OperationFormValue>;
};

export type ListParams = {
  page?: number;
  per_page?: number;
  [key: string]:
    | string
    | number
    | boolean
    | string[]
    | number[]
    | boolean[]
    | undefined;
};

export type QuantityRequest = {
  quantity: number;
};

export type ConfigureAccountRequest = {
  username: string;
  visible_name: string;
  biography?: string;
  profile_picture_url?: string;
  link_in_bio?: string;
  niche_warming_instructions?: string;
};

export type ConfigureVideoRequest = {
  video_type: "video" | "carousel";
  description: string;
  target_publish_date: string;
  name?: string;
  video_url?: string;
  carousel_images?: string[];
  carousel_title?: string;
  tiktok_sound_url?: string;
  volume_original_sound?: number | null;
  volume_added_sound?: number | null;
  editing_instructions?: string;
  external_ref?: string;
  instagram_content_type?: "reel" | "post";
  instagram_location?: string;
  instagram_collaborators?: string[];
  instagram_audio_name?: string;
  instagram_add_to_story?: boolean;
  youtube_title?: string;
  youtube_tags?: string[];
  youtube_category?: string;
  youtube_visibility?: "public" | "unlisted" | "private";
  youtube_sound_url?: string;
  auto_publish?: boolean;
};

export type PatchVideoRequest = {
  external_ref?: string | null;
  name?: string | null;
};

export type BatchConfigureVideosRequest = {
  videos: Array<ConfigureVideoRequest & { position: number }>;
  auto_publish?: boolean;
};

export type AccountEditRequest = {
  requested_username: string;
  requested_visible_name: string;
  requested_biography?: string;
  requested_profile_picture_url?: string;
  requested_link_in_bio?: string;
};

export type CredentialRevealAcceptance = {
  acknowledge_support_forfeit: true;
  policy_version: string;
};

export type ManagedAccountSubscriptionReactivationRequest = {
  expected_credits: number;
  expected_current_period_end: string;
  expected_lock_version: number;
};

export type CreateCommentTaskRequest =
  | {
      saved_account_id: string;
      target_video_url: string;
      comment_text: string;
      brief_id?: string | null;
    }
  | {
      tasks: Array<{
        saved_account_id: string;
        target_video_url: string;
        comment_text: string;
        brief_id?: string | null;
      }>;
    };

export type DisputeCommentRequest = {
  reason: string;
};

export type ApiResponse<T = unknown> = {
  data: T;
  [key: string]: unknown;
};

export type PaginatedResponse<T = unknown> = {
  data: T[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
};

export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

export type TokPortalApiErrorOptions = {
  details?: Record<string, unknown>;
  requestId?: string;
  rawBody?: string;
  headers?: Record<string, string>;
  retryAfterSeconds?: number;
  rateLimit?: TokPortalRateLimit;
};

export type TokPortalRateLimit = {
  limit?: number;
  remaining?: number;
  reset?: number;
};

export type VerifyWebhookSignatureOptions = {
  toleranceSeconds?: number;
  now?: number;
};

function parseWebhookSignature(header: string): {
  timestamp?: string;
  signature?: string;
} {
  const parts = header.split(",").map((part) => part.trim().split("="));
  const values = Object.fromEntries(parts.filter((part) => part.length === 2));
  return { timestamp: values.t, signature: values.v1 };
}

export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string,
  signingSecret: string,
  options: VerifyWebhookSignatureOptions = {},
): boolean {
  const { timestamp, signature } = parseWebhookSignature(signatureHeader);
  if (!timestamp || !signature || !signingSecret) return false;

  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) return false;

  const toleranceSeconds = options.toleranceSeconds ?? 300;
  const nowSeconds = options.now ?? Math.floor(Date.now() / 1000);
  if (
    toleranceSeconds > 0 &&
    Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds
  ) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", signingSecret)
    .update(timestamp)
    .update(".")
    .update(rawBody)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export class TokPortalApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly rawBody?: string;
  readonly headers?: Record<string, string>;
  readonly retryAfterSeconds?: number;
  readonly rateLimit?: TokPortalRateLimit;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code?: string,
    detailsOrOptions?: Record<string, unknown> | TokPortalApiErrorOptions,
  ) {
    super(message);
    this.name = "TokPortalApiError";
    this.status = status;
    this.code = code;
    if (
      detailsOrOptions &&
      ("details" in detailsOrOptions ||
        "requestId" in detailsOrOptions ||
        "rawBody" in detailsOrOptions ||
        "headers" in detailsOrOptions ||
        "retryAfterSeconds" in detailsOrOptions ||
        "rateLimit" in detailsOrOptions)
    ) {
      const options = detailsOrOptions as TokPortalApiErrorOptions;
      this.details = options.details;
      this.requestId = options.requestId;
      this.rawBody = options.rawBody;
      this.headers = options.headers;
      this.retryAfterSeconds = options.retryAfterSeconds;
      this.rateLimit = options.rateLimit;
    } else {
      this.details = detailsOrOptions as Record<string, unknown> | undefined;
    }
  }

  get statusCode(): number {
    return this.status;
  }

  get retryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

function headerInt(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isBinaryValue(value: unknown): value is OperationBinaryValue {
  return (
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    value instanceof Uint8Array
  );
}

function isCredentialRevealAcceptance(
  value: CredentialRevealAcceptance | SensitiveResponseRequestOptions | undefined,
): value is CredentialRevealAcceptance {
  if (!value) return false;
  const candidate = value as Record<string, unknown>;
  const looksLikeAcceptance =
    "acknowledge_support_forfeit" in candidate ||
    "policy_version" in candidate;
  if (!looksLikeAcceptance) return false;
  if (
    candidate.acknowledge_support_forfeit !== true ||
    typeof candidate.policy_version !== "string" ||
    candidate.policy_version.trim() === ""
  ) {
    throw new TypeError(
      "Credential reveal acceptance requires acknowledge_support_forfeit=true and a non-empty policy_version returned by the 428 preview.",
    );
  }
  return true;
}

function sensitiveResponseOptions(
  options: SensitiveResponseRequestOptions | RequestOptions | undefined,
): SensitiveResponseRequestOptions | undefined {
  if (!options) return undefined;
  const candidate = options as RequestOptions;
  const idempotencyHeader = Object.keys(candidate.headers || {}).find(
    (name) => name.toLowerCase() === "idempotency-key",
  );
  if (candidate.idempotencyKey || idempotencyHeader) {
    throw new TypeError(
      "Secret-bearing TokPortal operations do not accept Idempotency-Key because their responses are never stored for replay. Remove the key and reconcile safe resource state before retrying.",
    );
  }
  return options;
}

function toBlob(value: OperationBinaryValue, contentType?: string): Blob {
  if (value instanceof Blob && !contentType) return value;
  // TypeScript >= 5.7 types Uint8Array over ArrayBufferLike, which is not a
  // BlobPart; copy into a plain ArrayBuffer-backed view to satisfy every
  // TypeScript version and avoid a SharedArrayBuffer-backed source at runtime.
  const part: BlobPart =
    value instanceof Uint8Array ? new Uint8Array(value) : value;
  return new Blob([part], contentType ? { type: contentType } : undefined);
}

async function formFileFromPath(
  filePath: string,
  contentType?: string,
): Promise<{ value: Blob; filename: string; contentType?: string }> {
  const bytes = await fs.readFile(filePath);
  return {
    value: new Blob(
      [new Uint8Array(bytes)],
      contentType ? { type: contentType } : undefined,
    ),
    filename: path.basename(filePath),
    ...(contentType ? { contentType } : {}),
  };
}

export class TokPortal {
  readonly apiKey: string;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  readonly bundles = {
    list: (params?: ListParams, options?: RequestOptions) =>
      this.request<PaginatedResponse>(
        "GET",
        "/bundles",
        undefined,
        params,
        options,
      ),
    create: (body: CreateBundleRequest, options?: RequestOptions) =>
      this.request<ApiResponse>("POST", "/bundles", body, undefined, options),
    bulkCreate: (body: CreateBulkBundlesRequest, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        "/bundles/bulk",
        body,
        undefined,
        options,
      ),
    get: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/bundles/${encodeURIComponent(id)}`,
        undefined,
        undefined,
        options,
      ),
    update: (id: string, body: PatchBundleRequest, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "PATCH",
        `/bundles/${encodeURIComponent(id)}`,
        body,
        undefined,
        options,
      ),
    publish: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        `/bundles/${encodeURIComponent(id)}/publish`,
        undefined,
        undefined,
        options,
      ),
    readiness: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/bundles/${encodeURIComponent(id)}/publish-readiness`,
        undefined,
        undefined,
        options,
      ),
    unpublish: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        `/bundles/${encodeURIComponent(id)}/unpublish`,
        undefined,
        undefined,
        options,
      ),
    addVideoSlots: (
      id: string,
      body: QuantityRequest,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        `/bundles/${encodeURIComponent(id)}/add-video-slots`,
        body,
        undefined,
        options,
      ),
    addEditSlots: (
      id: string,
      body: QuantityRequest,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        `/bundles/${encodeURIComponent(id)}/add-edit-slots`,
        body,
        undefined,
        options,
      ),
    getAccount: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/bundles/${encodeURIComponent(id)}/account`,
        undefined,
        undefined,
        options,
      ),
    configureAccount: (
      id: string,
      body: ConfigureAccountRequest,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "PUT",
        `/bundles/${encodeURIComponent(id)}/account`,
        body,
        undefined,
        options,
      ),
    requestAccountCorrections: (
      id: string,
      body: AccountCorrectionsRequest,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        `/bundles/${encodeURIComponent(id)}/account/corrections`,
        body,
        undefined,
        options,
      ),
    finalizeAccount: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        `/bundles/${encodeURIComponent(id)}/account/finalize`,
        undefined,
        undefined,
        options,
      ),
    listVideos: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/bundles/${encodeURIComponent(id)}/videos`,
        undefined,
        undefined,
        options,
      ),
    getVideo: (id: string, position: number, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/bundles/${encodeURIComponent(id)}/videos/${encodeURIComponent(String(position))}`,
        undefined,
        undefined,
        options,
      ),
    configureVideo: (
      id: string,
      position: number,
      body: ConfigureVideoRequest,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "PUT",
        `/bundles/${encodeURIComponent(id)}/videos/${encodeURIComponent(String(position))}`,
        body,
        undefined,
        options,
      ),
    patchVideo: (
      id: string,
      position: number,
      body: PatchVideoRequest,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "PATCH",
        `/bundles/${encodeURIComponent(id)}/videos/${encodeURIComponent(String(position))}`,
        body,
        undefined,
        options,
      ),
    batchConfigureVideos: (
      id: string,
      body: BatchConfigureVideosRequest,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "PUT",
        `/bundles/${encodeURIComponent(id)}/videos/batch`,
        body,
        undefined,
        options,
      ),
    publishAllVideos: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        `/bundles/${encodeURIComponent(id)}/videos/publish-all`,
        undefined,
        undefined,
        options,
      ),
    publishVideo: (id: string, position: number, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        `/bundles/${encodeURIComponent(id)}/videos/${encodeURIComponent(String(position))}/publish`,
        undefined,
        undefined,
        options,
      ),
    resetVideo: (id: string, position: number, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        `/bundles/${encodeURIComponent(id)}/videos/${encodeURIComponent(String(position))}/reset`,
        undefined,
        undefined,
        options,
      ),
    unscheduleVideo: (id: string, position: number, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        `/bundles/${encodeURIComponent(id)}/videos/${encodeURIComponent(String(position))}/unschedule`,
        undefined,
        undefined,
        options,
      ),
    finalizeVideo: (id: string, position: number, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        `/bundles/${encodeURIComponent(id)}/videos/${encodeURIComponent(String(position))}/finalize`,
        undefined,
        undefined,
        options,
      ),
    requestVideoCorrections: (
      id: string,
      position: number,
      body: VideoCorrectionsRequest,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        `/bundles/${encodeURIComponent(id)}/videos/${encodeURIComponent(String(position))}/corrections`,
        body,
        undefined,
        options,
      ),
    fixVideoDownload: (
      id: string,
      position: number,
      body: FixVideoDownloadRequest,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        `/bundles/${encodeURIComponent(id)}/videos/${encodeURIComponent(String(position))}/fix-download`,
        body,
        undefined,
        options,
      ),
  };

  readonly credits = {
    balance: (options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        "/credits/balance",
        undefined,
        undefined,
        options,
      ),
    history: (params?: ListParams, options?: RequestOptions) =>
      this.request<PaginatedResponse>(
        "GET",
        "/credits/history",
        undefined,
        params,
        options,
      ),
  };

  readonly accounts = {
    list: (params?: ListParams, options?: RequestOptions) =>
      this.request<PaginatedResponse>(
        "GET",
        "/accounts",
        undefined,
        params,
        options,
      ),
    get: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/accounts/${encodeURIComponent(id)}`,
        undefined,
        undefined,
        options,
      ),
    bundles: (id: string, params?: ListParams, options?: RequestOptions) =>
      this.request<PaginatedResponse>(
        "GET",
        `/accounts/${encodeURIComponent(id)}/bundles`,
        undefined,
        params,
        options,
      ),
    verificationCode: (
      id: string,
      acceptanceOrOptions?:
        | CredentialRevealAcceptance
        | SensitiveResponseRequestOptions,
      options?: SensitiveResponseRequestOptions,
    ) => {
      const hasAcceptance = isCredentialRevealAcceptance(acceptanceOrOptions);
      return this.request<ApiResponse>(
        "POST",
        `/accounts/${encodeURIComponent(id)}/verification-code`,
        hasAcceptance ? acceptanceOrOptions : undefined,
        undefined,
        sensitiveResponseOptions(
          hasAcceptance ? options : acceptanceOrOptions,
        ),
      );
    },
    revealCredentials: (
      id: string,
      acceptanceOrOptions?:
        | CredentialRevealAcceptance
        | SensitiveResponseRequestOptions,
      options?: SensitiveResponseRequestOptions,
    ) => {
      const hasAcceptance = isCredentialRevealAcceptance(acceptanceOrOptions);
      return this.request<ApiResponse>(
        "POST",
        `/accounts/${encodeURIComponent(id)}/reveal-credentials`,
        hasAcceptance ? acceptanceOrOptions : undefined,
        undefined,
        sensitiveResponseOptions(
          hasAcceptance ? options : acceptanceOrOptions,
        ),
      );
    },
    coverage: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/accounts/${encodeURIComponent(id)}/managed-subscription`,
        undefined,
        undefined,
        options,
      ),
    reactivateCoverage: (
      id: string,
      body: ManagedAccountSubscriptionReactivationRequest,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        `/accounts/${encodeURIComponent(id)}/managed-subscription/reactivate`,
        body,
        undefined,
        options,
      ),
    pauseCoverage: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        `/accounts/${encodeURIComponent(id)}/managed-subscription/cancel`,
        undefined,
        undefined,
        options,
      ),
    canRefreshAnalytics: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/accounts/${encodeURIComponent(id)}/analytics/can-refresh`,
        undefined,
        undefined,
        options,
      ),
    refreshAnalytics: (
      id: string,
      body: RefreshAnalyticsRequest = {},
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        `/accounts/${encodeURIComponent(id)}/analytics/refresh`,
        body,
        undefined,
        options,
      ),
    getEditRequest: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/accounts/${encodeURIComponent(id)}/edit-request`,
        undefined,
        undefined,
        options,
      ),
    createEditRequest: (
      id: string,
      body: AccountEditRequest,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        `/accounts/${encodeURIComponent(id)}/edit-request`,
        body,
        undefined,
        options,
      ),
  };

  readonly analytics = {
    dashboard: (params?: ListParams, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        "/analytics",
        undefined,
        params,
        options,
      ),
    contract: (options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        "/analytics/contract",
        undefined,
        undefined,
        options,
      ),
    series: (params?: ListParams, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        "/analytics/series",
        undefined,
        params,
        options,
      ),
    account: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/analytics/accounts/${encodeURIComponent(id)}`,
        undefined,
        undefined,
        options,
      ),
    refreshAccount: (
      id: string,
      body: RefreshAnalyticsRequest = {},
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        `/analytics/accounts/${encodeURIComponent(id)}/refresh`,
        body,
        undefined,
        options,
      ),
    accountRaw: (id: string, params?: ListParams, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/analytics/accounts/${encodeURIComponent(id)}/raw`,
        undefined,
        params,
        options,
      ),
    accountCompatibility: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/accounts/${encodeURIComponent(id)}/analytics`,
        undefined,
        undefined,
        options,
      ),
    accountVideos: (
      id: string,
      params?: ListParams,
      options?: RequestOptions,
    ) =>
      this.request<PaginatedResponse>(
        "GET",
        `/accounts/${encodeURIComponent(id)}/analytics/videos`,
        undefined,
        params,
        options,
      ),
    video: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/videos/${encodeURIComponent(id)}/analytics`,
        undefined,
        undefined,
        options,
      ),
    commentPulse: (params?: ListParams, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        "/analytics/comments",
        undefined,
        params,
        options,
      ),
    accountComments: (
      id: string,
      params?: ListParams,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "GET",
        `/analytics/accounts/${encodeURIComponent(id)}/comments`,
        undefined,
        params,
        options,
      ),
    postRaw: (id: string, params?: ListParams, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/analytics/posts/${encodeURIComponent(id)}/raw`,
        undefined,
        params,
        options,
      ),
    exportVideos: (params?: ListParams, options?: RequestOptions) =>
      this.requestText("GET", "/analytics/export/videos", params, options),
    createReport: (
      body: CreateAnalyticsReportRequest,
      options?: SensitiveResponseRequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        "/analytics/export/reports",
        body,
        undefined,
        sensitiveResponseOptions(options),
      ),
    exportReportHtml: (
      body: CreateAnalyticsReportRequest,
      options?: RequestOptions,
    ) =>
      this.requestText(
        "POST",
        "/analytics/export/reports/html",
        undefined,
        options,
        body,
      ),
  };

  readonly uploads = {
    video: (
      body: UploadVideoRequest,
      options?: SensitiveResponseRequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        "/upload/video",
        body,
        undefined,
        sensitiveResponseOptions(options),
      ),
    image: (
      body: UploadImageRequest,
      options?: SensitiveResponseRequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        "/upload/image",
        body,
        undefined,
        sensitiveResponseOptions(options),
      ),
    imageFromUrl: (body: UploadImageFromUrlRequest, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        "/upload/image/from-url",
        body,
        undefined,
        options,
      ),
    videoDirect: (
      file: OperationBinaryValue,
      bundleId: string,
      filename = "video.mp4",
      options?: RequestOptions,
    ) =>
      this.requestForm<ApiResponse>(
        "POST",
        "/upload/video/direct",
        { file: { value: file, filename }, bundle_id: bundleId },
        options,
      ),
    videoDirectFile: async (
      filePath: string,
      bundleId: string,
      contentType?: string,
      options?: RequestOptions,
    ) =>
      this.requestForm<ApiResponse>(
        "POST",
        "/upload/video/direct",
        {
          file: await formFileFromPath(filePath, contentType),
          bundle_id: bundleId,
        },
        options,
      ),
    imageDirect: (
      file: OperationBinaryValue,
      bundleId: string,
      filename = "image.jpg",
      purpose: "carousel" | "profile_picture" = "carousel",
      options?: RequestOptions,
    ) =>
      this.requestForm<ApiResponse>(
        "POST",
        "/upload/image/direct",
        { file: { value: file, filename }, bundle_id: bundleId, purpose },
        options,
      ),
    imageDirectFile: async (
      filePath: string,
      bundleId: string,
      purpose: "carousel" | "profile_picture" = "carousel",
      contentType?: string,
      options?: RequestOptions,
    ) =>
      this.requestForm<ApiResponse>(
        "POST",
        "/upload/image/direct",
        {
          file: await formFileFromPath(filePath, contentType),
          bundle_id: bundleId,
          purpose,
        },
        options,
      ),
  };

  readonly comments = {
    list: (params?: ListParams, options?: RequestOptions) =>
      this.request<PaginatedResponse>(
        "GET",
        "/comments",
        undefined,
        params,
        options,
      ),
    create: (body: CreateCommentTaskRequest, options?: RequestOptions) =>
      this.request<ApiResponse>("POST", "/comments", body, undefined, options),
    get: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/comments/${encodeURIComponent(id)}`,
        undefined,
        undefined,
        options,
      ),
    delete: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "DELETE",
        `/comments/${encodeURIComponent(id)}`,
        undefined,
        undefined,
        options,
      ),
    approve: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        `/comments/${encodeURIComponent(id)}/approve`,
        undefined,
        undefined,
        options,
      ),
    dispute: (
      id: string,
      body: DisputeCommentRequest,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        `/comments/${encodeURIComponent(id)}/dispute`,
        body,
        undefined,
        options,
      ),
    verifications: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/comments/${encodeURIComponent(id)}/verifications`,
        undefined,
        undefined,
        options,
      ),
  };

  readonly webhooks = {
    events: (options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        "/webhooks/events",
        undefined,
        undefined,
        options,
      ),
    list: (params?: ListParams, options?: RequestOptions) =>
      this.request<PaginatedResponse>(
        "GET",
        "/webhooks",
        undefined,
        params,
        options,
      ),
    create: (
      body: CreateWebhookEndpointRequest,
      options?: SensitiveResponseRequestOptions,
    ) =>
      this.request<ApiResponse>(
        "POST",
        "/webhooks",
        body,
        undefined,
        sensitiveResponseOptions(options),
      ),
    get: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "GET",
        `/webhooks/${encodeURIComponent(id)}`,
        undefined,
        undefined,
        options,
      ),
    update: (
      id: string,
      body: UpdateWebhookEndpointRequest,
      options?: RequestOptions,
    ) =>
      this.request<ApiResponse>(
        "PATCH",
        `/webhooks/${encodeURIComponent(id)}`,
        body,
        undefined,
        options,
      ),
    delete: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "DELETE",
        `/webhooks/${encodeURIComponent(id)}`,
        undefined,
        undefined,
        options,
      ),
    deliveries: (id: string, params?: ListParams, options?: RequestOptions) =>
      this.request<PaginatedResponse>(
        "GET",
        `/webhooks/${encodeURIComponent(id)}/deliveries`,
        undefined,
        params,
        options,
      ),
    retryDelivery: (id: string, deliveryId: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        `/webhooks/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(deliveryId)}/retry`,
        undefined,
        undefined,
        options,
      ),
    test: (id: string, options?: RequestOptions) =>
      this.request<ApiResponse>(
        "POST",
        `/webhooks/${encodeURIComponent(id)}/test`,
        undefined,
        undefined,
        options,
      ),
  };

  constructor(options: TokPortalClientOptions) {
    if (!options.apiKey) {
      throw new Error("TokPortal apiKey is required.");
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || TOKPORTAL_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch || globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error(
        "TokPortal requires fetch. Use Node 18+ or pass a fetch implementation.",
      );
    }
  }

  me(options?: RequestOptions) {
    return this.request<ApiResponse>(
      "GET",
      "/me",
      undefined,
      undefined,
      options,
    );
  }

  countries(options?: RequestOptions) {
    return this.request<ApiResponse>(
      "GET",
      "/countries",
      undefined,
      undefined,
      options,
    );
  }

  platforms(options?: RequestOptions) {
    return this.request<ApiResponse>(
      "GET",
      "/platforms",
      undefined,
      undefined,
      options,
    );
  }

  creditCosts(options?: RequestOptions) {
    return this.request<ApiResponse>(
      "GET",
      "/credit-costs",
      undefined,
      undefined,
      options,
    );
  }

  requestOperation<T = ApiResponse>(
    operationId: OperationId,
    request: OperationRequest = {},
    options?: RequestOptions,
  ): Promise<T> {
    const operation = OPERATION_DEFINITIONS[operationId];
    if (!operation) {
      throw new Error(`Unknown TokPortal operationId: ${operationId}`);
    }
    const safeOptions = SENSITIVE_RESPONSE_OPERATION_IDS.has(operationId)
      ? sensitiveResponseOptions(options)
      : options;

    let path = operation.path;
    for (const param of operation.pathParams) {
      const value = request.path?.[param];
      if (value === undefined || value === null) {
        throw new Error(
          `Missing path parameter "${param}" for TokPortal operationId ${operationId}.`,
        );
      }
      path = path.replace(`{${param}}`, encodeURIComponent(String(value)));
    }

    if (operation.requestContentType === "multipart/form-data") {
      if (!request.form) {
        throw new Error(
          `Missing multipart form data for TokPortal operationId ${operationId}.`,
        );
      }
      return this.requestForm<T>(
        operation.method,
        path,
        request.form,
        safeOptions,
      );
    }

    if (
      operation.successContentTypes.some((type) => type.startsWith("text/"))
    ) {
      return this.requestText(
        operation.method,
        path,
        request.query,
        safeOptions,
        request.body,
      ) as Promise<T>;
    }

    return this.request<T>(
      operation.method,
      path,
      request.body,
      request.query,
      safeOptions,
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: ListParams,
    options?: RequestOptions,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) url.searchParams.append(key, String(item));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        "X-API-Key": this.apiKey,
        "X-TokPortal-Client": TOKPORTAL_CLIENT_HEADER,
        ...(options?.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
        ...options?.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw await this.toApiError(response);
    }

    const text = await response.text();
    const payload = text ? JSON.parse(text) : undefined;
    return payload as T;
  }

  private async requestText(
    method: string,
    path: string,
    query?: ListParams,
    options?: RequestOptions,
    body?: unknown,
  ): Promise<string> {
    const url = new URL(`${this.baseUrl}${path}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) url.searchParams.append(key, String(item));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Accept: "text/csv, text/html, application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        "X-API-Key": this.apiKey,
        "X-TokPortal-Client": TOKPORTAL_CLIENT_HEADER,
        ...(options?.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
        ...options?.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw await this.toApiError(response);
    }

    const text = await response.text();
    return text;
  }

  private async requestForm<T>(
    method: string,
    path: string,
    fields: Record<string, OperationFormValue>,
    options?: RequestOptions,
  ): Promise<T> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (
        typeof value === "object" &&
        "value" in value &&
        "filename" in value
      ) {
        form.append(
          key,
          toBlob(value.value, value.contentType),
          value.filename,
        );
      } else if (isBinaryValue(value)) {
        form.append(key, toBlob(value));
      } else {
        form.append(key, String(value));
      }
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "X-API-Key": this.apiKey,
        "X-TokPortal-Client": TOKPORTAL_CLIENT_HEADER,
        ...(options?.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
        ...options?.headers,
      },
      body: form,
    });

    if (!response.ok) {
      throw await this.toApiError(response);
    }

    const text = await response.text();
    const payload = text ? JSON.parse(text) : undefined;
    return payload as T;
  }

  private async toApiError(response: Response): Promise<TokPortalApiError> {
    const rawBody = await response.text();
    let errorBody: ApiErrorBody | undefined;

    try {
      errorBody = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      errorBody = undefined;
    }

    const error = errorBody?.error;
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const requestId =
      response.headers.get("x-tokportal-request-id") ||
      response.headers.get("x-request-id") ||
      response.headers.get("request-id") ||
      response.headers.get("x-vercel-id") ||
      undefined;
    const retryAfterSeconds = headerInt(response.headers, "retry-after");
    const rateLimit: TokPortalRateLimit = {
      limit: headerInt(response.headers, "x-ratelimit-limit"),
      remaining: headerInt(response.headers, "x-ratelimit-remaining"),
      reset: headerInt(response.headers, "x-ratelimit-reset"),
    };
    const hasRateLimit = Object.values(rateLimit).some(
      (value) => value !== undefined,
    );

    return new TokPortalApiError(
      error?.message ||
        rawBody ||
        `TokPortal API request failed with status ${response.status}.`,
      response.status,
      error?.code,
      {
        details: error?.details,
        requestId,
        rawBody,
        headers,
        retryAfterSeconds,
        ...(hasRateLimit ? { rateLimit } : {}),
      },
    );
  }
}

export default TokPortal;
