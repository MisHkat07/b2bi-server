const playwright = require("playwright");
const axios = require("axios");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);
const urlLib = require("url");
const cheerio = require("cheerio");
const dns = require("dns").promises;
const tls = require("tls");
require("dotenv").config();

function checkSSL(host) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      443,
      host,
      { servername: host, timeout: 7000 },
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
async function scrapeWebsiteForInfo(url) {
  let browser;
  try {
    // Check if site is online
    const statusCheck = await axios.get(url, { timeout: 8000 });
    const websiteStatus = statusCheck.status === 200 ? "Online" : "Unavailable";

    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
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
      const contactUrls = [`${url}/contact`, `${url}/contact-us`];
      for (const contactUrl of contactUrls) {
        try {
          await page.goto(contactUrl, {
            waitUntil: "domcontentloaded",
            timeout: 10000,
          });
          const contactPageContent = await page.content();
          emailMatches =
            contactPageContent.match(
              /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
            ) || [];
          emails = Array.from(new Set([...emails, ...emailMatches]));
          let emailObjects = emails.map((e) => ({
            email: e,
            domain: e.split("@")[1],
          }));
          const mailtoLinks = await page.$$eval(
            'a[href^="mailto:"]',
            (anchors) => anchors.map((a) => a.href)
          );
          for (const mailto of mailtoLinks) {
            const mail = mailto.replace("mailto:", "").split("?")[0];
            if (mail && !emails.includes(mail)) {
              emails.push(mail);
            }
          }
          emailObjects = emails.map((e) => ({
            email: e,
            domain: e.split("@")[1],
          }));
        } catch (error) {}
      }
    }

    // Extract LinkedIn
    let linkedIn = null;
    const allLinks = await page.$$eval("a", (anchors) =>
      anchors.map((a) => a.href)
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

    let hasSSL = url.startsWith("https://");
    if (!hasSSL) {
      try {
        const parsed = urlLib.parse(url);
        const httpsUrl = `https://${parsed.host}`;
        const httpsResponse = await page.goto(httpsUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        if (httpsResponse && httpsResponse.url().startsWith("https://")) {
          hasSSL = true;
        }
      } catch (sslErr) {}
    }

    const parsedHost = new URL(url).hostname;
    hasSSL = await checkSSL(parsedHost);
    const pageSpeed = await getPageSpeedScore(url);
    const gptInsights = await analyzeWithGPT({
      name: $("title").text(),
      websiteUri: url,
      linkedIn,
      types: [],
      formattedAddress: "",
      hasSSL,
    });
    console.log(gptInsights);
    return {
      emails,
      linkedIn,
      hasSSL,
      websiteStatus,
      gptInsights,
      pageSpeed,
    };
  } catch (err) {
    return {
      emails: [],
      linkedIn: null,
      hasSSL: url.startsWith("https://"),
      websiteStatus: "Unavailable",
      pageSpeed: null,
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

async function analyzeWithGPT(data) {
  const { name, websiteUri, linkedIn, types, formattedAddress, hasSSL } = data;

  const prompt = `
You are an intelligent business insight extractor. Use the details below to generate a json data of the business, focusing on its professionalism, digital presence, and overall online reputation.

Business Name: ${name}
Website: ${websiteUri}
LinkedIn: ${linkedIn || "N/A"}
Address: ${formattedAddress}
Business Types: ${types?.join(", ") || "N/A"}
SSL Secured: ${hasSSL ? "Yes" : "No"}

Now, extract and include the following additional insights with a bulleted list:
Estimated number of employees and their profiles and roles
Company size or revenue range
CEO or founder's names and social media profile links if available
CEO or founder's recent social media posts
Registered Year or company age
New store opening or expansion plans or new products or services
Company description or mission statement
Overall business progress or industry positioning
Publicly available social media links or handles (LinkedIn, Twitter/X, Instagram, etc.)
Latest updates or posts from their LinkedIn profile (if available)
Any indication of current hiring status or job openings

If some data is not directly available, infer reasonable assumptions based on available sources. Format your response in json way. This is the required format: {
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
  "employees": [
    {
      "name": "",
      "role": "",
      "email": "",
      "phone": "",
      "socialHandles": []
    },
    {
      "name": "",
      "role": "",
      "email": "",
      "phone": "",
      "socialHandles": []
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
  ]
}

only send data, no extra text or explanation. Do not include any other information. Do not include any code blocks. Do not include any markdown formatting. Do not include any links. Do not include any URLs. Do not include any HTML tags. Do not include any JSON formatting. Do not include any JSON keys or values. Do not include any JSON arrays or objects. Do not include any JSON properties or attributes. Do not include any JSON strings or numbers. Do not include any JSON booleans or null values.
`;

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini-search-preview",
      messages: [
        { role: "system", content: "You're a business intelligence analyst." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    }
  );
  // Try to parse the response as JSON, fallback to string if parsing fails
  let gptContent = response.data.choices[0].message.content.trim();
  let gptObj = {};
  try {
    gptObj = JSON.parse(gptContent);
  } catch (e) {
    gptObj = { raw: gptContent };
  }
  return gptObj;
}

module.exports = {
  scrapeWebsiteForInfo,
};
