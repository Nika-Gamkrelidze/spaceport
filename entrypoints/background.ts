export default defineBackground(() => {
  // Open the sidebar when the toolbar icon is clicked (Chrome side panel).
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // First install: go straight to the import screen.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') browser.tabs.create({ url: browser.runtime.getURL('/import.html') });
  });
});
