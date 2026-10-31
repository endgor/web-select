const MENU_ID = 'web-select-start';

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // Menyval i högerklicksmenyn. removeAll gör att det inte dubbleras vid uppdatering.
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Markera och kopiera område',
    contexts: ['page', 'selection', 'link', 'image'],
  });

  // Chrome tilldelar inte det föreslagna kortkommandot om det redan används av
  // något annat. Öppna då inställningssidan så att man kan välja ett eget.
  if (reason !== 'install') return;
  const commands = await chrome.commands.getAll();
  const cmd = commands.find((c) => c.name === '_execute_action');
  if (cmd && !cmd.shortcut) chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// Kortkommandot är kopplat till _execute_action, så både klick på ikonen och
// kortkommandot hamnar här. activeTab ger tillfällig åtkomst till fliken.
chrome.action.onClicked.addListener(start);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) start(tab);
});

async function start(tab) {
  if (!tab || !tab.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
  } catch (err) {
    // Sidor som chrome:// och Chrome Web Store går inte att injicera i.
    console.warn('[Web Select] Kunde inte starta på den här sidan:', err);
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#d93025' });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 2000);
  }
}
