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
    SPREADSHEET_ID: "15-yneYsrmgkpJ5CGK57RVS9chMoV-ixw_w7hsPcaPuo", // Assuming same spreadsheet, adjust if needed
    VIDEO_SHEET_NAME: 'GWS Video Overview',
    BLACKBOARD_FOLDER_ID: '1av7Fs1fKEDKwzP1morVrOJ0eunw-6sJz',
    PLAYLIST_NAME: "GWS Updates"
  },
  GCP: {
    SOURCE_FOLDER_ID: "1mrNTjpckNS4sAcS6vB5M8aRoAvwbECpu",
    DESTINATION_FOLDER_ID: "1aN4NbNa6XqBXlKzWnsyfZ8ByOTOwjsnn",
    SHEET_NAME: "GCP Video Overview",
    SPREADSHEET_ID: "15-yneYsrmgkpJ5CGK57RVS9chMoV-ixw_w7hsPcaPuo",
    VIDEO_SHEET_NAME: 'GCP Video Overview',
    BLACKBOARD_FOLDER_ID: '1spu6q19oLUdtUV2uUVNAcTDnmWHMYhEw',
    PLAYLIST_NAME: "GCP Updates"
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

      const videoFile = latestVideo; // Rename for clarity
      const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

      // 2. Generate Metadata (Title, Description, Tags) and Blackboard Summary
      const metadata = generateVideoMetadata(videoFile, apiKey, config.BLACKBOARD_FOLDER_ID);

      // 3. Upload to YouTube with generated metadata
      const uploadResult = uploadVideoToYouTube(videoFile, metadata);
      if (uploadResult.success && uploadResult.videoId) {
        const videoUrl = `https://www.youtube.com/watch?v=${uploadResult.videoId}`;
        logVideoToSheet(videoUrl, config, true, true, metadata.title, metadata.description); // Defaulting to not made for kids and subtitles enabled
        Logger.log(`Successfully processed and uploaded: ${videoFile.getName()}`);

        // 4. Add to Playlist
        if (config.PLAYLIST_NAME) {
          try {
            const playlistId = getPlaylistIdByName(config.PLAYLIST_NAME);
            if (playlistId) {
              const addedToPlaylist = addVideoToPlaylist(uploadResult.videoId, playlistId);
              if (addedToPlaylist) {
                Logger.log(`Added video to playlist: ${config.PLAYLIST_NAME}`);
              } else {
                Logger.log(`Failed to add video to playlist: ${config.PLAYLIST_NAME}`);
              }
            } else {
              Logger.log(`Playlist not found: ${config.PLAYLIST_NAME}`);
            }
          } catch (e) {
            Logger.log(`Error adding to playlist: ${e.toString()}`);
          }
        }
      }

      latestVideo.moveTo(destinationFolder);
      Logger.log(`Moved ${latestVideo.getName()} to the destination folder.`);
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
 * @param {string} apiKey - The Gemini API key.
 * @param {string} blackboardFolderId - Optional folder ID for blackboard summary.
 * @return {object} Object containing title, description, and tags.
 */
function generateVideoMetadata(videoFile, apiKey, blackboardFolderId = null) {
  const fileName = videoFile.getName();

  if (!apiKey) {
    Logger.log("Error: GEMINI_API_KEY not found. Falling back to filename.");
    return fallbackMetadata(fileName);
  }

  try {
    // 1. Upload to Gemini File API
    const fileUri = uploadToGeminiFileAPI(videoFile, apiKey);
    if (!fileUri) {
      Logger.log("Failed to upload to Gemini File API. Falling back.");
      return fallbackMetadata(fileName);
    }

    // 2. Wait for Processing
    if (!waitForFileProcessing(fileUri, apiKey)) {
      Logger.log("File processing timed out or failed. Falling back.");
      deleteGeminiFile(fileUri, apiKey); // Try to clean up anyway
      return fallbackMetadata(fileName);
    }

    // 3. Generate Content
    const metadata = generateContentWithFile(fileUri, apiKey, fileName);

    // Generate Blackboard Summary if requested
    if (blackboardFolderId && metadata && metadata.title) {
      generateAndSaveBlackboardSummary(fileUri, apiKey, blackboardFolderId, metadata.title);
    }

    // 4. Cleanup
    deleteGeminiFile(fileUri, apiKey);

    if (metadata) {
      return metadata;
    } else {
      Logger.log("Failed to generate metadata from file. Falling back.");
      return fallbackMetadata(fileName);
    }

  } catch (e) {
    Logger.log(`Exception in generateVideoMetadata: ${e.toString()}. Falling back.`);
    return fallbackMetadata(fileName);
  }
}

function fallbackMetadata(fileName) {
  return {
    title: fileName.replace('.mp4', ''),
    description: `Video: ${fileName}`,
    tags: []
  };
}

function uploadToGeminiFileAPI(videoFile, apiKey) {
  const blob = videoFile.getBlob();
  const fileSize = blob.getBytes().length;
  const mimeType = "video/mp4";
  const fileName = videoFile.getName();

  const initUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;

  // Step 1: Initialize Resumable Upload
  const initHeaders = {
    'X-Goog-Upload-Protocol': 'resumable',
    'X-Goog-Upload-Command': 'start',
    'X-Goog-Upload-Header-Content-Length': fileSize.toString(),
    'X-Goog-Upload-Header-Content-Type': mimeType,
    'Content-Type': 'application/json'
  };

  const initResponse = UrlFetchApp.fetch(initUrl, {
    method: 'post',
    headers: initHeaders,
    payload: JSON.stringify({ file: { displayName: fileName } }),
    muteHttpExceptions: true
  });

  if (initResponse.getResponseCode() !== 200) {
    Logger.log(`Init upload failed: ${initResponse.getContentText()}`);
    return null;
  }

  const uploadUrl = initResponse.getHeaders()['X-Goog-Upload-URL'] || initResponse.getHeaders()['x-goog-upload-url'];
  if (!uploadUrl) return null;

  // Step 2: Upload Data
  const uploadResponse = UrlFetchApp.fetch(uploadUrl, {
    method: 'post', // Resumable upload uses POST or PUT for the actual data
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Type': mimeType
    },
    payload: blob,
    muteHttpExceptions: true
  });

  if (uploadResponse.getResponseCode() !== 200 && uploadResponse.getResponseCode() !== 201) {
    Logger.log(`Upload data failed: ${uploadResponse.getContentText()}`);
    return null;
  }

  const fileInfo = JSON.parse(uploadResponse.getContentText());
  return fileInfo.file.uri;
}

function waitForFileProcessing(fileUri, apiKey) {
  const fileId = fileUri.split('/').pop();
  const getUrl = `https://generativelanguage.googleapis.com/v1beta/files/${fileId}?key=${apiKey}`;

  // Wait up to ~2.5 minutes (30 retries * 5 seconds)
  for (let i = 0; i < 30; i++) {
    const response = UrlFetchApp.fetch(getUrl, {
      method: 'get',
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      const fileState = JSON.parse(response.getContentText());
      Logger.log(`File state: ${fileState.state}. Waiting...`);
      if (fileState.state === 'ACTIVE') {
        return true;
      }
      if (fileState.state === 'FAILED') {
        Logger.log("File processing failed on Gemini side.");
        return false;
      }
    } else {
      Logger.log(`Error checking file status (HTTP ${response.getResponseCode()}): ${response.getContentText()}`);
    }
    Utilities.sleep(5000); // Wait 5 seconds between checks
  }
  return false; // Timeout
}

function generateAndSaveBlackboardSummary(fileUri, apiKey, folderId, videoTitle) {
  const models = [
    { name: 'gemini-3-pro-preview', version: 'v1beta' },
    { name: 'gemini-1.5-pro', version: 'v1' },
    { name: 'gemini-1.5-flash', version: 'v1' }
  ];

  for (const model of models) {
    try {
      const apiEndpoint = `https://generativelanguage.googleapis.com/${model.version}/models/${model.name}:generateContent?key=${apiKey}`;

      const prompt = `
        Basado en este video, crea un resumen conciso que quepa en una pizarra escolar.
        El resumen debe ser en español, claro, directo y destacar los puntos clave del video.
        No incluyas un título, solo el resumen.
      `;

      const requestBody = {
        contents: [{
          parts: [
            { text: prompt },
            { fileData: { mimeType: "video/mp4", fileUri: fileUri } }
          ]
        }]
      };

      const options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(requestBody),
        muteHttpExceptions: true
      };

      const response = UrlFetchApp.fetch(apiEndpoint, options);
      if (response.getResponseCode() === 200) {
        const jsonResponse = JSON.parse(response.getContentText());
        if (jsonResponse.candidates && jsonResponse.candidates[0] && jsonResponse.candidates[0].content && jsonResponse.candidates[0].content.parts && jsonResponse.candidates[0].content.parts[0]) {
          const summaryText = jsonResponse.candidates[0].content.parts[0].text;

          const folder = DriveApp.getFolderById(folderId);
          const fileName = `Resumen Pizarra - ${videoTitle}.txt`;
          folder.createFile(fileName, summaryText, MimeType.PLAIN_TEXT);
          Logger.log(`Blackboard summary saved using model ${model.name} for "${videoTitle}" in folder ID: ${folderId}`);
          return; // Success, exit function
        }
      } else {
        Logger.log(`Model ${model.name} failed for blackboard summary: ${response.getResponseCode()} - ${response.getContentText()}`);
      }
    } catch (e) {
      Logger.log(`Exception with model ${model.name} in generateAndSaveBlackboardSummary: ${e.toString()}`);
    }
  }
  Logger.log("All models failed for blackboard summary.");
}


function generateContentWithFile(fileUri, apiKey, fileName) {
  const models = [
    { name: 'gemini-3-pro-preview', version: 'v1beta' },
    { name: 'gemini-1.5-pro', version: 'v1' },
    { name: 'gemini-1.5-flash', version: 'v1' }
  ];

  const prompt = `
    As an expert YouTube content strategist specializing in SEO for a tech audience, analyze the following video.
    Based on the video content, generate the following information in SPANISH. Your response MUST be a valid JSON object with the following keys: "title", "description", "tags".

    - "title": Create a new, compelling, SEO-friendly title (max 100 chars) that improves upon the original. Do NOT include prefixes like "Google Cloud News:" or "Noticias de Google Cloud:". Start directly with the topic.
    - "description": Write a detailed, engaging description. Include:
        1. A brief summary of the video content.
        2. A "Table of Contents" (TOC) with accurate timestamps (e.g., 0:00 Introduction) based on the actual video content.
        3. 5-10 relevant hashtags at the end.
    - "tags": Provide an array of around 15 high-quality, detailed keywords (tags). Tags should not contain commas.
  `;

  const requestBody = {
    contents: [{
      parts: [
        { text: prompt },
        { fileData: { mimeType: "video/mp4", fileUri: fileUri } }
      ]
    }],
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 2048,
      responseMimeType: "application/json"
    }
  };

  for (const model of models) {
    try {
      const apiEndpoint = `https://generativelanguage.googleapis.com/${model.version}/models/${model.name}:generateContent?key=${apiKey}`;
      const options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(requestBody),
        muteHttpExceptions: true
      };

      let response;
      let retries = 3;
      while (retries > 0) {
        try {
          response = UrlFetchApp.fetch(apiEndpoint, options);
          if (response.getResponseCode() === 200) {
            break; // Success
          }
          Logger.log(`Model ${model.name} failed (HTTP ${response.getResponseCode()}). Retrying...`);
        } catch (e) {
          Logger.log(`Model ${model.name} error: ${e.toString()}. Retrying...`);
        }
        retries--;
        Utilities.sleep(2000); // Wait 2 seconds before retry
      }

      if (response && response.getResponseCode() === 200) {
        const jsonResponse = JSON.parse(response.getContentText());
        if (jsonResponse.candidates && jsonResponse.candidates[0] && jsonResponse.candidates[0].content && jsonResponse.candidates[0].content.parts && jsonResponse.candidates[0].content.parts[0]) {
          const textResponse = jsonResponse.candidates[0].content.parts[0].text;
          Logger.log(`Successfully used model: ${model.name}`);
          return JSON.parse(textResponse);
        }
      } else {
        Logger.log(`Model ${model.name} failed after retries.`);
      }
    } catch (e) {
      Logger.log(`Exception with model ${model.name}: ${e.toString()}`);
    }
  }
  throw new Error("All models failed for metadata generation.");
}

function deleteGeminiFile(fileUri, apiKey) {
  const fileId = fileUri.split('/').pop();
  const deleteUrl = `https://generativelanguage.googleapis.com/v1beta/files/${fileId}?key=${apiKey}`;
  UrlFetchApp.fetch(deleteUrl, { method: 'delete', muteHttpExceptions: true });
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
 * @param {string} videoUrl - The YouTube video URL.
 * @param {object} config - The configuration object.
 * @param {boolean} notMadeForKids - Whether the video is not made for kids.
 * @param {boolean} subtitlesEnabled - Whether subtitles are enabled.
 * @param {string} title - The video title.
 * @param {string} description - The video description.
 */
function logVideoToSheet(videoUrl, config, notMadeForKids, subtitlesEnabled, title, description) {
  try {
    const ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
    let sheet = ss.getSheetByName(config.SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(config.SHEET_NAME);
    }

    // Append row with URL, initial status, settings, title, and description
    sheet.appendRow([videoUrl, 'uploaded', notMadeForKids, subtitlesEnabled, title, description]);
    const lastRow = sheet.getLastRow();

    // Add checkboxes to Columns C and D
    sheet.getRange(lastRow, 3, 1, 2).insertCheckboxes();
    sheet.getRange(lastRow, 3).setValue(notMadeForKids);
    sheet.getRange(lastRow, 4).setValue(subtitlesEnabled);

    Logger.log(`Logged video link, settings, title, and description to ${config.SHEET_NAME}`);
  } catch (e) {
    Logger.log(`Error logging to sheet: ${e.toString()}`);
  }
}

/**
 * Gets the Playlist ID by its name.
 * @param {string} playlistName - The name of the playlist to find.
 * @return {string|null} The Playlist ID or null if not found.
 */
function getPlaylistIdByName(playlistName) {
  try {
    let pageToken = '';
    do {
      const response = YouTube.Playlists.list('snippet', {
        mine: true,
        maxResults: 50,
        pageToken: pageToken
      });

      if (response.items) {
        for (const item of response.items) {
          if (item.snippet.title === playlistName) {
            return item.id;
          }
        }
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    Logger.log(`Playlist "${playlistName}" not found.`);
    return null;
  } catch (e) {
    Logger.log(`Error listing playlists: ${e.toString()}`);
    return null;
  }
}

/**
 * Adds a video to a specific playlist.
 * @param {string} videoId - The ID of the video to add.
 * @param {string} playlistId - The ID of the playlist.
 * @return {boolean} True if successful, false otherwise.
 */
function addVideoToPlaylist(videoId, playlistId) {
  try {
    const resource = {
      snippet: {
        playlistId: playlistId,
        resourceId: {
          kind: 'youtube#video',
          videoId: videoId
        }
      }
    };
    YouTube.PlaylistItems.insert(resource, 'snippet');
    return true;
  } catch (e) {
    Logger.log(`Error adding video ${videoId} to playlist ${playlistId}: ${e.toString()}`);
    return false;
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