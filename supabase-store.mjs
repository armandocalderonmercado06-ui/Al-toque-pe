import { createReadStream } from 'node:fs';

const STATE_TABLE = 'al_toque_state';
const DEFAULT_VIDEO_BUCKET = 'al-toque-reels';
const MAX_SUPABASE_VIDEO_BYTES = 50 * 1024 * 1024;

function assertSuccessful(response, operation) {
  if (!response.ok) {
    throw new Error(`Supabase ${operation} failed with status ${response.status}.`);
  }
}

async function consumeResponse(response) {
  await response.arrayBuffer();
}

export function createSupabaseStore({
  url,
  serviceRoleKey,
  bucket = DEFAULT_VIDEO_BUCKET,
  fetchImpl = fetch
}) {
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when DATA_BACKEND=supabase.');
  }
  const baseUrl = url.replace(/\/+$/, '');
  const authorizationHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`
  };

  async function loadState(key) {
    const query = new URLSearchParams({ key: `eq.${key}`, select: 'state' });
    const response = await fetchImpl(`${baseUrl}/rest/v1/${STATE_TABLE}?${query}`, {
      headers: authorizationHeaders
    });
    assertSuccessful(response, 'state read');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Supabase returned an invalid state response.');
    return rows[0]?.state ?? null;
  }

  async function saveState(key, state) {
    const response = await fetchImpl(`${baseUrl}/rest/v1/${STATE_TABLE}?on_conflict=key`, {
      method: 'POST',
      headers: {
        ...authorizationHeaders,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify([{ key, state, updated_at: new Date().toISOString() }])
    });
    assertSuccessful(response, 'state write');
    await consumeResponse(response);
  }

  function videoObjectPath(video) {
    const extension = video.mimeType === 'video/mp4' ? 'mp4' : 'webm';
    return `${video.id}.${extension}`;
  }

  async function uploadVideo(video, filePath) {
    const response = await fetchImpl(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(videoObjectPath(video))}`,
      {
        method: 'POST',
        headers: {
          ...authorizationHeaders,
          'Content-Type': video.mimeType,
          'Content-Length': String(video.size),
          'x-upsert': 'false'
        },
        body: createReadStream(filePath),
        duplex: 'half'
      }
    );
    assertSuccessful(response, 'video upload');
    await consumeResponse(response);
  }

  async function deleteVideo(video) {
    const response = await fetchImpl(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(videoObjectPath(video))}`,
      {
        method: 'DELETE',
        headers: authorizationHeaders
      }
    );
    assertSuccessful(response, 'video deletion');
    await consumeResponse(response);
  }

  function publicVideoUrl(video) {
    return `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeURIComponent(videoObjectPath(video))}`;
  }

  return {
    maxVideoBytes: MAX_SUPABASE_VIDEO_BYTES,
    loadState,
    saveState,
    uploadVideo,
    deleteVideo,
    publicVideoUrl
  };
}
