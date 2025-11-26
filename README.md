# Noticas Google Cloud - Apps Script Automation

This project contains a collection of Google Apps Script tools designed to automate the gathering, summarization, and publication of news from Google Cloud Platform (GCP) and Google Workspace (GWS) blogs, as well as automating YouTube video uploads.

## Project Overview

The application provides the following core functionalities:
1.  **GCP & GWS News Aggregation**: Automatically fetches and filters the latest news from official Google blogs and organizes them in a Google Sheet.
2.  **YouTube Automation**: Monitors a Google Drive folder for new videos, generates SEO-friendly metadata using the Gemini API, and uploads them to YouTube.

## File Structure

-   **`Menu.js`**: Sets up the custom "Blog Tools" menu in the Google Sheets UI.
-   **`Get GCP News.js`**: Fetches and processes RSS feeds from the Google Cloud Blog.
-   **`Get GWS News.js`**: Fetches and processes RSS feeds from the Google Workspace Updates Blog.
-   **`Youtube Automation.js`**: Handles video processing, metadata generation via Gemini API, and YouTube uploads.
-   **`appsscript.json`**: The manifest file defining project settings and dependencies.

## Key Components

### 1. Blog News Aggregation

The scripts fetch RSS feeds and filter posts based on predefined categories.

#### GCP News (`Get GCP News.js`)
-   **Source**: `https://cloudblog.withgoogle.com/rss`
-   **Sheet**: `GCP` (current news), `GCP Old` (archive for duplicate checking)
-   **Functionality**:
    -   Clears the 'GCP' sheet.
    -   Fetches latest posts for various categories (e.g., AI, Security, Kubernetes).
    -   Filters out duplicates already present in 'GCP Old'.
    -   Formats dates and saves to the sheet.

#### GWS News (`Get GWS News.js`)
-   **Source**: `https://workspaceupdates.googleblog.com/feeds/posts/default`
-   **Sheet**: `GWS` (current news), `GWS Old` (archive)
-   **Functionality**:
    -   Similar to GCP news, but tailored for Workspace categories.
    -   Automatically filters out "Weekly Recap" posts.

### 2. YouTube Automation (`Youtube Automation.js`)

Automates the workflow of uploading videos to YouTube with optimized metadata.

-   **Source Folder**: Monitors a specific Google Drive folder for `.mp4` files.
-   **Metadata Generation**: Uses the **Gemini API** to generate:
    -   SEO-friendly Title (Spanish)
    -   Detailed Description (Spanish)
    -   Tags and Hashtags
-   **Upload**: Uploads the video to YouTube with the generated metadata (set to 'private' by default).
-   **Post-Processing**: Moves the processed video to a destination folder.

## Setup & Configuration

### Prerequisites
1.  **Google Sheet**: Create a spreadsheet with the following sheets:
    -   `GCP`
    -   `GCP Old`
    -   `GWS`
    -   `GWS Old`
2.  **Google Drive Folders**: Create source and destination folders for YouTube videos and update the IDs in `Youtube Automation.js`.
3.  **Gemini API Key**: Obtain an API key from Google AI Studio and add it to the Apps Script project properties with the key `GEMINI_API_KEY`.
4.  **YouTube Data API**: Enable the YouTube Data API v3 in the Google Cloud Project associated with the Apps Script.

### Deployment
This project is managed using `clasp`.
```bash
# Clone the project
clasp clone "13qlr9iyIjZ7fTClN5KljDEuI4zuvO0u5uWRhv-4FXwjBibpjA_yJS1A9"

# Push changes
clasp push
```

## Usage
Once deployed, open the Google Sheet. You will see a new menu item **"Blog Tools"**.
-   **Get GCP Blog News**: Fetches and updates the GCP sheet.
-   **Get GWS Blog News**: Fetches and updates the GWS sheet.
-   **YouTube Automation**: Run the `processAndUploadVideos` function manually or set up a time-based trigger.
