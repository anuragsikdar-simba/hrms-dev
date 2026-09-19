import type { SupabaseClient } from '@supabase/supabase-js';

/** Storage bucket holding employee documents (private; signed-URL access). */
export const DOCUMENTS_BUCKET = 'documents';

/** How long a generated signed URL stays valid (seconds). */
export const SIGNED_URL_TTL = 3600; // 1 hour

/**
 * `documents.file_url` historically held either a relative storage path (new)
 * or a full public URL (legacy). Normalise to the relative path the Storage
 * API expects.
 */
export function toStoragePath(fileUrl: string): string {
  if (!fileUrl) return fileUrl;
  if (fileUrl.startsWith('http')) {
    const marker = `/storage/v1/object/public/${DOCUMENTS_BUCKET}/`;
    const idx = fileUrl.indexOf(marker);
    if (idx !== -1) return decodeURIComponent(fileUrl.slice(idx + marker.length));
  }
  return fileUrl;
}

/**
 * Mint a short-lived signed URL for a stored document path using the given
 * (RLS-scoped) Supabase client. Returns null if no URL can be produced.
 *
 * There is deliberately NO public-URL fallback: the `documents` bucket is
 * private, so `getPublicUrl` would hand back a well-formed link that 404s
 * ("Bucket not found") the moment it is followed. A dead link that looks valid
 * is the "fake success" bug class in BUSINESS_RULES §6.1 — callers must get
 * null and render an honest "unavailable" state instead.
 *
 * If signing fails for every caller, the cause is almost always missing storage
 * RLS policies on the bucket — see `supabase/migration-storage.sql`.
 */
export async function getDocumentUrl(
  db: SupabaseClient,
  fileUrl: string,
): Promise<string | null> {
  const path = toStoragePath(fileUrl);
  if (!path) return null;

  const { data: signed, error } = await db.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);

  if (error || !signed?.signedUrl) {
    console.error('[documents] could not sign URL for', path, error?.message);
    return null;
  }
  return signed.signedUrl;
}

/**
 * Given a submission's `documents` array (entries carrying a `docId`), return a
 * copy where each entry's `url` is a freshly signed, viewable URL. Entries are
 * looked up against the `documents` table through the caller's RLS-scoped
 * client, so callers only ever receive documents they are allowed to see.
 */
export async function resolveSubmissionDocumentUrls(
  db: SupabaseClient,
  documents: unknown,
): Promise<unknown> {
  if (!Array.isArray(documents) || documents.length === 0) return documents ?? [];

  const ids = documents
    .map((d) => (d && typeof d === 'object' ? (d as { docId?: string }).docId : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  // Resolve file paths for the referenced document ids in one round-trip.
  const pathById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: rows } = await db
      .from('documents')
      .select('id, file_url')
      .in('id', ids);
    for (const row of rows ?? []) {
      if (row?.id && typeof row.file_url === 'string') pathById.set(row.id, row.file_url);
    }
  }

  return Promise.all(
    documents.map(async (d) => {
      if (!d || typeof d !== 'object') return d;
      const entry = d as { docId?: string; url?: string; [k: string]: unknown };
      // Prefer the canonical path from the documents table (id is the source of
      // truth); fall back to a path stored inline on older submissions.
      const filePath = (entry.docId && pathById.get(entry.docId)) || entry.url || '';
      const url = filePath ? await getDocumentUrl(db, filePath) : null;
      return { ...entry, url: url ?? '' };
    }),
  );
}
