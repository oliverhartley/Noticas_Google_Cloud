/**
 * @version 1.0
 * @date 2025-11-26
 */
// --- Configuration ---
const CONFIG = {
  GWS: {
    SOURCE_FOLDER_ID: "1N_MgJYotvEEuyMQU3TA_9S6lQwFrfwuI",
    DESTINATION_FOLDER_ID: "14or8nArjbB4BO7nJvmDz2blPSOpQqoLa",
    SHEET_NAME: "GWS Video Overview",
    SPREADSHEET_ID: "15-yneYsrmgkpJ5CGK57RVS9chMoV-ixw_w7hsPcaPuo" // Assuming same spreadsheet, adjust if needed
  },
  GCP: {
    SOURCE_FOLDER_ID: "1mrNTjpckNS4sAcS6vB5M8aRoAvwbECpu",
    DESTINATION_FOLDER_ID: "1aN4NbNa6XqBXlKzWnsyfZ8ByOTOwjsnn",
    SHEET_NAME: "GCP Video Overview",
    SPREADSHEET_ID: "15-yneYsrmgkpJ5CGK57RVS9chMoV-ixw_w7hsPcaPuo"
  }
};

const YOUTUBE_CHANNEL_ID = "1aN4NbNa6XqBXlKzWnsyfZ8ByOTOwjsnn"; // Kept for reference.

/**
 * Wrapper function for GWS Video Processing.
 */
function processAndUploadVideosGWS() {
  processAndUploadVideos(CONFIG.GWS);
}

/**
 * Wrapper function for GCP Video Processing.
 */
function processAndUploadVideosGCP() {
  processAndUploadVideos(CONFIG.GCP);
}

/**
 * Main function to process and upload videos.
 * @param {object} config - The configuration object (GWS or GCP).
 */
function processAndUploadVideos(config) {
  try {
    const sourceFolder = DriveApp.getFolderById(config.SOURCE_FOLDER_ID);
    const destinationFolder = DriveApp.getFolderById(config.DESTINATION_FOLDER_ID);

    const videos = sourceFolder.getFilesByType('video/mp4');

    if (!videos.hasNext()) {
      Logger.log(`No new MP4 videos found in the source folder for ${config.SHEET_NAME}.`);
      return;
    }

    while (videos.hasNext()) {
      const videoFile = videos.next();
      Logger.log(`Processing video: ${videoFile.getName()}`);

      try {
        const metadata = generateVideoMetadata(videoFile.getName());

        if (metadata) {
          Logger.log(`Generated metadata for ${videoFile.getName()}:`);
          Logger.log(JSON.stringify(metadata, null, 2));

          const uploadResult = uploadVideoToYouTube(videoFile, metadata);

          if (uploadResult.success) {
            Logger.log(`Successfully uploaded ${videoFile.getName()} to YouTube. ID: ${uploadResult.videoId}`);

            // Log to Sheet
            logVideoToSheet(config, uploadResult.videoId, metadata);

            videoFile.moveTo(destinationFolder);
            Logger.log(`Moved ${videoFile.getName()} to the destination folder.`);
          } else {
            Logger.log(`Failed to upload ${videoFile.getName()}.`);
          }
        } else {
          Logger.log(`Could not generate metadata for ${videoFile.getName()}.`);
        }
      } catch (e) {
        Logger.log(`An error occurred while processing ${videoFile.getName()}: ${e.toString()}`);
      }
    }
    Logger.log("All videos have been processed.");

  } catch (e) {
    if (e.toString().includes("could not be found")) {
      Logger.log("Error: A Folder ID is invalid. Please check configuration.");
    } else {
      Logger.log(`A critical error occurred: ${e.toString()}`);
    }
  }
}

/**
 * Generates video metadata using the Gemini API.
 * @param {string} fileName - The name of the video file.
 * @return {object|null} The generated metadata object or null on failure.
 */
function generateVideoMetadata(fileName) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log("Error: GEMINI_API_KEY not found in Script Properties.");
    return null;
  }
  
  const apiEndpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const prompt = `
    As an expert YouTube content strategist specializing in SEO for a tech audience, analyze the following video.
    Based on the video content, generate the following information in SPANISH. Your response MUST be a valid JSON object with the following keys: "title", "description", "tags".

    - "title": Create a new, compelling, SEO-friendly title (max 100 chars) that improves upon the original.
    - "description": Write a detailed, engaging description. Include:
        1. A brief summary of the video content.
        2. A "Table of Contents" (TOC) with accurate timestamps (e.g., 0:00 Introduction) based on the actual video content.
        3. 5-10 relevant hashtags at the end.
    - "tags": Provide an array of around 15 high-quality, detailed keywords (tags). Tags should not contain commas.
  `;

  // For video analysis, we need to send the file content if it's small enough, 
  // or use the File API which is complex in Apps Script.
  // Here we attempt inline for small files, but warn about limits.
  let requestBody;
  const videoFile = DriveApp.getFilesByName(fileName).next(); // Assuming unique filename for now, or we need to pass the file object
  const blob = videoFile.getBlob();
  const fileSizeMB = blob.getBytes().length / (1024 * 1024);

  if (fileSizeMB < 15) { // Base64 encoding increases size by ~33%, 15MB -> ~20MB payload, safe for now.
    const base64Video = Utilities.base64Encode(blob.getBytes());
    requestBody = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "video/mp4",
              data: base64Video
            }
          }
        ]
      }]
    };
  } else {
    Logger.log(`Video ${fileName} is too large (${fileSizeMB.toFixed(2)}MB) for inline Gemini analysis. Falling back to filename-based analysis.`);
    // Fallback to filename-based analysis if too large
    requestBody = {
      contents: [{
        parts: [{ text: prompt + `\n\nVideo Filename (Fallback): "${fileName}"` }]
      }]
    };
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode !== 200) {
      Logger.log(`Error from Gemini API. Status: ${responseCode}. Response: ${responseText}`);
      return null;
    }

    const jsonResponse = JSON.parse(responseText);
    
    if (jsonResponse.candidates && jsonResponse.candidates[0] && jsonResponse.candidates[0].content && jsonResponse.candidates[0].content.parts && jsonResponse.candidates[0].content.parts[0]) {
      const contentText = jsonResponse.candidates[0].content.parts[0].text;
      const cleanedJsonString = contentText.replace(/```json/g, "").replace(/```/g, "").trim();
      return JSON.parse(cleanedJsonString);
    } else {
       Logger.log(`Unexpected API response format: ${JSON.stringify(jsonResponse)}`);
       return null;
    }

  } catch (e) {
    Logger.log(`Exception calling Gemini API: ${e.toString()}`);
    return null;
  }
}

/**
 * Uploads a video file to YouTube.
 * @param {GoogleAppsScript.Drive.File} videoFile - The video file to upload.
 * @param {object} metadata - The metadata for the video.
 * @return {object} Result object with success status and video ID.
 */
function uploadVideoToYouTube(videoFile, metadata) {
  try {
    const videoResource = {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
      },
      status: {
        privacyStatus: 'public' // Changed from 'private' to 'public'
      }
    };

    const video = YouTube.Videos.insert(videoResource, 'snippet,status', videoFile.getBlob());
    return { success: true, videoId: video.id };
  } catch (e) {
    Logger.log(`YouTube upload error: ${e.toString()}`);
    return { success: false };
  }
}

/**
 * Logs video details to the specified Google Sheet.
 * @param {object} config - The configuration object.
 * @param {string} videoId - The YouTube video ID.
 * @param {object} metadata - The video metadata.
 */
function logVideoToSheet(config, videoId, metadata) {
  try {
    const ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
    let sheet = ss.getSheetByName(config.SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(config.SHEET_NAME);
      sheet.appendRow(['Link', 'Title', 'Description', 'Date Created']);
    }

    const videoLink = `https://www.youtube.com/watch?v=${videoId}`;
    const dateCreated = new Date();

    sheet.appendRow([videoLink, metadata.title, metadata.description, dateCreated]);
    Logger.log(`Logged video to ${config.SHEET_NAME}`);
  } catch (e) {
    Logger.log(`Error logging to sheet: ${e.toString()}`);
  }
}