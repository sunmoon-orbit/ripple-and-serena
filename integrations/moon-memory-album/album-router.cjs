const express = require('express');
const { getAlbumStore } = require('./album-store.cjs');
const { searchCommons } = require('./album-search.cjs');

function createAlbumRouter(getStore = getAlbumStore) {
  const router = express.Router();
  // Mount under the already authenticated /moments router, before /:id routes.
  router.get('/', (req, res, next) => { try { res.json(getStore().list(req.query)); } catch (error) { next(error); } });
  router.get('/search', async (req, res, next) => { try { res.json({ items: await searchCommons(req.query.q) }); } catch (error) { next(error); } });
  router.get('/avatars', (_req, res, next) => { try { res.json(getStore().avatarStatus()); } catch (error) { next(error); } });
  router.put('/avatars/:role', async (req, res, next) => { try { res.json(await getStore().saveAvatar(req.params.role, req.body.image_data)); } catch (error) { next(error); } });
  router.get('/avatars/:role', (req, res, next) => {
    try {
      const media = getStore().avatar(req.params.role);
      res.set({ 'Content-Type': media.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      res.sendFile(media.path, error => { if (error) next(error); });
    } catch (error) { next(error); }
  });
  router.post('/', async (req, res, next) => {
    try { res.status(201).json(await getStore().save(req.body)); } catch (error) { next(error); }
  });
  router.get('/:id', (req, res, next) => { try { res.json(getStore().get(req.params.id, req.query.trash === '1')); } catch (error) { next(error); } });
  for (const kind of ['image', 'thumb']) {
    router.get(`/:id/${kind}`, (req, res, next) => {
      try {
        const media = getStore().media(req.params.id, kind === 'thumb', req.query.trash === '1');
        res.set({ 'Content-Type': media.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
        res.sendFile(media.path, error => { if (error) next(error); });
      } catch (error) { next(error); }
    });
  }
  router.delete('/:id', (req, res, next) => { try { res.json(getStore().hide(req.params.id)); } catch (error) { next(error); } });
  router.post('/:id/restore', (req, res, next) => { try { res.json(getStore().restore(req.params.id)); } catch (error) { next(error); } });
  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || 400;
    res.status(status).json({ error: status >= 500 ? '相册暂时不可用或空间已满' : error.message });
  });
  return router;
}
module.exports = { createAlbumRouter };
