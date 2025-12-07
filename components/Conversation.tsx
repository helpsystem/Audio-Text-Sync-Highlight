import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import { Icon } from './Icon.tsx';

type WordSegment = {
  word: string;
  start_time: number;
  end_time: number;
};

type LineSegment = {
    content: string;
    words: WordSegment[];
};

type TranscriptData = {
  lines: LineSegment[];
  fullTranscript: string;
};

type Status = 'idle' | 'reading' | 'transcribing' | 'detecting_chords' | 'exporting' | 'done' | 'error';
type Mode = 'speech' | 'song';

const STATUS_MESSAGES: Record<Status, string> = {
    idle: 'Drop an audio file or click to upload',
    reading: 'Reading file...',
    transcribing: 'Transcribing and structuring audio...',
    detecting_chords: 'Analyzing for musical chords...',
    exporting: 'Generating presentation (Slides + Images)...',
    done: 'Processing complete.',
    error: 'An error occurred.',
};

export const Conversation: React.FC = () => {
    const [status, setStatus] = useState<Status>('idle');
    const [mode, setMode] = useState<Mode>('speech');
    const [error, setError] = useState<string | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [transcriptData, setTranscriptData] = useState<TranscriptData | null>(null);
    const [chords, setChords] = useState<string | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [exportProgress, setExportProgress] = useState(0);
    const [totalSlides, setTotalSlides] = useState(0);
    
    // Translation & Audio
    const [persianTranscript, setPersianTranscript] = useState<string | null>(null);
    const [isTranslating, setIsTranslating] = useState(false);
    const [isGeneratingAudio, setIsGeneratingAudio] = useState<'english' | 'persian' | false>(false);
    const [generatedEnglishAudioUrl, setGeneratedEnglishAudioUrl] = useState<string | null>(null);
    const [generatedPersianAudioUrl, setGeneratedPersianAudioUrl] = useState<string | null>(null);

    // Appearance
    const [showAppearance, setShowAppearance] = useState(false);
    const [wordHighlightColor, setWordHighlightColor] = useState('#2dd4bf'); // teal-400
    const [lineHighlightColor, setLineHighlightColor] = useState('#1e293b'); // gray-800

    const audioRef = useRef<HTMLAudioElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const transcriptContainerRef = useRef<HTMLDivElement>(null);

    const resetState = useCallback(() => {
        setStatus('idle');
        setError(null);
        setFile(null);
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
        setTranscriptData(null);
        setChords(null);
        setCurrentTime(0);
        setExportProgress(0);
        setTotalSlides(0);
        setPersianTranscript(null);
        setIsTranslating(false);
        setIsGeneratingAudio(false);
        if (generatedEnglishAudioUrl) URL.revokeObjectURL(generatedEnglishAudioUrl);
        setGeneratedEnglishAudioUrl(null);
        if (generatedPersianAudioUrl) URL.revokeObjectURL(generatedPersianAudioUrl);
        setGeneratedPersianAudioUrl(null);
    }, [audioUrl, generatedEnglishAudioUrl, generatedPersianAudioUrl]);

    const fileToGenerativePart = async (file: File) => {
        const base64EncodedData = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
            reader.readAsDataURL(file);
        });
        return {
            inlineData: { data: base64EncodedData, mimeType: file.type },
        };
    };

    const transcribeAudio = async (audioFile: File, selectedMode: Mode) => {
        try {
            if (!process.env.API_KEY) throw new Error("API_KEY not found.");
            setStatus('transcribing');
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const audioPart = await fileToGenerativePart(audioFile);

            let promptText = "";
            if (selectedMode === 'song') {
                promptText = "Transcribe this worship song. Group words into natural lyric lines/stanzas in the 'lines' array. Do NOT merge stanzas into big blocks. Provide precise timestamps for every word.";
            } else {
                promptText = "Transcribe this speech. Group words into natural sentences/phrases in the 'lines' array. Provide precise timestamps for every word.";
            }

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{
                    parts: [
                        audioPart,
                        { text: promptText }
                    ]
                }],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            lines: {
                                type: Type.ARRAY,
                                description: "Array of lines (lyrics or sentences).",
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        content: { type: Type.STRING, description: "The full text content of this line/sentence." },
                                        words: {
                                            type: Type.ARRAY,
                                            items: {
                                                type: Type.OBJECT,
                                                properties: {
                                                    word: { type: Type.STRING },
                                                    start_time: { type: Type.NUMBER },
                                                    end_time: { type: Type.NUMBER },
                                                },
                                                required: ['word', 'start_time', 'end_time']
                                            }
                                        }
                                    },
                                    required: ['content', 'words']
                                }
                            }
                        },
                        required: ['lines']
                    }
                }
            });
            
            try {
                const jsonString = response.text.trim();
                const data = JSON.parse(jsonString);
                const fullTranscript = data.lines.map((l: LineSegment) => l.content).join('\n');
                
                const finalData: TranscriptData = {
                    lines: data.lines,
                    fullTranscript: fullTranscript
                };

                setTranscriptData(finalData);
                return finalData;
            } catch(parseErr) {
                console.error("JSON Parsing Error. Raw model output:", response.text, parseErr);
                throw new Error("Failed to parse the structured response from the model.");
            }
        } catch (err) {
            console.error("Transcription error:", err);
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred during transcription.";
            setError(`Failed to transcribe the audio. ${errorMessage}`);
            setStatus('error');
            return null;
        }
    };
    
    const detectChords = async (audioFile: File, transcript: string) => {
        try {
            if (!process.env.API_KEY) throw new Error("API_KEY not found.");
            setStatus('detecting_chords');
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const audioPart = await fileToGenerativePart(audioFile);

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{
                    parts: [
                        audioPart,
                        { text: `Analyze this audio file (Transcript: "${transcript}"). Identify the musical chords being played. List the chords in order of appearance or by section (Verse, Chorus, etc.). If no chords are detectable, respond with "none".` }
                    ],
                }],
            });
            
            const chordText = response.text.trim();
            if (chordText.toLowerCase() !== 'none' && chordText.length > 0) {
                setChords(chordText);
            }
        } catch (err) {
             console.error("Chord detection error:", err);
        }
    };

    const handleFile = useCallback(async (selectedFile: File) => {
        if (!selectedFile.type.startsWith('audio/')) {
            setError("Invalid file type. Please upload an audio file.");
            setStatus('error');
            return;
        }
        
        setStatus('reading');
        setFile(selectedFile);
        setAudioUrl(URL.createObjectURL(selectedFile));

        const transcription = await transcribeAudio(selectedFile, mode);
        
        if (transcription) {
            if (mode === 'song') {
                await detectChords(selectedFile, transcription.fullTranscript);
            }
            setStatus('done');
        }
    }, [mode, resetState]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('border-teal-400');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    }, [handleFile]);

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); };
    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('border-teal-400'); };
    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('border-teal-400'); };
    
    const handleDownloadTranscript = () => {
        if (!transcriptData) return;
        const blob = new Blob([transcriptData.fullTranscript], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${file?.name.split('.')[0]}_transcript.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleExportToPowerPoint = async () => {
        if (!transcriptData || !file || !audioUrl) return;
        setStatus('exporting');
        setExportProgress(0);
        setError(null);
        try {
            const PptxGenJS = (await import('pptxgenjs')).default;
            if (!process.env.API_KEY) throw new Error("API_KEY not found.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const pres = new PptxGenJS();
            
            // Set widescreen by default
            pres.layout = 'LAYOUT_16x9';

            let chunks: { text: string; start: number; end: number }[] = [];
            const lines = transcriptData.lines;

            if (mode === 'song') {
                // SONG MODE: Group by ~4 lines (Stanza)
                for (let i = 0; i < lines.length; i += 4) {
                    const slice = lines.slice(i, i + 4);
                    const text = slice.map(l => l.content).join('\n');
                    const start = slice[0]?.words[0]?.start_time || 0;
                    const lastLine = slice[slice.length-1];
                    const end = lastLine?.words[lastLine.words.length-1]?.end_time || 0;
                    chunks.push({ text, start, end });
                }
            } else {
                // SPEECH MODE: Group by ~3 lines (Paragraph)
                 for (let i = 0; i < lines.length; i += 3) {
                    const slice = lines.slice(i, i + 3);
                    const text = slice.map(l => l.content).join(' ');
                    const start = slice[0]?.words[0]?.start_time || 0;
                    const lastLine = slice[slice.length-1];
                    const end = lastLine?.words[lastLine.words.length-1]?.end_time || 0;
                    chunks.push({ text, start, end });
                }
            }

            setTotalSlides(chunks.length);
            let firstSlideReference: any = null;

            for (const [index, chunk] of chunks.entries()) {
                const slide = pres.addSlide();
                if (index === 0) firstSlideReference = slide;

                // Cube/Flip transition effect to behave like a card turning
                // @ts-ignore - pptxgenjs types might be outdated for transitions
                slide.transition = { type: 'cube', duration: 800 };

                // 1. Generate Image
                const imagePrompt = mode === 'song' 
                    ? `Abstract, spiritual, or worship background image suitable for these song lyrics: "${chunk.text}". No text in image. High quality, 4k, soft lighting.`
                    : `Create a descriptive illustration for this text: "${chunk.text}". No text in image. Cinematic lighting, professional photography style.`;

                try {
                    const imageResponse = await ai.models.generateImages({ model: 'imagen-4.0-generate-001', prompt: imagePrompt, config: { numberOfImages: 1, outputMimeType: 'image/jpeg' } });
                    const b64Image = imageResponse.generatedImages[0].image.imageBytes;
                    slide.addImage({ data: `data:image/jpeg;base64,${b64Image}`, w: '100%', h: '100%' });
                } catch (imgErr) {
                    console.warn("Image gen failed for slide", index, imgErr);
                    slide.background = { color: '111827' }; // Fallback background
                }

                // 2. The "Card" Shape (Glassmorphism style)
                // A centered rounded rectangle that holds the text
                slide.addShape("roundRect", { 
                    x: '10%', y: '15%', w: '80%', h: '70%', 
                    fill: { color: '000000', transparency: 40 },
                    rectRadius: 0.5,
                    line: { color: 'FFFFFF', width: 1, transparency: 60 },
                    shadow: { type: 'outer', color: '000000', blur: 10, offset: 5, angle: 90 }
                });
                
                // 3. Text inside the Card
                const fontSize = mode === 'song' ? 32 : 24;
                slide.addText(chunk.text, { 
                    x: '10%', y: '15%', w: '80%', h: '70%', 
                    align: 'center', valign: 'middle', 
                    color: 'FFFFFF', fontSize: fontSize, bold: true, 
                    fontFace: 'Arial' // Standard font for compatibility
                });
                
                // 4. Hidden Notes for timing (Manual)
                slide.addNotes(`Audio Segment: ${chunk.start.toFixed(2)}s - ${chunk.end.toFixed(2)}s`);

                setExportProgress(index + 1);
            }

            // 5. Embed Audio on First Slide
            if (chunks.length > 0 && firstSlideReference) {
                  const audioPart = await fileToGenerativePart(file);
                  // Embed audio icon
                  firstSlideReference.addMedia({ type: 'audio', data: `data:${file.type};base64,${audioPart.inlineData.data}`, x: 0.5, y: 0.5, w:1, h:1 });
                  firstSlideReference.addText( 'POWERED BY GEMINI', { x: 0, y: '95%', w: '100%', h: 0.25, align: 'center', fontSize: 10, color: 'AAAAAA' } );
            }
            
            await pres.writeFile({ fileName: `${file.name.split('.')[0]}_${mode}.pptx` });
            setStatus('done');
        } catch (err) {
            console.error("PowerPoint Export Error:", err);
            setError("Failed to generate PowerPoint. Please try again.");
            setStatus('error');
        } finally {
           setExportProgress(0);
           setTotalSlides(0);
        }
    };

    const handleTranslate = async () => {
        if (!transcriptData) return;
        setIsTranslating(true);
        setError(null);
        setPersianTranscript(null);
        try {
            if (!process.env.API_KEY) throw new Error("API_KEY not found.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const prompt = `Translate the following ${mode} text to fluent, natural-sounding Iranian Persian (Farsi). Maintain the original tone and intent. Do NOT use Afghani or Tajiki phrasing. Use standard Iranian Tehrani literary style.\n\nEnglish Text:\n---\n${transcriptData.fullTranscript}\n---\n\nPersian Translation:`;
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: [{ parts: [{ text: prompt }] }], });
            setPersianTranscript(response.text);
        } catch (err) {
            console.error("Translation error:", err);
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred during translation.";
            setError(`Failed to translate. ${errorMessage}`);
        } finally {
            setIsTranslating(false);
        }
    };

    function decodeBase64(base64: string) {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    const handleGenerateAudio = async (language: 'english' | 'persian') => {
        const textToSpeak = language === 'english' ? transcriptData?.fullTranscript : persianTranscript;
        if (!textToSpeak) return;

        setIsGeneratingAudio(language);
        setError(null);

        try {
            if (!process.env.API_KEY) throw new Error("API_KEY not found.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            let prompt = "";
            if (language === 'persian') {
                prompt = `
You are a highly skilled Iranian voice actor specializing in Persian literature and poetry. 
Read the following text with a polished, standard **Iranian (Tehrani)** accent.

**CRITICAL INSTRUCTIONS:**
1. **Accent:** strictly Iranian (Tehrani). Absolutely NO Afghani, Tajiki, or other regional dialects.
2. **Pronunciation:** Ensure precise pronunciation of vowels and consonants typical of formal Iranian speech.
3. **Grammar:** Pay close attention to the 'Ezafe' (Kasra) - connect words correctly (e.g., 'Ketab-e Man').
4. **Tone:** If this is a song/poem, be expressive and soulful. If prose, be articulate and clear.
5. **Emotion:** Convey the emotion inherent in the text.

Text to read:
"${textToSpeak}"
`;
            } else {
                prompt = `Read this with a clear, engaging, and natural tone: "${textToSpeak}"`;
            }

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: prompt }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
                },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                const audioBytes = decodeBase64(base64Audio);
                const pcmData = new Int16Array(audioBytes.buffer);
                const sampleRate = 24000, numChannels = 1, bytesPerSample = 2;
                const dataSize = pcmData.length * bytesPerSample;
                const buffer = new ArrayBuffer(44 + dataSize);
                const view = new DataView(buffer);
                view.setUint32(0, 0x52494646, false); // "RIFF"
                view.setUint32(4, 36 + dataSize, true);
                view.setUint32(8, 0x57415645, false); // "WAVE"
                view.setUint32(12, 0x666d7420, false); // "fmt "
                view.setUint16(16, 16, true);
                view.setUint16(20, 1, true);
                view.setUint16(22, numChannels, true);
                view.setUint32(24, sampleRate, true);
                view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
                view.setUint16(32, numChannels * bytesPerSample, true);
                view.setUint16(34, bytesPerSample * 8, true);
                view.setUint32(36, 0x64617461, false); // "data"
                view.setUint32(40, dataSize, true);
                for (let i = 0; i < pcmData.length; i++) {
                    view.setInt16(44 + i * 2, pcmData[i], true);
                }
                const audioBlob = new Blob([view], { type: 'audio/wav' });
                const url = URL.createObjectURL(audioBlob);
                if (language === 'english') setGeneratedEnglishAudioUrl(url);
                else setGeneratedPersianAudioUrl(url);
            } else {
                throw new Error("No audio data received from the API.");
            }
        } catch (err) {
            console.error("TTS Generation error:", err);
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred during audio generation.";
            setError(`Failed to generate audio. ${errorMessage}`);
        } finally {
            setIsGeneratingAudio(false);
        }
    };
    
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const timeUpdate = () => setCurrentTime(audio.currentTime);
        audio.addEventListener('timeupdate', timeUpdate);
        return () => audio.removeEventListener('timeupdate', timeUpdate);
    }, [audioUrl, status]);

    // Auto-scroll logic
    useEffect(() => {
        if (!transcriptData || !transcriptContainerRef.current) return;
        const activeLineIndex = transcriptData.lines.findIndex(line => {
             const start = line.words[0]?.start_time;
             const end = line.words[line.words.length - 1]?.end_time;
             return start !== undefined && end !== undefined && currentTime >= start && currentTime <= end;
        });

        if (activeLineIndex !== -1) {
            const container = transcriptContainerRef.current;
            const activeLineElement = container.children[activeLineIndex] as HTMLElement;
            if (activeLineElement) {
                 const containerRect = container.getBoundingClientRect();
                 const elementRect = activeLineElement.getBoundingClientRect();
                 if (elementRect.top < containerRect.top + 20 || elementRect.bottom > containerRect.bottom - 20) {
                     activeLineElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                 }
            }
        }
    }, [currentTime, transcriptData]);

    const renderTranscript = () => {
        if (!transcriptData) return null;
        
        return (
            <div className="space-y-2">
                {transcriptData.lines.map((line, lineIndex) => {
                    // Line Highlight Logic
                    const lineStart = line.words[0]?.start_time || 0;
                    const lineEnd = line.words[line.words.length - 1]?.end_time || 0;
                    const isLineActive = currentTime >= lineStart && currentTime <= lineEnd;

                    return (
                        <div 
                            key={lineIndex} 
                            className={`p-2 rounded transition-all duration-300 ${mode === 'song' ? 'text-center' : 'text-left'}`}
                            style={{ 
                                backgroundColor: isLineActive ? `${lineHighlightColor}80` : 'transparent', 
                                borderLeft: isLineActive ? `4px solid ${wordHighlightColor}` : '4px solid transparent',
                                transform: isLineActive ? 'scale(1.02)' : 'scale(1)',
                            }}
                        >
                            {line.words.map((wordObj, wordIndex) => {
                                // Word Highlight Logic
                                const isWordActive = currentTime >= wordObj.start_time && currentTime < wordObj.end_time;
                                return (
                                    <span 
                                        key={wordIndex} 
                                        className={`inline-block mx-1 transition-all duration-100 px-1 rounded ${isWordActive ? 'font-bold' : 'text-gray-300'}`}
                                        style={{ 
                                            color: isWordActive ? wordHighlightColor : undefined,
                                            textShadow: isWordActive ? `0 0 10px ${wordHighlightColor}66` : 'none',
                                            transform: isWordActive ? 'scale(1.1)' : 'scale(1)',
                                        }}
                                    >
                                        {wordObj.word}
                                    </span>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderModeSelector = () => (
        <div className="flex justify-center mb-6 bg-gray-900/40 p-1 rounded-xl w-fit mx-auto border border-gray-700">
            <button
                onClick={() => setMode('speech')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${mode === 'speech' ? 'bg-teal-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
            >
                <Icon name="book" className="w-4 h-4" /> Spoken Word (Bible/Book)
            </button>
            <button
                onClick={() => setMode('song')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${mode === 'song' ? 'bg-teal-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
            >
                <Icon name="music" className="w-4 h-4" /> Worship Song
            </button>
        </div>
    );

    const renderContent = () => {
        if (status === 'idle' || (status === 'error' && !file)) {
            return (
                <div className="text-center">
                    {renderModeSelector()}
                    <div 
                        className="relative border-2 border-dashed border-gray-600 rounded-lg p-12 cursor-pointer transition-colors hover:border-teal-500 bg-gray-800/50"
                        onDrop={handleDrop} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}
                        onClick={() => inputRef.current?.click()}
                    >
                        <input type="file" ref={inputRef} onChange={handleFileChange} accept="audio/*" className="hidden" />
                        <Icon name="upload" className="w-12 h-12 mx-auto text-gray-500" />
                        <p className="mt-4 text-gray-400">
                            {mode === 'speech' ? 'Upload Bible reading or Audiobook' : 'Upload Worship Song (Audio)'}
                        </p>
                        <p className="mt-2 text-xs text-gray-500">
                             {mode === 'speech' ? 'Focus: Transcription, Timeline, Translation' : 'Focus: Chords, Lyrics, Slide Generation'}
                        </p>
                        {error && <p className="mt-2 text-red-400">{error}</p>}
                    </div>
                </div>
            );
        }

        if (status !== 'done' && status !== 'error' ) {
             return (
                <div className="text-center p-12">
                    <div className="w-12 h-12 border-4 border-t-transparent border-teal-400 rounded-full animate-spin mx-auto"></div>
                    <p className="mt-4 text-lg text-gray-300">{STATUS_MESSAGES[status]}</p>
                    {status === 'exporting' && totalSlides > 0 && (
                        <div className="mt-4 w-full max-w-xs mx-auto">
                            <div className="w-full bg-gray-700 rounded-full h-2.5"><div className="bg-teal-400 h-2.5 rounded-full transition-all duration-300" style={{ width: `${(exportProgress / totalSlides) * 100}%` }}></div></div>
                            <p className="mt-2 text-sm text-gray-400">{`Generating slide ${exportProgress} of ${totalSlides}...`}</p>
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div>
                 {error && <p className="mb-4 text-center text-red-400 bg-red-900/50 p-3 rounded-lg">{error}</p>}
                <div className="mb-4 flex flex-wrap gap-2 justify-center items-center">
                    <button onClick={resetState} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition-colors">New File</button>
                    <button onClick={handleDownloadTranscript} className="bg-teal-600 hover:bg-teal-500 text-white font-bold py-2 px-4 rounded-lg transition-colors">Download Transcript</button>
                    <button onClick={handleExportToPowerPoint} className="bg-orange-600 hover:bg-orange-500 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2">
                      <Icon name="presentation" className="w-5 h-5" /> Export {mode === 'song' ? 'Worship Slides' : 'Presentation'}
                    </button>
                     <button onClick={handleTranslate} disabled={isTranslating || isGeneratingAudio !== false} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center gap-2">
                        {isTranslating ? <> <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"></div> Translating... </>
                        : <><Icon name="language" className="w-5 h-5" /> Translate to Persian</>}
                    </button>
                    <button onClick={() => setShowAppearance(!showAppearance)} className={`p-2 rounded-lg transition-colors ${showAppearance ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                         <Icon name="palette" className="w-6 h-6" />
                    </button>
                </div>

                {showAppearance && (
                    <div className="mb-6 bg-gray-800 p-4 rounded-lg border border-gray-700 flex flex-wrap justify-center gap-8 animate-fade-in-down">
                        <div className="flex flex-col items-center gap-2">
                            <label className="text-xs text-gray-400 uppercase font-semibold">Word Highlight (Text)</label>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="color" 
                                    value={wordHighlightColor} 
                                    onChange={(e) => setWordHighlightColor(e.target.value)} 
                                    className="w-10 h-10 rounded cursor-pointer bg-transparent border-0 p-0"
                                />
                                <span className="text-sm font-mono text-gray-300">{wordHighlightColor}</span>
                            </div>
                        </div>
                         <div className="flex flex-col items-center gap-2">
                            <label className="text-xs text-gray-400 uppercase font-semibold">Line Highlight (Bg)</label>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="color" 
                                    value={lineHighlightColor} 
                                    onChange={(e) => setLineHighlightColor(e.target.value)} 
                                    className="w-10 h-10 rounded cursor-pointer bg-transparent border-0 p-0"
                                />
                                <span className="text-sm font-mono text-gray-300">{lineHighlightColor}</span>
                            </div>
                            <span className="text-xs text-gray-500">(50% Opacity)</span>
                        </div>
                    </div>
                )}

                <audio ref={audioRef} src={audioUrl!} controls className="w-full mb-4" />
                
                <div className={`grid gap-4 ${persianTranscript ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
                    {/* English Section */}
                    <div className="flex flex-col">
                         <div className="flex justify-between items-center mb-2">
                            <h3 className="font-semibold text-lg text-teal-400">Original ({mode === 'song' ? 'Lyrics' : 'Transcript'})</h3>
                            {!generatedEnglishAudioUrl && (
                                <button onClick={() => handleGenerateAudio('english')} disabled={isGeneratingAudio !== false || isTranslating} className="bg-teal-600 hover:bg-teal-500 text-white font-bold py-1 px-3 text-sm rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center gap-1.5">
                                    {isGeneratingAudio === 'english' ? <><div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"></div> Gen... </> : <><Icon name="audio-wave" className="w-4 h-4" /> TTS</>}
                                </button>
                            )}
                        </div>
                         {generatedEnglishAudioUrl && <audio src={generatedEnglishAudioUrl} controls className="w-full mb-2 h-8" />}
                        <div ref={transcriptContainerRef} className="p-6 bg-gray-900/70 rounded-lg max-h-96 overflow-y-auto border border-gray-700 flex-grow">
                            {renderTranscript()}
                        </div>
                    </div>

                    {/* Persian Section */}
                    {persianTranscript && (
                         <div className="flex flex-col">
                            <div className="flex justify-between items-center mb-2">
                                 <h3 className="font-semibold text-lg text-blue-400">Translation (Persian)</h3>
                                 {!generatedPersianAudioUrl && (
                                    <button onClick={() => handleGenerateAudio('persian')} disabled={isGeneratingAudio !== false || isTranslating} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-1 px-3 text-sm rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center gap-1.5">
                                        {isGeneratingAudio === 'persian' ? <><div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"></div> Gen... </> : <><Icon name="audio-wave" className="w-4 h-4" /> TTS</>}
                                    </button>
                                 )}
                            </div>
                            {generatedPersianAudioUrl && <audio src={generatedPersianAudioUrl} controls className="w-full mb-2 h-8" />}
                            <div className="p-6 bg-gray-900/70 rounded-lg max-h-96 overflow-y-auto border border-gray-700 flex-grow" dir="rtl">
                                <p className="text-lg leading-relaxed text-right font-vazir text-gray-200 whitespace-pre-wrap">{persianTranscript}</p>
                            </div>
                         </div>
                    )}
                </div>

                {chords && (
                    <div className="mt-4 p-4 bg-gray-800 rounded-lg border border-teal-500/30">
                        <h3 className="text-lg font-semibold text-teal-400 mb-2 flex items-center gap-2">
                            <Icon name="music" className="w-5 h-5" /> Detected Chords
                        </h3>
                        <pre className="whitespace-pre-wrap font-mono text-sm text-gray-300 overflow-x-auto">
                            {chords}
                        </pre>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="p-4 w-full">
            {renderContent()}
        </div>
    );
};