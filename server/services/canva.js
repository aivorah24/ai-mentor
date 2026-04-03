const axios = require('axios');

const CANVA_API_BASE = 'https://api.canva.com/rest/v1';

function getCanvaToken() {
  const token = process.env.CANVA_ACCESS_TOKEN || process.env.CANVA_API_TOKEN || '';
  if (!token) {
    throw new Error('Missing Canva token. Set CANVA_ACCESS_TOKEN in server/.env');
  }
  return token;
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${getCanvaToken()}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function canvaRequest(method, path, options = {}) {
  const { data, params, responseType } = options;
  const url = `${CANVA_API_BASE}${path}`;
  const res = await axios({
    method,
    url,
    headers: authHeaders(options.headers || {}),
    data,
    params,
    responseType: responseType || 'json',
    timeout: 60000,
  });
  return res.data;
}

function getJobState(payload = {}) {
  const job = payload.job || {};
  return job.status || 'unknown';
}

async function waitForJob(fetchJobFn, jobId, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 240000;
  const pollMs = opts.pollMs ?? 3000;
  const started = Date.now();

  while (true) {
    const payload = await fetchJobFn(jobId);
    const state = getJobState(payload);

    if (state === 'success') return payload;
    if (state === 'failed') {
      const err = payload?.job?.error?.message || payload?.job?.error?.code || 'Canva job failed';
      throw new Error(err);
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for Canva job ${jobId}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

function extractDesignId(designUrl = '') {
  const m = String(designUrl).match(/\/design\/([^/]+)/i);
  return m ? m[1] : null;
}

async function getBrandTemplateDataset(templateId) {
  if (!templateId) throw new Error('templateId is required');
  return canvaRequest('get', `/brand-templates/${templateId}/dataset`);
}

async function createAutofillJob({ templateId, data, title }) {
  if (!templateId) throw new Error('templateId is required');
  if (!data || typeof data !== 'object') throw new Error('data is required');

  const body = {
    brand_template_id: templateId,
    data,
  };
  if (title) body.title = title;

  return canvaRequest('post', '/autofills', { data: body });
}

async function getAutofillJob(jobId) {
  if (!jobId) throw new Error('jobId is required');
  return canvaRequest('get', `/autofills/${jobId}`);
}

async function createExportJob({ designId, format }) {
  if (!designId) throw new Error('designId is required');
  if (!format || typeof format !== 'object' || !format.type) {
    throw new Error('format.type is required');
  }
  return canvaRequest('post', '/exports', {
    data: {
      design_id: designId,
      format,
    },
  });
}

async function getExportJob(jobId) {
  if (!jobId) throw new Error('jobId is required');
  return canvaRequest('get', `/exports/${jobId}`);
}

async function createUrlAssetUploadJob({ name, url }) {
  if (!name) throw new Error('name is required');
  if (!url) throw new Error('url is required');
  return canvaRequest('post', '/url-asset-uploads', { data: { name, url } });
}

async function getUrlAssetUploadJob(jobId) {
  if (!jobId) throw new Error('jobId is required');
  return canvaRequest('get', `/url-asset-uploads/${jobId}`);
}

module.exports = {
  extractDesignId,
  getBrandTemplateDataset,
  createAutofillJob,
  getAutofillJob,
  createExportJob,
  getExportJob,
  createUrlAssetUploadJob,
  getUrlAssetUploadJob,
  waitForJob,
};

