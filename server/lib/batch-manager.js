import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { ReportAutomation } from './report-automation.js';

function formatBatchError(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('browserType.launch: spawn EPERM')) {
    return 'Playwright no pudo abrir Chromium en este entorno. Ejecuta la app localmente en Windows fuera del sandbox de Codex.';
  }

  return message;
}

function sanitizeFileName(value) {
  return value.replace(/[<>:"/\\|?*]+/g, '_');
}

export class BatchManager {
  constructor({ outputDir, defaultTargetUrl }) {
    this.outputDir = outputDir;
    this.defaultTargetUrl = defaultTargetUrl;
    this.batches = new Map();
  }

  getBatch(id) {
    return this.batches.get(id) ?? null;
  }

  getDownloadPath(batchId, fileName) {
    const batch = this.getBatch(batchId);

    if (!batch) {
      throw new Error('No existe el lote solicitado.');
    }

    const filePath = path.join(batch.batchDir, fileName);
    return { batch, filePath };
  }

  async createBatch(input) {
    const oms = [...new Set(String(input.oms || '').split(/\s|,|;/).map((item) => item.trim()).filter(Boolean))];
    const username = String(input.username || process.env.OM_ARCGIS_USER || '').trim();
    const password = String(input.password || process.env.OM_ARCGIS_PASSWORD || '').trim();
    const concurrency = Math.max(1, Math.min(3, Number(input.concurrency || 1)));
    const keepBrowserOpen = Boolean(input.keepBrowserOpen);

    if (!oms.length) {
      throw new Error('Debes ingresar al menos una OM.');
    }

    if (!username || !password) {
      throw new Error('Debes proporcionar usuario y contraseña.');
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const batchDir = path.join(this.outputDir, sanitizeFileName(id));

    await fs.mkdir(batchDir, { recursive: true });

    const batch = {
      id,
      createdAt,
      status: 'queued',
      batchDir,
      items: oms.map((om) => ({
        om,
        status: 'pending',
        message: 'En espera'
      }))
    };

    this.batches.set(id, batch);

    const automation = new ReportAutomation({
      username,
      password,
      targetUrl: this.defaultTargetUrl,
      outputDir: batchDir,
      keepBrowserOpen
    });

    void this.runBatch({ batch, automation, concurrency }).catch((error) => {
      const formattedMessage = formatBatchError(error);
      batch.status = 'failed';
      batch.items = batch.items.map((item) =>
        item.status === 'completed'
          ? item
          : {
              ...item,
              status: 'failed',
              message: formattedMessage
            }
      );
    });

    return batch;
  }

  async runBatch({ batch, automation, concurrency }) {
    batch.status = 'running';
    const queue = [...batch.items];
    const workers = Array.from({ length: concurrency }, () =>
      this.runWorker({ queue, batch, automation })
    );

    try {
      await Promise.all(workers);
      const hasFailures = batch.items.some((item) => item.status === 'failed');
      batch.status = hasFailures ? 'finished_with_errors' : 'completed';
    } finally {
      await automation.dispose();
    }
  }

  async runWorker({ queue, batch, automation }) {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;

      item.status = 'running';
      item.message = 'Generando informe...';

      try {
        const result = await automation.generateReport(item.om);
        item.status = 'completed';
        item.message = 'Informe generado';
        item.fileName = path.basename(result.pdfPath);
        item.pdfUrl = `/api/downloads/${batch.id}/${item.fileName}`;
        item.reportUrl = result.reportUrl;
      } catch (error) {
        item.status = 'failed';
        item.message = formatBatchError(error);
      }
    }
  }

  async buildBatchZip(id) {
    const batch = this.getBatch(id);

    if (!batch) {
      throw new Error('No existe el lote solicitado.');
    }

    const readyItems = batch.items.filter((item) => item.status === 'completed' && item.pdfUrl);

    if (!readyItems.length) {
      throw new Error('Aun no hay informes PDF para descargar.');
    }

    const zip = new JSZip();

    for (const item of readyItems) {
      const pdfPath = path.join(batch.batchDir, `Informe_${item.om}.pdf`);
      const fileBuffer = await fs.readFile(pdfPath);
      zip.file(path.basename(pdfPath), fileBuffer);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const zipPath = path.join(batch.batchDir, `informes_${id}.zip`);
    await fs.writeFile(zipPath, zipBuffer);

    return {
      downloadUrl: `/api/downloads/${id}/${path.basename(zipPath)}?cleanup=batch`,
      filePath: zipPath
    };
  }

  async removeDownloadedFile(batchId, fileName, cleanupMode = 'file') {
    const { batch, filePath } = this.getDownloadPath(batchId, fileName);

    await fs.rm(filePath, { force: true });

    if (cleanupMode === 'batch') {
      for (const item of batch.items) {
        if (item.fileName) {
          const itemPath = path.join(batch.batchDir, item.fileName);
          await fs.rm(itemPath, { force: true });
          item.pdfUrl = null;
        }
      }

      await fs.rm(batch.batchDir, { recursive: true, force: true });
      batch.archiveStatus = 'deleted_after_download';
      return;
    }

    const downloadedItem = batch.items.find((item) => item.fileName === fileName);
    if (downloadedItem) {
      downloadedItem.pdfUrl = null;
      downloadedItem.message = 'Informe descargado y eliminado del servidor';
    }

    const remainingFiles = await fs.readdir(batch.batchDir).catch(() => []);
    if (!remainingFiles.length) {
      await fs.rm(batch.batchDir, { recursive: true, force: true });
    }
  }
}
