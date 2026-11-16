export default defineBackground(() => {
  // Open the sidebar when the toolbar icon is clicked (Chrome side panel).
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
