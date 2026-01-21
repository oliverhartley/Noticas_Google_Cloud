/**
 * @file LinkedIn Utils.js
 * @description Utilities for interacting with the LinkedIn API to post updates and manage posts.
 */

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';

/**
 * Retrieves the LinkedIn Access Token from Script Properties.
 * Falls back to a hardcoded string if not found (though Script Properties is recommended).
 */
function getLinkedInAccessToken() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('LINKEDIN_ACCESS_TOKEN');

  if (!token) {
    Logger.log('ERROR: LINKEDIN_ACCESS_TOKEN not found in Script Properties.');
    // Optional: Return a fallback or throw error
  }
  return token;
}

/**
 * Gets the authenticated user's LinkedIn Member URN (ID).
 * @param {string} accessToken - The LinkedIn OAuth2 access token.
 * @returns {string} The user's URN (e.g., 'urn:li:person:abcdef123').
 */
/**
 * Gets the authenticated user's LinkedIn Member URN (ID).
 * @param {string} accessToken - The LinkedIn OAuth2 access token.
 * @returns {string} The user's URN (e.g., 'urn:li:person:abcdef123').
 */
function getLinkedInPersonUrn(accessToken) {
  // 1. Check if we have a manually set or cached URN
  const props = PropertiesService.getScriptProperties();
  const cachedUrn = props.getProperty('LINKEDIN_PERSON_URN');
  if (cachedUrn) {
    return cachedUrn;
  }

  const token = accessToken || getLinkedInAccessToken();
  if (!token) throw new Error('No Access Token available.');

  // Strategy 1: Try OIDC /userinfo endpoint (requires 'openid' scope)
  try {
    const url = `${LINKEDIN_API_BASE}/userinfo`;
    const options = {
      method: 'get',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      // OIDC 'sub' is usually just the ID (e.g. '12345'), but can be a URN. 
      // ugcPosts requires 'urn:li:person:12345'
      let urn = data.sub;
      if (!urn.startsWith('urn:li:person:')) {
        urn = `urn:li:person:${urn}`;
      }

      // Cache the result to avoid future calls
      props.setProperty('LINKEDIN_PERSON_URN', urn);
      return urn; 
    } else {
      Logger.log(`OIDC /userinfo failed (${response.getResponseCode()}). Trying legacy /me endpoint...`);
    }
  } catch (e) {
    Logger.log(`OIDC check failed: ${e.message}`);
  }

  // Strategy 2: Try Legacy /me endpoint (requires 'r_liteprofile' or 'r_basicprofile')
  try {
    const url = `${LINKEDIN_API_BASE}/me`;
    const options = {
      method: 'get',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      // /me returns generic ID, need to prefix
      const urn = `urn:li:person:${data.id}`;
      props.setProperty('LINKEDIN_PERSON_URN', urn);
      return urn;
    } else {
      Logger.log(`Legacy /me failed: ${response.getResponseCode()} - ${response.getContentText()}`);
      throw new Error(`Failed to retrieve Profile ID. Scopes 'openid', 'profile', or 'r_liteprofile' might be missing.`);
    }
  } catch (e) {
    Logger.log(`Exception in getLinkedInPersonUrn: ${e.message}`);
    throw e;
  }
}


/**
 * Posts a text update with an optional link/media to LinkedIn.
 * @param {string} message - The text content of the post.
 * @param {string} linkUrl - (Optional) URL to share (e.g., YouTube link).
 * @param {string} linkTitle - (Optional) Title for the link card.
 * @param {string} linkDescription - (Optional) Description for the link card.
 */
/**
 * Initializes an image upload to LinkedIn.
 * @param {string} token - Access Token.
 * @param {string} personUrn - User URN.
 * @returns {object} { uploadUrl, imageUrn }
 */
function initializeImageUpload(token, personUrn) {
  const url = 'https://api.linkedin.com/rest/images?action=initializeUpload';
  const requestBody = {
    "initializeUploadRequest": {
      "owner": personUrn
    }
  };

  const options = {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': '202401'
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  Logger.log(`initializeUpload Response Code: ${response.getResponseCode()}`);

  if (response.getResponseCode() === 200) {
    const data = JSON.parse(response.getContentText());
    Logger.log(`initializeUpload Response Data: ${JSON.stringify(data)}`);
    return {
      uploadUrl: data.value.uploadUrl,
      imageUrn: data.value.image
    };
  } else {
    Logger.log(`Error initializing upload: ${response.getResponseCode()} - ${response.getContentText()}`);
    return null;
  }
}

/**
 * Uploads the image binary to the signed URL.
 * @param {string} uploadUrl - The URL from initializeImageUpload.
 * @param {Blob} imageBlob - The image file blob.
 */
function uploadImageBinary(uploadUrl, imageBlob) {
  Logger.log(`Uploading to URL: ${uploadUrl.substring(0, 50)}...`);

  const options = {
    method: 'put',
    headers: {
      // LinkedIn Signed URLs often require strict Content-Type matching if enforced, or at least a valid one.
      'Content-Type': imageBlob.getContentType()
    },
    // Pass the Blob directly. UrlFetchApp usually handles this better for binary.
    payload: imageBlob,
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(uploadUrl, options);
    const responseCode = response.getResponseCode();

    if (responseCode === 201 || responseCode === 200) {
      Logger.log("Image binary uploaded successfully.");
      return true;
    } else {
      Logger.log(`Error uploading binary: ${responseCode}`);
      // Log strict response only if not too huge
      const body = response.getContentText();
      Logger.log(`Response start: ${body.substring(0, 500)}`);
      return false;
    }
  } catch (e) {
    Logger.log(`Exception during binary upload: ${e.message}`);
    return false;
  }
}

/**
 * Posts a text update to LinkedIn.
 * Logic:
 * - If Image provided: Posts as an IMAGE post, and appends the Link URL to the text.
 * - If No Image: Posts as an ARTICLE (Link Card) post.
 */
function postToLinkedIn(message, linkUrl, linkTitle, linkDescription, imageBlob) {
  const token = getLinkedInAccessToken();
  if (!token) {
    Logger.log('No LinkedIn Access Token found.');
    return null;
  }

  try {
    const personUrn = getLinkedInPersonUrn(token);

    // 1. Upload Image (if provided)
    let uploadedImageUrn = null;
    if (imageBlob) {
      Logger.log("Uploading image...");
      const uploadData = initializeImageUpload(token, personUrn);
      if (uploadData) {
        const success = uploadImageBinary(uploadData.uploadUrl, imageBlob);
        if (success) {
          uploadedImageUrn = uploadData.imageUrn;
        }
      }
    }

    // 2. Prepare Post Data
    const url = 'https://api.linkedin.com/rest/posts';

    // Default commentary
    let finalMessage = message;

    // Base Request Body
    const requestBody = {
      "author": personUrn,
      "visibility": "PUBLIC",
      "distribution": {
        "feedDistribution": "MAIN_FEED",
        "targetEntities": [],
        "thirdPartyDistributionChannels": []
      },
      "lifecycleState": "PUBLISHED",
      "isReshareDisabledByAuthor": false
    };

    // 3. Determine Format (Image vs Article)
    if (uploadedImageUrn) {
      // --- IMAGE POST ---
      // Link is now embedded in the message by the caller
      requestBody.commentary = finalMessage;
      requestBody.content = {
        "media": {
          "id": uploadedImageUrn,
          "title": linkTitle || "News Update"
        }
      };

    } else if (linkUrl) {
      // --- ARTICLE (LINK CARD) POST ---
      // Fallback if no image (or upload failed)
      requestBody.commentary = finalMessage;
      requestBody.content = {
        "article": {
          "source": linkUrl,
          "title": linkTitle || "News Update",
          // 'description' often ignored by API but good to have
        }
      };
    } else {
      // --- TEXT ONLY ---
      requestBody.commentary = finalMessage;
    }

    const options = {
      method: 'post',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202401' 
      },
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode === 201) {
      // Header 'x-restli-id' contains the new URN, or it's in the body?
      // /posts usually returns the created object or header.
      // If 201 Created, check headers or body.
      // Usually body is empty on 201? Or contains ID.
      // Let's check headers for ID if body is empty, or try parsing body.

      let postId = '';
      const headers = response.getHeaders();
      if (headers['x-linkedin-id']) {
        postId = headers['x-linkedin-id'];
      } else if (headers['x-restli-id']) {
        postId = headers['x-restli-id'];
      }

      // If not in headers, check body (sometimes it's there)
      if (!postId && responseBody) {
        try {
          const data = JSON.parse(responseBody);
          postId = data.id;
        } catch (e) {
          // ignore
        }
      }

      Logger.log(`Successfully posted to LinkedIn. ID: ${postId}`);
      // Store the last post ID in script properties for easy deletion
      PropertiesService.getScriptProperties().setProperty('LAST_LINKEDIN_POST_URN', postId);
      return postId;
    } else {
      Logger.log(`Error posting to LinkedIn: ${responseCode} - ${responseBody}`);
      return null;
    }

  } catch (e) {
    Logger.log(`Exception in postToLinkedIn: ${e.message}`);
    return null;
  }
}

/**
 * Deletes a LinkedIn post by URN.
 * Uses the modern '/posts' API.
 * @param {string} postUrn - The URN of the post to delete.
 */
function deleteLinkedInPost(postUrn) {
  const token = getLinkedInAccessToken();
  if (!token) return;

  // If no URN provided, try to get the last one
  if (!postUrn) {
    postUrn = PropertiesService.getScriptProperties().getProperty('LAST_LINKEDIN_POST_URN');
    if (!postUrn) {
      Logger.log('No post URN provided or found in cache.');
      return;
    }
  }

  // Ensure URN is properly encoded for the URL
  const encodedUrn = encodeURIComponent(postUrn);
  const url = `https://api.linkedin.com/rest/posts/${encodedUrn}`;

  const options = {
    method: 'delete',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': '202401'
    },
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();

    if (responseCode === 204 || responseCode === 200) {
      Logger.log(`Successfully deleted LinkedIn post: ${postUrn}`);
      PropertiesService.getScriptProperties().deleteProperty('LAST_LINKEDIN_POST_URN');
    } else {
      Logger.log(`Error deleting LinkedIn post: ${responseCode} - ${response.getContentText()}`);
    }
  } catch (e) {
    Logger.log(`Exception in deleteLinkedInPost: ${e.message}`);
  }
}


/**
 * Test function to verify authentication.
 */
function testLinkedInAuth() {
  // Now uses the getter, so undefined reference error occurs.
  const token = getLinkedInAccessToken();
  if (!token) {
    Logger.log("No token found. Please check Script Properties.");
    return;
  }
  const urn = getLinkedInPersonUrn(token);
  Logger.log(`Authenticated as User URN: ${urn}`);
  return urn;
}


/**
 * Manual trigger to delete the last created post.
 */
function manualDeleteLastPost() {
  deleteLinkedInPost();
}


/**
 * Full lifecycle test: Posts "Hello World", waits 10s, then deletes it.
 */
function testLinkedInLifecycle() {
  Logger.log("--- Starting LinkedIn Lifecycle Test ---");

  // 1. Create Post
  const message = "Hello world - Integration Test " + new Date().toISOString();
  Logger.log(`1. Posting message: "${message}"`);
  const postId = postToLinkedIn(message);

  if (!postId) {
    Logger.log("ERROR: Failed to create post. Check logs.");
    return;
  }

  Logger.log(`2. Post created successfully. ID: ${postId}`);
  Logger.log("   (Check your LinkedIn profile now to see it)");

  // 2. Wait
  Logger.log("3. Waiting 10 seconds before deletion...");
  Utilities.sleep(10000);

  // 3. Delete Post
  Logger.log(`4. Deleting post ${postId}...`);
  deleteLinkedInPost(postId);

  Logger.log("--- Test Complete ---");
}

/**
 * DEBUG FUNCTION: Inspects the raw profile data.
 * Clears cache to ensure fresh fetch.
 */
function debugLinkedInProfile() {
  Logger.log("--- DEBUGGING LINKEDIN PROFILE ---");

  // 1. Clear Cache
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('LINKEDIN_PERSON_URN');
  Logger.log("Cleared cached URN.");

  const token = getLinkedInAccessToken();
  if (!token) {
    Logger.log("No token found.");
    return;
  }

  // 2. Try OIDC
  try {
    const url = `${LINKEDIN_API_BASE}/userinfo`;
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true
    });
    Logger.log(`OIDC /userinfo Response (${response.getResponseCode()}):`);
    Logger.log(response.getContentText());
  } catch (e) {
    Logger.log("OIDC Error: " + e.message);
  }

  // 3. Try Legacy /me
  try {
    const url = `${LINKEDIN_API_BASE}/me`;
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true
    });
    Logger.log(`Legacy /me Response (${response.getResponseCode()}):`);
    Logger.log(response.getContentText());
  } catch (e) {
    Logger.log("Legacy Error: " + e.message);
  }

  Logger.log("--- END DEBUG ---");
}
