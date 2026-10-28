import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAlToqueServer } from './server.mjs';
import { createSupabaseStore } from './supabase-store.mjs';

test('reads and upserts persisted JSON state using the server-only key', async () => {
  const calls = [];
  const store = createSupabaseStore({
    url: 'https://project.supabase.co/',
    serviceRoleKey: 'server-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return String(url).includes('/rest/v1/')
        ? new Response(JSON.stringify([{ state: { orders: [{ id: 'order-1' }] } }]), { status: 200 })
        : new Response(null, { status: 204 });
    }
  });

  assert.deepEqual(await store.loadState('orders'), { orders: [{ id: 'order-1' }] });
  await store.saveState('orders', { orders: [{ id: 'order-2' }] });

  assert.match(calls[0].url, /\/rest\/v1\/al_toque_state\?key=eq\.orders&select=state$/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-secret');
  assert.equal(calls[0].options.headers.apikey, 'server-secret');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.deepEqual(JSON.parse(calls[1].options.body), [{
    key: 'orders',
    state: { orders: [{ id: 'order-2' }] },
    updated_at: JSON.parse(calls[1].options.body)[0].updated_at
  }]);
});

test('uploads videos, exposes a public URL, and deletes the same object path', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'al-toque-supabase-'));
  const filePath = join(directory, 'video.mp4');
  await writeFile(filePath, Buffer.from('video-content'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const calls = [];
  const store = createSupabaseStore({
    url: 'https://project.supabase.co',
    serviceRoleKey: 'server-secret',
    fetchImpl: async (url, options) => {
      let body = '';
      if (options.body && typeof options.body[Symbol.asyncIterator] === 'function') {
        for await (const chunk of options.body) body += chunk.toString();
      }
      calls.push({ url: String(url), options, body });
      return new Response(null, { status: 200 });
    }
  });
  const video = { id: '123e4567-e89b-42d3-a456-426614174000', mimeType: 'video/mp4', size: 13 };

  await store.uploadVideo(video, filePath);
  await store.deleteVideo(video);

  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].body, (await readFile(filePath)).toString());
  assert.equal(calls[0].options.headers['Content-Length'], '13');
  assert.equal(calls[1].options.method, 'DELETE');
  assert.match(calls[0].url, /\/storage\/v1\/object\/al-toque-reels\/123e4567-e89b-42d3-a456-426614174000\.mp4$/);
  assert.match(calls[1].url, /\/storage\/v1\/object\/al-toque-reels\/123e4567-e89b-42d3-a456-426614174000\.mp4$/);
  assert.equal(
    store.publicVideoUrl(video),
    'https://project.supabase.co/storage/v1/object/public/al-toque-reels/123e4567-e89b-42d3-a456-426614174000.mp4'
  );
  assert.equal(store.maxVideoBytes, 50 * 1024 * 1024);
});

test('reports Supabase failures rather than returning success-shaped state', async () => {
  const store = createSupabaseStore({
    url: 'https://project.supabase.co',
    serviceRoleKey: 'server-secret',
    fetchImpl: async () => new Response(null, { status: 503 })
  });

  await assert.rejects(store.loadState('orders'), /Supabase state read failed with status 503/);
});

test('uses persistent state and remote video storage across server restarts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'al-toque-server-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const states = new Map([
    ['orders', { orders: [] }],
    ['reels', { profiles: [], videos: [], posts: [] }]
  ]);
  const uploadedVideos = new Map();
  const persistenceStore = {
    maxVideoBytes: 50 * 1024 * 1024,
    async loadState(key) {
      return states.get(key) ?? null;
    },
    async saveState(key, state) {
      states.set(key, structuredClone(state));
    },
    async uploadVideo(video, filePath) {
      uploadedVideos.set(video.id, await readFile(filePath));
    },
    async deleteVideo(video) {
      uploadedVideos.delete(video.id);
    },
    publicVideoUrl(video) {
      return `https://project.supabase.co/storage/v1/object/public/al-toque-reels/${video.id}.mp4`;
    }
  };
  const startServer = async () => {
    const server = createAlToqueServer({
      ordersFile: join(directory, 'orders.json'),
      reelsFile: join(directory, 'reels.json'),
      reelsVideosDir: join(directory, 'videos'),
      persistenceStore
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    t.after(() => closeServer(server));
    return server;
  };
  const closeServer = async (server) => {
    if (!server.listening) return;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  };

  const firstServer = await startServer();
  const firstBaseUrl = `http://127.0.0.1:${firstServer.address().port}`;
  const orderResponse = await fetch(`${firstBaseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: firstBaseUrl },
    body: JSON.stringify({
      isDemo: true,
      paymentMethod: 'efectivo',
      items: [{ name: 'Pedido de prueba', quantity: 1, price: 2 }]
    })
  });
  assert.equal(orderResponse.status, 201);
  const { order } = await orderResponse.json();
  assert.equal(states.get('orders').orders[0].id, order.id);

  const videoResponse = await fetch(`${firstBaseUrl}/api/reels/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4', Origin: firstBaseUrl },
    body: Buffer.from('0000ftypisom')
  });
  assert.equal(videoResponse.status, 201);
  const { video } = await videoResponse.json();
  assert.equal(uploadedVideos.get(video.id).toString(), '0000ftypisom');
  await closeServer(firstServer);

  const restartedServer = await startServer();
  const restartedBaseUrl = `http://127.0.0.1:${restartedServer.address().port}`;
  const ordersResponse = await fetch(`${restartedBaseUrl}/api/orders`);
  assert.equal((await ordersResponse.json()).orders[0].id, order.id);
  const videoRedirect = await fetch(`${restartedBaseUrl}${video.url}`, { redirect: 'manual' });
  assert.equal(videoRedirect.status, 302);
  assert.equal(
    videoRedirect.headers.get('location'),
    `https://project.supabase.co/storage/v1/object/public/al-toque-reels/${video.id}.mp4`
  );
});
