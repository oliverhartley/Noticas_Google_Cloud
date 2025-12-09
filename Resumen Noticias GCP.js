// Funciona Perfecto solo voy agrerar el Video y el audio.
/**
 * @file Google Apps Script to summarize GCP articles, group by channel in a Google Doc, and email the content.
 * @author Gemini
 * @version 2.1 (Grounded Summaries with Video Link)
 * @see https://developers.google.com/apps-script/
 * @see https://ai.google.dev/
 *
 * @changelog
 *   - v2.1: Modified email functions to include a YouTube link from the 'GCP Video Overview' sheet.
 *           Refactored getHtmlContentFromDocGCP for better separation of concerns.
 *   - v2.0: Modified getGeminiSummaryGCP to fetch article content before summarizing.
 *           This "grounds" the model to the specific article, preventing hallucinations.
 *           Added getTextFromHtml helper function to parse web content.
 *           Switched to PropertiesService for secure API key storage.
 *           Corrected Gemini model name to a valid, existing model (gemini-1.5-flash-latest).
 */

// --- GCP Configuration ---
const GCP_SPREADSHEET_ID = '15-yneYsrmgkpJ5CGK57RVS9chMoV-ixw_w7hsPcaPuo'; // Your spreadsheet ID
const GCP_SHEET_NAME = 'GCP'; // The sheet with links for GCP
const GCP_OLD_SHEET_NAME = 'GCP Old'; // The sheet where processed GCP links will be moved
const GCP_COLUMN_HEADER_LINK = 'Link'; // The header of the column containing article links
const GCP_COLUMN_HEADER_CHANNEL = 'Channel'; // The header of the column containing the channel name
const GCP_DOCUMENT_BASE_TITLE = 'Noticias GCP - '; // Base title for the new Google Document
const GCP_EMAIL_SUBJECT_BASE = '[GCP Readiness] - Noticias GCP'; // Base subject of the email
const VIDEO_SOURCE_FOLDER_ID = '1mrNTjpckNS4sAcS6vB5M8aRoAvwbECpu'; // Source folder for videos and PNGs

/**
 * Main function to read GCP articles, group by channel, summarize, write to a Google Doc, and email.
 */
function summarizeArticlesGCP() {
  Logger.log('Starting the summarizeArticlesGCP script (v2.1 - Grounded Summaries with Video Link)...');
  const ss = SpreadsheetApp.openById(GCP_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(GCP_SHEET_NAME);
  const oldSheet = ss.getSheetByName(GCP_OLD_SHEET_NAME);

  if (!sheet) {
    Logger.log(`Error: Sheet '${GCP_SHEET_NAME}' not found in the spreadsheet.`);
    return;
  }
  if (!oldSheet) {
    Logger.log(`Error: Sheet '${GCP_OLD_SHEET_NAME}' not found.`);
    return;
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getDisplayValues();
  const headers = values[0];
  
  // Find column indices
  const linkColumnIndex = headers.indexOf(GCP_COLUMN_HEADER_LINK);
  const channelColumnIndex = headers.indexOf(GCP_COLUMN_HEADER_CHANNEL);

  if (linkColumnIndex === -1) {
    Logger.log(`Error: Column '${GCP_COLUMN_HEADER_LINK}' not found.`);
    return;
  }
  if (channelColumnIndex === -1) {
    Logger.log(`Error: Column '${GCP_COLUMN_HEADER_CHANNEL}' not found. Grouping requires this column.`);
    return;
  }

  // Data structures for processing
  const articlesToProcess = []; 
  const rowsToProcessIndices = [];
  const rowsToMoveData = [];

  // Extract data
  for (let i = 1; i < values.length; i++) {
    const link = values[i][linkColumnIndex];
    let channel = values[i][channelColumnIndex];

    if (link && link.startsWith('http')) {
      if (!channel) channel = 'General'; // Fallback if channel is empty
      
      articlesToProcess.push({ link: link, channel: channel });
      rowsToProcessIndices.push(i + 1);
      rowsToMoveData.push(values[i]);
    }
  }

  if (articlesToProcess.length === 0) {
    Logger.log('Info: No new article links found. Exiting script.');
    return;
  }

  Logger.log(`Found ${articlesToProcess.length} articles to process.`);

  // Group articles by Channel
  const groupedArticles = {};
  articlesToProcess.forEach(article => {
    if (!groupedArticles[article.channel]) {
      groupedArticles[article.channel] = [];
    }
    groupedArticles[article.channel].push(article.link);
  });

  // Prepare Document
  const today = new Date();
  const docDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const docTitle = GCP_DOCUMENT_BASE_TITLE + docDate;
  let doc;
  let documentUrl = '';

  try {
    const docs = DriveApp.getFilesByName(docTitle);
    if (docs.hasNext()) {
      doc = DocumentApp.openById(docs.next().getId());
      doc.getBody().clear();
      Logger.log(`Opened and cleared existing document: ${docTitle}`);
    } else {
      doc = DocumentApp.create(docTitle);
      Logger.log(`Created new document: ${docTitle}`);
    }
    documentUrl = doc.getUrl();
  } catch (e) {
    Logger.log(`FATAL ERROR: Failed to create or open Google Document: ${e.message}`);
    return;
  }

  const body = doc.getBody();

  // Iterate through groups and write to Doc
  const sortedChannels = Object.keys(groupedArticles).sort();

  for (const channel of sortedChannels) {
    body.appendParagraph(`Noticias ${channel}`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
    Logger.log(`Processing channel: ${channel}`);
    const linksInChannel = groupedArticles[channel];

    for (const articleLink of linksInChannel) {
      try {
        const geminiResponse = getGeminiSummaryGCP(articleLink);
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
        Logger.log(`-- Summarized: ${articleLink}`);
      } catch (e) {
        Logger.log(`Error summarizing ${articleLink}: ${e.message}`);
        body.appendParagraph(`Error summarizing article:`);
        body.appendParagraph(articleLink).editAsText().setLinkUrl(articleLink);
        body.appendParagraph(e.message);
      }
      body.appendParagraph(""); 
      Utilities.sleep(2000); // Increased sleep time slightly for fetching URLs
    }
  }

  doc.saveAndClose();
  Logger.log(`Finished updating Google Doc. URL: ${documentUrl}`);

  // --- Email ---
  const emailDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'dd MMM');
  const dynamicSubject = `${GCP_EMAIL_SUBJECT_BASE} ${emailDate}`;

  const FALLBACK_PHRASE = 'Hola todos, les adjunto las ultimas noticias de Google Cloud.';
  const randomPhraseObject = getRandomPhraseGCP(ss);
  const openingPhraseHtml = randomPhraseObject ? convertRichTextToHtmlGCP(randomPhraseObject) : FALLBACK_PHRASE;

  const emailSheet = ss.getSheetByName('email');
  if (!emailSheet) {
    Logger.log(`ERROR: Sheet 'email' not found. Cannot send email.`);
  } else {
    // Default to GCP list, but can be overridden for testing
    const bccString = getEmailList('GCP'); 
    if (bccString) {
      const validEmails = validateEmails(bccString);

      if (validEmails.length > 0) {
        const finalBccList = validEmails.join(',');
        const emailSent = sendEmailWithSummariesGCP(doc.getId(), finalBccList);
        
        let successMessage = `SUCCESS: Summaries added to Google Document.`;
        if (emailSent) {
          successMessage += ` Email sent.`;
        } else {
          successMessage += ` FAILED to send email.`;
        }
        Logger.log(successMessage);
      } else {
        Logger.log('Warning: No valid BCC recipients found for GCP. Skipping email send.');
      }
    } else {
      Logger.log('Warning: No BCC recipients found for GCP. Skipping email send.');
    }
  }

  // --- Archive Rows ---
  if (rowsToMoveData.length > 0) {
    const lastRowOldSheet = oldSheet.getLastRow();
    oldSheet.getRange(lastRowOldSheet + 1, 1, rowsToMoveData.length, rowsToMoveData[0].length).setValues(rowsToMoveData);
    
    for (let i = rowsToProcessIndices.length - 1; i >= 0; i--) {
      sheet.deleteRow(rowsToProcessIndices[i]);
    }
    Logger.log(`Moved and deleted ${rowsToMoveData.length} rows.`);
  }
  
  Logger.log('Script finished.');
}


// --- HELPER FUNCTIONS ---


/**
 * Converts a RichTextValue object into a simple HTML string.
 */
function convertRichTextToHtmlGCP(richTextValue) {
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
 * Retrieves a random phrase from the 'Frases' sheet as a RichTextValue object.
 */
function getRandomPhraseGCP(spreadsheet) {
  const PHRASE_SHEET_NAME = 'Frases';
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
    Logger.log(`Selected phrase: "${selectedPhrase.getText()}"`);
    return selectedPhrase;
  } catch (e) {
    Logger.log(`Error getting random phrase: ${e.message}.`);
    return null;
  }
}

/**
 * Retrieves content, appends a signature, and sends email to a BCC list.
 * THIS FUNCTION HAS BEEN MODIFIED to include the video link.
 */
/**
 * Retrieves content, appends a signature, and sends email to a BCC list.
 * Refactored to use Gemini-generated content and new structure.
 */
function sendEmailWithSummariesGCP(documentId, bccRecipients, isTest = false) {
  try {
    const ss = SpreadsheetApp.openById(GCP_SPREADSHEET_ID);

    // 1. Get Video Info
    const videoSheet = ss.getSheetByName('GCP Video Overview');
    let videoLink = '';
    let videoTitle = 'Noticias GCP';
    let videoDescription = 'Resumen de noticias de Google Cloud.';

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
    const phrases = generateEmailPhrases(videoTitle, videoDescription, 'GCP');

    // 3. Prepare Subject
    const subject = `[Readiness GCP] - ${videoTitle}`;

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

    htmlBody += `<br><p><strong>Para más detalles, aquí están las noticias del blog:</strong></p>`;

    // 5. Add Article Summaries from Doc (Links Only)
    htmlBody += convertDocToHtmlGCP(documentId);

    // 6. Add PNG Image if available
    const pngBlob = getLatestPngFromFolder(VIDEO_SOURCE_FOLDER_ID);
    const inlineImages = {};
    if (pngBlob) {
      inlineImages['summaryImage'] = pngBlob;
      htmlBody += `<br><div style="text-align: center;"><img src="cid:summaryImage" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px;"></div>`;
    }

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
    Logger.log(`Successfully sent GCP email to: ${bccRecipients}`);
    return true;
  } catch (e) {
    Logger.log(`EMAIL ERROR: Failed to send email: ${e.message}`);
    return false;
  }
}

function sendTestEmailGCP() {
  const ss = SpreadsheetApp.openById(GCP_SPREADSHEET_ID);
  // We need a doc ID. We can use the last created one or create a dummy.
  // For testing, let's just try to find the last created GCP doc.
  const today = new Date();
  const docDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const docTitle = GCP_DOCUMENT_BASE_TITLE + docDate;
  const docs = DriveApp.getFilesByName(docTitle);
  let docId = '';
  if (docs.hasNext()) {
    docId = docs.next().getId();
  } else {
    // Try to find the most recent GCP doc if today's doesn't exist
    // Better approach: Sort search results by date to find most recent doc.
    const searchDocs = DriveApp.searchFiles(`name contains '${GCP_DOCUMENT_BASE_TITLE}' and mimeType = 'application/vnd.google-apps.document'`);
    let files = [];
    while (searchDocs.hasNext()) {
      files.push(searchDocs.next());
    }
    if (files.length > 0) {
      files.sort((a, b) => b.getLastUpdated().getTime() - a.getLastUpdated().getTime());
      docId = files[0].getId();
    } else {
      // Create a dummy doc for testing if none exists
      const doc = DocumentApp.create(docTitle + ' TEST');
      doc.getBody().appendParagraph('Noticias Test').setHeading(DocumentApp.ParagraphHeading.HEADING1);
      doc.getBody().appendParagraph('Título de Prueba').setBold(true).setLinkUrl('https://google.com');
      doc.getBody().appendParagraph('Resumen de prueba.');
      docId = doc.getId();
    }
  }

  const bccString = getEmailList('Testing');
  if (bccString) {
    const validEmails = validateEmails(bccString);
    if (validEmails.length > 0) {
      sendEmailWithSummariesGCP(docId, validEmails.join(','), true);
      Logger.log('Test email sent to: ' + validEmails.join(','));
    } else {
      Logger.log('No valid emails in Testing list.');
    }
  } else {
    Logger.log('Testing list empty or not found.');
  }
}

/**
 * Helper function to parse a Google Doc and convert its content to an HTML string.
 * This is a refactored version of the old getHtmlContentFromDocGCP.
 */
function convertDocToHtmlGCP(documentId) {
    const doc = DocumentApp.openById(documentId);
    const body = doc.getBody();
    let htmlContent = ""; // Start with an empty string, we build the full body in the calling function

    for (let i = 0; i < body.getNumChildren(); i++) {
        const child = body.getChild(i);
        const type = child.getType();

        if (type === DocumentApp.ElementType.PARAGRAPH) {
            const p = child.asParagraph();
            const text = p.getText();
            if (text.trim().length === 0) continue; 

            const heading = p.getHeading();
            
            if (heading === DocumentApp.ParagraphHeading.HEADING1) {
                htmlContent += `<h2 style="color: #202124; border-bottom: 1px solid #e0e0e0; padding-bottom: 5px; margin-top: 20px;">${text}</h2>`;
                continue;
            }

            const textElement = p.editAsText();
            const isBold = textElement.isBold();
            const linkUrl = textElement.getLinkUrl();

            let style = 'padding: 0;';
            if (isBold) {
              // Treat as Title - KEEP
              style += ' font-weight: bold; margin: 10px 0 0 0; color: #1a73e8; font-size: 12pt;';
              let elementHtml = `<p style="${style}">`;
              if (linkUrl) {
                elementHtml += `<a href="${linkUrl}" style="text-decoration: none; color: #1a73e8;">${text}</a>`;
              } else {
                elementHtml += text;
              }
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


// --- GEMINI AND CONTENT FUNCTIONS (MODIFIED SECTION) ---


/**
 * Extrae el texto principal de un contenido HTML.
 * Primero elimina las etiquetas de script y estilo, y luego el resto de las etiquetas HTML.
 * @param {string} htmlContent El contenido HTML de la página.
 * @return {string} El texto extraído y limpio.
 */
function getTextFromHtml(htmlContent) {
  // Quita los bloques de script y estilo para evitar que su contenido se incluya
  let text = htmlContent.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
  // Quita las etiquetas HTML restantes
  text = text.replace(/<[^>]+>/g, '');
  // Decodifica entidades HTML comunes
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  // Reemplaza múltiples saltos de línea y espacios por uno solo para limpiar el texto
  text = text.replace(/(\r\n|\n|\r){2,}/gm, '\n').trim();
  
  // Trunca el texto para no exceder los límites de tokens y mantener la eficiencia.
  // Gemini 1.5 Flash tiene un contexto muy grande, pero es buena práctica controlar el tamaño.
  const MAX_LENGTH = 300000; // Un límite generoso.
  if (text.length > MAX_LENGTH) {
    text = text.substring(0, MAX_LENGTH) + '... [CONTENIDO TRUNCADO]';
  }
  
  return text;
}


/**
 * Llama a la API de Gemini para obtener un resumen del contenido de un artículo, no solo de su URL.
 * Esta función está "anclada" (grounded) al contenido real del post.
 */
function getGeminiSummaryGCP(articleUrl) {
  // Paso 1: Obtener la API Key de forma segura desde las Propiedades del Script.
  const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!GEMINI_API_KEY) {
    throw new Error('La GEMINI_API_KEY no se encuentra en las Propiedades del Script.');
  }

  // Corregido: Usa un nombre de modelo válido como "gemini-1.5-flash-latest".
  const API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY;
  
  let articleText;
  try {
    // Paso 2: Descargar el contenido HTML de la URL.
    const articleResponse = UrlFetchApp.fetch(articleUrl, { muteHttpExceptions: true });
    const responseCode = articleResponse.getResponseCode();
    
    if (responseCode === 200) {
      const htmlContent = articleResponse.getContentText();
      // Paso 3: Extraer el texto limpio del HTML.
      articleText = getTextFromHtml(htmlContent);
    } else {
      throw new Error(`No se pudo obtener el contenido de la URL. Código de estado: ${responseCode}`);
    }
    
    if (!articleText || articleText.length < 100) { // Si no hay texto o es muy corto.
        throw new Error('No se pudo extraer suficiente contenido del artículo para resumir.');
    }

  } catch (e) {
    Logger.log(`Error al descargar o procesar el artículo ${articleUrl}: ${e.message}`);
    // Devuelve un error claro para que se registre en el documento.
    return `*Error al Procesar Artículo*\nNo se pudo leer el contenido de la URL. Razón: ${e.message}`;
  }

  // Paso 4: Crear un prompt mejorado que incluya el contenido y pida al modelo que se base SOLO en él.
  const prompt = `Eres un experto en tecnología de Google Cloud. A continuación se encuentra el texto de un artículo.
  
  **Instrucciones:**
  1.  Crea un título corto, atractivo y en negritas para el artículo en una sola línea.
  2.  En la siguiente línea, escribe un resumen en un solo párrafo conciso (entre 50 y 70 palabras) en español.
  3.  El resumen debe enfocarse en el tema principal y las conclusiones clave del texto proporcionado.
  4.  Añade 2 o 3 emojis relevantes al final del resumen.
  5.  **IMPORTANTE**: Basa tu respuesta exclusivamente en el siguiente texto. No inventes información ni utilices conocimiento externo.

  **Texto del Artículo:**
  ---
  ${articleText}`;

  const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // El sistema de reintentos que ya tenías es una excelente idea. Lo conservamos.
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
         // Si la API responde OK pero el contenido está bloqueado o vacío (por seguridad, etc.)
        const blockReason = jsonResponse.promptFeedback?.blockReason || 'Estructura de respuesta inesperada';
        Logger.log(`Respuesta de la API sin contenido. Razón: ${blockReason}. Body: ${responseBody}`);
        throw new Error(`La API no devolvió contenido. Razón: ${blockReason}`);
      }
    } else if (responseCode === 429 || responseCode === 503) { // 429: Rate limit, 503: Overloaded
      Logger.log(`Intento ${i + 1} de ${MAX_RETRIES} falló con código ${responseCode}. Reintentando en ${delay / 1000}s...`);
      if (i < MAX_RETRIES - 1) { 
        Utilities.sleep(delay);
        delay *= 2; 
      }
    } else {
      Logger.log(`Error en la API de Gemini: ${responseBody}`);
      throw new Error(`La llamada a la API falló con el código ${responseCode}: ${responseBody}`);
    }
  }

  throw new Error(`La llamada a la API de Gemini falló después de ${MAX_RETRIES} intentos para la URL: ${articleUrl}`);
}

/**
 * Creates a draft email with the summarized content from a Google Doc.
 * THIS FUNCTION HAS BEEN MODIFIED to include the video link.
 */
function createDraftEmailWithSummariesGCP(documentId, bccRecipients, subject, openingPhraseHtml) {
  try {
    // --- START: MODIFIED SECTION ---
    // 1. Get the YouTube link from the "GCP Video Overview" sheet
    const ss = SpreadsheetApp.openById(GCP_SPREADSHEET_ID);
    const videoSheet = ss.getSheetByName('GCP Video Overview');
    let videoLink = '';
    if (videoSheet) {
      const lastRow = videoSheet.getLastRow();
      if (lastRow > 0) {
        videoLink = videoSheet.getRange('A' + lastRow).getDisplayValue().trim();
      }
    }

    // 2. Build the email body piece by piece
    let htmlBody = `<div style="font-family: Arial, sans-serif; font-size: 11pt;">`;
    htmlBody += openingPhraseHtml;
    htmlBody += `<br><br>`;
    
    // 3. Add the new video paragraph if a link was found
    if (videoLink) {
      htmlBody += `<p style="margin: 0 0 10px 0;">Te aburre leer, como a mi :) ahora, gracias a NotebookLM, tenemos un resumen y análisis de las noticias aquí: <a href="${videoLink}" style="color: #1a73e8; text-decoration: none;">${videoLink}</a></p>`;
    }
    
    // 4. Add the article summaries from the Google Doc (Links Only)
    htmlBody += convertDocToHtmlGCP(documentId);

    // 5. Add PNG Image if available
    const pngBlob = getLatestPngFromFolder(VIDEO_SOURCE_FOLDER_ID);
    const inlineImages = {};
    if (pngBlob) {
      inlineImages['summaryImage'] = pngBlob;
      htmlBody += `<br><div style="text-align: center;"><img src="cid:summaryImage" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px;"></div>`;
    }
    // --- END: MODIFIED SECTION ---

    const signatureHtml = `
      <div style="font-family: Arial, sans-serif; font-size: 10pt; color: #5f6368; margin-top: 20px;">
        --<br>
        Oliver Hartley Lyon<br>
        Google Cloud and Workspace Partner Engineer<br>
        oliverhartley@google.com
      </div>
    `;
    
    htmlBody += signatureHtml;
    htmlBody += `</div>`; // Close the main div

    GmailApp.createDraft('', subject, '', {
      bcc: bccRecipients,
      htmlBody: htmlBody,
      inlineImages: Object.keys(inlineImages).length > 0 ? inlineImages : null
    });

    Logger.log(`Successfully created email draft for recipients: ${bccRecipients}`);
    return true;
  } catch (e) {
    Logger.log(`DRAFT ERROR: Failed to create email draft: ${e.message}`);
    return false;
  }
}

/**
 * Main function to read GCP articles, group by channel, summarize, write to a Google Doc, and save as a draft email.
 * This is a new version of summarizeArticlesGCP that saves a draft instead of sending an email.
 */
function saveEmailAsDraftGCP() {
  Logger.log('Starting the saveEmailAsDraftGCP script...');
  const ss = SpreadsheetApp.openById(GCP_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(GCP_SHEET_NAME);
  const oldSheet = ss.getSheetByName(GCP_OLD_SHEET_NAME);

  if (!sheet) {
    Logger.log(`Error: Sheet '${GCP_SHEET_NAME}' not found in the spreadsheet.`);
    return;
  }
  if (!oldSheet) {
    Logger.log(`Error: Sheet '${GCP_OLD_SHEET_NAME}' not found.`);
    return;
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getDisplayValues();
  const headers = values[0];
  
  const linkColumnIndex = headers.indexOf(GCP_COLUMN_HEADER_LINK);
  const channelColumnIndex = headers.indexOf(GCP_COLUMN_HEADER_CHANNEL);

  if (linkColumnIndex === -1) {
    Logger.log(`Error: Column '${GCP_COLUMN_HEADER_LINK}' not found.`);
    return;
  }
  if (channelColumnIndex === -1) {
    Logger.log(`Error: Column '${GCP_COLUMN_HEADER_CHANNEL}' not found. Grouping requires this column.`);
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
    Logger.log('Info: No new article links found. Exiting script.');
    return;
  }

  Logger.log(`Found ${articlesToProcess.length} articles to process.`);

  const groupedArticles = {};
  articlesToProcess.forEach(article => {
    if (!groupedArticles[article.channel]) {
      groupedArticles[article.channel] = [];
    }
    groupedArticles[article.channel].push(article.link);
  });

  const today = new Date();
  const docDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const docTitle = GCP_DOCUMENT_BASE_TITLE + docDate;
  let doc;
  let documentUrl = '';

  try {
    const docs = DriveApp.getFilesByName(docTitle);
    if (docs.hasNext()) {
      doc = DocumentApp.openById(docs.next().getId());
      doc.getBody().clear();
      Logger.log(`Opened and cleared existing document: ${docTitle}`);
    } else {
      doc = DocumentApp.create(docTitle);
      Logger.log(`Created new document: ${docTitle}`);
    }
    documentUrl = doc.getUrl();
  } catch (e) {
    Logger.log(`FATAL ERROR: Failed to create or open Google Document: ${e.message}`);
    return;
  }

  const body = doc.getBody();
  const sortedChannels = Object.keys(groupedArticles).sort();

  for (const channel of sortedChannels) {
    body.appendParagraph(`Noticias ${channel}`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
    Logger.log(`Processing channel: ${channel}`);
    const linksInChannel = groupedArticles[channel];

    for (const articleLink of linksInChannel) {
      try {
        const geminiResponse = getGeminiSummaryGCP(articleLink);
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
        Logger.log(`-- Summarized: ${articleLink}`);
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
  Logger.log(`Finished updating Google Doc. URL: ${documentUrl}`);

  // --- Create Email Draft ---
  const DRAFT_GCP_EMAIL_SUBJECT_BASE = '[DRAFT GCP Readiness] - Noticias GCP';
  const emailDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'dd MMM');
  const dynamicSubject = `${DRAFT_GCP_EMAIL_SUBJECT_BASE} ${emailDate}`;

  const FALLBACK_PHRASE = 'Hola todos, les adjunto las ultimas noticias de Google Cloud.';
  const randomPhraseObject = getRandomPhraseGCP(ss);
  const openingPhraseHtml = randomPhraseObject ? convertRichTextToHtmlGCP(randomPhraseObject) : FALLBACK_PHRASE;

  const emailSheet = ss.getSheetByName('email');
  if (!emailSheet) {
    Logger.log(`ERROR: Sheet 'email' not found. Cannot create email draft.`);
  } else {
    const bccString = emailSheet.getRange('B3').getDisplayValue().trim();
    if (bccString) {
      const allEmails = bccString.split(',');
      const validEmails = [];
      const invalidEmails = [];
      const emailRegex = /.+@.+\..+/; 
      
      for (const email of allEmails) {
        const trimmedEmail = email.trim();
        if (trimmedEmail) {
          if (emailRegex.test(trimmedEmail)) {
            validEmails.push(trimmedEmail);
          } else {
            invalidEmails.push(trimmedEmail);
          }
        }
      }

      if (invalidEmails.length > 0) {
        Logger.log(`Warning: Found and skipped the following invalid email addresses: ${invalidEmails.join(', ')}`);
      }

      if (validEmails.length > 0) {
        const finalBccList = validEmails.join(',');
        const draftCreated = createDraftEmailWithSummariesGCP(doc.getId(), finalBccList, dynamicSubject, openingPhraseHtml);
        
        let successMessage = `SUCCESS: Summaries added to Google Document.`;
        if (draftCreated) {
          successMessage += ` Email draft created.`;
        } else {
          successMessage += ` FAILED to create email draft.`;
        }
        Logger.log(successMessage);
      } else {
        Logger.log('Warning: No valid BCC recipients found after filtering the list from email!B3. Skipping email draft creation.');
      }
    } else {
      Logger.log('Warning: No BCC recipients found in email!B3. Skipping email draft creation.');
    }
  }

  // --- Archive Rows ---
  if (rowsToMoveData.length > 0) {
    const lastRowOldSheet = oldSheet.getLastRow();
    oldSheet.getRange(lastRowOldSheet + 1, 1, rowsToMoveData.length, rowsToMoveData[0].length).setValues(rowsToMoveData);
    
    for (let i = rowsToProcessIndices.length - 1; i >= 0; i--) {
      sheet.deleteRow(rowsToProcessIndices[i]);
    }
    Logger.log(`Moved and deleted ${rowsToMoveData.length} rows.`);
  }
  
  Logger.log('Script finished.');
}
// // Funciona Perfecto solo voy agrerar el Video y el audio.
// /**
//  * @file Google Apps Script to summarize GCP articles, group by channel in a Google Doc, and email the content.
//  * @author Gemini
//  * @version 2.0 (Grounded Summaries)
//  * @see https://developers.google.com/apps-script/
//  * @see https://ai.google.dev/
//  *
//  * @changelog
//  *   - v2.0: Modified getGeminiSummaryGCP to fetch article content before summarizing.
//  *           This "grounds" the model to the specific article, preventing hallucinations.
//  *           Added getTextFromHtml helper function to parse web content.
//  *           Switched to PropertiesService for secure API key storage.
//  *           Corrected Gemini model name to a valid, existing model (gemini-1.5-flash-latest).
//  */

// // --- GCP Configuration ---
// const GCP_SPREADSHEET_ID = '15-yneYsrmgkpJ5CGK57RVS9chMoV-ixw_w7hsPcaPuo'; // Your spreadsheet ID
// const GCP_SHEET_NAME = 'GCP'; // The sheet with links for GCP
// const GCP_OLD_SHEET_NAME = 'GCP Old'; // The sheet where processed GCP links will be moved
// const GCP_COLUMN_HEADER_LINK = 'Link'; // The header of the column containing article links
// const GCP_COLUMN_HEADER_CHANNEL = 'Channel'; // The header of the column containing the channel name
// const GCP_DOCUMENT_BASE_TITLE = 'Noticias GCP - '; // Base title for the new Google Document
// const GCP_EMAIL_SUBJECT_BASE = '[GCP Readiness] - Noticias GCP'; // Base subject of the email

// /**
//  * Main function to read GCP articles, group by channel, summarize, write to a Google Doc, and email.
//  */
// function summarizeArticlesGCP() {
//   Logger.log('Starting the summarizeArticlesGCP script (v2.0 - Grounded Summaries)...');
//   const ss = SpreadsheetApp.openById(GCP_SPREADSHEET_ID);
//   const sheet = ss.getSheetByName(GCP_SHEET_NAME);
//   const oldSheet = ss.getSheetByName(GCP_OLD_SHEET_NAME);

//   if (!sheet) {
//     Logger.log(`Error: Sheet '${GCP_SHEET_NAME}' not found in the spreadsheet.`);
//     return;
//   }
//   if (!oldSheet) {
//     Logger.log(`Error: Sheet '${GCP_OLD_SHEET_NAME}' not found.`);
//     return;
//   }

//   const dataRange = sheet.getDataRange();
//   const values = dataRange.getDisplayValues();
//   const headers = values[0];
  
//   // Find column indices
//   const linkColumnIndex = headers.indexOf(GCP_COLUMN_HEADER_LINK);
//   const channelColumnIndex = headers.indexOf(GCP_COLUMN_HEADER_CHANNEL);

//   if (linkColumnIndex === -1) {
//     Logger.log(`Error: Column '${GCP_COLUMN_HEADER_LINK}' not found.`);
//     return;
//   }
//   if (channelColumnIndex === -1) {
//     Logger.log(`Error: Column '${GCP_COLUMN_HEADER_CHANNEL}' not found. Grouping requires this column.`);
//     return;
//   }

//   // Data structures for processing
//   const articlesToProcess = []; 
//   const rowsToProcessIndices = [];
//   const rowsToMoveData = [];

//   // Extract data
//   for (let i = 1; i < values.length; i++) {
//     const link = values[i][linkColumnIndex];
//     let channel = values[i][channelColumnIndex];

//     if (link && link.startsWith('http')) {
//       if (!channel) channel = 'General'; // Fallback if channel is empty
      
//       articlesToProcess.push({ link: link, channel: channel });
//       rowsToProcessIndices.push(i + 1);
//       rowsToMoveData.push(values[i]);
//     }
//   }

//   if (articlesToProcess.length === 0) {
//     Logger.log('Info: No new article links found. Exiting script.');
//     return;
//   }

//   Logger.log(`Found ${articlesToProcess.length} articles to process.`);

//   // Group articles by Channel
//   const groupedArticles = {};
//   articlesToProcess.forEach(article => {
//     if (!groupedArticles[article.channel]) {
//       groupedArticles[article.channel] = [];
//     }
//     groupedArticles[article.channel].push(article.link);
//   });

//   // Prepare Document
//   const today = new Date();
//   const docDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
//   const docTitle = GCP_DOCUMENT_BASE_TITLE + docDate;
//   let doc;
//   let documentUrl = '';

//   try {
//     const docs = DriveApp.getFilesByName(docTitle);
//     if (docs.hasNext()) {
//       doc = DocumentApp.openById(docs.next().getId());
//       doc.getBody().clear();
//       Logger.log(`Opened and cleared existing document: ${docTitle}`);
//     } else {
//       doc = DocumentApp.create(docTitle);
//       Logger.log(`Created new document: ${docTitle}`);
//     }
//     documentUrl = doc.getUrl();
//   } catch (e) {
//     Logger.log(`FATAL ERROR: Failed to create or open Google Document: ${e.message}`);
//     return;
//   }

//   const body = doc.getBody();

//   // Iterate through groups and write to Doc
//   const sortedChannels = Object.keys(groupedArticles).sort();

//   for (const channel of sortedChannels) {
//     body.appendParagraph(`Noticias ${channel}`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
//     Logger.log(`Processing channel: ${channel}`);
//     const linksInChannel = groupedArticles[channel];

//     for (const articleLink of linksInChannel) {
//       try {
//         const geminiResponse = getGeminiSummaryGCP(articleLink);
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
//         Logger.log(`-- Summarized: ${articleLink}`);
//       } catch (e) {
//         Logger.log(`Error summarizing ${articleLink}: ${e.message}`);
//         body.appendParagraph(`Error summarizing article:`);
//         body.appendParagraph(articleLink).editAsText().setLinkUrl(articleLink);
//         body.appendParagraph(e.message);
//       }
//       body.appendParagraph(""); 
//       Utilities.sleep(2000); // Increased sleep time slightly for fetching URLs
//     }
//   }

//   doc.saveAndClose();
//   Logger.log(`Finished updating Google Doc. URL: ${documentUrl}`);

//   // --- Email ---
//   const emailDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'dd MMM');
//   const dynamicSubject = `${GCP_EMAIL_SUBJECT_BASE} ${emailDate}`;

//   const FALLBACK_PHRASE = 'Hola todos, les adjunto las ultimas noticias de Google Cloud.';
//   const randomPhraseObject = getRandomPhraseGCP(ss);
//   const openingPhraseHtml = randomPhraseObject ? convertRichTextToHtmlGCP(randomPhraseObject) : FALLBACK_PHRASE;

//   const emailSheet = ss.getSheetByName('email');
//   if (!emailSheet) {
//     Logger.log(`ERROR: Sheet 'email' not found. Cannot send email.`);
//   } else {
//     const bccString = emailSheet.getRange('B3').getDisplayValue().trim();
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
//         const emailSent = sendEmailWithSummariesGCP(doc.getId(), finalBccList, dynamicSubject, openingPhraseHtml);
        
//         let successMessage = `SUCCESS: Summaries added to Google Document.`;
//         if (emailSent) {
//           successMessage += ` Email sent.`;
//         } else {
//           successMessage += ` FAILED to send email.`;
//         }
//         Logger.log(successMessage);
//       } else {
//         Logger.log('Warning: No valid BCC recipients found after filtering the list from email!B3. Skipping email send.');
//       }
//     } else {
//       Logger.log('Warning: No BCC recipients found in email!B3. Skipping email send.');
//     }
//   }

//   // --- Archive Rows ---
//   if (rowsToMoveData.length > 0) {
//     const lastRowOldSheet = oldSheet.getLastRow();
//     oldSheet.getRange(lastRowOldSheet + 1, 1, rowsToMoveData.length, rowsToMoveData[0].length).setValues(rowsToMoveData);
    
//     for (let i = rowsToProcessIndices.length - 1; i >= 0; i--) {
//       sheet.deleteRow(rowsToProcessIndices[i]);
//     }
//     Logger.log(`Moved and deleted ${rowsToMoveData.length} rows.`);
//   }
  
//   Logger.log('Script finished.');
// }


// // --- HELPER FUNCTIONS ---


// /**
//  * Converts a RichTextValue object into a simple HTML string.
//  */
// function convertRichTextToHtmlGCP(richTextValue) {
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
//  * Retrieves a random phrase from the 'Frases' sheet as a RichTextValue object.
//  */
// function getRandomPhraseGCP(spreadsheet) {
//   const PHRASE_SHEET_NAME = 'Frases';
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
//     Logger.log(`Selected phrase: "${selectedPhrase.getText()}"`);
//     return selectedPhrase;
//   } catch (e) {
//     Logger.log(`Error getting random phrase: ${e.message}.`);
//     return null;
//   }
// }

// /**
//  * Retrieves content, appends a signature, and sends email to a BCC list.
//  */
// function sendEmailWithSummariesGCP(documentId, bccRecipients, subject, openingPhraseHtml) {
//   try {
//     let htmlBody = getHtmlContentFromDocGCP(documentId, openingPhraseHtml);

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
//     Logger.log(`Successfully sent email via BCC to: ${bccRecipients}`);
//     return true;
//   } catch (e) {
//     Logger.log(`EMAIL ERROR: Failed to send email: ${e.message}`);
//     return false;
//   }
// }

// /**
//  * Helper function to parse a Google Doc and convert its content to an HTML string.
//  */
// function getHtmlContentFromDocGCP(documentId, openingPhraseHtml) {
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


// // --- GEMINI AND CONTENT FUNCTIONS (MODIFIED SECTION) ---


// /**
//  * Extrae el texto principal de un contenido HTML.
//  * Primero elimina las etiquetas de script y estilo, y luego el resto de las etiquetas HTML.
//  * @param {string} htmlContent El contenido HTML de la página.
//  * @return {string} El texto extraído y limpio.
//  */
// function getTextFromHtml(htmlContent) {
//   // Quita los bloques de script y estilo para evitar que su contenido se incluya
//   let text = htmlContent.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
//   text = text.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
//   // Quita las etiquetas HTML restantes
//   text = text.replace(/<[^>]+>/g, '');
//   // Decodifica entidades HTML comunes
//   text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
//   // Reemplaza múltiples saltos de línea y espacios por uno solo para limpiar el texto
//   text = text.replace(/(\r\n|\n|\r){2,}/gm, '\n').trim();
  
//   // Trunca el texto para no exceder los límites de tokens y mantener la eficiencia.
//   // Gemini 1.5 Flash tiene un contexto muy grande, pero es buena práctica controlar el tamaño.
//   const MAX_LENGTH = 300000; // Un límite generoso.
//   if (text.length > MAX_LENGTH) {
//     text = text.substring(0, MAX_LENGTH) + '... [CONTENIDO TRUNCADO]';
//   }
  
//   return text;
// }


// /**
//  * Llama a la API de Gemini para obtener un resumen del contenido de un artículo, no solo de su URL.
//  * Esta función está "anclada" (grounded) al contenido real del post.
//  */
// function getGeminiSummaryGCP(articleUrl) {
//   // Paso 1: Obtener la API Key de forma segura desde las Propiedades del Script.
//   const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
//   if (!GEMINI_API_KEY) {
//     throw new Error('La GEMINI_API_KEY no se encuentra en las Propiedades del Script.');
//   }

//   // Corregido: Usa un nombre de modelo válido como "gemini-1.5-flash-latest".
//   const API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY;
  
//   let articleText;
//   try {
//     // Paso 2: Descargar el contenido HTML de la URL.
//     const articleResponse = UrlFetchApp.fetch(articleUrl, { muteHttpExceptions: true });
//     const responseCode = articleResponse.getResponseCode();
    
//     if (responseCode === 200) {
//       const htmlContent = articleResponse.getContentText();
//       // Paso 3: Extraer el texto limpio del HTML.
//       articleText = getTextFromHtml(htmlContent);
//     } else {
//       throw new Error(`No se pudo obtener el contenido de la URL. Código de estado: ${responseCode}`);
//     }
    
//     if (!articleText || articleText.length < 100) { // Si no hay texto o es muy corto.
//         throw new Error('No se pudo extraer suficiente contenido del artículo para resumir.');
//     }

//   } catch (e) {
//     Logger.log(`Error al descargar o procesar el artículo ${articleUrl}: ${e.message}`);
//     // Devuelve un error claro para que se registre en el documento.
//     return `*Error al Procesar Artículo*\nNo se pudo leer el contenido de la URL. Razón: ${e.message}`;
//   }

//   // Paso 4: Crear un prompt mejorado que incluya el contenido y pida al modelo que se base SOLO en él.
//   const prompt = `Eres un experto en tecnología de Google Cloud. A continuación se encuentra el texto de un artículo.
  
//   **Instrucciones:**
//   1.  Crea un título corto, atractivo y en negritas para el artículo en una sola línea.
//   2.  En la siguiente línea, escribe un resumen en un solo párrafo conciso (entre 50 y 70 palabras) en español.
//   3.  El resumen debe enfocarse en el tema principal y las conclusiones clave del texto proporcionado.
//   4.  Añade 2 o 3 emojis relevantes al final del resumen.
//   5.  **IMPORTANTE**: Basa tu respuesta exclusivamente en el siguiente texto. No inventes información ni utilices conocimiento externo.

//   **Texto del Artículo:**
//   ---
//   ${articleText}`;

//   const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
//   const options = {
//     method: 'post',
//     contentType: 'application/json',
//     payload: JSON.stringify(payload),
//     muteHttpExceptions: true
//   };

//   // El sistema de reintentos que ya tenías es una excelente idea. Lo conservamos.
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
//          // Si la API responde OK pero el contenido está bloqueado o vacío (por seguridad, etc.)
//         const blockReason = jsonResponse.promptFeedback?.blockReason || 'Estructura de respuesta inesperada';
//         Logger.log(`Respuesta de la API sin contenido. Razón: ${blockReason}. Body: ${responseBody}`);
//         throw new Error(`La API no devolvió contenido. Razón: ${blockReason}`);
//       }
//     } else if (responseCode === 429 || responseCode === 503) { // 429: Rate limit, 503: Overloaded
//       Logger.log(`Intento ${i + 1} de ${MAX_RETRIES} falló con código ${responseCode}. Reintentando en ${delay / 1000}s...`);
//       if (i < MAX_RETRIES - 1) { 
//         Utilities.sleep(delay);
//         delay *= 2; 
//       }
//     } else {
//       Logger.log(`Error en la API de Gemini: ${responseBody}`);
//       throw new Error(`La llamada a la API falló con el código ${responseCode}: ${responseBody}`);
//     }
//   }

//   throw new Error(`La llamada a la API de Gemini falló después de ${MAX_RETRIES} intentos para la URL: ${articleUrl}`);
// }

// /**
//  * Creates a draft email with the summarized content from a Google Doc.
//  * This function is a modified version of sendEmailWithSummariesGCP.
//  *
//  * @param {string} documentId The ID of the Google Document containing the summaries.
//  * @param {string} bccRecipients A comma-separated string of BCC email addresses.
//  * @param {string} subject The subject line of the email.
//  * @param {string} openingPhraseHtml The HTML content for the opening phrase of the email.
//  * @return {boolean} True if the draft was created successfully, false otherwise.
//  */
// function createDraftEmailWithSummariesGCP(documentId, bccRecipients, subject, openingPhraseHtml) {
//   try {
//     let htmlBody = getHtmlContentFromDocGCP(documentId, openingPhraseHtml);

//     const signatureHtml = `
//       <div style="font-family: Arial, sans-serif; font-size: 10pt; color: #5f6368; margin-top: 20px;">
//         --<br>
//         Oliver Hartley Lyon<br>
//         Google Cloud and Workspace Partner Engineer<br>
//         oliverhartley@google.com
//       </div>
//     `;
    
//     htmlBody += signatureHtml;

//     GmailApp.createDraft('', subject, '', {
//       bcc: bccRecipients,
//       htmlBody: htmlBody
//     });

//     Logger.log(`Successfully created email draft for recipients: ${bccRecipients}`);
//     return true;
//   } catch (e) {
//     Logger.log(`DRAFT ERROR: Failed to create email draft: ${e.message}`);
//     return false;
//   }
// }

// /**
//  * Main function to read GCP articles, group by channel, summarize, write to a Google Doc, and save as a draft email.
//  * This is a new version of summarizeArticlesGCP that saves a draft instead of sending an email.
//  */
// function saveEmailAsDraftGCP() {
//   Logger.log('Starting the saveEmailAsDraftGCP script...');
//   const ss = SpreadsheetApp.openById(GCP_SPREADSHEET_ID);
//   const sheet = ss.getSheetByName(GCP_SHEET_NAME);
//   const oldSheet = ss.getSheetByName(GCP_OLD_SHEET_NAME);

//   if (!sheet) {
//     Logger.log(`Error: Sheet '${GCP_SHEET_NAME}' not found in the spreadsheet.`);
//     return;
//   }
//   if (!oldSheet) {
//     Logger.log(`Error: Sheet '${GCP_OLD_SHEET_NAME}' not found.`);
//     return;
//   }

//   const dataRange = sheet.getDataRange();
//   const values = dataRange.getDisplayValues();
//   const headers = values[0];
  
//   const linkColumnIndex = headers.indexOf(GCP_COLUMN_HEADER_LINK);
//   const channelColumnIndex = headers.indexOf(GCP_COLUMN_HEADER_CHANNEL);

//   if (linkColumnIndex === -1) {
//     Logger.log(`Error: Column '${GCP_COLUMN_HEADER_LINK}' not found.`);
//     return;
//   }
//   if (channelColumnIndex === -1) {
//     Logger.log(`Error: Column '${GCP_COLUMN_HEADER_CHANNEL}' not found. Grouping requires this column.`);
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
//     Logger.log('Info: No new article links found. Exiting script.');
//     return;
//   }

//   Logger.log(`Found ${articlesToProcess.length} articles to process.`);

//   const groupedArticles = {};
//   articlesToProcess.forEach(article => {
//     if (!groupedArticles[article.channel]) {
//       groupedArticles[article.channel] = [];
//     }
//     groupedArticles[article.channel].push(article.link);
//   });

//   const today = new Date();
//   const docDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
//   const docTitle = GCP_DOCUMENT_BASE_TITLE + docDate;
//   let doc;
//   let documentUrl = '';

//   try {
//     const docs = DriveApp.getFilesByName(docTitle);
//     if (docs.hasNext()) {
//       doc = DocumentApp.openById(docs.next().getId());
//       doc.getBody().clear();
//       Logger.log(`Opened and cleared existing document: ${docTitle}`);
//     } else {
//       doc = DocumentApp.create(docTitle);
//       Logger.log(`Created new document: ${docTitle}`);
//     }
//     documentUrl = doc.getUrl();
//   } catch (e) {
//     Logger.log(`FATAL ERROR: Failed to create or open Google Document: ${e.message}`);
//     return;
//   }

//   const body = doc.getBody();
//   const sortedChannels = Object.keys(groupedArticles).sort();

//   for (const channel of sortedChannels) {
//     body.appendParagraph(`Noticias ${channel}`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
//     Logger.log(`Processing channel: ${channel}`);
//     const linksInChannel = groupedArticles[channel];

//     for (const articleLink of linksInChannel) {
//       try {
//         const geminiResponse = getGeminiSummaryGCP(articleLink);
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
//         Logger.log(`-- Summarized: ${articleLink}`);
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
//   Logger.log(`Finished updating Google Doc. URL: ${documentUrl}`);

//   // --- Create Email Draft ---
//   const DRAFT_GCP_EMAIL_SUBJECT_BASE = '[DRAFT GCP Readiness] - Noticias GCP';
//   const emailDate = Utilities.formatDate(today, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'dd MMM');
//   const dynamicSubject = `${DRAFT_GCP_EMAIL_SUBJECT_BASE} ${emailDate}`;

//   const FALLBACK_PHRASE = 'Hola todos, les adjunto las ultimas noticias de Google Cloud.';
//   const randomPhraseObject = getRandomPhraseGCP(ss);
//   const openingPhraseHtml = randomPhraseObject ? convertRichTextToHtmlGCP(randomPhraseObject) : FALLBACK_PHRASE;

//   const emailSheet = ss.getSheetByName('email');
//   if (!emailSheet) {
//     Logger.log(`ERROR: Sheet 'email' not found. Cannot create email draft.`);
//   } else {
//     const bccString = emailSheet.getRange('B3').getDisplayValue().trim();
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
//         const draftCreated = createDraftEmailWithSummariesGCP(doc.getId(), finalBccList, dynamicSubject, openingPhraseHtml);
        
//         let successMessage = `SUCCESS: Summaries added to Google Document.`;
//         if (draftCreated) {
//           successMessage += ` Email draft created.`;
//         } else {
//           successMessage += ` FAILED to create email draft.`;
//         }
//         Logger.log(successMessage);
//       } else {
//         Logger.log('Warning: No valid BCC recipients found after filtering the list from email!B3. Skipping email draft creation.');
//       }
//     } else {
//       Logger.log('Warning: No BCC recipients found in email!B3. Skipping email draft creation.');
//     }
//   }

//   // --- Archive Rows ---
//   if (rowsToMoveData.length > 0) {
//     const lastRowOldSheet = oldSheet.getLastRow();
//     oldSheet.getRange(lastRowOldSheet + 1, 1, rowsToMoveData.length, rowsToMoveData[0].length).setValues(rowsToMoveData);
    
//     for (let i = rowsToProcessIndices.length - 1; i >= 0; i--) {
//       sheet.deleteRow(rowsToProcessIndices[i]);
//     }
//     Logger.log(`Moved and deleted ${rowsToMoveData.length} rows.`);
//   }
  
//   Logger.log('Script finished.');
// }