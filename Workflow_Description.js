/**
 * @file Workflow_Description.js
 * @description This file provides a high-level overview of the news automation workflow
 * from fetching the latest news to sending the summarized email.
 * 
 * This file is for documentation purposes only and does not contain executable code.
 */

/**
 * ============================================================================
 * END-TO-END WORKFLOW DESCRIPTION
 * ============================================================================
 * 
 * The workflow consists of two main phases: Fetching News and Processing/Summarizing.
 * 
 * PHASE 1: Fetching News (Get GCP News.js)
 * -----------------------------------------
 * 1.  The script `getLatestGcpPosts` is triggered (usually on a schedule or manually).
 * 2.  It fetches the latest RSS feed from the Google Cloud Blog.
 * 3.  It parses the XML feed and extracts the latest posts for specific channels/categories.
 * 4.  It cleans the 'GCP' sheet in the spreadsheet and populates it with the new posts (Channel, Title, Link, Date).
 * 5.  It compares the links with posts in the 'GCP Old' sheet to remove any duplicates that have already been processed.
 * 
 * PHASE 2: Processing, Summarizing, and Emailing (Resumen Noticias GCP.js)
 * ----------------------------------------------------------------------
 * 1.  The script `summarizeArticlesGCP` is triggered.
 * 2.  It reads the list of new article links from the 'GCP' sheet.
 * 3.  It groups the articles by their 'Channel'.
 * 4.  It opens or creates a Google Document to store the summaries for the day.
 * 5.  For each article:
 *     a. It fetches the actual text content of the article to provide "grounding" for the AI.
 *     b. It calls the Gemini API (e.g., `gemini-2.5-flash`) with a prompt to generate a summary in Spanish, including a title and relevant emojis.
 *     c. It writes the title (with link) and the summary to the Google Document.
 * 6.  After processing all articles, it reads the 'GCP Video Overview' sheet to see if a video summary (e.g., from NotebookLM) is available.
 * 7.  It retrieves a random opening phrase from the 'Frases' sheet.
 * 8.  It constructs an HTML email body combining the opening phrase, video link (if any), image (if any), and the summaries from the Google Doc.
 * 9.  It fetches the recipient list (BCC) from the 'email' sheet and sends the email via `MailApp.sendEmail`.
 * 10. Optionally, it posts the update to LinkedIn.
 * 11. Finally, it moves the processed articles from the 'GCP' sheet to the 'GCP Old' sheet for archiving.
 */

/**
 * ============================================================================
 * MAIN FUNCTIONS DESCRIPTION
 * ============================================================================
 * 
 * Here is a brief description of the main functions involved in this workflow.
 * 
 * ----------------------------------------------------------------------------
 * File: Get GCP News.js
 * ----------------------------------------------------------------------------
 * 
 * - `getLatestGcpPosts()`:
 *   Fetches the latest posts from the Google Cloud Blog RSS feed, filters them by predefined channels,
 *   and writes the unique, formatted posts to the 'GCP' sheet. It also triggers deduplication.
 * 
 * - `removeDuplicateGcpPosts()`:
 *   Compares the posts in the current 'GCP' sheet against the 'GCP Old' sheet by URL link and deletes
 *   any rows in the 'GCP' sheet that have already been processed in the past.
 * 
 * ----------------------------------------------------------------------------
 * File: Resumen Noticias GCP.js
 * ----------------------------------------------------------------------------
 * 
 * - `summarizeArticlesGCP()`:
 *   The master orchestrator for the processing phase. It handles reading data, grouping, calling
 *   summarization, writing to the Doc, sending the email, posting to social media, and archiving rows.
 * 
 * - `getGeminiSummaryGCP(articleUrl)`:
 *   Fetches the full HTML content of the provided article URL, extracts the clean text, and calls
 *   the Gemini API to generate a structured summary. It ensures the AI sticks to the provided content.
 * 
 * - `sendEmailWithSummariesGCP(documentId, bccRecipients, isTest)`:
 *   Constructs the full HTML body for the email, combining the summaries generated in the Google Doc,
 *   video links, and images. It sends the email to the specified BCC recipients.
 * 
 * - `convertDocToHtmlGCP(documentId)`:
 *   A helper function that reads the structured content of the Google Doc (headings and bold titles with links)
 *   and converts it into clean HTML to be inserted into the email body.
 * 
 * - `createDraftEmailWithSummariesGCP(...)`:
 *   Similar to the email sending function, but instead of sending directly, it creates a draft in the
 *   user's Gmail account for manual review and sending.
 * 
 * - `saveEmailAsDraftGCP()`:
 *   An alternative orchestrator function that follows the same summarization flow but calls
 *   `createDraftEmailWithSummariesGCP` at the end instead of sending the email automatically.
 */
