/**
 * Shared utilities for generating Gemini-powered email content.
 */

/**
 * Generates casual opening and closing phrases for emails using Gemini.
 * @param {string} videoTitle - The title of the video.
 * @param {string} videoDescription - The description of the video.
 * @param {string} type - 'GCP' or 'GWS'.
 * @return {object} Object with 'opening' and 'closing' phrases.
 */
function generateEmailPhrases(videoTitle, videoDescription, type) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    return {
      opening: `Hola todos, aquí están las últimas noticias de ${type === 'GCP' ? 'Google Cloud' : 'Google Workspace'}.`,
      closing: 'Pronto más noticias.'
    };
  }

  const today = new Date();
  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'dd - MMM');
  const platform = type === 'GCP' ? 'Google Cloud' : 'Google Workspace';

  const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`;

  const prompt = `
    Eres un experto en comunicación y tecnología para ${platform}.
    Quiero que generes dos frases en español para un correo electrónico sobre las últimas noticias.
    
    Contexto del video:
    Título: ${videoTitle}
    Descripción: ${videoDescription}
    Fecha de hoy: ${dateStr}
    
    Instrucciones:
    1. Genera una "frase de apertura" casual y amigable que mencione que estas son las noticias de hoy (${dateStr}). Usa el contexto del video para hacerla relevante y diferente cada vez.
    2. Genera una "frase de cierre" casual, similar a "Pronto más noticias" pero con variaciones.
    
    Responde ÚNICAMENTE con un objeto JSON válido con las claves "opening" y "closing". No incluyas markdown ni texto adicional.
  `;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }]
  };

  try {
    const response = UrlFetchApp.fetch(apiEndpoint, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      const jsonResponse = JSON.parse(response.getContentText());
      if (jsonResponse.candidates && jsonResponse.candidates[0] && jsonResponse.candidates[0].content && jsonResponse.candidates[0].content.parts && jsonResponse.candidates[0].content.parts[0]) {
        const contentText = jsonResponse.candidates[0].content.parts[0].text;
        const cleanedJsonString = contentText.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(cleanedJsonString);
      }
    }
  } catch (e) {
    Logger.log(`Error generating email phrases: ${e.toString()}`);
  }

  // Fallback
  return {
    opening: `Hola todos, aquí están las últimas noticias de ${platform} para hoy ${dateStr}.`,
    closing: 'Pronto más noticias.'
  };
}

/**
 * Gets the email list for a given type from the 'email' sheet.
 * @param {string} type - 'GCP', 'GWS', or 'Testing'.
 * @return {string} Comma-separated list of emails.
 */
function getEmailList(type) {
  const ss = SpreadsheetApp.openById('15-yneYsrmgkpJ5CGK57RVS9chMoV-ixw_w7hsPcaPuo');
  const sheet = ss.getSheetByName('email');
  if (!sheet) return '';

  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === type) {
      return data[i][1] || '';
    }
  }
  return '';
}

/**
 * Validates a comma-separated string of email addresses.
 * @param {string} emailString - Comma-separated emails.
 * @return {string[]} Array of valid email addresses.
 */
function validateEmails(emailString) {
  const allEmails = emailString.split(',');
  const validEmails = [];
  const emailRegex = /.+@.+\..+/;
  for (const email of allEmails) {
    const trimmedEmail = email.trim();
    if (trimmedEmail && emailRegex.test(trimmedEmail)) {
      validEmails.push(trimmedEmail);
    }
  }
  return validEmails;
}

/**
 * Converts timestamps in text (e.g., 0:00, 1:15) into clickable YouTube links.
 * @param {string} text - The text containing timestamps.
 * @param {string} videoUrl - The base YouTube video URL.
 * @return {string} The text with timestamps converted to HTML links.
 */
function linkifyTimestamps(text, videoUrl) {
  if (!videoUrl || !text) return text;

  let videoId = '';
  try {
    if (videoUrl.includes('v=')) {
      videoId = videoUrl.split('v=')[1].split('&')[0];
    } else if (videoUrl.includes('youtu.be/')) {
      videoId = videoUrl.split('youtu.be/')[1].split('?')[0];
    }
  } catch (e) {
    return text; // Return original text if URL parsing fails
  }

  if (!videoId) return text;

  // Regex to match timestamps like 0:00, 1:15, 1:02:30 at the beginning of a line or after a space
  // Added support for optional hours
  return text.replace(/(^|\s)((\d{1,2}:)?(\d{1,2}):(\d{2}))/gm, (match, prefix, timestamp, hours, minutes, seconds) => {
    let totalSeconds = 0;
    if (hours) {
      // hours match includes the trailing colon, e.g., "1:"
      totalSeconds += parseInt(hours.replace(':', '')) * 3600;
    }
    totalSeconds += parseInt(minutes) * 60;
    totalSeconds += parseInt(seconds);

    const link = `https://youtu.be/${videoId}?t=${totalSeconds}`;
    return `${prefix}<a href="${link}" style="color: #1a73e8; text-decoration: none;">${timestamp}</a>`;
  });
}
