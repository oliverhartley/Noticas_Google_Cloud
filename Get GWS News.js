/**
 * @version 1.0
 * @date 2025-11-26
 */
/**
 * Clears the 'GWS' sheet and fetches the last 10 unique posts from each channel of the Google Workspace Updates Blog RSS feed,
 * with custom date formatting.
 */
function getLatestGwsPosts() {
  const sheetName = 'GWS';
  const rssUrl = 'https://workspaceupdates.googleblog.com/feeds/posts/default'; // URL for Google Workspace Updates RSS Feed
  const channels = [
    'Comms & Meetings', 'Gmail', 'Google Chat', 'Google Calendar', 'Google Tasks', 'Google Groups', 'Google Meet', 'Google Meet hardware', 'Google Voice',
    'Content & Collaboration', 'Google Drive', 'Google Docs', 'Google Sheets', 'Google Slides', 'Google Forms', 'Google Keep', 'Google Sites', 'Google Vids',
    'Gemini', 'Gemini App', 'NotebookLM',
    'Admin & Security', 'Admin console', 'Security and Compliance', 'Directory Sync', 'Google Workspace Migrate', 'Google Vault', 'Identity', 'MDM', 'SSO',
    'Education', 'Google Workspace for Education', 'Google Classroom',
    'More', 'Google Workspace Marketplace', 'API', 'Google Apps Script', 'AppSheet', 'Mobile', 'iOS', 'Android', 'Beta', 'Additional Google services', 'Other', 'Google Workspace Add-ons'
  ];

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  // 1. Clean the sheet
  sheet.clear();

  try {
    // 2. Fetch the RSS feed
    const xml = UrlFetchApp.fetch(rssUrl).getContentText();
    const document = XmlService.parse(xml);
    const root = document.getRootElement();
    const atomNs = XmlService.getNamespace('http://www.w3.org/2005/Atom');
    const entries = root.getChildren('entry', atomNs);

    const allPosts = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const title = entry.getChild('title', atomNs).getText();
      
      // Find the alternate link which is the actual blog post URL
      const links = entry.getChildren('link', atomNs);
      let postLink = '';
      for (let j = 0; j < links.length; j++) {
        if (links[j].getAttribute('rel').getValue() == 'alternate') {
          postLink = links[j].getAttribute('href').getValue();
          break;
        }
      }

      const pubDate = new Date(entry.getChild('published', atomNs).getText());
      
      // In Atom feeds, categories are in a <category> tag with a 'term' attribute
      const postCategories = entry.getChildren('category', atomNs).map(c => c.getAttribute('term').getValue());

      if (title && postLink) {
          allPosts.push({
            title: title,
            link: postLink,
            pubDate: pubDate,
            categories: postCategories
          });
      }
    }

    const channelPosts = {};
    channels.forEach(channel => {
      channelPosts[channel] = [];
    });

    allPosts.forEach(post => {
      post.categories.forEach(category => {
        if (channels.includes(category)) {
          channelPosts[category].push(post);
        }
      });
    });

    const finalData = [];
    finalData.push(['Channel', 'Title', 'Link', 'Publication Date']); // Add Channel header
    const addedLinks = new Set(); // To track added links and prevent duplicates

    for (const channel in channelPosts) {
      const posts = channelPosts[channel];
      posts.sort((a, b) => b.pubDate - a.pubDate); // Sort newest first
      const latestPosts = posts.slice(0, 10); // Get the 10 most recent posts for the channel

      latestPosts.forEach(post => {
        // Check if the post link has already been added to avoid duplicates across channels
        if (!addedLinks.has(post.link)) {
          // Format the date to "DD - Mon" format
          const formattedDate = Utilities.formatDate(post.pubDate, Session.getScriptTimeZone(), 'dd - MMM');
          finalData.push([channel, post.title, post.link, formattedDate]);
          addedLinks.add(post.link); // Add the link to the set to mark it as added
        }
      });
    }

    if (finalData.length > 1) { // Check if any posts were actually added
        sheet.getRange(1, 1, finalData.length, finalData[0].length).setValues(finalData);
    } else {
        sheet.getRange('A1').setValue('No new posts found.');
    }

    // After populating the 'GWS' sheet, remove duplicates from 'GWS Old'
    removeDuplicateGwsPosts();

  } catch (e) {
    Logger.log('Error fetching or parsing RSS feed: ' + e.toString());
    sheet.getRange('A1').setValue('Error fetching or parsing RSS feed.');
  }
}

/**
 * Deletes rows in the 'GWS' sheet that are duplicates of rows in the 'GWS Old' sheet based on the link URL,
 * and also deletes rows where the title contains "Weekly Recap".
 * This version includes improved logging and data validation.
 */
function removeDuplicateGwsPosts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gwsSheet = ss.getSheetByName('GWS');
  const gwsOldSheet = ss.getSheetByName('GWS Old');

  if (!gwsSheet) {
    Logger.log('Error: The "GWS" sheet was not found.');
    return;
  }
  if (!gwsOldSheet) {
    Logger.log('Warning: The "GWS Old" sheet was not found. No duplicates can be removed.');
    return;
  }

  const gwsData = gwsSheet.getDataRange().getValues();
  const gwsOldData = gwsOldSheet.getDataRange().getValues();

  // Exit if there's no data in the "GWS Old" sheet to compare against.
  if (gwsOldData.length < 2) { // < 2 to account for a possible header row
    Logger.log('The "GWS Old" sheet is empty or contains only a header. No duplicates were removed based on "GWS Old".');
  }
  
  // The link is in the 3rd column (index 2). Using .trim() to avoid issues with whitespace.
  const gwsOldLinks = new Set(gwsOldData.map(row => row[2] ? row[2].toString().trim() : ''));
  Logger.log(`Found ${gwsOldLinks.size} unique links in "GWS Old" to compare against.`);

  let deletedRowCount = 0;
  // Loop backwards from the last row to the first data row (i > 0 to skip header).
  // Deleting rows while iterating backwards prevents issues with shifting row indexes.
  for (let i = gwsData.length - 1; i > 0; i--) {
    // Ensure the row and cells exist before trying to access them
    if (gwsData[i]) {
      const title = gwsData[i][1] ? gwsData[i][1].toString() : ''; // Title is in the 2nd column (index 1)
      const link = gwsData[i][2] ? gwsData[i][2].toString().trim() : ''; // Link is in the 3rd column (index 2)

      // Check if the link is a duplicate OR if the title contains "Weekly Recap"
      if (gwsOldLinks.has(link) || title.includes("Weekly Recap")) {
        gwsSheet.deleteRow(i + 1); // i + 1 is the actual sheet row number
        deletedRowCount++;
      }
    }
  }
  
  Logger.log(`Finished removing duplicates and "Weekly Recap" posts. Deleted ${deletedRowCount} rows from the "GWS" sheet.`);
}