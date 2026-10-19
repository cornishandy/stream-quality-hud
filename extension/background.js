// Show/hide for the toolbar button and Control+Shift+H. The background keeps no state of its
// own: it asks every frame of the tab whether a panel is showing, then hides it everywhere if one is
// and shows it otherwise, so frames always agree and a restarted worker can't get out of step.
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
  if (!msg || msg.type !== 'sqhud-toggle-request' || !sender.tab) return false;
  toggleTab(sender.tab.id);
  sendResponse({ ok: true });
  return false;
});
