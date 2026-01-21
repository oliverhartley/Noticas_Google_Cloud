function runLinkedInDebug() {
  Logger.log("--- Starting LinkedIn Debug Test ---");
  
  // 1. Configuration - reusing GWS Folder for test images
  const GWS_FOLDER_ID = '1N_MgJYotvEEuyMQU3TA_9S6lQwFrfwuI'; 
  
  // 2. Mock Data
  const linkUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"; // Dummy valid URL (Rick Roll, safe for testing)
  const title = "Debug Test Video Title";
  const body = "This is a debug test post to verify API connectivity. checking image upload.";
  const message = `Debug Test Post ${new Date().toISOString()}\n\n▶️ Vea el resumen aquí: ${linkUrl}\n\n${body}`;

  // 3. Fetch Image
  let imageBlob = null;
  try {
    const folder = DriveApp.getFolderById(GWS_FOLDER_ID);
    // Try to find ANY image to test with
    const files = folder.getFiles(); // Just get files and check mime
    while (files.hasNext()) {
      const file = files.next();
      const mime = file.getMimeType();
      if (mime === MimeType.PNG || mime === MimeType.JPEG) {
        imageBlob = file.getBlob();
        Logger.log(`Found test image: ${file.getName()} (${mime})`);
        break; // Use the first one found
      }
    }
  } catch (e) {
    Logger.log("Error fetching test image: " + e.toString());
  }

  if (!imageBlob) {
    Logger.log("WARNING: No image found for test. Test INVALID if goal is to test Image Upload.");
    // Create a dummy blob if none found? No, better to warn.
  }

  // 4. Attempt Post
  Logger.log("Calling postToLinkedIn...");
  // Signature: postToLinkedIn(message, linkUrl, linkTitle, linkDescription, imageBlob, specificImageUrn = null)
  const postId = postToLinkedIn(message, linkUrl, title, body, imageBlob);
  
  Logger.log("--- Test Finished ---");
  Logger.log(`Result URN: ${postId}`);
}
