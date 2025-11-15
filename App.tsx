import React from 'react';
import { Conversation } from './components/Conversation.tsx';
import { FeatureList } from './components/FeatureList.tsx';

function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-4xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-cyan-500">
            Audio-Text Sync & Highlight
          </h1>
          <p className="mt-2 text-lg text-gray-400">
            Upload your audio, and watch Gemini bring it to life with a synchronized transcript.
          </p>
        </header>
        <main className="bg-gray-800/50 backdrop-blur-sm rounded-2xl shadow-2xl overflow-hidden ring-1 ring-white/10">
          <Conversation />
        </main>
        
        <FeatureList />

        <footer className="text-center mt-8 text-gray-500 text-sm">
          <p>This app uses the Gemini API for transcription.</p>
          <div className="mt-4 p-4 border border-gray-700 rounded-lg bg-gray-800/30 max-w-2xl mx-auto">
             <h3 className="font-semibold text-gray-300">How to use this on your site:</h3>
             <p className="mt-1 text-left text-xs">
              This component can be integrated into your own website. You'll need to get a Gemini API key and set it up in your environment. The core logic in <code>components/Conversation.tsx</code> handles file processing, API calls, and text highlighting, which you can adapt for your needs.
             </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;