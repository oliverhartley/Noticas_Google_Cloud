/**
 * @file LinkedIn Utils.js
 * @description Utilities for interacting with the LinkedIn API to post updates and manage posts.
 */

// TEMPORARY: Hardcoded token for immediate usage. 
// RECOMMENDATION: Move this to ScriptProperties for security (File > Project Properties > Script Properties).
const LINKEDIN_ACCESS_TOKEN = 'AQWQolO3KkBMuTVAD-S3LgX_eNHiEOFqyBhmwa39j7ldWvtsZd7uTgJlu2JWV2I9bZ_a3zYRK4MspDfYS4Xl8p6-bK6l4-lW3AatJFwM8njP7rM6Vm7eHFOGNvumbDRbOPwPQTyFT8r_hRfEe38FQGVk8581JIppknQ5VkwLpF35XcMiKKzw3GrcEfHBRzZeoGpRkDymsjkdYgINKO-aJYrlDmtYF_9JqnK9VZOGtz_167KJK7QD5hJWRcG5nMhNNfgIp-QIZBMJcAuiSqyz9ELfs_rIo0L5lHp2QVamuR-Da2UjRhG2dAXPczhxi5MV4jqzibaYhi5ghd5CPWGCfIcoqa-qwA';

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';

/**
 * Gets the authenticated user's LinkedIn Member URN (ID).
 * @param {string} accessToken - The LinkedIn OAuth2 access token.
 * @returns {string} The user's URN (e.g., 'urn:li:person:abcdef123').
 */
function getLinkedInPersonUrn(accessToken) {
  const token = accessToken || LINKEDIN_ACCESS_TOKEN;
  const url = `${LINKEDIN_API_BASE}/userinfo`;
  
  const options = {
    method: 'get',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Connection': 'Keep-Alive'
    },
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode === 200) {
      const data = JSON.parse(responseBody);
      // userinfo returns 'sub' as the URN
      return data.sub; 
    } else {
      Logger.log(`Error getting LinkedIn Profile: ${responseCode} - ${responseBody}`);
      throw new Error(`Failed to get LinkedIn Profile: ${responseBody}`);
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
  const token = LINKEDIN_ACCESS_TOKEN;
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
  const token = LINKEDIN_ACCESS_TOKEN;
  if (!token) return;

  // If no URN provided, try to get the last one
  if (!postUrn) {
    postUrn = PropertiesService.getScriptProperties().getProperty('LAST_LINKEDIN_POST_URN');
    if (!postUrn) {
      Logger.log('No post URN provided or found in cache.');
      return;
    }
  }

  // The ID returned by ugcPosts is like 'urn:li:ugcPost:123'. 
  // Should serve as the ID for deletion directly? 
  // According to docs, DELETE /ugcPosts/{ugcPostId}
  // We need to encode the URN if passing in URL, or just append it.
  
  // Actually, usually it's `https://api.linkedin.com/v2/ugcPosts/{urn}`
  // But we need to url-encode the URN? No, normally passed directly or encoded.
  // Let's try direct first. 
  // Actually, for some endpoints it's `posts/{id}` but this is legacy `ugcPosts`.
  
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
  const urn = getLinkedInPersonUrn(LINKEDIN_ACCESS_TOKEN);
  Logger.log(`Authenticated as User URN: ${urn}`);
  return urn;
}

/**
 * Manual trigger to delete the last created post.
 */
function manualDeleteLastPost() {
  deleteLinkedInPost();
}
