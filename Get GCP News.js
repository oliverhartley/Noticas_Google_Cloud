/**
 * Clears the 'GCP' sheet and fetches the last 10 unique posts from each channel of the Google Cloud Blog RSS feed,
 * with custom date formatting.
 */
function getLatestGcpPosts() {
  const sheetName = 'GCP';
  const rssUrl = 'https://cloudblog.withgoogle.com/rss';
  const channels = [
    'Solutions & Technology',
    'AI & Machine Learning',
    'API Management',
    'Application Development',
    'Application Modernization',
    'Chrome Enterprise',
    'Compute',
    'Containers & Kubernetes',
    'Data Analytics',
    'Databases',
    'DevOps & SRE',
    'Maps & Geospatial',
    'Security',
    'Security & Identity',
    'Threat Intelligence',
    'Infrastructure',
    'Infrastructure Modernization',
    'Networking',
    'Productivity & Collaboration',
    'SAP on Google Cloud',
    'Storage & Data Transfer',
    'Sustainability',
    'Ecosystem',
    'IT Leaders',
    'Industries',
    'Financial Services',
    'Healthcare & Life Sciences',
    'Manufacturing',
    'Media & Entertainment',
    'Public Sector',
    'Retail',
    'Supply Chain',
    'Telecommunications',
    'Partners',
    'Startups & SMB',
    'Training & Certifications',
    'Inside Google Cloud',
    'Google Cloud Next & Events',
    'Google Cloud Consulting',
    'Google Maps Platform',
    'Google Workspace',
    'Developers & Practitioners',
    'Transform with Google Cloud'
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
    const channel = root.getChild('channel');
    const items = channel.getChildren('item');

    const allPosts = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const title = item.getChild('title').getText();
      const link = item.getChild('link').getText();
      const pubDate = new Date(item.getChild('pubDate').getText());
      const postCategories = item.getChildren('category').map(c => c.getText());

      allPosts.push({
        title: title,
        link: link,
        pubDate: pubDate,
        categories: postCategories
      });
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
    finalData.push(['Channel', 'Title', 'Link', 'Publication Date']);
    const addedLinks = new Set(); // To track added links and prevent duplicates

    for (const channel in channelPosts) {
      const posts = channelPosts[channel];
      posts.sort((a, b) => b.pubDate - a.pubDate);
      const latestPosts = posts.slice(0, 10);

      latestPosts.forEach(post => {
        // Check if the post link has already been added
        if (!addedLinks.has(post.link)) {
          // Format the date to "DD - Mon" format
          const formattedDate = Utilities.formatDate(post.pubDate, Session.getScriptTimeZone(), 'dd - MMM');
          finalData.push([channel, post.title, post.link, formattedDate]);
          addedLinks.add(post.link); // Add the link to the set to mark it as added
        }
      });
    }

    sheet.getRange(1, 1, finalData.length, finalData[0].length).setValues(finalData);

    // After populating the 'GCP' sheet, remove duplicates from 'GCP Old'
    removeDuplicateGcpPosts();

  } catch (e) {
    Logger.log('Error fetching or parsing RSS feed: ' + e.toString());
    sheet.getRange('A1').setValue('Error fetching or parsing RSS feed.');
  }
}

/**
 * Deletes rows in the 'GCP' sheet that are duplicates of rows in the 'GCP Old' sheet based on the link URL.
 */
function removeDuplicateGcpPosts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gcpSheet = ss.getSheetByName('GCP');
  const gcpOldSheet = ss.getSheetByName('GCP Old');

  if (!gcpSheet || !gcpOldSheet) {
    Logger.log('One or both sheets ("GCP", "GCP Old") not found.');
    return;
  }

  const gcpData = gcpSheet.getDataRange().getValues();
  const gcpOldData = gcpOldSheet.getDataRange().getValues();

  // Assuming the link is in the 3rd column (index 2)
  const gcpOldLinks = new Set(gcpOldData.map(row => row[2]));

  const rowsToDelete = [];
  for (let i = gcpData.length - 1; i >= 1; i--) { // Start from the end to avoid shifting rows
    const link = gcpData[i][2];
    if (gcpOldLinks.has(link)) {
      rowsToDelete.push(i + 1);
    }
  }

  rowsToDelete.forEach(rowNum => {
    gcpSheet.deleteRow(rowNum);
  });
}

