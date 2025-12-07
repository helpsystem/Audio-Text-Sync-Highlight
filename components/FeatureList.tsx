import React from 'react';

export const FeatureList: React.FC = () => {
    return (
        <section className="mt-12 w-full max-w-3xl mx-auto text-left">
            <h2 className="text-2xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-400 mb-6">
                Key Features
            </h2>
            <div className="space-y-4 text-gray-300 bg-gray-800/40 p-6 rounded-lg ring-1 ring-white/10">
                 <div className="p-4 rounded-md bg-gray-900/50 border-l-4 border-teal-500">
                    <h3 className="font-semibold text-teal-400">Dual Mode Processing</h3>
                    <p className="text-sm mt-1">
                        Select between <strong>Spoken Word</strong> (Bible reading, audiobooks) and <strong>Worship Song</strong> modes for tailored processing.
                    </p>
                </div>
                <div className="p-4 rounded-md bg-gray-900/50">
                    <h3 className="font-semibold text-teal-400">Smart Transcription & Synchronization</h3>
                    <p className="text-sm mt-1">
                        The full text is transcribed using Gemini AI, with precise word timings for synchronized highlighting as the audio plays.
                    </p>
                </div>
                 <div className="p-4 rounded-md bg-gray-900/50">
                    <h3 className="font-semibold text-teal-400">Worship Mode: Lyrics & Chords</h3>
                    <p className="text-sm mt-1">
                        In Worship Song mode, chords are automatically detected, and the transcript is formatted as lyrics (stanzas) rather than blocks of text.
                    </p>
                </div>
                <div className="p-4 rounded-md bg-gray-900/50">
                    <h3 className="font-semibold text-teal-400">Bilingual Audio Generation</h3>
                    <p className="text-sm mt-1">
                        Translate your transcript into Persian with one click and view them side-by-side. Then, generate high-quality, natural-sounding audio for both languages.
                    </p>
                </div>
                <div className="p-4 rounded-md bg-gray-900/50">
                    <h3 className="font-semibold text-teal-400">Professional PowerPoint Export</h3>
                    <ul className="list-disc list-inside text-sm mt-2 space-y-1 pl-2">
                        <li><span className="font-medium">Worship Slides:</span> Generates lyric slides (approx. 4 lines/slide) with large text and spiritual backgrounds.</li>
                        <li><span className="font-medium">Presentation Slides:</span> Generates readable paragraph slides for spoken content.</li>
                        <li><span className="font-medium">Embedded Audio:</span> Your audio file is embedded to play along with the presentation.</li>
                    </ul>
                </div>
                 <div className="p-4 rounded-md bg-gray-900/50">
                    <h3 className="font-semibold text-teal-400">Download Transcript</h3>
                    <p className="text-sm mt-1">
                        Download the complete transcript as a text file (<code className="bg-gray-700 px-1 rounded">.txt</code>) with a single click.
                    </p>
                </div>
            </div>
        </section>
    );
};