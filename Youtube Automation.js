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
 * Wrapper function for GWS Video Status Check.
 */
function checkVideoStatusGWS() {
  checkVideoStatus(CONFIG.GWS);
}

/**
 * Wrapper function for GCP Video Status Check.
 */
function checkVideoStatusGCP() {
  checkVideoStatus(CONFIG.GCP);
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

    let latestVideo = null;
    let latestTime = 0;

    while (videos.hasNext()) {
      const video = videos.next();
      const time = video.getDateCreated().getTime();
      if (time > latestTime) {
        latestTime = time;
        latestVideo = video;
      }
    }

    if (latestVideo) {
      Logger.log(`Processing latest video: ${latestVideo.getName()}`);

      // Try to generate metadata with Gemini
      const metadata = generateVideoMetadata(latestVideo);

      const uploadResult = uploadVideoToYouTube(latestVideo, metadata);

      if (uploadResult.success) {
        Logger.log(`Successfully uploaded ${latestVideo.getName()} to YouTube. ID: ${uploadResult.videoId}`);

        // Log to Sheet (URL and settings)
        logVideoToSheet(config, uploadResult.videoId, true, true); // Assuming success if upload worked

        latestVideo.moveTo(destinationFolder);
        Logger.log(`Moved ${latestVideo.getName()} to the destination folder.`);
      } else {
        Logger.log(`Failed to upload ${latestVideo.getName()}.`);
      }
    } else {
      Logger.log("No valid video found to process.");
    }
    Logger.log("Processing complete.");

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
 * @param {GoogleAppsScript.Drive.File} videoFile - The video file.
 * @return {object} The generated metadata object.
 */
function generateVideoMetadata(videoFile) {
  const fileName = videoFile.getName();
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

  if (!apiKey) {
    Logger.log("Error: GEMINI_API_KEY not found. Falling back to filename.");
    return {
      title: fileName.replace('.mp4', ''),
      description: `Video: ${fileName}`,
      tags: []
    };
  }

  const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`;

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

  const blob = videoFile.getBlob();
  const fileSizeMB = blob.getBytes().length / (1024 * 1024);
  let requestBody;

  if (fileSizeMB < 15) { // Base64 encoding limit
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

    if (responseCode === 200) {
      const jsonResponse = JSON.parse(responseText);
      if (jsonResponse.candidates && jsonResponse.candidates[0] && jsonResponse.candidates[0].content && jsonResponse.candidates[0].content.parts && jsonResponse.candidates[0].content.parts[0]) {
        const contentText = jsonResponse.candidates[0].content.parts[0].text;
        const cleanedJsonString = contentText.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(cleanedJsonString);
      }
    }
    Logger.log(`Gemini API failed or returned unexpected format. Status: ${responseCode}. Falling back to filename.`);
  } catch (e) {
    Logger.log(`Exception calling Gemini API: ${e.toString()}. Falling back to filename.`);
  }

  // Fallback
  return {
    title: fileName.replace('.mp4', ''),
    description: `Video: ${fileName}`,
    tags: []
  };
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
        defaultAudioLanguage: 'es-419', // Spanish (Latin America)
        defaultLanguage: 'es-419'
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false
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
 * @param {boolean} notMadeForKids - Whether the video is not made for kids.
 * @param {boolean} subtitlesEnabled - Whether subtitles are enabled.
 */
function logVideoToSheet(config, videoId, notMadeForKids, subtitlesEnabled) {
  try {
    const ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
    let sheet = ss.getSheetByName(config.SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(config.SHEET_NAME);
    }

    const videoLink = `https://www.youtube.com/watch?v=${videoId}`;

    // Append row with URL and placeholders for checkboxes
    sheet.appendRow([videoLink, 'uploaded', notMadeForKids, subtitlesEnabled]);
    const lastRow = sheet.getLastRow();

    // Add checkboxes to Columns C and D
    sheet.getRange(lastRow, 3, 1, 2).insertCheckboxes();
    sheet.getRange(lastRow, 3).setValue(notMadeForKids);
    sheet.getRange(lastRow, 4).setValue(subtitlesEnabled);

    Logger.log(`Logged video link and settings to ${config.SHEET_NAME}`);
  } catch (e) {
    Logger.log(`Error logging to sheet: ${e.toString()}`);
  }
}

/**
 * Checks the status of videos listed in the sheet and updates Columns B, C, and D.
 * @param {object} config - The configuration object.
 */
function checkVideoStatus(config) {
  if (!config || !config.SPREADSHEET_ID) {
    Logger.log("Error: Invalid configuration passed to checkVideoStatus. Please run checkVideoStatusGCP or checkVideoStatusGWS instead.");
    return;
  }
  try {
    const ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(config.SHEET_NAME);
    if (!sheet) {
      Logger.log(`Sheet ${config.SHEET_NAME} not found.`);
      return;
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 1) return;

    const range = sheet.getRange(1, 1, lastRow, 4); // Columns A, B, C, D
    const values = range.getValues();

    for (let i = 0; i < values.length; i++) {
      const url = values[i][0];
      let currentStatus = values[i][1];

      if (url && url.includes('youtube.com/watch?v=')) {
        const videoId = url.split('v=')[1].split('&')[0];
        try {
          const response = YouTube.Videos.list('status,snippet', { id: videoId });
          if (response.items && response.items.length > 0) {
            const video = response.items[0];
            const status = video.status;
            const snippet = video.snippet;

            const uploadStatus = status.uploadStatus;
            const privacyStatus = status.privacyStatus;
            const madeForKids = status.madeForKids; // This is what YouTube actually set
            const audioLanguage = snippet.defaultAudioLanguage;

            const newStatus = `${uploadStatus} (${privacyStatus})`;
            if (newStatus !== currentStatus) {
              sheet.getRange(i + 1, 2).setValue(newStatus);
            }

            // Update Checkboxes
            const notMadeForKidsValue = !madeForKids;
            const subtitlesValue = (audioLanguage === 'es-419' || audioLanguage === 'es');

            const cellC = sheet.getRange(i + 1, 3);
            const cellD = sheet.getRange(i + 1, 4);

            if (cellC.getDataValidation() === null) cellC.insertCheckboxes();
            if (cellD.getDataValidation() === null) cellD.insertCheckboxes();

            cellC.setValue(notMadeForKidsValue);
            cellD.setValue(subtitlesValue);

            Logger.log(`Updated status and settings for ${videoId}`);
          } else {
            sheet.getRange(i + 1, 2).setValue('Not Found');
          }
        } catch (e) {
          Logger.log(`Error checking status for ${videoId}: ${e.toString()}`);
        }
      }
    }
    Logger.log(`Status check complete for ${config.SHEET_NAME}.`);
  } catch (e) {
    Logger.log(`Error in checkVideoStatus: ${e.toString()}`);
  }
}