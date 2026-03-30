import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const LOGIN_INPUT_CANDIDATES = [
  'input[name="username"]',
  'input[id="username"]',
  'input[type="email"]',
  'input[autocomplete="username"]'
];

const PASSWORD_INPUT_CANDIDATES = [
  'input[name="password"]',
  'input[id="password"]',
  'input[type="password"]',
  'input[autocomplete="current-password"]'
];

const SUBMIT_BUTTON_CANDIDATES = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Sign In")',
  'button:has-text("Iniciar")'
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonResponse(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Respuesta no valida del servidor ArcGIS: ${text.slice(0, 300)}`);
  }
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const element = page.locator(selector).first();
    if (await element.count()) {
      return element;
    }
  }

  return null;
}

export class ReportAutomation {
  constructor({ username, password, targetUrl, outputDir, keepBrowserOpen }) {
    this.username = username;
    this.password = password;
    this.targetUrl = targetUrl;
    this.outputDir = outputDir;
    this.keepBrowserOpen = keepBrowserOpen;
    this.portalBaseUrl = 'https://araucaria.arauco.com/portal';
    this.serverBaseUrl = 'https://araucaria.arauco.com/vector';
    this.referer = 'https://araucaria.arauco.com';
    this.browserPromise = null;
    this.contextPromise = null;
    this.loginPromise = null;
  }

  async dispose() {
    if (this.keepBrowserOpen) return;
    if (this.contextPromise) {
      const context = await this.contextPromise.catch(() => null);
      if (context) {
        await context.close();
      }
    }

    if (this.browserPromise) {
      const browser = await this.browserPromise.catch(() => null);
      if (browser) {
        await browser.close();
      }
    }
  }

  async generateReport(om) {
    const context = await this.getAuthenticatedContext();
    const token = await this.getServerToken();
    const submitData = await this.postArcgisJson(
      `${this.serverBaseUrl}/rest/services/CIMA_SURVEY/ReporteOMCIMA/GPServer/ReporteOMCIMA/submitJob`,
      { OM: om, token, f: 'json' }
    );

    if (!submitData.jobId) {
      throw new Error(`No se pudo iniciar el informe para la OM ${om}.`);
    }

    const jobInfo = await this.waitForJob(submitData.jobId, om, token);
    const paramUrl = jobInfo.results?.Reporte?.paramUrl;

    if (!paramUrl) {
      throw new Error(`El servicio no devolvio la URL del informe para la OM ${om}.`);
    }

    const resultData = await this.getArcgisJson(
      `${this.serverBaseUrl}/rest/services/CIMA_SURVEY/ReporteOMCIMA/GPServer/ReporteOMCIMA/jobs/${submitData.jobId}/${paramUrl}?f=json&token=${encodeURIComponent(token)}`
    );
    const reportUrl = resultData?.value?.url;

    if (!reportUrl) {
      throw new Error(`No se encontro el enlace del informe para la OM ${om}.`);
    }

    const pdfPath = path.join(this.outputDir, `Informe_${om}.pdf`);
    await this.renderPdf(context, reportUrl, pdfPath);

    return { pdfPath, reportUrl };
  }

  async waitForJob(jobId, om, token) {
    const deadline = Date.now() + 10 * 60 * 1000;

    while (Date.now() < deadline) {
      const data = await this.getArcgisJson(
        `${this.serverBaseUrl}/rest/services/CIMA_SURVEY/ReporteOMCIMA/GPServer/ReporteOMCIMA/jobs/${jobId}?f=json&token=${encodeURIComponent(token)}`
      );

      if (data.jobStatus === 'esriJobSucceeded') {
        return data;
      }

      if (data.jobStatus === 'esriJobFailed') {
        throw new Error(data.messages?.map((item) => item.description).join(' | ') || `Fallo el informe para la OM ${om}.`);
      }

      await wait(3000);
    }

    throw new Error(`La OM ${om} excedio el tiempo de espera.`);
  }

  async getServerToken() {
    const portalData = await this.postArcgisJson(
      `${this.portalBaseUrl}/sharing/rest/generateToken`,
      {
        username: this.username,
        password: this.password,
        client: 'referer',
        referer: this.referer,
        expiration: '60',
        f: 'json'
      }
    );

    if (!portalData.token) {
      throw new Error(portalData.error?.message || 'No se pudo obtener el token del portal ArcGIS.');
    }

    const serverData = await this.postArcgisJson(
      `${this.portalBaseUrl}/sharing/rest/generateToken`,
      {
        token: portalData.token,
        serverUrl: this.serverBaseUrl,
        expiration: '60',
        f: 'json'
      }
    );

    if (!serverData.token) {
      throw new Error(serverData.error?.message || 'No se pudo obtener el token del servidor ArcGIS.');
    }

    return serverData.token;
  }

  async postArcgisJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Referer: this.referer
      },
      body: new URLSearchParams(body)
    });

    const data = await readJsonResponse(response);

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || `Fallo la solicitud a ${url}.`);
    }

    return data;
  }

  async getArcgisJson(url) {
    const response = await fetch(url, {
      headers: {
        Referer: this.referer
      }
    });

    const data = await readJsonResponse(response);

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || `Fallo la consulta a ${url}.`);
    }

    return data;
  }

  async renderPdf(context, reportUrl, pdfPath) {
    await fs.mkdir(path.dirname(pdfPath), { recursive: true });

    const page = await context.newPage();
    try {
      await page.goto(reportUrl, { waitUntil: 'networkidle', timeout: 120000 });
      await page.emulateMedia({ media: 'screen' });
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' }
      });
    } finally {
      await page.close();
    }
  }

  async getAuthenticatedContext() {
    if (!this.contextPromise) {
      this.contextPromise = this.createAuthenticatedContext();
    }

    return this.contextPromise;
  }

  async createAuthenticatedContext() {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      acceptDownloads: true,
      ignoreHTTPSErrors: true
    });

    const page = await context.newPage();
    this.loginPromise = this.login(page);
    await this.loginPromise;
    await page.close();

    return context;
  }

  async getBrowser() {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({
        headless: !this.keepBrowserOpen
      });
    }

    return this.browserPromise;
  }

  async login(page) {
    await page.goto(this.targetUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await this.completeLoginIfNeeded(page);
    await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => undefined);
  }

  async completeLoginIfNeeded(page) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const usernameInput = await firstVisible(page, LOGIN_INPUT_CANDIDATES);
      const passwordInput = await firstVisible(page, PASSWORD_INPUT_CANDIDATES);

      if (!usernameInput || !passwordInput) {
        return;
      }

      await usernameInput.fill(this.username);
      await passwordInput.fill(this.password);

      const submitButton = await firstVisible(page, SUBMIT_BUTTON_CANDIDATES);
      if (submitButton) {
        await Promise.all([
          page.waitForLoadState('domcontentloaded', { timeout: 120000 }).catch(() => undefined),
          submitButton.click()
        ]);
      } else {
        await passwordInput.press('Enter');
      }

      await page.waitForTimeout(1500);
    }
  }
}
