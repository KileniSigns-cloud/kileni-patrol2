// Photos live in the private patrol-media bucket; rows store the storage path, never base64.
// Paths start with the organisation id so the bucket's RLS can scope reads and uploads by org.
// Upload errors throw: a sign or Quick Catch is never saved without its photos.

export const PHOTO_BUCKET = 'patrol-media';

export type PhotoKind = 'patrol' | 'quick-catch';

/** `{org_id}/{kind}/{owner_id}/{file}`: owner is the sign_inspections id or the Quick Catch lead id. */
export function photoPath(orgId: string, kind: PhotoKind, ownerId: string, fileName: string): string {
  if (!orgId) throw new Error('Photos not uploaded: your account has no organisation.');
  if (!ownerId) throw new Error('Photos not uploaded: missing record id.');
  return `${orgId}/${kind}/${ownerId}/${fileName}`;
}

/** A stored photo reference is a bucket path, not a data URL or a full URL. */
export const isStoragePath = (p: string) => p !== '' && !p.startsWith('data:') && !/^https?:\/\//i.test(p);

export interface PhotoToUpload {
  /** File name inside the owner folder, e.g. "sign-1-<uuid>.jpg". */
  name: string;
  blob: Blob;
}

/** The slice of the Supabase client uploadPhotos needs (lets tests pass a fake). */
export interface StorageClient {
  storage: {
    from(bucket: string): {
      upload(path: string, body: Blob, opts: { contentType: string; upsert: boolean }): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

/**
 * Uploads every photo, in order, and returns their paths. Throws on the first failure
 * so the caller can stop before writing any rows.
 */
export async function uploadPhotos(
  client: StorageClient,
  orgId: string,
  kind: PhotoKind,
  ownerId: string,
  photos: readonly PhotoToUpload[],
  onProgress?: (done: number) => void,
): Promise<string[]> {
  const paths: string[] = [];
  for (const p of photos) {
    const path = photoPath(orgId, kind, ownerId, p.name);
    const { error } = await client.storage
      .from(PHOTO_BUCKET)
      .upload(path, p.blob, { contentType: p.blob.type || 'image/jpeg', upsert: false });
    if (error) throw new Error(`Photos not uploaded: ${error.message}`);
    paths.push(path);
    onProgress?.(paths.length);
  }
  return paths;
}

/** inspection_photos rows for a sign; refuses anything that isn't a storage path. */
export function buildInspectionPhotoRows(
  inspectionId: string,
  businessId: string | null,
  photos: { path: string; type: 'sign' | 'surrounding' }[],
  nowIso: string,
) {
  const bad = photos.find((p) => !isStoragePath(p.path));
  if (bad) throw new Error('Photos not saved: a photo was not uploaded to storage. Go back and retake it.');
  return photos.map((p) => ({
    inspection_id: inspectionId,
    ...(businessId ? { business_id: businessId } : {}),
    photo_url: p.path,
    photo_type: p.type,
    created_at: nowIso,
  }));
}

/** Resizes to at most maxWidth and re-encodes as JPEG. Browser only (canvas). */
export function compressToBlob(file: Blob, maxWidth = 1200, quality = 0.75): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(src);
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Could not process the photo on this device.')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not process the photo on this device.'))),
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error('Could not read one of the photos. Retake it and try again.'));
    };
    img.src = src;
  });
}
