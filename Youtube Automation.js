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
      const filename = latestVideo.getName().replace('.mp4', '');
      const metadata = {
        title: filename,
        description: `Video: ${filename}`
      };

      const uploadResult = uploadVideoToYouTube(latestVideo, metadata);

      if (uploadResult.success) {
        Logger.log(`Successfully uploaded ${latestVideo.getName()} to YouTube. ID: ${uploadResult.videoId}`);

        // Log to Sheet (Only URL)
        logVideoToSheet(config, uploadResult.videoId);

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
 */
function logVideoToSheet(config, videoId) {
  try {
    const ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
    let sheet = ss.getSheetByName(config.SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(config.SHEET_NAME);
    }

    const videoLink = `https://www.youtube.com/watch?v=${videoId}`;

    // Append only the link to the first available row in Column A
    sheet.appendRow([videoLink]);
    Logger.log(`Logged video link to ${config.SHEET_NAME}`);
  } catch (e) {
    Logger.log(`Error logging to sheet: ${e.toString()}`);
  }
}

/**
 * Checks the status of videos listed in the sheet and updates Column B.
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

    const range = sheet.getRange(1, 1, lastRow, 2); // Columns A and B
    const values = range.getValues();

    for (let i = 0; i < values.length; i++) {
      const url = values[i][0];
      let currentStatus = values[i][1];

      if (url && url.includes('youtube.com/watch?v=')) {
        // Only check if status is not already 'processed' or if it's empty/pending
        if (!currentStatus || currentStatus === 'pending' || currentStatus === 'uploaded') {
          const videoId = url.split('v=')[1].split('&')[0];
          try {
            const response = YouTube.Videos.list('status', { id: videoId });
            if (response.items && response.items.length > 0) {
              const status = response.items[0].status;
              const uploadStatus = status.uploadStatus; // e.g., 'processed', 'uploaded', 'failed'
              const privacyStatus = status.privacyStatus; // e.g., 'public', 'private'

              const newStatus = `${uploadStatus} (${privacyStatus})`;
              if (newStatus !== currentStatus) {
                sheet.getRange(i + 1, 2).setValue(newStatus);
                Logger.log(`Updated status for ${videoId}: ${newStatus}`);
              }
            } else {
              sheet.getRange(i + 1, 2).setValue('Not Found');
            }
          } catch (e) {
            Logger.log(`Error checking status for ${videoId}: ${e.toString()}`);
          }
        }
      }
    }
    Logger.log(`Status check complete for ${config.SHEET_NAME}.`);
  } catch (e) {
    Logger.log(`Error in checkVideoStatus: ${e.toString()}`);
  }
}