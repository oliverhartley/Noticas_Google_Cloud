/**
 * @file Google Apps Script to summarize GWS articles, group by channel in a Google Doc, and email the content.
 * @author Gemini
 * @version 2.3 (Adds YouTube video link to email)
 */

// --- GWS Configuration ---
const GWS_SPREADSHEET_ID = '15-yneYsrmgkpJ5CGK57RVS9chMoV-ixw_w7hsPcaPuo'; // The ID of your Google Spreadsheet
const GWS_SHEET_NAME = 'GWS'; // The sheet with new links for GWS
const GWS_OLD_SHEET_NAME = 'GWS Old'; // The sheet where processed GWS links will be moved
const GWS_COLUMN_HEADER_LINK = 'Link'; // The header of the column containing article links
const GWS_COLUMN_HEADER_CHANNEL = 'Channel'; // The header of the column containing the channel name
const GWS_DOCUMENT_BASE_TITLE = 'Noticias GWS - '; // Base title for the new Google Document
const GWS_EMAIL_SUBJECT_BASE = '[GWS Readiness] - Noticias GWS'; // Base subject of the email
const GWS_VIDEO_SOURCE_FOLDER_ID = '1N_MgJYotvEEuyMQU3TA_9S6lQwFrfwuI'; // Source folder for videos and PNGs

/**
 * Main function to read GWS articles, group by channel, summarize, write to a Google Doc, and email.
 */
function summarizeArticlesGWS() {
  Logger.log('Starting the summarizeArticlesGWS script (v2.3)...');
  const ss = SpreadsheetApp.openById(GWS_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(GWS_SHEET_NAME);
  const oldSheet = ss.getSheetByName(GWS_OLD_SHEET_NAME);

  if (!sheet) {
    Logger.log(`Error: Sheet '${GWS_SHEET_NAME}' not found in the spreadsheet.`);
    return;
  }
  if (!oldSheet) {
    Logger.log(`Error: Sheet '${GWS_OLD_SHEET_NAME}' not found.`);
    return;
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getDisplayValues();
  
  if (values.length <= 1) {
    Logger.log('Info: No new article links found in GWS sheet. Exiting script.');
    return;
  }
  
  const headers = values[0];
  
  const linkColumnIndex = headers.indexOf(GWS_COLUMN_HEADER_LINK);
  const channelColumnIndex = headers.indexOf(GWS_COLUMN_HEADER_CHANNEL);

  if (linkColumnIndex === -1) {
    Logger.log(`Error: Column '${GWS_COLUMN_HEADER_LINK}' not found.`);
    return;
  }
  if (channelColumnIndex === -1) {
    Logger.log(`Error: Column '${GWS_COLUMN_HEADER_CHANNEL}' not found. Grouping requires this column.`);
    return;
  }

  const articlesToProcess = []; 
  const rowsToProcessIndices = [];
  const rowsToMoveData = [];

  for (let i = 1; i < values.length; i++) {
    const link = values[i][linkColumnIndex];
    let channel = values[i][channelColumnIndex];

    if (link && link.startsWith('http')) {
      if (!channel) channel = 'General';
      
      articlesToProcess.push({ link: link, channel: channel });
      rowsToProcessIndices.push(i + 1);
      rowsToMoveData.push(values[i]);
    }
  }

  if (articlesToProcess.length === 0) {
    Logger.log('Info: No processable article links found after filtering. Exiting script.');
    return;
  }

  Logger.log(`Found ${articlesToProcess.length} GWS articles to process.`);

  const groupedArticles = {};
  articlesToProcess.forEach(article => {
    if (!groupedArticles[article.channel]) {
      groupedArticles[article.channel] = [];
    }
    groupedArticles[article.channel].push(article.link);
  });

  const today = new Date();
  const docDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const docTitle = GWS_DOCUMENT_BASE_TITLE + docDate;
  let doc;
  let documentUrl = '';

  try {
    const docs = DriveApp.getFilesByName(docTitle);
    if (docs.hasNext()) {
      doc = DocumentApp.openById(docs.next().getId());
      doc.getBody().clear();
      Logger.log(`Opened and cleared existing GWS document: ${docTitle}`);
    } else {
      doc = DocumentApp.create(docTitle);
      Logger.log(`Created new GWS document: ${docTitle}`);
    }
    documentUrl = doc.getUrl();
  } catch (e) {
    Logger.log(`FATAL ERROR: Failed to create or open Google Document for GWS: ${e.message}`);
    return;
  }

  const body = doc.getBody();
  const sortedChannels = Object.keys(groupedArticles).sort();

  for (const channel of sortedChannels) {
    body.appendParagraph(`Noticias ${channel}`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
    Logger.log(`Processing GWS channel: ${channel}`);
    const linksInChannel = groupedArticles[channel];

    for (const articleLink of linksInChannel) {
      try {
        const geminiResponse = getGeminiSummaryGWS(articleLink);
        const parts = geminiResponse.split('\n');
        const title = parts.shift().replace(/^\*+\s*|\s*\*+$/g, '').trim();
        const summary = parts.join('\n').trim();

        if (title) {
          const titleText = body.appendParagraph(title).editAsText();
          titleText.setBold(true);
          titleText.setFontSize(12);
          titleText.setLinkUrl(articleLink);
          if (summary) {
            body.appendParagraph(summary).editAsText().setBold(false).setFontSize(11);
          }
        } else {
          body.appendParagraph("Summary").editAsText().setLinkUrl(articleLink);
          body.appendParagraph(geminiResponse);
        }
        Logger.log(`-- Summarized GWS link: ${articleLink}`);
      } catch (e) {
        Logger.log(`Error summarizing ${articleLink}: ${e.message}`);
        body.appendParagraph(`Error summarizing article:`);
        body.appendParagraph(articleLink).editAsText().setLinkUrl(articleLink);
        body.appendParagraph(e.message);
      }
      body.appendParagraph(""); 
      Utilities.sleep(2000);
    }
  }

  doc.saveAndClose();
  Logger.log(`Finished updating GWS Google Doc. URL: ${documentUrl}`);

  // --- Email ---
  const emailDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'dd MMM');
  const dynamicSubject = `${GWS_EMAIL_SUBJECT_BASE} ${emailDate}`;

  const FALLBACK_PHRASE = 'Hola todos, les adjunto las ultimas noticias de Google Workspace.';
  const randomPhraseObject = getRandomPhraseGWS(ss);
  const openingPhraseHtml = randomPhraseObject ? convertRichTextToHtmlGWS(randomPhraseObject) : FALLBACK_PHRASE;

  const emailSheet = ss.getSheetByName('email');
  if (!emailSheet) {
    Logger.log(`ERROR: Sheet 'email' not found. Cannot send email.`);
  } else {
    // Default to GWS list, but can be overridden for testing
    const bccString = getEmailList('GWS'); 
    
    if (bccString) {
      const validEmails = validateEmails(bccString);

      if (validEmails.length > 0) {
        const finalBccList = validEmails.join(',');
        const emailSent = sendEmailWithSummariesGWS(doc.getId(), finalBccList);
        
        let successMessage = `SUCCESS: GWS Summaries added to Google Document.`;
        if (emailSent) {
          successMessage += ` Email sent.`;
        } else {
          successMessage += ` FAILED to send email.`;
        }
        Logger.log(successMessage);
      } else {
        Logger.log('Warning: No valid BCC recipients found for GWS. Skipping email send.');
      }
    } else {
      Logger.log('Warning: No BCC recipients found for GWS. Skipping email send.');
    }
  }

  // --- LinkedIn Post ---
  Logger.log('Starting LinkedIn Post for GWS...');
  const videoSheet = ss.getSheetByName('GWS Video Overview');
  let videoLink = '';
  let videoTitle = 'Noticias GWS';
  let videoDescription = 'Resumen de noticias de Google Workspace.';

  if (videoSheet) {
    const lastRow = videoSheet.getLastRow();
    if (lastRow > 0) {
      videoLink = videoSheet.getRange('A' + lastRow).getDisplayValue().trim();
      const titleFromSheet = videoSheet.getRange('E' + lastRow).getDisplayValue().trim();
      const descFromSheet = videoSheet.getRange('F' + lastRow).getDisplayValue().trim();

      if (titleFromSheet) videoTitle = titleFromSheet;
      if (descFromSheet) videoDescription = descFromSheet;
    }
  }

  const openingPhraseText = randomPhraseObject ? randomPhraseObject.getText() : FALLBACK_PHRASE;
  const linkedInMessage = `${openingPhraseText}\n\nCheck out the latest Google Workspace news update!`;

  if (videoLink) {
    const postId = postToLinkedIn(linkedInMessage, videoLink, videoTitle, videoDescription);
    if (postId) {
      Logger.log('Successfully posted to LinkedIn: ' + postId);
    } else {
      Logger.log('Failed to post to LinkedIn.');
    }
  } else {
    Logger.log('No video link found for LinkedIn post. Skipping.');
  }

  // --- Archive Rows ---
  if (rowsToMoveData.length > 0) {
    const lastRowOldSheet = oldSheet.getLastRow();
    oldSheet.getRange(lastRowOldSheet + 1, 1, rowsToMoveData.length, rowsToMoveData[0].length).setValues(rowsToMoveData);
    
    for (let i = rowsToProcessIndices.length - 1; i >= 0; i--) {
      sheet.deleteRow(rowsToProcessIndices[i]);
    }
    Logger.log(`Moved and deleted ${rowsToMoveData.length} rows from GWS sheet.`);
  }
  
  Logger.log('GWS Summarizer Script finished.');
}


// --- GWS HELPER FUNCTIONS ---


/**
 * Converts a RichTextValue object into a simple HTML string for GWS.
 */
function convertRichTextToHtmlGWS(richTextValue) {
  if (!richTextValue) return '';
  let html = '';
  const runs = richTextValue.getRuns();
  for (const run of runs) {
    const text = run.getText();
    const isBold = run.getTextStyle().isBold();
    if (isBold) {
      html += `<b>${text}</b>`;
    } else {
      html += text;
    }
  }
  return html;
}

/**
 * Retrieves a random phrase from the 'Frases_GWS' sheet as a RichTextValue object for GWS.
 */
function getRandomPhraseGWS(spreadsheet) {
  const PHRASE_SHEET_NAME = 'Frases_GWS'; // Using the GWS-specific sheet name
  const PHRASE_RANGE = 'A1:A10';
  
  try {
    const phraseSheet = spreadsheet.getSheetByName(PHRASE_SHEET_NAME);
    if (!phraseSheet) {
      Logger.log(`Warning: Sheet '${PHRASE_SHEET_NAME}' not found.`);
      return null;
    }

    const phrases = phraseSheet.getRange(PHRASE_RANGE).getRichTextValues()
                               .flat()
                               .filter(rt => rt.getText().trim() !== '');

    if (phrases.length === 0) {
      Logger.log(`Warning: No phrases found in '${PHRASE_SHEET_NAME}'!${PHRASE_RANGE}.`);
      return null;
    }

    const randomIndex = Math.floor(Math.random() * phrases.length);
    const selectedPhrase = phrases[randomIndex];
    Logger.log(`Selected GWS phrase: "${selectedPhrase.getText()}"`);
    return selectedPhrase;
  } catch (e) {
    Logger.log(`Error getting random GWS phrase: ${e.message}.`);
    return null;
  }
}

/**
 * Retrieves content, appends a signature, and sends GWS email to a BCC list.
 */
/**
 * Retrieves content, appends a signature, and sends GWS email to a BCC list.
 * Refactored to use Gemini-generated content and new structure.
 */
function sendEmailWithSummariesGWS(documentId, bccRecipients, isTest = false) {
  try {
    const ss = SpreadsheetApp.openById(GWS_SPREADSHEET_ID);

    // 1. Get Video Info
    const videoSheet = ss.getSheetByName('GWS Video Overview');
    let videoLink = '';
    let videoTitle = 'Noticias GWS';
    let videoDescription = 'Resumen de noticias de Google Workspace.';

    if (videoSheet) {
      const lastRow = videoSheet.getLastRow();
      if (lastRow > 0) {
        videoLink = videoSheet.getRange('A' + lastRow).getDisplayValue().trim();
        const titleFromSheet = videoSheet.getRange('E' + lastRow).getDisplayValue().trim();
        const descFromSheet = videoSheet.getRange('F' + lastRow).getDisplayValue().trim();

        if (titleFromSheet) videoTitle = titleFromSheet;
        if (descFromSheet) videoDescription = descFromSheet;
      }
    }

    // 2. Generate Gemini Phrases
    const phrases = generateEmailPhrases(videoTitle, videoDescription, 'GWS');

    // 3. Prepare Subject
    const subject = `[Readiness GWS] - ${videoTitle}`;

    // 4. Build Email Body
    let htmlBody = `<div style="font-family: Arial, sans-serif; font-size: 11pt; color: #3c4043;">`;
    htmlBody += `<p>Hola Todos.</p>`;
    htmlBody += `<p>${phrases.opening}</p>`;

    if (videoLink) {
      htmlBody += `<p><strong>Resumen de noticias:</strong> <a href="${videoLink}">Ver video</a></p>`;
      htmlBody += `<p><strong style="color: #34A853;">Suscríbete a nuestro canal de YouTube y mantente siempre un paso adelante en tecnología.</strong></p>`;
      if (videoDescription) {
        let cleanDescription = removeHashtags(videoDescription);
        const linkifiedDescription = linkifyTimestamps(cleanDescription, videoLink);
        htmlBody += `<p>${linkifiedDescription.replace(/\n/g, '<br>')}</p>`;
      }
    }

    // 5. Add PNG Image if available
    const pngBlob = getLatestPngFromFolder(GWS_VIDEO_SOURCE_FOLDER_ID);
    const inlineImages = {};
    if (pngBlob) {
      inlineImages['summaryImage'] = pngBlob;
      htmlBody += `<br><div style="text-align: center;"><img src="cid:summaryImage" style="max-width: 80%; height: auto; border: 1px solid #ddd; border-radius: 8px;"></div>`;
    }

    htmlBody += `<br><p><strong>Para más detalles, aquí están las noticias del blog:</strong></p>`;

    // 6. Add Article Summaries from Doc (Links Only)
    htmlBody += getHtmlContentFromDocGWS(documentId);

    htmlBody += `<br><p>${phrases.closing}</p>`;

    const signatureHtml = `
      <div style="font-family: Arial, sans-serif; font-size: 10pt; color: #5f6368; margin-top: 20px;">
        --<br>
        Oliver Hartley Lyon<br>
        Google Cloud and Workspace Partner Engineer<br>
        oliverhartley@google.com
      </div>
    `;
    
    htmlBody += signatureHtml;
    htmlBody += `</div>`;

    MailApp.sendEmail({
      bcc: bccRecipients,
      subject: subject,
      htmlBody: htmlBody,
      inlineImages: Object.keys(inlineImages).length > 0 ? inlineImages : null
    });
    Logger.log(`Successfully sent GWS email to: ${bccRecipients}`);
    return true;
  } catch (e) {
    Logger.log(`GWS EMAIL ERROR: Failed to send email: ${e.message}`);
    return false;
  }
}

// Helper function to get YouTube title is no longer needed but kept for fallback if wanted, 
// but we are now using the sheet. Removing it to clean up.

function sendTestEmailGWS() {
  const ss = SpreadsheetApp.openById(GWS_SPREADSHEET_ID);
  const today = new Date();
  const docDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const docTitle = GWS_DOCUMENT_BASE_TITLE + docDate;
  const docs = DriveApp.getFilesByName(docTitle);
  let docId = '';
  if (docs.hasNext()) {
    docId = docs.next().getId();
  } else {
    // Try to find the most recent GWS doc if today's doesn't exist
    const searchDocs = DriveApp.searchFiles(`name contains '${GWS_DOCUMENT_BASE_TITLE}' and mimeType = 'application/vnd.google-apps.document'`);
    let files = [];
    while (searchDocs.hasNext()) {
      files.push(searchDocs.next());
    }
    if (files.length > 0) {
      files.sort((a, b) => b.getLastUpdated().getTime() - a.getLastUpdated().getTime());
      docId = files[0].getId();
    } else {
      const doc = DocumentApp.create(docTitle + ' TEST');
      doc.getBody().appendParagraph('Noticias Test GWS').setHeading(DocumentApp.ParagraphHeading.HEADING1);
      doc.getBody().appendParagraph('Título de Prueba GWS').setBold(true).setLinkUrl('https://google.com');
      doc.getBody().appendParagraph('Resumen de prueba GWS.');
      docId = doc.getId();
    }
  }

  const bccString = getEmailList('Testing');
  if (bccString) {
    const validEmails = validateEmails(bccString);
    if (validEmails.length > 0) {
      sendEmailWithSummariesGWS(docId, validEmails.join(','), true);
      Logger.log('Test email sent to: ' + validEmails.join(','));
    } else {
      Logger.log('No valid emails in Testing list.');
    }
  } else {
    Logger.log('Testing list empty or not found.');
  }
}

/**
 * Helper function to parse a GWS Google Doc and convert its content to an HTML string.
 */
function getHtmlContentFromDocGWS(documentId, openingPhraseHtml) {
  let htmlContent = ""; // Start with empty, we build it in calling function

    const doc = DocumentApp.openById(documentId);
    const body = doc.getBody();
    
    for (let i = 0; i < body.getNumChildren(); i++) {
        const child = body.getChild(i);
        const type = child.getType();

        if (type === DocumentApp.ElementType.PARAGRAPH) {
            const p = child.asParagraph();
          const textElement = p.editAsText();
            const text = p.getText();
            if (text.trim().length === 0) continue; 

            const heading = p.getHeading();
            
            if (heading === DocumentApp.ParagraphHeading.HEADING1) {
                htmlContent += `<h2 style="color: #202124; border-bottom: 1px solid #e0e0e0; padding-bottom: 5px; margin-top: 20px;">${text}</h2>`;
                continue;
            }

          // Check first character for bold/link to determine if it's a title
          // This is more robust than checking the whole paragraph
          const isBold = textElement.isBold(0);
          const linkUrl = textElement.getLinkUrl(0);

            let style = 'padding: 0;';
          if (isBold || linkUrl) {
              // Treat as Title - KEEP
              style += ' font-weight: bold; margin: 10px 0 0 0; color: #1a73e8; font-size: 12pt;';
              let elementHtml = `<p style="${style}">`;
                elementHtml += `<a href="${linkUrl}" style="text-decoration: none; color: #1a73e8;">${text}</a>`;
              elementHtml += '</p>';
              htmlContent += elementHtml;
            } else {
              // Treat as Description - SKIP
              continue;
            }

        } else if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
            htmlContent += "<hr style='border: 0; border-top: 1px solid #eee;'>";
        }
    }
    return htmlContent;
}


// --- GWS GEMINI AND CONTENT FUNCTIONS ---


/**
 * Extracts the main text from HTML content.
 */
function getTextFromHtmlGWS(htmlContent) {
  let text = htmlContent.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  text = text.replace(/(\r\n|\n|\r){2,}/gm, '\n').trim();
  
  const MAX_LENGTH = 300000;
  if (text.length > MAX_LENGTH) {
    text = text.substring(0, MAX_LENGTH) + '... [CONTENT TRUNCADO]';
  }
  
  return text;
}


/**
 * Calls the Gemini API to get a summary of an article's content, grounded to the actual post.
 */
function getGeminiSummaryGWS(articleUrl) {
  const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in Script Properties.');
  }

  const API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY;
  
  let articleText;
  try {
    const articleResponse = UrlFetchApp.fetch(articleUrl, { muteHttpExceptions: true });
    const responseCode = articleResponse.getResponseCode();
    
    if (responseCode === 200) {
      const htmlContent = articleResponse.getContentText();
      articleText = getTextFromHtmlGWS(htmlContent);
    } else {
      throw new Error(`Failed to fetch URL content. Status code: ${responseCode}`);
    }
    
    if (!articleText || articleText.length < 100) {
        throw new Error('Could not extract enough content from the article to summarize.');
    }

  } catch (e) {
    Logger.log(`Error fetching or processing the article ${articleUrl}: ${e.message}`);
    return `*Error Processing Article*\nCould not read the URL content. Reason: ${e.message}`;
  }

  const prompt = `You are an expert in Google Workspace productivity and collaboration tools. Below is the text from an article.
  
  **Instructions:**
  1.  Create a short, engaging, and bolded title for the article in a single line.
  2.  On the next line, write a concise summary in a single paragraph (between 50 and 70 words) in Spanish.
  3.  The summary must focus on the main topic and key takeaways from the provided text.
  4.  Add 2 or 3 relevant emojis at the end of the summary.
  5.  **IMPORTANT**: Base your response exclusively on the following text. Do not invent information or use external knowledge.

  **Article Text:**
  ---
  ${articleText}`;

  const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const MAX_RETRIES = 3;
  let delay = 1000; 

  for (let i = 0; i < MAX_RETRIES; i++) {
    const response = UrlFetchApp.fetch(API_ENDPOINT, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode === 200) {
      const jsonResponse = JSON.parse(responseBody);
      if (jsonResponse.candidates && jsonResponse.candidates[0]?.content?.parts[0]?.text) {
        return jsonResponse.candidates[0].content.parts[0].text; 
      } else {
        const blockReason = jsonResponse.promptFeedback?.blockReason || 'Unexpected response structure';
        Logger.log(`API response was OK but content was missing. Reason: ${blockReason}. Body: ${responseBody}`);
        throw new Error(`The API returned no content. Reason: ${blockReason}`);
      }
    } else if (responseCode === 429 || responseCode === 503) {
      Logger.log(`Attempt ${i + 1} of ${MAX_RETRIES} failed with code ${responseCode}. Retrying in ${delay / 1000}s...`);
      if (i < MAX_RETRIES - 1) { 
        Utilities.sleep(delay);
        delay *= 2; 
      }
    } else {
      Logger.log(`Gemini API Error: ${responseBody}`);
      throw new Error(`API call failed with code ${responseCode}: ${responseBody}`);
    }
  }

  throw new Error(`Gemini API call failed after ${MAX_RETRIES} attempts for URL: ${articleUrl}`);
}

// // Funciona Perfecto sin agregar vidseo de youtube

// /**
//  * @file Google Apps Script to summarize GWS articles, group by channel in a Google Doc, and email the content.
//  * @author Gemini
//  * @version 2.2 (Separate Phrases Sheet)
//  */

// // --- GWS Configuration ---
// const GWS_SPREADSHEET_ID = '15-yneYsrmgkpJ5CGK57RVS9chMoV-ixw_w7hsPcaPuo'; // The ID of your Google Spreadsheet
// const GWS_SHEET_NAME = 'GWS'; // The sheet with new links for GWS
// const GWS_OLD_SHEET_NAME = 'GWS Old'; // The sheet where processed GWS links will be moved
// const GWS_COLUMN_HEADER_LINK = 'Link'; // The header of the column containing article links
// const GWS_COLUMN_HEADER_CHANNEL = 'Channel'; // The header of the column containing the channel name
// const GWS_DOCUMENT_BASE_TITLE = 'Noticias GWS - '; // Base title for the new Google Document
// const GWS_EMAIL_SUBJECT_BASE = '[GWS Readiness] - Noticias GWS'; // Base subject of the email

// /**
//  * Main function to read GWS articles, group by channel, summarize, write to a Google Doc, and email.
//  */
// function summarizeArticlesGWS() {
//   Logger.log('Starting the summarizeArticlesGWS script (v2.2)...');
//   const ss = SpreadsheetApp.openById(GWS_SPREADSHEET_ID);
//   const sheet = ss.getSheetByName(GWS_SHEET_NAME);
//   const oldSheet = ss.getSheetByName(GWS_OLD_SHEET_NAME);

//   if (!sheet) {
//     Logger.log(`Error: Sheet '${GWS_SHEET_NAME}' not found in the spreadsheet.`);
//     return;
//   }
//   if (!oldSheet) {
//     Logger.log(`Error: Sheet '${GWS_OLD_SHEET_NAME}' not found.`);
//     return;
//   }

//   const dataRange = sheet.getDataRange();
//   const values = dataRange.getDisplayValues();
  
//   if (values.length <= 1) {
//     Logger.log('Info: No new article links found in GWS sheet. Exiting script.');
//     return;
//   }
  
//   const headers = values[0];
  
//   const linkColumnIndex = headers.indexOf(GWS_COLUMN_HEADER_LINK);
//   const channelColumnIndex = headers.indexOf(GWS_COLUMN_HEADER_CHANNEL);

//   if (linkColumnIndex === -1) {
//     Logger.log(`Error: Column '${GWS_COLUMN_HEADER_LINK}' not found.`);
//     return;
//   }
//   if (channelColumnIndex === -1) {
//     Logger.log(`Error: Column '${GWS_COLUMN_HEADER_CHANNEL}' not found. Grouping requires this column.`);
//     return;
//   }

//   const articlesToProcess = []; 
//   const rowsToProcessIndices = [];
//   const rowsToMoveData = [];

//   for (let i = 1; i < values.length; i++) {
//     const link = values[i][linkColumnIndex];
//     let channel = values[i][channelColumnIndex];

//     if (link && link.startsWith('http')) {
//       if (!channel) channel = 'General';
      
//       articlesToProcess.push({ link: link, channel: channel });
//       rowsToProcessIndices.push(i + 1);
//       rowsToMoveData.push(values[i]);
//     }
//   }

//   if (articlesToProcess.length === 0) {
//     Logger.log('Info: No processable article links found after filtering. Exiting script.');
//     return;
//   }

//   Logger.log(`Found ${articlesToProcess.length} GWS articles to process.`);

//   const groupedArticles = {};
//   articlesToProcess.forEach(article => {
//     if (!groupedArticles[article.channel]) {
//       groupedArticles[article.channel] = [];
//     }
//     groupedArticles[article.channel].push(article.link);
//   });

//   const today = new Date();
//   const docDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
//   const docTitle = GWS_DOCUMENT_BASE_TITLE + docDate;
//   let doc;
//   let documentUrl = '';

//   try {
//     const docs = DriveApp.getFilesByName(docTitle);
//     if (docs.hasNext()) {
//       doc = DocumentApp.openById(docs.next().getId());
//       doc.getBody().clear();
//       Logger.log(`Opened and cleared existing GWS document: ${docTitle}`);
//     } else {
//       doc = DocumentApp.create(docTitle);
//       Logger.log(`Created new GWS document: ${docTitle}`);
//     }
//     documentUrl = doc.getUrl();
//   } catch (e) {
//     Logger.log(`FATAL ERROR: Failed to create or open Google Document for GWS: ${e.message}`);
//     return;
//   }

//   const body = doc.getBody();
//   const sortedChannels = Object.keys(groupedArticles).sort();

//   for (const channel of sortedChannels) {
//     body.appendParagraph(`Noticias ${channel}`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
//     Logger.log(`Processing GWS channel: ${channel}`);
//     const linksInChannel = groupedArticles[channel];

//     for (const articleLink of linksInChannel) {
//       try {
//         const geminiResponse = getGeminiSummaryGWS(articleLink);
//         const parts = geminiResponse.split('\n');
//         const title = parts.shift().replace(/^\*+\s*|\s*\*+$/g, '').trim();
//         const summary = parts.join('\n').trim();

//         if (title) {
//           const titleText = body.appendParagraph(title).editAsText();
//           titleText.setBold(true);
//           titleText.setFontSize(12);
//           titleText.setLinkUrl(articleLink);
//           if (summary) {
//             body.appendParagraph(summary).editAsText().setBold(false).setFontSize(11);
//           }
//         } else {
//           body.appendParagraph("Summary").editAsText().setLinkUrl(articleLink);
//           body.appendParagraph(geminiResponse);
//         }
//         Logger.log(`-- Summarized GWS link: ${articleLink}`);
//       } catch (e) {
//         Logger.log(`Error summarizing ${articleLink}: ${e.message}`);
//         body.appendParagraph(`Error summarizing article:`);
//         body.appendParagraph(articleLink).editAsText().setLinkUrl(articleLink);
//         body.appendParagraph(e.message);
//       }
//       body.appendParagraph(""); 
//       Utilities.sleep(2000);
//     }
//   }

//   doc.saveAndClose();
//   Logger.log(`Finished updating GWS Google Doc. URL: ${documentUrl}`);

//   // --- Email ---
//   const emailDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'dd MMM');
//   const dynamicSubject = `${GWS_EMAIL_SUBJECT_BASE} ${emailDate}`;

//   const FALLBACK_PHRASE = 'Hola todos, les adjunto las ultimas noticias de Google Workspace.';
//   const randomPhraseObject = getRandomPhraseGWS(ss);
//   const openingPhraseHtml = randomPhraseObject ? convertRichTextToHtmlGWS(randomPhraseObject) : FALLBACK_PHRASE;

//   const emailSheet = ss.getSheetByName('email');
//   if (!emailSheet) {
//     Logger.log(`ERROR: Sheet 'email' not found. Cannot send email.`);
//   } else {
//     const bccString = emailSheet.getRange('B2').getDisplayValue().trim();
    
//     if (bccString) {
//       const allEmails = bccString.split(',');
//       const validEmails = [];
//       const invalidEmails = [];
//       const emailRegex = /.+@.+\..+/; 
      
//       for (const email of allEmails) {
//         const trimmedEmail = email.trim();
//         if (trimmedEmail) {
//           if (emailRegex.test(trimmedEmail)) {
//             validEmails.push(trimmedEmail);
//           } else {
//             invalidEmails.push(trimmedEmail);
//           }
//         }
//       }

//       if (invalidEmails.length > 0) {
//         Logger.log(`Warning: Found and skipped the following invalid email addresses: ${invalidEmails.join(', ')}`);
//       }

//       if (validEmails.length > 0) {
//         const finalBccList = validEmails.join(',');
//         const emailSent = sendEmailWithSummariesGWS(doc.getId(), finalBccList, dynamicSubject, openingPhraseHtml);
        
//         let successMessage = `SUCCESS: GWS Summaries added to Google Document.`;
//         if (emailSent) {
//           successMessage += ` Email sent.`;
//         } else {
//           successMessage += ` FAILED to send email.`;
//         }
//         Logger.log(successMessage);
//       } else {
//         Logger.log('Warning: No valid BCC recipients found after filtering the list from email!B2. Skipping email send.');
//       }
//     } else {
//       Logger.log('Warning: No BCC recipients found in email!B2. Skipping email send.');
//     }
//   }

//   // --- Archive Rows ---
//   if (rowsToMoveData.length > 0) {
//     const lastRowOldSheet = oldSheet.getLastRow();
//     oldSheet.getRange(lastRowOldSheet + 1, 1, rowsToMoveData.length, rowsToMoveData[0].length).setValues(rowsToMoveData);
    
//     for (let i = rowsToProcessIndices.length - 1; i >= 0; i--) {
//       sheet.deleteRow(rowsToProcessIndices[i]);
//     }
//     Logger.log(`Moved and deleted ${rowsToMoveData.length} rows from GWS sheet.`);
//   }
  
//   Logger.log('GWS Summarizer Script finished.');
// }


// // --- GWS HELPER FUNCTIONS ---


// /**
//  * Converts a RichTextValue object into a simple HTML string for GWS.
//  */
// function convertRichTextToHtmlGWS(richTextValue) {
//   if (!richTextValue) return '';
//   let html = '';
//   const runs = richTextValue.getRuns();
//   for (const run of runs) {
//     const text = run.getText();
//     const isBold = run.getTextStyle().isBold();
//     if (isBold) {
//       html += `<b>${text}</b>`;
//     } else {
//       html += text;
//     }
//   }
//   return html;
// }

// /**
//  * Retrieves a random phrase from the 'Frases_GWS' sheet as a RichTextValue object for GWS.
//  */
// function getRandomPhraseGWS(spreadsheet) {
//   const PHRASE_SHEET_NAME = 'Frases_GWS'; // Using the GWS-specific sheet name
//   const PHRASE_RANGE = 'A1:A10';
  
//   try {
//     const phraseSheet = spreadsheet.getSheetByName(PHRASE_SHEET_NAME);
//     if (!phraseSheet) {
//       Logger.log(`Warning: Sheet '${PHRASE_SHEET_NAME}' not found.`);
//       return null;
//     }

//     const phrases = phraseSheet.getRange(PHRASE_RANGE).getRichTextValues()
//                                .flat()
//                                .filter(rt => rt.getText().trim() !== '');

//     if (phrases.length === 0) {
//       Logger.log(`Warning: No phrases found in '${PHRASE_SHEET_NAME}'!${PHRASE_RANGE}.`);
//       return null;
//     }

//     const randomIndex = Math.floor(Math.random() * phrases.length);
//     const selectedPhrase = phrases[randomIndex];
//     Logger.log(`Selected GWS phrase: "${selectedPhrase.getText()}"`);
//     return selectedPhrase;
//   } catch (e) {
//     Logger.log(`Error getting random GWS phrase: ${e.message}.`);
//     return null;
//   }
// }

// /**
//  * Retrieves content, appends a signature, and sends GWS email to a BCC list.
//  */
// function sendEmailWithSummariesGWS(documentId, bccRecipients, subject, openingPhraseHtml) {
//   try {
//     let htmlBody = getHtmlContentFromDocGWS(documentId, openingPhraseHtml);

//     const signatureHtml = `
//       <div style="font-family: Arial, sans-serif; font-size: 10pt; color: #5f6368; margin-top: 20px;">
//         --<br>
//         Oliver Hartley Lyon<br>
//         Google Cloud and Workspace Partner Engineer<br>
//         oliverhartley@google.com
//       </div>
//     `;
    
//     htmlBody += signatureHtml;

//     MailApp.sendEmail({
//       bcc: bccRecipients,
//       subject: subject,
//       htmlBody: htmlBody
//     });
//     Logger.log(`Successfully sent GWS email via BCC to: ${bccRecipients}`);
//     return true;
//   } catch (e) {
//     Logger.log(`GWS EMAIL ERROR: Failed to send email: ${e.message}`);
//     return false;
//   }
// }

// /**
//  * Helper function to parse a GWS Google Doc and convert its content to an HTML string.
//  */
// function getHtmlContentFromDocGWS(documentId, openingPhraseHtml) {
//     const doc = DocumentApp.openById(documentId);
//     const body = doc.getBody();
//     let htmlContent = `<div style="font-family: Arial, sans-serif; font-size: 11pt;">${openingPhraseHtml}<br><br>`;

//     for (let i = 0; i < body.getNumChildren(); i++) {
//         const child = body.getChild(i);
//         const type = child.getType();

//         if (type === DocumentApp.ElementType.PARAGRAPH) {
//             const p = child.asParagraph();
//             const text = p.getText();
//             if (text.trim().length === 0) continue; 

//             const heading = p.getHeading();
            
//             if (heading === DocumentApp.ParagraphHeading.HEADING1) {
//                 htmlContent += `<h2 style="color: #202124; border-bottom: 1px solid #e0e0e0; padding-bottom: 5px; margin-top: 20px;">${text}</h2>`;
//                 continue;
//             }

//             const textElement = p.editAsText();
//             const isBold = textElement.isBold();
//             const linkUrl = textElement.getLinkUrl();

//             let style = 'padding: 0;';
//             if (isBold) {
//                 style += ' font-weight: bold; margin: 10px 0 0 0; color: #1a73e8; font-size: 12pt;';
//             } else {
//                 style += ' font-weight: normal; margin: 0 0 10px 0; color: #3c4043; font-size: 11pt;';
//             }

//             let elementHtml = `<p style="${style}">`;
//             if (linkUrl && isBold) {
//                 elementHtml += `<a href="${linkUrl}" style="text-decoration: none; color: #1a73e8;">${text}</a>`;
//             } else {
//                 elementHtml += text;
//             }
//             elementHtml += '</p>';
//             htmlContent += elementHtml;

//         } else if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
//             htmlContent += "<hr style='border: 0; border-top: 1px solid #eee;'>";
//         }
//     }
//     htmlContent += "</div>";
//     return htmlContent;
// }


// // --- GWS GEMINI AND CONTENT FUNCTIONS ---


// /**
//  * Extracts the main text from HTML content.
//  */
// function getTextFromHtmlGWS(htmlContent) {
//   let text = htmlContent.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
//   text = text.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
//   text = text.replace(/<[^>]+>/g, '');
//   text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
//   text = text.replace(/(\r\n|\n|\r){2,}/gm, '\n').trim();
  
//   const MAX_LENGTH = 300000;
//   if (text.length > MAX_LENGTH) {
//     text = text.substring(0, MAX_LENGTH) + '... [CONTENT TRUNCADO]';
//   }
  
//   return text;
// }


// /**
//  * Calls the Gemini API to get a summary of an article's content, grounded to the actual post.
//  */
// function getGeminiSummaryGWS(articleUrl) {
//   const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
//   if (!GEMINI_API_KEY) {
//     throw new Error('GEMINI_API_KEY is not set in Script Properties.');
//   }

//   const API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY;
  
//   let articleText;
//   try {
//     const articleResponse = UrlFetchApp.fetch(articleUrl, { muteHttpExceptions: true });
//     const responseCode = articleResponse.getResponseCode();
    
//     if (responseCode === 200) {
//       const htmlContent = articleResponse.getContentText();
//       articleText = getTextFromHtmlGWS(htmlContent);
//     } else {
//       throw new Error(`Failed to fetch URL content. Status code: ${responseCode}`);
//     }
    
//     if (!articleText || articleText.length < 100) {
//         throw new Error('Could not extract enough content from the article to summarize.');
//     }

//   } catch (e) {
//     Logger.log(`Error fetching or processing the article ${articleUrl}: ${e.message}`);
//     return `*Error Processing Article*\nCould not read the URL content. Reason: ${e.message}`;
//   }

//   const prompt = `You are an expert in Google Workspace productivity and collaboration tools. Below is the text from an article.
  
//   **Instructions:**
//   1.  Create a short, engaging, and bolded title for the article in a single line.
//   2.  On the next line, write a concise summary in a single paragraph (between 50 and 70 words) in Spanish.
//   3.  The summary must focus on the main topic and key takeaways from the provided text.
//   4.  Add 2 or 3 relevant emojis at the end of the summary.
//   5.  **IMPORTANT**: Base your response exclusively on the following text. Do not invent information or use external knowledge.

//   **Article Text:**
//   ---
//   ${articleText}`;

//   const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
//   const options = {
//     method: 'post',
//     contentType: 'application/json',
//     payload: JSON.stringify(payload),
//     muteHttpExceptions: true
//   };

//   const MAX_RETRIES = 3;
//   let delay = 1000; 

//   for (let i = 0; i < MAX_RETRIES; i++) {
//     const response = UrlFetchApp.fetch(API_ENDPOINT, options);
//     const responseCode = response.getResponseCode();
//     const responseBody = response.getContentText();

//     if (responseCode === 200) {
//       const jsonResponse = JSON.parse(responseBody);
//       if (jsonResponse.candidates && jsonResponse.candidates[0]?.content?.parts[0]?.text) {
//         return jsonResponse.candidates[0].content.parts[0].text; 
//       } else {
//         const blockReason = jsonResponse.promptFeedback?.blockReason || 'Unexpected response structure';
//         Logger.log(`API response was OK but content was missing. Reason: ${blockReason}. Body: ${responseBody}`);
//         throw new Error(`The API returned no content. Reason: ${blockReason}`);
//       }
//     } else if (responseCode === 429 || responseCode === 503) {
//       Logger.log(`Attempt ${i + 1} of ${MAX_RETRIES} failed with code ${responseCode}. Retrying in ${delay / 1000}s...`);
//       if (i < MAX_RETRIES - 1) { 
//         Utilities.sleep(delay);
//         delay *= 2; 
//       }
//     } else {
//       Logger.log(`Gemini API Error: ${responseBody}`);
//       throw new Error(`API call failed with code ${responseCode}: ${responseBody}`);
//     }
//   }

//   throw new Error(`Gemini API call failed after ${MAX_RETRIES} attempts for URL: ${articleUrl}`);
// }