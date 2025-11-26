// --- Configuration ---
const SOURCE_FOLDER_ID = "1N_MgJYotvEEuyMQU3TA_9S6lQwFrfwuI"; //  GWS Folder
// const SOURCE_FOLDER_ID = "1mrNTjpckNS4sAcS6vB5M8aRoAvwbECpu"; //  GCP Folder
const DESTINATION_FOLDER_ID = "14or8nArjbB4BO7nJvmDz2blPSOpQqoLa"; // GWS Folder
// const DESTINATION_FOLDER_ID = "1aN4NbNa6XqBXlKzWnsyfZ8ByOTOwjsnn"; // GCP Folder
const YOUTUBE_CHANNEL_ID = "1aN4NbNa6XqBXlKzWnsyfZ8ByOTOwjsnn"; // Kept for reference.

/**
 * Main function to process and upload videos.
 */
function processAndUploadVideos() {
  try {
    const sourceFolder = DriveApp.getFolderById(SOURCE_FOLDER_ID);
    const destinationFolder = DriveApp.getFolderById(DESTINATION_FOLDER_ID);
    
    // --- CORRECTED LINE ---
    // Using the correct string 'video/mp4' as the argument.
    const videos = sourceFolder.getFilesByType('video/mp4');

    if (!videos.hasNext()) {
      Logger.log("No new MP4 videos found in the source folder.");
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

          const uploadSuccessful = uploadVideoToYouTube(videoFile, metadata);

          if (uploadSuccessful) {
            Logger.log(`Successfully uploaded ${videoFile.getName()} to YouTube.`);
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
      Logger.log("Error: A Folder ID is invalid. Please check SOURCE_FOLDER_ID and DESTINATION_FOLDER_ID.");
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
  
  const apiEndpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const prompt = `
    As an expert YouTube content strategist specializing in SEO for a tech audience, analyze the following video metadata.
    Based on this information, generate the following content in SPANISH. Your response MUST be a valid JSON object with the following keys: "title", "description", "hashtags", "tags".

    Video Filename: "${fileName}"

    - "title": Create a new, compelling, SEO-friendly title that improves upon the original.
    - "description": Write a new, detailed, 2-3 paragraph description.
    - "hashtags": Provide an array of 5 relevant hashtags.
    - "tags": Provide an array of around 15 high-quality, detailed keywords (tags). Tags should not contain commas.
  `;

  const requestBody = {
    contents: [{
      parts: [{
        text: prompt
      }]
    }]
  };

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
 * @return {boolean} True if the upload was successful, false otherwise.
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
        privacyStatus: 'private' // or 'public' or 'unlisted'
      }
    };

    const video = YouTube.Videos.insert(videoResource, 'snippet,status', videoFile.getBlob());
    Logger.log(`Video uploaded with ID: ${video.id}`);
    return true;
  } catch (e) {
    Logger.log(`YouTube upload error: ${e.toString()}`);
    return false;
  }
}