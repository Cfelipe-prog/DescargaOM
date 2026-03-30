import { useEffect, useMemo, useState } from 'react';

const DEFAULT_FORM = {
  oms: '',
  username: 'MANCIMA1',
  password: 'ARAUCO2025',
  concurrency: 1,
  keepBrowserOpen: false
};

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-CL');
}

export default function App() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [batch, setBatch] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);

  useEffect(() => {
    if (!batch?.id) return undefined;

    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/batches/${batch.id}`);
        if (!response.ok) throw new Error('No se pudo actualizar el estado.');
        const data = await response.json();
        setBatch(data);
      } catch (pollError) {
        setError(pollError.message);
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [batch?.id]);

  const counts = useMemo(() => {
    const items = batch?.items ?? [];
    return items.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[item.status] = (acc[item.status] ?? 0) + 1;
        return acc;
      },
      { total: 0, pending: 0, running: 0, completed: 0, failed: 0 }
    );
  }, [batch]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/batches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(form)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'No fue posible iniciar el proceso.');
      }

      setBatch(data);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleDownloadAll() {
    if (!batch?.id) return;

    setDownloadingAll(true);
    setError('');

    try {
      const response = await fetch(`/api/batches/${batch.id}/download-all`, {
        method: 'POST'
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'No se pudo preparar el ZIP.');
      }

      window.open(data.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (downloadError) {
      setError(downloadError.message);
    } finally {
      setDownloadingAll(false);
    }
  }

  return (
    <div className="page-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Vite + React + Playwright</p>
          <h1>Automatizador de informes OM</h1>
          <p className="lede">
            Ingresa varias OMs, procesa una por una o en paralelo y guarda cada
            informe en PDF en la carpeta <code>output</code>.
          </p>
        </div>
        <div className="hero-stats">
          <article>
            <strong>{counts.total}</strong>
            <span>OMs cargadas</span>
          </article>
          <article>
            <strong>{counts.completed}</strong>
            <span>PDF listos</span>
          </article>
          <article>
            <strong>{counts.failed}</strong>
            <span>Con error</span>
          </article>
        </div>
      </section>

      <main className="grid">
        <section className="panel">
          <h2>Entrada</h2>
          <form onSubmit={handleSubmit} className="form-grid">
            <label>
              <span>OMs</span>
              <textarea
                rows="12"
                value={form.oms}
                onChange={(event) => updateField('oms', event.target.value)}
                placeholder={'22853722\n22850001\n22850002'}
              />
            </label>

            <div className="two-col">
              <label>
                <span>Usuario ArcGIS</span>
                <input
                  type="text"
                  value={form.username}
                  onChange={(event) => updateField('username', event.target.value)}
                />
              </label>
              <label>
                <span>Contraseña</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => updateField('password', event.target.value)}
                />
              </label>
            </div>

            <div className="two-col align-end">
              <label>
                <span>Procesos simultáneos</span>
                <input
                  type="number"
                  min="1"
                  max="3"
                  value={form.concurrency}
                  onChange={(event) =>
                    updateField('concurrency', Number(event.target.value))
                  }
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.keepBrowserOpen}
                  onChange={(event) =>
                    updateField('keepBrowserOpen', event.target.checked)
                  }
                />
                <span>Mantener navegador visible</span>
              </label>
            </div>

            {error ? <p className="error-box">{error}</p> : null}

            <button type="submit" disabled={submitting}>
              {submitting ? 'Iniciando...' : 'Generar informes'}
            </button>
          </form>
        </section>

        <section className="panel">
          <h2>Progreso</h2>
          {!batch ? (
            <div className="empty-state">
              <p>Cuando lances un lote, aquí verás el estado OM por OM.</p>
            </div>
          ) : (
            <>
              <div className="batch-meta">
                <div>
                  <span>Lote</span>
                  <strong>{batch.id}</strong>
                </div>
                <div>
                  <span>Creado</span>
                  <strong>{formatDate(batch.createdAt)}</strong>
                </div>
                <div>
                  <span>Estado</span>
                  <strong>{batch.status}</strong>
                </div>
              </div>

              {counts.completed > 0 ? (
                <div className="download-all-row">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={handleDownloadAll}
                    disabled={downloadingAll}
                  >
                    {downloadingAll ? 'Preparando ZIP...' : 'Descargar todos los informes'}
                  </button>
                </div>
              ) : null}

              <div className="items-list">
                {batch.items.map((item) => (
                  <article key={item.om} className={`item-card ${item.status}`}>
                    <div>
                      <p className="item-title">OM {item.om}</p>
                      <p className="item-status">{item.status}</p>
                    </div>
                    <div className="item-detail">
                      <span>{item.message || 'En espera'}</span>
                      {item.pdfUrl ? (
                        <a href={item.pdfUrl} target="_blank" rel="noreferrer">
                          Descargar PDF
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
