function checkDriveFolder() {
  const folderId = '1N_MgJYotvEEuyMQU3TA_9S6lQwFrfwuI';
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      Logger.log(`File: ${file.getName()} (${file.getMimeType()}) - Created: ${file.getDateCreated()}`);
    }
  } catch (e) {
    Logger.log('Error: ' + e.message);
  }
}
