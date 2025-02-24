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

// Launch the browser instance once at startup
let browserPromise = chromium.launch({ headless: true });

// --- Session Pool Implementation --- //

const POOL_SIZE = 3; // adjust based on expected concurrency
const sessionPool = [];

// Prepare a new session (context + page pre-warmed to login state)
const prepareSession = async () => {
  const browser = await browserPromise;
  const context = await browser.newContext({
    userAgent: USER_AGENT_STRINGS[Math.floor(Math.random() * USER_AGENT_STRINGS.length)]
  });
  const page = await context.newPage();
  // Directly load the prelogin URL to bypass extra navigation
  await page.goto("https://vtop.vit.ac.in/vtop/prelogin/setup?_csrf=915d4b89-b5a2-4004-b733-bf07d64cc0f5&flag=VTOP", { waitUntil: "domcontentloaded" });
  console.log("Prelogin page loaded (pre-warm)");
  // Wait for captcha to appear and solve it
  await page.waitForSelector("#captchaStr", { state: "visible" });
  console.log("Captcha detected in pre-warm. Solving captcha...");
  await solveCaptcha(page);
  return { context, page };
};

// Initialize the pool with ready sessions
const initializePool = async () => {
  for (let i = 0; i < POOL_SIZE; i++) {
    try {
      const session = await prepareSession();
      sessionPool.push(session);
      console.log(`Session ${i + 1} prepared and added to pool.`);
    } catch (e) {
      console.error("Error preparing session:", e);
    }
  }
};

// Reset a session after use: clear cookies and re-prewarm it
const resetSession = async (session) => {
  try {
    await session.context.clearCookies();
    await session.page.goto("https://vtop.vit.ac.in/vtop/prelogin/setup?_csrf=915d4b89-b5a2-4004-b733-bf07d64cc0f5&flag=VTOP", { waitUntil: "domcontentloaded" });
    console.log("Session reset: Prelogin page reloaded");
    await session.page.waitForSelector("#captchaStr", { state: "visible" });
    console.log("Captcha detected in reset. Solving captcha...");
    await solveCaptcha(session.page);
  } catch (e) {
    console.error("Error resetting session:", e);
  }
};

// --- End Session Pool Implementation --- //

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

// Use a ready session from the pool to complete the login and data extraction flow
const getVtopData = async (username, password, semIndex = 0) => {
  const Alldata = {};
  let semId = null;

  // Get a ready session from the pool; if none available, prepare one on demand
  let session;
  if (sessionPool.length > 0) {
    session = sessionPool.shift();
  } else {
    session = await prepareSession();
  }
  const { context, page } = session;

  try {
    // With the session pre-warmed, just fill in credentials
    await page.fill("#username", username);
    await page.fill("#password", password);
    console.log("Credentials filled. Solving captcha and logging in...");
    await solveCaptcha(page);
    try {
      await page.waitForLoadState("networkidle");
    } catch (e) {
      // Ignore load state errors if they occur
    }

    let errorType = await checkForErrors(page);
    if (errorType) {
      if (errorType === "captcha") {
        console.log("Invalid Captcha detected. Retrying captcha solver once...");
        await solveCaptcha(page);
        try {
          await page.waitForLoadState("networkidle");
        } catch (e) {}
        errorType = await checkForErrors(page);
        if (errorType) {
          console.log("Captcha solving failed. Exiting request.");
          throw { status: 400, message: "Captcha solving failed." };
        }
      } else if (errorType === "login" || errorType === "credentials") {
        console.log(`Error: ${errorType} issue detected. Please check your credentials.`);
        throw { status: 401, message: "Invalid credentials." };
      } else {
        console.log("Unknown error detected. Exiting request.");
        throw { status: 500, message: "Unknown error occurred." };
      }
    }

    if (!page.url().startsWith("https://vtop.vit.ac.in/vtop/content")) {
      console.log("Login unsuccessful. Exiting request.");
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

    // Execute additional data extraction scripts
    for (const [key, script] of Object.entries(JS_SCRIPTS)) {
      const data = await executeJavascript(page, script, semId);
      if (data !== null) {
        Alldata[key] = data;
      }
    }

    return Alldata;
  } catch (e) {
    console.error(`Error during scraping: ${e}`);
    throw { status: e.status || 500, message: e.message || "Scraping failed." };
  } finally {
    // Reset the session and put it back into the pool for the next request
    await resetSession(session);
    sessionPool.push(session);
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

// Initialize the session pool at startup
initializePool().then(() => {
  console.log("Session pool initialized.");
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch((err) => {
  console.error("Failed to initialize session pool:", err);
  process.exit(1);
});
