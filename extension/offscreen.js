import {extractDocument} from './core/extract.js';
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'offscreen' || message.type !== 'EXTRACT') return;
  try { reply({ok: true, data: extractDocument(message.options, message.html)}); }
  catch (e) { reply({ok: false, error: e.message}); }
});
