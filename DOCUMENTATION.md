# Google Cloud & Workspace News Automation

This project automates the process of gathering news, creating summaries, sending emails, and uploading video content for Google Cloud Platform (GCP) and Google Workspace (GWS).

## Purpose
The system is designed to:
1.  **Summarize News**: Automatically gather the latest news from GCP and GWS RSS feeds.
2.  **Create Google Docs**: Generate a Google Doc with formatted summaries.
3.  **Send Emails**: Send an email newsletter to a specified list of recipients with the summaries and a link to a YouTube video.
4.  **Automate YouTube**: Upload video content to YouTube, generate metadata (title, description, tags) using Gemini AI, and log the details to a Google Sheet.
5.  **Generate Blackboard Summaries**: Create a concise, blackboard-style text summary of the video using Gemini AI.

## Process Flow
1.  **News Gathering**: The system fetches news from RSS feeds.
2.  **Doc Creation**: A Google Doc is created/updated with the news items.
3.  **Video Upload (Manual)**: You upload a video to the designated Google Drive folder.
4.  **Video Processing**: The system detects the video, generates metadata via Gemini, uploads it to YouTube, and logs the URL to a Google Sheet.
5.  **Email Sending**: The system reads the Google Doc and the Google Sheet (for the video link), generates an email, and sends it.

## Script Breakdown

### News & Email
-   **`Resumen Noticias GCP.js`**: Handles GCP news gathering, Doc creation, and email sending.
-   **`Resumen Noticias GWS.js`**: Handles GWS news gathering, Doc creation, and email sending.
-   **`Email Utils.js`**: Shared utilities for email generation, Gemini phrase generation, and timestamp linkification.
-   **`Get GCP News.js` / `Get GWS News.js`**: Functions to fetch and parse RSS feeds.

### YouTube Automation
-   **`Youtube Automation.js`**: Core logic for video processing, Gemini integration, YouTube uploading, and Sheet logging.
-   **`Youtube Test.js`**: Test functions for YouTube integration.

### Other
-   **`Menu.js`**: Creates the custom "Blog Tools" menu in Google Sheets.
-   **`All Gcp.js` / `allGWS.js`**: Likely contains all-in-one execution scripts (check contents).

## Manual Execution Order
If you do not want to use the "Blog Tools" menu, you can run these functions manually from the Apps Script editor:

### For GCP:
1.  **Summarize & Send Email**: Run `summarizeArticlesGCP()` in `Resumen Noticias GCP.js`.
    *   *Note: This will create the Doc and send the email to the real list.*
2.  **Process Video**: Run `processAndUploadVideosGCP()` in `Youtube Automation.js`.
    *   *Note: Run this after uploading a video to the GCP source folder.*
3.  **Check Status (Optional)**: Run `checkVideoStatusGCP()` in `Youtube Automation.js`.

### For GWS:
1.  **Summarize & Send Email**: Run `summarizeArticlesGWS()` in `Resumen Noticias GWS.js`.
2.  **Process Video**: Run `processAndUploadVideosGWS()` in `Youtube Automation.js`.
3.  **Check Status (Optional)**: Run `checkVideoStatusGWS()` in `Youtube Automation.js`.

### Testing:
-   **Test GCP Email**: Run `sendTestEmailGCP()` in `Resumen Noticias GCP.js`.
-   **Test GWS Email**: Run `sendTestEmailGWS()` in `Resumen Noticias GWS.js`.

## Configuration
Ensure the following are set up:
-   **Script Properties**:
    -   `GEMINI_API_KEY`: Your Google AI Studio API key.
-   **Google Sheets**: The IDs for GCP and GWS Video Overview sheets must be correct in `Youtube Automation.js`.
-   **Google Drive Folders**: Source and Destination folder IDs must be correct in `Youtube Automation.js`.
