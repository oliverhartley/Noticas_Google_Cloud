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
      return data.sub; // 'sub' is the URN in OIDC
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
      return `urn:li:person:${data.id}`;
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
function postToLinkedIn(message, linkUrl, linkTitle, linkDescription) {
  const token = getLinkedInAccessToken();
  if (!token) {
    Logger.log('No LinkedIn Access Token found.');
    return null;
  }

  try {
    const personUrn = getLinkedInPersonUrn(token);
    const url = `${LINKEDIN_API_BASE}/ugcPosts`;

    // Construct the request body for specificContent (Share)
    // See: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api
    
    const requestBody = {
      "author": personUrn,
      "lifecycleState": "PUBLISHED",
      "specificContent": {
        "com.linkedin.ugc.ShareContent": {
          "shareCommentary": {
            "text": message
          },
          "shareMediaCategory": "NONE"
        }
      },
      "visibility": {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
      }
    };

    // If there is a link, change media category to ARTICLE and add media
    if (linkUrl) {
      requestBody.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory = "ARTICLE";
      requestBody.specificContent["com.linkedin.ugc.ShareContent"].media = [
        {
          "status": "READY",
          "description": {
            "text": linkDescription || "News Update"
          },
          "originalUrl": linkUrl,
          "title": {
            "text": linkTitle || "Click to view"
          }
        }
      ];
    }

    const options = {
      method: 'post',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0'
      },
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode === 201) {
      const data = JSON.parse(responseBody);
      Logger.log(`Successfully posted to LinkedIn. ID: ${data.id}`);
      // Store the last post ID in script properties for easy deletion
      PropertiesService.getScriptProperties().setProperty('LAST_LINKEDIN_POST_URN', data.id);
      return data.id;
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
 * @param {string} postUrn - The URN of the post to delete (e.g. urn:li:share:123).
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

  const encodedUrn = encodeURIComponent(postUrn);
  const url = `${LINKEDIN_API_BASE}/ugcPosts/${encodedUrn}`;

  const options = {
    method: 'delete',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Restli-Protocol-Version': '2.0.0'
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
