import { isCapturableUrl } from './capture-policy.js';

const HOST = 'com.trace.browser_capture';
const timers = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('trace-heartbeat', { periodInMinutes: 0.5 });
  void heartbeat();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('trace-heartbeat', { periodInMinutes: 0.5 });
  void heartbeat();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'trace-heartbeat') void heartbeat();
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) schedule(details.tabId, 2_000);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId === 0) schedule(details.tabId, 2_000);
});

chrome.tabs.onActivated.addListener(({ tabId }) => schedule(tabId, 1_500));
chrome.action.onClicked.addListener((tab) => tab.id && schedule(tab.id, 0, true));

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const origin = sender.url ? new URL(sender.url).origin : '';
  if (!['http://127.0.0.1:3333', 'http://localhost:3333'].includes(origin) || message?.action !== 'trace.openResumeTabs') {
    sendResponse({ ok: false, error: 'unauthorized' });
    return false;
  }
  const urls = Array.isArray(message.urls) ? message.urls.slice(0, 3).filter(isSafeResumeUrl) : [];
  if (!urls.length) {
    sendResponse({ ok: false, error: 'no_valid_urls' });
    return false;
  }
  Promise.all(urls.map((url) => chrome.tabs.create({ url, active: false })))
    .then(() => sendResponse({ ok: true, opened: urls.length }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

function isSafeResumeUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function schedule(tabId, delay, manual = false) {
  clearTimeout(timers.get(tabId));
  timers.set(tabId, setTimeout(() => {
    timers.delete(tabId);
    void consider(tabId, manual);
  }, delay));
}

async function heartbeat() {
  await sendNative({ action: 'status', authorized: true }).catch(() => undefined);
}

async function consider(tabId, manual = false) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!isCapturableTab(tab)) return;
  const pageText = await extractPageText(tabId);
  const response = await sendNative({
    action: 'visit',
    visit: {
      url: tab.url,
      title: tab.title || tab.url,
      capturedAt: new Date().toISOString(),
      pageText,
      manual,
    },
  }).catch(() => null);
  if (!response?.ok || response.result?.status !== 'capture' || !response.result.request) return;

  const request = response.result.request;
  const waitMs = Math.max(0, new Date(request.availableAt).getTime() - Date.now());
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (!isCapturableTab(current) || current.url !== tab.url || !current.active) {
    await sendNative({ action: 'skip', id: request.id, reason: 'no_matching_window' }).catch(() => undefined);
    return;
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(current.windowId, { format: 'jpeg', quality: 78 });
    const payload = await prepareImage(dataUrl, pageText);
    const completed = await sendNative({ action: 'complete', id: request.id, payload });
    if (!completed?.ok) throw new Error(completed?.error || 'Trace rejected the screenshot');
  } catch (error) {
    await sendNative({ action: 'skip', id: request.id, reason: 'capture_failed' }).catch(() => undefined);
  }
}

function isCapturableTab(tab) {
  if (!tab?.id || !tab.active || tab.incognito || typeof tab.url !== 'string') return false;
  return isCapturableUrl(tab.url);
}

async function extractPageText(tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => `${document.title}\n${document.querySelector('meta[name="description"]')?.content || ''}\n${document.body?.innerText || ''}`.slice(0, 20_000),
  }).catch(() => []);
  return typeof result?.[0]?.result === 'string' ? result[0].result : '';
}

async function prepareImage(dataUrl, pageText) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 2560 / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const fullCanvas = new OffscreenCanvas(width, height);
  fullCanvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  const fullBlob = await fullCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.78 });

  const thumbWidth = Math.min(640, width);
  const thumbHeight = Math.max(1, Math.round(height * thumbWidth / width));
  const thumbCanvas = new OffscreenCanvas(thumbWidth, thumbHeight);
  thumbCanvas.getContext('2d').drawImage(bitmap, 0, 0, thumbWidth, thumbHeight);
  const thumbnailBlob = await thumbCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.65 });
  const visualHash = averageHash(bitmap);
  bitmap.close();
  return {
    fullImageBase64: await blobBase64(fullBlob),
    thumbnailBase64: await blobBase64(thumbnailBlob),
    ocrText: pageText,
    width,
    height,
    visualHash,
  };
}

function averageHash(bitmap) {
  const canvas = new OffscreenCanvas(8, 8);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, 8, 8);
  const pixels = context.getImageData(0, 0, 8, 8).data;
  const values = Array.from({ length: 64 }, (_, index) => {
    const offset = index * 4;
    return (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3;
  });
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  let hex = '';
  for (let index = 0; index < 64; index += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit++) if (values[index + bit] >= average) nibble |= 1 << (3 - bit);
    hex += nibble.toString(16);
  }
  return hex;
}

async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function sendNative(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST, message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}
