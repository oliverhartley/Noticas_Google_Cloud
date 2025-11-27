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
