import React, { useState } from 'react';
import './App.css';

// Matches the structure returned by the worker
interface AnalysisResult {
  mxdrFitAnalysis: string;
  coldOutreachEmails: string[];
  followUpEmails: string[];
  callBattlecard: {
    talkingPoints: string[];
    questions: string[];
  };
  scrapedDataSummary?: string;
}

function App() {
  const [companyUrl, setCompanyUrl] = useState('');
  const [results, setResults] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setResults(null);

    if (!companyUrl || !companyUrl.startsWith('http')) {
      setError('Please enter a valid URL (e.g., https://www.example.com)');
      return;
    }

    setIsLoading(true);

    try {
      // The path '/api/analyze' is automatically routed to the function
      // when deployed on Cloudflare Pages.
      // Vite proxy handles this during local development.
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ companyUrl }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }

      const data: AnalysisResult = await response.json();
      setResults(data);

    } catch (err: any) {
      console.error("Analysis request failed:", err);
      setError(`Analysis failed: ${err.message}. Check the worker logs for details.`);
    } finally {
      setIsLoading(false);
    }
  };

  const renderEmail = (emailString: string, index: number) => {
    const subjectMatch = emailString.match(/^Subject:\s*(.*)/m);
    const bodyMatch = emailString.match(/Body:\s*([\s\S]*)/m);
    const subject = subjectMatch ? subjectMatch[1] : 'No Subject Found';
    const body = bodyMatch ? bodyMatch[1].trim().split('\n').map((line, i) => <p key={i}>{line}</p>) : <p>No Body Found</p>;

    return (
      <div className="email-item" key={index}>
        <strong>Subject:</strong> {subject}
        <br />
        <strong>Body:</strong>
        <div>{body}</div>
      </div>
    );
  };


  return (
    <div className="App">
      <h1>MXDR Prospect Analyzer</h1>
      <p>Enter a company website URL to analyze its potential fit for MXDR and generate sales content.</p>

      <form onSubmit={handleSubmit}>
        <input
          type="url"
          value={companyUrl}
          onChange={(e) => setCompanyUrl(e.target.value)}
          placeholder="https://www.example.com"
          required
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Analyzing...' : 'Analyze'}
        </button>
      </form>

      {isLoading && <div className="loader">Loading...</div>}

      {error && <div className="error-message">Error: {error}</div>}

      {results && (
        <div className="results-container">
          <h2>Analysis Results for {companyUrl}</h2>

          <div className="result-section">
            <h3>MXDR Fit Assessment</h3>
            <p>{results.mxdrFitAnalysis || 'No analysis provided.'}</p>
          </div>

          <div className="result-section">
            <h3>Cold Outreach Emails</h3>
            {results.coldOutreachEmails?.length > 0 ? (
              results.coldOutreachEmails.map((email, index) => renderEmail(email, index))
            ) : (
              <p>No cold outreach emails generated.</p>
            )}
          </div>

           <div className="result-section">
            <h3>Follow-up Emails</h3>
            {results.followUpEmails?.length > 0 ? (
               results.followUpEmails.map((email, index) => renderEmail(email, index + results.coldOutreachEmails.length)) // Ensure unique keys
            ) : (
              <p>No follow-up emails generated.</p>
            )}
          </div>

          <div className="result-section">
            <h3>Sales Call Battlecard</h3>
            {results.callBattlecard ? (
              <>
                <h4>Potential Talking Points:</h4>
                <ul>
                  {results.callBattlecard.talkingPoints?.length > 0 ? (
                    results.callBattlecard.talkingPoints.map((point, index) => <li key={`tp-${index}`}>{point}</li>)
                   ) : <li>No talking points generated.</li>}
                </ul>
                <h4>Probing Questions:</h4>
                 <ul>
                  {results.callBattlecard.questions?.length > 0 ? (
                    results.callBattlecard.questions.map((q, index) => <li key={`q-${index}`}>{q}</li>)
                   ) : <li>No questions generated.</li>}
                </ul>
              </>
            ) : (
               <p>No battlecard generated.</p>
            )}
          </div>

          {/* Optional: Display scraped data summary
          {results.scrapedDataSummary && (
            <div className="result-section">
              <h3>Scraped Data Summary (Debug)</h3>
              <pre>{results.scrapedDataSummary}</pre>
            </div>
          )}
          */}
        </div>
      )}
    </div>
  );
}

export default App;
