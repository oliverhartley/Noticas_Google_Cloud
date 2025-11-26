/**
 * Test function to verify Gemini video analysis.
 * Place a small video file (< 15MB) in Google Drive and update the FILE_ID.
 */
function testGeminiVideoAnalysis() {
  const FILE_ID = "YOUR_TEST_VIDEO_FILE_ID"; // Replace with a valid File ID
  
  try {
    const file = DriveApp.getFileById(FILE_ID);
    const fileName = file.getName();
    Logger.log(`Testing with file: ${fileName}`);
    
    const metadata = generateVideoMetadata(fileName);
    
    if (metadata) {
      Logger.log("Generated Metadata:");
      Logger.log(JSON.stringify(metadata, null, 2));
    } else {
      Logger.log("Failed to generate metadata.");
    }
  } catch (e) {
    Logger.log(`Error during test: ${e.toString()}`);
  }
}
