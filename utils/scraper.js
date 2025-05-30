const playwright = require("playwright");
const axios = require("axios");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);
const urlLib = require("url");
const cheerio = require("cheerio");
const dns = require("dns").promises;
const tls = require("tls");
const BusinessType = require("../models/BusinessType");
require("dotenv").config();

function checkSSL(host) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      443,
      host,
      { servername: host, timeout: 20000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert && Object.keys(cert).length > 0);
      }
    );
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
async function scrapeWebsiteForInfo(
  url,
  name,
  types,
  formattedAddress,
  userBusinessTypeId,
  userServiceAreas,
  userBusinessTypeName
) {
  let browser;
  browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  let websiteStatus = "Unavailable";
  let finalUrl = url;
  let hasSSL = url?.startsWith("https://") ? true : false;
  let pageSpeed;
  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    if (response && response.status() < 400) {
      websiteStatus = "Online";
      finalUrl = response.url();
      hasSSL = finalUrl.startsWith("https://") ? true : false;
      if (!hasSSL) {
        try {
          const parsedUrl = new URL(finalUrl);
          const host = parsedUrl.hostname;
          hasSSL = await checkSSL(host);
        } catch (sslErr) {
          hasSSL = false;
        }
      }
    } else {
      websiteStatus = "Unavailable";
    }

    if (!hasSSL) {
      try {
        const parsedHost = new URL(finalUrl).hostname;
        hasSSL = await checkSSL(parsedHost);
      } catch (sslErr) {
        hasSSL = false;
      }
    }

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g;
    const content = await page.content();
    let emailMatches = content.match(emailRegex) || [];
    let emails = Array.from(new Set(emailMatches));
    const $ = cheerio.load(content);

    // Extract emails
    const pageText = await page.innerText("body");
    let textEmailMatches =
      pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    emails = Array.from(new Set([...emails, ...textEmailMatches]));
    if (emails.length === 0) {
      const contactUrls = [`${finalUrl}/contact`, `${finalUrl}/contact-us`];
      for (const contactUrl of contactUrls) {
        try {
          await page.goto(contactUrl, {
            waitUntil: "domcontentloaded",
            timeout: 20000,
          });
          const contactPageContent = await page.content();
          emailMatches =
            contactPageContent.match(
              /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
            ) || [];
          emails = Array.from(new Set([...emails, ...emailMatches]));
          const mailtoLinks = await page.$$eval(
            'a[href^="mailto:"]',
            (anchors) =>
              anchors
                .filter((a) => a instanceof HTMLAnchorElement)
                .map((a) => a.href)
          );
          for (const mailto of mailtoLinks) {
            const mail = mailto.replace("mailto:", "").split("?")[0];
            if (mail && !emails.includes(mail)) {
              emails.push(mail);
            }
          }
        } catch (error) {}
      }
    }
    // Extract LinkedIn
    let linkedIn = null;
    const allLinks = await page.$$eval("a", (anchors) =>
      anchors
        .map((a) => (a instanceof HTMLAnchorElement ? a.href : null))
        .filter(Boolean)
    );
    linkedIn =
      allLinks.find(
        (link) =>
          link.toLowerCase().includes("linkedin.com/in/") ||
          link.toLowerCase().includes("linkedin.com/company/")
      ) || null;
    if (!linkedIn) {
      const googleRedirect = allLinks.find(
        (link) =>
          link.startsWith("https://www.google.com/url") &&
          link.includes("linkedin.com") &&
          link.includes("url=")
      );
      if (googleRedirect) {
        try {
          const urlParams = new URLSearchParams(googleRedirect.split("?")[1]);
          const realUrl = urlParams.get("url");
          if (
            realUrl &&
            (realUrl.includes("linkedin.com/in/") ||
              realUrl.includes("linkedin.com/company/"))
          ) {
            linkedIn = decodeURIComponent(realUrl);
          }
        } catch (e) {}
      }
    }
    pageSpeed = await getPageSpeedScore(finalUrl);

    const gptInsights = await analyzeWithGPT(
      {
        name,
        websiteUri: finalUrl,
        types,
        formattedAddress,
        hasSSL,
      },
      userBusinessTypeId,
      userServiceAreas,
      userBusinessTypeName
    );
   
    return {
      emails,
      linkedIn,
      hasSSL,
      websiteStatus,
      gptInsights,
      pageSpeed,
    };
  } catch (err) {
    const gptInsights = await analyzeWithGPT(
      {
        name,
        websiteUri: finalUrl,
        types,
        formattedAddress,
        hasSSL,
      },
      userBusinessTypeId,
      userServiceAreas,
      userBusinessTypeName
    );
    return {
      emails: [],
      linkedIn: null,
      hasSSL,
      gptInsights,
      websiteStatus,
      pageSpeed,
      scrapeError: err.message,
    };
  } finally {
    if (browser) await browser.close();
  }
}

async function getPageSpeedScore(website) {
  try {
    const apiKey = process.env.PAGESPEED_INSIGHTS_API_KEY;
    if (!apiKey) return null;
    const url = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(
      website
    )}&key=${apiKey}`;
    const response = await axios.get(url);
    const { lighthouseResult } = response.data;
    return {
      performance: lighthouseResult?.categories?.performance?.score * 100,
      lcp: lighthouseResult.audits?.["largest-contentful-paint"].displayValue
        ? lighthouseResult.audits["largest-contentful-paint"].displayValue
        : null,
      fcp: lighthouseResult.audits?.["first-contentful-paint"].displayValue
        ? lighthouseResult.audits["first-contentful-paint"].displayValue
        : null,
      tti: lighthouseResult.audits?.["interactive"].displayValue
        ? lighthouseResult.audits["interactive"].displayValue
        : null,
      load_time:
        lighthouseResult?.audits?.["metrics"]?.details?.items?.[0]
          ?.observedLoad || null,
    };
  } catch (error) {
    return { error: "PageSpeed Insights API failed", details: error.message };
  }
}

async function analyzeWithGPT(
  data,
  userBusinessTypeId,
  userServiceAreas,
  userBusinessTypeName
) {
  const { name, websiteUri, linkedIn, types, formattedAddress, hasSSL } = data;

  // Dynamic prompt construction
  const userServiceDetails =
    userServiceAreas && userServiceAreas.length
      ? `Service Types: ${userServiceAreas.join(", ")}`
      : "Service Types: (not specified)";
  const businessTypeText = userBusinessTypeName
    ? userBusinessTypeName
    : "Digital Marketer";

  // Default prompt
  const defaultPrompt = `
  Suppose you are an intelligent business insight extractor. And I'm a ${businessTypeText}. My expected output is I want to approach my services to the target business. I will give the data input regarding the target business. Based on the input, analyse the marketing intent of the business by examining publicly available information such as their website performance, website content, Google presence, social media presence, and recent activities. Also, gather detailed information about the business's administration-level personnel, including names, positions, social media profiles, professional interests, and recent professional engagements or activities. Analyse the latest activities of their CEO and their social post presence, and see if there are any marketing opportunities.
  Try to scrape their latest social media activity and posts as much as possible, including the links to the posts. Analyse what their Key Performance Indicators and scope to improve sectors are, and how a Marketer can find the business approachable on the basis of their business types and their needs.
  As this prompt's result will help b2b client selection, get the info accordingly, which gonna to help make a decision. If you need to add extra fields in JSON, then add.

  Use the details below to generate a JSON data of the business, focusing on its professionalism, digital presence, and overall online reputation.
  
  * My Service Details : 
  ${userServiceDetails}

  * Target Business Details :
  Business Name: ${name}
  Website: ${websiteUri ? websiteUri : "N/A"}
  Address: ${formattedAddress ? formattedAddress : "N/A"}
  Business Types: ${types?.join(", ") || "N/A"}

  
  
  Now, extract and include the following additional insights with a bulleted list: 
  * The Managers and company heads and their profiles, roles and latest social activities
  * Based on their activities, determine their interests.
  * Company size or revenue range 
  * CEO or founder's names and social media profile links if available 
  * CEO or founder's recent social media posts and insight about their interests
  * Registered Year or company age 
  * New store opening or expansion plans or new products, or services 
  * Company description or mission statement 
  * Overall business progress or industry positioning 
  * Publicly available social media links or handles (LinkedIn, Twitter/X, Instagram, etc.) 
  * Latest updates or posts from their LinkedIn profile (if available) 
  * Any indication of current hiring status or job openings 
  * Marketing Intent Analysis
  * Marketing Opportunities or Approachable fields.
  * Key Performance Indicators, their shortcomings and possible improvements.
  * Determine the scopes to approach them based on the services I'm offering and their business intent and fields of lack. 
  * How can I approach them in the optimum way?
  * Based on what my service offers and what the targeted business lacks, give the "marketing opportunities".
  * It'd be better if you could analyse their key Improvement scopes and what my service offers, give a possibility score to make a successful approach to them. Like ''possibility": 50%


  If some data is not directly available, infer reasonable assumptions based on available sources.No dummy fake data will be acceptable from you.

  Format your response in JSON. This is the required format: 
  { 
    "company": { 
      "name": "", 
      "foundingYear": 2020 
    }, 
    "leadership/Managers/Administration": [ 
      { 
        "name": "", 
        "role": "", 
        "linkedin": "", 
        "email": "", 
        "phone": "" 
      } 
    ],
    "socialMedia": [ 
      { 
        "platform": "LinkedIn", 
        "url": "" 
      }, 
      { 
        "platform": "Twitter", 
        "url": "" 
      } 
    ], 
    "publicPosts/JobPosts": [ 
      { 
        "date": "", 
        "content": "", 
        "source": "" 
      } 
    ],
  "marketing_intent_analysis": "",
  "marketing_opportunities":"",
  "keyPoints":[],
  "approachable_fileds":[{
        "field": "",
        "description": ""
      }],
  "approach_strategy": "",
  "possibility": "",
  } 
  
  only send data, no extra text or explanation. Do not include any other information. Do not include code blocks. Do not include markdown formatting. Do not include links. Do not include URLs. Do not include HTML tags. Do not include JSON formatting. Do not include JSON keys or values. Do not include code
`;

  let prompt = defaultPrompt;
  if (userBusinessTypeId) {
    // Try to fetch the business type and use its custom prompt if available
    const businessTypeDoc = await BusinessType.findById(
      userBusinessTypeId
    ).lean();
    // Fix type mismatch for businessTypeDoc.prompt
    if (businessTypeDoc && typeof businessTypeDoc.prompt === "string") {
      prompt = businessTypeDoc.prompt;
    }
  }

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini-search-preview",
        messages: [
          {
            role: "system",
            content:
              "You're a business intelligence and Market Intent  analyst. Who will suggest the approachable ways for tagret business.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 1500,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    let gptContent = response.data.choices[0].message.content.trim();
    let gptObj = {};
    try {
      gptObj = JSON.parse(gptContent);
    } catch (e) {
      gptObj = { raw: gptContent };
    }
    return gptObj;
  } catch (error) {
    console.error("Error calling OpenAI API:", error.message);
    return {
      error: "OpenAI API error",
      status: error.response?.status || "Unknown",
      details: error.message,
    };
  }
}

module.exports = {
  scrapeWebsiteForInfo,
  getPageSpeedScore,
  analyzeWithGPT,
};
