const express = require('express');
const { getAlbumStore } = require('./album-store.cjs');

function createAlbumRouter(getStore = getAlbumStore) {
  const router = express.Router();
  // Mount under the already authenticated /moments router, before /:id routes.
  router.get('/', (req, res, next) => { try { res.json(getStore().list(req.query)); } catch (error) { next(error); } });
  router.post('/', async (req, res, next) => {
    try { res.status(201).json(await getStore().save(req.body)); } catch (error) { next(error); }
  });
  router.get('/:id', (req, res, next) => { try { res.json(getStore().get(req.params.id)); } catch (error) { next(error); } });
  for (const kind of ['image', 'thumb']) {
    router.get(`/:id/${kind}`, (req, res, next) => {
      try {
        const media = getStore().media(req.params.id, kind === 'thumb');
        res.set({ 'Content-Type': media.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
        res.sendFile(media.path, error => { if (error) next(error); });
      } catch (error) { next(error); }
    });
  }
  router.delete('/:id', (req, res, next) => { try { res.json(getStore().hide(req.params.id)); } catch (error) { next(error); } });
  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || 400;
    res.status(status).json({ error: status >= 500 ? '相册暂时不可用或空间已满' : error.message });
  });
  return router;
}
module.exports = { createAlbumRouter };
