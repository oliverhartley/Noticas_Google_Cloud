/**
 * @version 1.0
 * @date 2025-11-26
 */
/**
 * Runs automatically when the Spreadsheet/Document is opened.
 * This function creates a custom menu to access the blog news and summary functions.
 * The menu structure uses a separator to clearly distinguish the GCP and GWS functions.
 */
function onOpen() {
  // Get the UI environment for the host application (e.g., Spreadsheet, Doc, or Forms).
  // Uses fallbacks to support multiple Apps Script host environments.
  const ui = SpreadsheetApp.getUi() || DocumentApp.getUi() || FormApp.getUi();

  // Create the top-level menu item 'Blog Tools'.
  ui.createMenu('Blog Tools')
    // --- GCP Blog Functions ---
    .addItem('Get GCP Blog News', 'getLatestGcpPosts')
    .addItem('Summarize GCP Posts', 'summarizeArticlesGCP')

    // Add a separator line to visually group the related functions
    .addSeparator()

    // --- GWS Blog Functions ---
    .addItem('Get GWS Blog News', 'getLatestGwsPosts')
    .addItem('Summarize GWS Posts', 'summarizeArticlesGWS')

    .addToUi();
}