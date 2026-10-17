/**
 * Composer attachments: a picked image becomes one in-memory record carrying the bytes the wire
 * sends and the object URL the thumbnail shows. The base64 payload never enters the transcript
 * model, and the object URL is released when the attachment leaves the composer.
 */

import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  type ImageAttachment,
} from "@pi-my-ui/protocol";

export { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE };

export interface ComposerAttachment extends ImageAttachment {
  /** Stable identity for the list key and the remove control. */
  readonly id: string;
  readonly fileName: string;
  /** The thumbnail URL; released when the attachment is removed or accepted. */
  readonly objectUrl: string;
}

/**
 * A source of stable attachment ids. The composer numbers nothing itself, so the identity a list key
 * and a remove control depend on is produced in one place.
 */
export function createAttachmentIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `attachment-${String(next)}`;
  };
}

/** A file the composer refuses, naming the file and the offending value. */
export class AttachmentRejection extends Error {
  public override readonly name = "AttachmentRejection";
}

/** Read a File's bytes as base64, without a data-URL prefix. */
function readBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new AttachmentRejection(`Could not read "${file.name}"`));
    };
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function rejectFile(file: File): void {
  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new AttachmentRejection(
      `"${file.name}" is ${file.type === "" ? "not an image" : file.type}; allowed: ${ALLOWED_IMAGE_MIME_TYPES.join(", ")}`,
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new AttachmentRejection(
      `"${file.name}" is ${String(file.size)} bytes; the maximum is ${String(MAX_IMAGE_BYTES)}`,
    );
  }
}

/**
 * Validate and read picked files, returning the extended list. Every candidate is validated before
 * any is read, so a rejected file leaves the list unchanged rather than half-appended.
 */
export async function addAttachments(
  existing: readonly ComposerAttachment[],
  files: readonly File[],
  nextId: () => string,
): Promise<readonly ComposerAttachment[]> {
  if (existing.length + files.length > MAX_IMAGES_PER_MESSAGE) {
    throw new AttachmentRejection(`At most ${String(MAX_IMAGES_PER_MESSAGE)} images per message`);
  }
  for (const file of files) {
    rejectFile(file);
  }
  const added: ComposerAttachment[] = [];
  for (const file of files) {
    const data = await readBase64(file);
    added.push({
      id: nextId(),
      fileName: file.name,
      objectUrl: URL.createObjectURL(file),
      mediaType: file.type,
      data,
    });
  }
  return [...existing, ...added];
}

/** Release one attachment's preview URL. */
export function releaseAttachment(attachment: ComposerAttachment): void {
  URL.revokeObjectURL(attachment.objectUrl);
}

/** The wire form of the composer's accepted attachments, in order. */
export function toImageAttachments(
  attachments: readonly ComposerAttachment[],
): readonly ImageAttachment[] {
  return attachments.map(({ mediaType, data }) => ({ mediaType, data }));
}
