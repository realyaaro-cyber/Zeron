const { parentPort } = require('worker_threads');
const { renderRankCardNow, clearRankCardCache } = require('./rank-card');

parentPort.on('message', async msg => {
  if (msg.type === 'clear') {
    clearRankCardCache(msg.userId);
    return;
  }
  try {
    const buffer = await renderRankCardNow(msg.options);
    parentPort.postMessage({ id: msg.id, buffer });
  } catch (error) {
    parentPort.postMessage({ id: msg.id, error: error.message });
  }
});
