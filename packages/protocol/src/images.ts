/** Image bounds shared by the browser's picker and the server's frame validation. */

/** Largest decoded image one message may attach, in bytes. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** base64 length of an image of exactly {@link MAX_IMAGE_BYTES}. */
export const MAX_IMAGE_BASE64_LENGTH_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

/** Most images one message may attach. */
export const MAX_IMAGES_PER_MESSAGE = 8;

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
