import { IttyRouter, Request as IttyRequest, error, json } from 'itty-router';
import * as cheerio from 'cheerio';

// Define the expected structure for requests to this endpoint
interface AnalyzeRequestBody {
  companyUrl: string;
}

// Define the structure for the data returned to the frontend
interface AnalysisResult {
  mxdrFitAnalysis: string;
  coldOutreachEmails: string[];
  followUpEmails: string[];
  callBattlecard: {
    talkingPoints: string[];
    questions: string[];
  };
  scrapedDataSummary?: string; // Optional: include summary for debugging/transparency
}

// Define the structure for environment variables passed to the worker
interface Env {
  GEMINI_API_KEY: string; // Secret variable
}

// Define the context available in Pages Functions
// Includes environment variables, KV namespaces, D1 databases, etc.
interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
  env: Env;
  // Add other context properties if needed (e.g., KV, DO bindings)
}

// --- Helper Functions ---

// Basic URL validation
function isValidUrl(urlString: string): boolean {
  try {
    new URL(urlString);
    return urlString.startsWith('http://') || urlString.startsWith('https://');
  } catch (_) {
    return false;
  }
}

// Scrape website content (basic implementation)
async function scrapeCompanyData(url: string): Promise<string> {
  console.log(`Attempting to scrape: ${url}`);
  try {
    const response = await fetch(url, {
      headers: {
        // Pretend to be a browser
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      // Cloudflare workers have limitations on redirects, may need handling
      // redirect: 'follow' // Be careful with this in workers
    });

    if (!response.ok) {
      throw new Error(`Scraping failed: HTTP status ${response.status} for ${url}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('text/html')) {
        throw new Error(`Scraping failed: Expected HTML content, got ${contentType} for ${url}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract relevant text content - THIS IS HIGHLY SITE-SPECIFIC AND LIKELY TO BREAK
    let scrapedText = '';
    scrapedText += $('title').text() + '\n';
    scrapedText += $('meta[name="description"]').attr('content') + '\n';
    scrapedText += $('h1, h2, h3').map((i, el) => $(el).text()).get().join('\n') + '\n';
    // Get text from paragraphs, maybe limit the length
    scrapedText += $('p').map((i, el) => $(el).text()).get().slice(0, 20).join('\n').substring(0, 4000); // Limit length

    // Look for keywords (customize these heavily)
    const keywords = ["security", "compliance", "cloud", "SaaS", "IT team", "data protection", "cybersecurity", "managed services", "technology", "careers", "about us"];
    $('a, p, li').each((i, el) => {
        const text = $(el).text().toLowerCase();
        if (keywords.some(keyword => text.includes(keyword))) {
            scrapedText += '\n' + $(el).text().substring(0, 200); // Add relevant snippets
        }
    });

    console.log(`Scraping successful for: ${url}. Data length: ${scrapedText.length}`);
    // Limit overall scraped text size to avoid huge Gemini prompts
    return scrapedText.replace(/\s+/g, ' ').trim().substring(0, 8000);

  } catch (err: any) {
    console.error(`Scraping error for ${url}:`, err);
    // Don't throw here, allow Gemini to try analysis even if scraping fails partially or fully
    return `Scraping failed for ${url}. Error: ${err.message}. Proceeding with analysis based on URL only.`;
  }
}

// Call Google Gemini API
async function callGeminiApi(scrapedData: string, companyUrl: string, apiKey: string): Promise<AnalysisResult> {
  const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

  // *** THIS IS THE CORE PROMPT - CUSTOMIZE IT THOROUGHLY ***
  const prompt = `
  Analyze the following information scraped from the company website (${companyUrl}) to assess their potential fit for Managed Extended Detection and Response (MXDR) cybersecurity services and generate sales enablement content.

  **Scraped Data:**
  ---
  ${scrapedData || 'No data could be scraped. Analyze based on the URL and general company knowledge if possible.'}
  ---

  **Analysis Task:**

  Based *only* on the provided scraped data (or lack thereof) and the company URL:

  1.  **MXDR Fit Assessment:**
      *   Estimate the company's likely size (Small, Medium, Large) and industry.
      *   Identify any indicators of their technology stack (e.g., Cloud-native, SaaS).
      *   Assess their potential need for advanced cybersecurity based on hints like compliance mentions, data sensitivity, lack of large internal security teams (inferred from job postings if seen, or lack of security pages), or industry type.
      *   Conclude with a brief summary (1-2 sentences) on whether they seem like a Low, Medium, or High potential fit for MXDR, and *why*. Be conservative if data is sparse.

  2.  **Personalized Cold Outreach Email Sequence:**
      *   Generate one initial cold outreach email (Subject + Body).
      *   Generate two distinct follow-up emails (Subject + Body).
      *   Emails should be concise, professional, reference a *potential* pain point suggested by the scraped data (or industry norms if no data), and introduce MXDR as a solution. Avoid making definitive claims not supported by the data. Personalize slightly using the company name/URL context.

  3.  **Sales Call Battlecard:**
      *   List 3-5 potential talking points relevant to the company/industry suggested by the data (e.g., "Discussing cloud security for SaaS platforms", "Addressing compliance needs in [Industry]").
      *   List 3-5 probing questions to ask a cybersecurity decision-maker at this company (e.g., "How are you currently handling threat detection across your endpoints, cloud, and network?", "What are your biggest concerns regarding ransomware or data breaches?").

  **Output Format:**

  Return the analysis as a JSON object with the following exact structure:
  {
    "mxdrFitAnalysis": "...",
    "coldOutreachEmails": ["Subject: ...\nBody: ...", "Subject: ...\nBody: ..."],
    "followUpEmails": ["Subject: ...\nBody: ...", "Subject: ...\nBody: ..."],
    "callBattlecard": {
      "talkingPoints": ["...", "..."],
      "questions": ["...", "..."]
    }
  }

  If the scraped data is insufficient for a meaningful analysis, state that clearly in the 'mxdrFitAnalysis' and provide generic (but plausible) emails/battlecard points based on common business needs, mentioning the lack of specific data. Do not invent information.
  `;

  try {
    console.log(`Calling Gemini API for ${companyUrl}...`);
    const response = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // Optional: Add safety settings, generation config if needed
        // generationConfig: { responseMimeType: "application/json" } // Request JSON output if model supports it
      }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error("Gemini API Error Response:", errorBody);
        throw new Error(`Gemini API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Process Gemini Response - Adjust based on actual API output structure
    // This assumes Gemini returns text that contains a JSON string.
    // If using responseMimeType: "application/json", parsing might be direct.
    if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
        console.error("Unexpected Gemini API response structure:", JSON.stringify(data, null, 2));
        throw new Error("Failed to parse response from Gemini API.");
    }

    const rawTextResponse = data.candidates[0].content.parts[0].text;
    console.log("Raw Gemini Response Text:", rawTextResponse);

    // Attempt to parse the JSON from the text response
    // Need to clean the response text (remove ```json ... ``` markers if present)
    let jsonString = rawTextResponse.trim();
    if (jsonString.startsWith('```json')) {
        jsonString = jsonString.substring(7); // Remove ```json\n
    }
    if (jsonString.endsWith('```')) {
        jsonString = jsonString.substring(0, jsonString.length - 3); // Remove ```
    }

    try {
        const parsedResult: AnalysisResult = JSON.parse(jsonString);
        console.log(`Gemini analysis successful for ${companyUrl}.`);
        return parsedResult;
    } catch (parseError: any) {
         console.error("Failed to parse Gemini JSON response:", parseError);
         console.error("Problematic JSON String:", jsonString);
         // Fallback: Return the raw text if JSON parsing fails, wrapped in a basic structure
         return {
             mxdrFitAnalysis: `Failed to parse structured response. Raw Gemini Output:\n${rawTextResponse}`,
             coldOutreachEmails: [],
             followUpEmails: [],
             callBattlecard: { talkingPoints: [], questions: [] }
         };
    }

  } catch (err: any) {
    console.error(`Gemini API error for ${companyUrl}:`, err);
    throw new Error(`Failed to get analysis from Gemini API: ${err.message}`);
  }
}


// --- Router Setup ---

const router = IttyRouter();

// POST /api/analyze
router.post('/api/analyze', async (request: IttyRequest, context: ExecutionContext): Promise<Response> => {
  console.log("Received request to /api/analyze");
  let body: AnalyzeRequestBody;

  try {
    body = await request.json();
  } catch (e) {
    console.error("Failed to parse request body:", e);
    return error(400, 'Invalid JSON request body.');
  }

  const companyUrl = body.companyUrl;

  if (!companyUrl || typeof companyUrl !== 'string' || !isValidUrl(companyUrl)) {
    console.warn("Invalid company URL received:", companyUrl);
    return error(400, 'Invalid or missing "companyUrl" in request body. Must be a valid URL starting with http:// or https://.');
  }

  const { env } = context; // Get environment variables (including secrets)

  if (!env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY secret is not set in Cloudflare environment.");
    return error(500, 'Server configuration error: Gemini API Key not found.');
  }

  try {
    // 1. Scrape data (allow to proceed even if scraping fails)
    const scrapedData = await scrapeCompanyData(companyUrl);

    // 2. Call Gemini for analysis
    const analysisResult = await callGeminiApi(scrapedData, companyUrl, env.GEMINI_API_KEY);

    // Include scraped summary for transparency if needed
    // analysisResult.scrapedDataSummary = scrapedData.substring(0, 500) + '...';

    console.log(`Analysis complete for ${companyUrl}. Returning results.`);
    // 3. Return results
    return json(analysisResult);

  } catch (err: any) {
    console.error(`Unhandled error during analysis for ${companyUrl}:`, err);
    // Return a generic server error
    return error(500, `Analysis failed: ${err.message}`);
  }
});

// Catch-all for other routes (404)
router.all('*', () => new Response('Not Found.', { status: 404 }));

// --- Cloudflare Worker Entry Point ---

// We use the default export fetch handler for Cloudflare Pages Functions
export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> =>
    router
        .handle(request, ctx)
        .then(response => {
            // Add CORS headers - Adjust origin as needed for local dev or stricter policies
            // Cloudflare Pages Functions usually handle this well, but being explicit can help.
            const responseWithCors = new Response(response.body, response);
            responseWithCors.headers.set('Access-Control-Allow-Origin', '*'); // Allow any origin
            responseWithCors.headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
            responseWithCors.headers.set('Access-Control-Allow-Headers', 'Content-Type');
            return responseWithCors;
        })
        .catch((err) => {
             console.error("Router error caught:", err);
             // Ensure error responses also have CORS headers
             const errorResponse = error(500, err.message || 'Internal Server Error');
             errorResponse.headers.set('Access-Control-Allow-Origin', '*');
             errorResponse.headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
             errorResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type');
             return errorResponse;
        })
};
