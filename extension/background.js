// Show/hide for the toolbar button and Control+Shift+H. The background keeps no catalogue of
// its own. It also relays one film card to the loopback box at 127.0.0.1:9791, and reads cards
// back. It does not fetch stream lists, and it has no permission for any website.
const CARD_BOX = 'http://127.0.0.1:9791';

function toggleTab(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'sqhud-state' }, (res) => {
    void chrome.runtime.lastError;
    chrome.tabs.sendMessage(tabId, { type: 'sqhud-set', show: !(res && res.shown) }, () => void chrome.runtime.lastError);
  });
}

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id != null) toggleTab(tab.id);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === 'sqhud-cards-put' || msg.type === 'sqhud-cards-get') {
    const url = msg.type === 'sqhud-cards-get' ? CARD_BOX + '/cards?id=' + encodeURIComponent(String(msg.id || '')) : CARD_BOX + '/cards';
    const opts = msg.type === 'sqhud-cards-put' ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg.card || null) } : undefined;
    fetch(url, opts).then(async (res) => {
      if (msg.type === 'sqhud-cards-get') {
        let cards = [];
        try { if (res.ok) cards = (await res.json()).cards || []; } catch (e) {}
        sendResponse({ ok: res.ok, cards });
      } else sendResponse({ ok: res.ok });
    }).catch(() => sendResponse({ ok: false, cards: [] }));
    return true;
  }
  if (msg.type !== 'sqhud-toggle-request' || !sender.tab) return false;
  toggleTab(sender.tab.id);
  sendResponse({ ok: true });
  return false;
});
