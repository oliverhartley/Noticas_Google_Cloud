/**
 * @version 1.0
 * @date 2025-11-26
 */
/**
 * Deletes the last two rows containing data from the sheet named "GCP Old"
 * in the spreadsheet specified by GWS_SPREADSHEET_ID.
 *
 * Note: It uses getLastRow() to find the last row with content, ensuring
 * only populated rows are considered for deletion.
 */
function deleteLastTwoRowsGCP() {
  // The GWS_SPREADSHEET_ID constant is defined in another file within this project.
  // We can use it directly here.
  const ss = SpreadsheetApp.openById(GCP_SPREADSHEET_ID);

  // Define the target sheet name
  const sheetName = "GCP Old";
  const sheet = ss.getSheetByName(sheetName);

  // Define the number of rows to delete
  const rowsToDelete = 2;

  // Check if the sheet exists
  if (!sheet) {
    // If the sheet is not found, log an error and return
    Logger.log(`Error: Sheet named "${sheetName}" was not found. Please check the sheet name.`);
    return;
  }

  // Determine the last row with content
  const lastRow = sheet.getLastRow();

  // Check if there are enough rows of content to delete the last two
  if (lastRow < rowsToDelete) {
    // If there are less than 2 rows of content, inform the console and stop
    Logger.log(`Warning: Sheet "${sheetName}" only has ${lastRow} row(s) of content. No rows deleted.`);
    return;
  }

  // Calculate the starting row for deletion (lastRow - 2 + 1)
  const startRow = lastRow - rowsToDelete + 1;

  try {
    // Execute the deletion
    sheet.deleteRows(startRow, rowsToDelete);

    // Log success
    Logger.log(`Success: Deleted the last ${rowsToDelete} rows (rows ${startRow} to ${lastRow}) from the "${sheetName}" sheet.`);

  } catch (e) {
    // Handle any potential execution errors by logging them
    Logger.log(`Failed to delete rows. An error occurred: ${e.toString()}`);
  }
}