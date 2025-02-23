const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());

// Preload JavaScript files to avoid repeated disk I/O
const preloadScript = (path) => fs.readFileSync(path, 'utf8');

const CAPTCHA_SOLVER_SCRIPT = preloadScript("utilities/captchasolver.js");
const SEMESTER_SCRIPT = preloadScript("utilities/scraper.js");
const JS_SCRIPTS = {
  "Attendance": preloadScript("utilities/Attendancescraper.js"),
  "Course": preloadScript("utilities/Coursescraper.js"),
  "Marks": preloadScript("utilities/Marksscraper.js"),
  "CGPA": preloadScript("utilities/CGPAscraper.js"),
  "ExamSchedule": preloadScript("utilities/ExamSchedulescraper.js"),
};

const USER_AGENT_STRINGS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.2227.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
];

// Launch browser instance once at startup
let browserPromise = chromium.launch({ headless: true });

const executeJavascript = async (page, script, semId = null) => {
  if (semId) {
    script = script.replace(/\bsemId\b/g, `'${semId}'`);
  }
  try {
    const result = await page.evaluate(script);
    try {
      return JSON.parse(result);
    } catch (e) {
      return result;
    }
  } catch (e) {
    console.error(`Error executing JS: ${e}`);
    return null;
  }
};

const solveCaptcha = async (page) => {
  try {
    await page.evaluate(CAPTCHA_SOLVER_SCRIPT);
    console.log("Captcha solver executed.");
  } catch (e) {
    console.error(`Error solving captcha: ${e}`);
  }
};

const checkForErrors = async (page) => {
  try {
    const bodyText = await page.innerText("body");
    if (bodyText.includes("Invalid Captcha")) return "captcha";
    if (bodyText.includes("Invalid LoginId/Password")) return "login";
    if (bodyText.includes("Invalid credentials.")) return "credentials";
    return null;
  } catch (e) {
    console.error(`Error checking errors: ${e}`);
    return null;
  }
};

const getVtopData = async (username, password, semIndex = 0) => {
  const Alldata = {};
  let semId = null;

  // Create a new context per request from the persistent browser instance
  const browser = await browserPromise;
  const context = await browser.newContext({
    userAgent: USER_AGENT_STRINGS[Math.floor(Math.random() * USER_AGENT_STRINGS.length)]
  });
  const page = await context.newPage();

  try {
    // Directly navigate to the prelogin URL to bypass extra navigation steps
    await page.goto("https://vtop.vit.ac.in/vtop/prelogin/setup?_csrf=915d4b89-b5a2-4004-b733-bf07d64cc0f5&flag=VTOP", { waitUntil: "domcontentloaded" });
    console.log("Direct login page loaded");

    // Wait for the captcha element to appear using default timeout
    await page.waitForSelector("#captchaStr", { state: "visible" });
    console.log("Captcha detected, proceeding with login");

    // Fill in login details
    await page.fill("#username", username);
    await page.fill("#password", password);

    console.log("Solving Captcha...");
    await solveCaptcha(page);
    try {
      await page.waitForLoadState("networkidle");
    } catch (e) {
      // Ignore if network idle state is not reached immediately
    }

    let errorType = await checkForErrors(page);
    if (errorType) {
      if (errorType === "captcha") {
        console.log("Invalid Captcha detected. Retrying captcha solver...");
        const maxRetries = 20;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          await solveCaptcha(page);
          try {
            await page.waitForLoadState("networkidle");
          } catch (e) {}
          await new Promise(resolve => setTimeout(resolve, 500));
          errorType = await checkForErrors(page);
          if (!errorType && page.url().startsWith("https://vtop.vit.ac.in/vtop/content")) {
            console.log("Captcha solved successfully.");
            break;
          }
          console.log(`Retry ${attempt + 1} for captcha.`);
        }
        if (errorType) {
          console.log("Max captcha retries exceeded. Exiting.");
          await context.clearCookies();
          await context.close();
          throw { status: 400, message: "Captcha solving failed." };
        }
      } else if (errorType === "login" || errorType === "credentials") {
        console.log(`Error: ${errorType} issue detected. Please check your credentials.`);
        await context.clearCookies();
        await context.close();
        throw { status: 401, message: "Invalid credentials." };
      } else {
        console.log("Unknown error detected. Exiting.");
        await context.clearCookies();
        await context.close();
        throw { status: 500, message: "Unknown error occurred." };
      }
    }

    if (!page.url().startsWith("https://vtop.vit.ac.in/vtop/content")) {
      console.log("Login unsuccessful. Exiting.");
      await context.clearCookies();
      await context.close();
      throw { status: 401, message: "Login failed." };
    }

    console.log("Login successful. Proceeding to get data...");

    // Execute the semester script and extract data
    const semData = await executeJavascript(page, SEMESTER_SCRIPT);
    if (semData) {
      Alldata['semester'] = semData;
      try {
        semId = semData.semesters[semIndex].id;
      } catch (e) {
        console.error("Error extracting semId using semIndex:", e);
        semId = null;
      }
    } else {
      semId = null;
      console.log("Failed to get semester data.");
    }

    // Execute data extraction scripts for each key
    for (const [key, script] of Object.entries(JS_SCRIPTS)) {
      const data = await executeJavascript(page, script, semId);
      if (data !== null) {
        Alldata[key] = data;
      }
    }

    await context.clearCookies();
    await context.close();
    return Alldata;
  } catch (e) {
    console.error(`Error during scraping: ${e}`);
    await context.clearCookies();
    await context.close();
    throw { status: 500, message: `Scraping failed: ${e.message}` };
  }
};

app.get("/vtopdata", async (req, res) => {
  const { username, password, semIndex = 0 } = req.query;
  try {
    const data = await getVtopData(username, password, parseInt(semIndex));
    res.json({ status: "success", data });
  } catch (e) {
    res.status(e.status || 500).json({ status: "error", message: e.message });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
