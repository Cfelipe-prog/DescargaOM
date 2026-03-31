import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BatchManager } from './lib/batch-manager.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'output');
const distDir = path.join(rootDir, 'dist');

const app = express();
const manager = new BatchManager({
  outputDir,
  defaultTargetUrl:
    'https://araucaria.arauco.com/portal/apps/experiencebuilder/experience/?id=8601146a38b14e47a12416ce6e1b387d&page=Informe'
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(distDir));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/batches', async (req, res) => {
  try {
    const batch = await manager.createBatch(req.body);
    res.status(201).json(batch);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/batches/:id', (req, res) => {
  const batch = manager.getBatch(req.params.id);

  if (!batch) {
    res.status(404).json({ error: 'No existe el lote solicitado.' });
    return;
  }

  res.json(batch);
});

app.post('/api/batches/:id/download-all', async (req, res) => {
  try {
    const result = await manager.buildBatchZip(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/downloads/:batchId/:fileName', async (req, res) => {
  try {
    const cleanupMode = req.query.cleanup === 'batch' ? 'batch' : 'file';
    const { filePath } = manager.getDownloadPath(req.params.batchId, req.params.fileName);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'El archivo ya no esta disponible en el servidor.' });
      return;
    }

    let cleanedUp = false;
    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      await manager.removeDownloadedFile(req.params.batchId, req.params.fileName, cleanupMode);
    };

    res.download(filePath, req.params.fileName, (error) => {
      if (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'No se pudo descargar el archivo.' });
        }
        return;
      }

      cleanup().catch((cleanupError) => {
        console.error('No se pudo limpiar el archivo descargado:', cleanupError);
      });
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }

  res.sendFile(path.join(distDir, 'index.html'));
});

const port = Number(process.env.PORT || 3000);

app.listen(port, "0.0.0.0", () => {
  console.log(`Servidor listo en http://0.0.0.0:${port}`);
});
