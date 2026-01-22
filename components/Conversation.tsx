import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import { Icon } from './Icon.tsx';

type WordSegment = {
  word: string;
  start_time: number;
  end_time: number;
};

type LineType = 'book_title' | 'chapter_title' | 'verse' | 'text' | 'lyric';

type LineSegment = {
    type: LineType;
    label?: string; // e.g., "1", "2" for verses
    content: string;
    words: WordSegment[];
};

type TranscriptData = {
  lines: LineSegment[];
  fullTranscript: string;
};

type Status = 'idle' | 'reading' | 'transcribing' | 'detecting_chords' | 'exporting' | 'done' | 'error';
type Mode = 'speech' | 'song';
type TranslationTarget = 'persian' | 'english' | 'finglish';

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
    
    // Translation
    const [translations, setTranslations] = useState<{
        persian: string | null;
        english: string | null;
        finglish: string | null;
    }>({ persian: null, english: null, finglish: null });
    const [activeTab, setActiveTab] = useState<TranslationTarget>('persian');
    const [isTranslating, setIsTranslating] = useState(false);

    // Audio Gen
    const [isGeneratingAudio, setIsGeneratingAudio] = useState<string | false>(false);
    const [generatedAudioUrls, setGeneratedAudioUrls] = useState<{
        original: string | null;
        persian: string | null;
        english: string | null;
        finglish: string | null;
    }>({ original: null, persian: null, english: null, finglish: null });

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
        setTranslations({ persian: null, english: null, finglish: null });
        setIsTranslating(false);
        setIsGeneratingAudio(false);
        
        Object.values(generatedAudioUrls).forEach(url => {
            if (typeof url === 'string') URL.revokeObjectURL(url);
        });
        setGeneratedAudioUrls({ original: null, persian: null, english: null, finglish: null });
    }, [audioUrl, generatedAudioUrls]);

    const fileToGenerativePart = async (file: File) => {
        const base64EncodedData = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                if (result) {
                    resolve(result.split(',')[1]);
                } else {
                    resolve('');
                }
            };
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
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const audioPart = await fileToGenerativePart(audioFile);

            let promptText = "";
            if (selectedMode === 'song') {
                promptText = "Transcribe this worship song. Group words into natural lyric lines/stanzas in the 'lines' array. Set type to 'lyric'. Do NOT merge stanzas into big blocks. CRITICAL: Provide highly accurate timestamps for every single word, down to the hundredth of a second (0.01s), for perfect karaoke-style synchronization.";
            } else {
                promptText = `
Transcribe this Bible reading or Speech.
Analyze the structure carefully:
1. If you detect a Book Title (e.g., 'The Book of Genesis', 'Gospel of John'), create a line with type 'book_title'.
2. If you detect a Chapter Title (e.g., 'Chapter One'), create a line with type 'chapter_title'.
3. For Verses, create a line with type 'verse'. IMPORTANT: Extract the verse number (e.g., '1', '12') and put it in the 'label' field.
4. For general text, use type 'text'.
Group words into these structural lines.
CRITICAL: Provide highly accurate timestamps for every single word, down to the hundredth of a second (0.01s), to ensure perfect synchronization with the audio.
                `;
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
                                description: "Array of structured lines.",
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        type: { 
                                            type: Type.STRING, 
                                            enum: ['book_title', 'chapter_title', 'verse', 'text', 'lyric'],
                                            description: "The structural type of this line."
                                        },
                                        label: { 
                                            type: Type.STRING,
                                            description: "The verse number (e.g. '1', '2') if this is a verse."
                                        },
                                        content: { type: Type.STRING, description: "The full text content of this line." },
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
                                    required: ['content', 'words', 'type']
                                }
                            }
                        },
                        required: ['lines']
                    }
                }
            });
            
            try {
                const jsonString = response.text?.trim();
                if (!jsonString) throw new Error("Empty response text");
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
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
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
            
            const chordText = response.text?.trim();
            if (chordText && chordText.toLowerCase() !== 'none' && chordText.length > 0) {
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
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const pres = new PptxGenJS();
            
            pres.layout = 'LAYOUT_16x9';
            const isRtl = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(transcriptData.fullTranscript);
            pres.rtl = isRtl;

            let chunks: { text: string; start: number; end: number; label?: string }[] = [];
            const lines = transcriptData.lines;

            if (mode === 'song') {
                for (let i = 0; i < lines.length; i += 4) {
                    const slice = lines.slice(i, i + 4);
                    const text = slice.map(l => l.content).join('\n');
                    const start = slice[0]?.words[0]?.start_time || 0;
                    const lastLine = slice[slice.length-1];
                    const end = lastLine?.words[lastLine.words.length-1]?.end_time || 0;
                    chunks.push({ text, start, end });
                }
            } else {
                let currentChunkLines: string[] = [];
                let chunkStart = 0;
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const lineStart = line.words[0]?.start_time || 0;
                    const lineEnd = line.words[line.words.length-1]?.end_time || 0;

                    if (line.type === 'book_title' || line.type === 'chapter_title') {
                        if (currentChunkLines.length > 0) {
                             chunks.push({ text: currentChunkLines.join(' '), start: chunkStart, end: lines[i-1].words.at(-1)?.end_time || 0 });
                             currentChunkLines = [];
                        }
                        chunks.push({ text: line.content, start: lineStart, end: lineEnd });
                        chunkStart = 0;
                    } else {
                        if (currentChunkLines.length === 0) chunkStart = lineStart;
                        const labelPrefix = line.label ? `[${line.label}] ` : '';
                        currentChunkLines.push(labelPrefix + line.content);

                        if (currentChunkLines.length >= 3 || i === lines.length - 1) {
                            chunks.push({ text: currentChunkLines.join(' '), start: chunkStart, end: lineEnd });
                            currentChunkLines = [];
                        }
                    }
                }
            }

            setTotalSlides(chunks.length);
            let firstSlideReference: any = null;

            for (const [index, chunk] of chunks.entries()) {
                const slide = pres.addSlide();
                if (index === 0) firstSlideReference = slide;
                // @ts-ignore
                slide.transition = { type: 'cube', duration: 800 };

                const imagePrompt = mode === 'song' 
                    ? `Abstract, spiritual, or worship background image suitable for these song lyrics: "${chunk.text}". No text in image. High quality, 4k, soft lighting.`
                    : `Create a descriptive illustration for this text: "${chunk.text}". No text in image. Cinematic lighting, professional photography style.`;

                try {
                    const imageResponse = await ai.models.generateImages({ model: 'imagen-4.0-generate-001', prompt: imagePrompt, config: { numberOfImages: 1, outputMimeType: 'image/jpeg' } });
                    const b64Image = imageResponse.generatedImages[0].image.imageBytes;
                    slide.addImage({ data: `data:image/jpeg;base64,${b64Image}`, w: '100%', h: '100%' });
                } catch (imgErr) {
                    console.warn("Image gen failed for slide", index, imgErr);
                    slide.background = { color: '111827' };
                }

                slide.addShape("roundRect", { 
                    x: '10%', y: '15%', w: '80%', h: '70%', 
                    fill: { color: '000000', transparency: 40 },
                    rectRadius: 0.5,
                    line: { color: 'FFFFFF', width: 1, transparency: 60 },
                    shadow: { type: 'outer', color: '000000', blur: 10, offset: 5, angle: 90 }
                });
                
                const fontSize = mode === 'song' ? 32 : 24;
                slide.addText(chunk.text, { 
                    x: '10%', y: '15%', w: '80%', h: '70%', 
                    align: 'center', valign: 'middle', 
                    color: 'FFFFFF', fontSize: fontSize, bold: true, 
                    fontFace: isRtl ? 'Vazirmatn' : 'Segoe UI',
                    rtlMode: isRtl
                });

                slide.addText("کلیسای ایرانیان واشنگتن دی سی", {
                    x: 0, y: '92%', w: '100%', h: 0.5,
                    align: 'center', fontSize: 12, color: 'E5E7EB',
                    fontFace: 'Vazirmatn',
                    bold: true,
                    shadow: { type: 'outer', color: '000000', blur: 2, offset: 1, angle: 45 }
                });
                
                slide.addNotes(`Audio Segment: ${chunk.start.toFixed(2)}s - ${chunk.end.toFixed(2)}s`);

                setExportProgress(index + 1);
            }

            if (chunks.length > 0 && firstSlideReference) {
                  const audioPart = await fileToGenerativePart(file);
                  firstSlideReference.addMedia({ type: 'audio', data: `data:${file.type};base64,${audioPart.inlineData.data}`, x: 0.5, y: 0.5, w:1, h:1 });
                  firstSlideReference.addText( 'POWERED BY GEMINI', { x: 0, y: '95%', w: '100%', h: 0.25, align: 'center', fontSize: 10, color: 'AAAAAA' } );
            }
            
            await pres.writeFile({ fileName: `${file.name.split('.')[0]}_${mode}.ppsx` });
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

    const handleTranslate = async (target: TranslationTarget) => {
        if (!transcriptData) return;
        setIsTranslating(true);
        setError(null);
        setActiveTab(target); // Switch to the tab being generated

        try {
            if (!process.env.API_KEY) throw new Error("API_KEY not found.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            
            let systemInstruction = "";
            let userPrompt = "";

            if (target === 'persian') {
                systemInstruction = "You are a professional translator. Translate text to fluent, formal Iranian Persian (Farsi).";
                userPrompt = `Translate this to Persian:\n\n${transcriptData.fullTranscript}`;
            } else if (target === 'english') {
                systemInstruction = "You are a professional translator. Translate text to fluent English.";
                userPrompt = `Translate this to English:\n\n${transcriptData.fullTranscript}`;
            } else if (target === 'finglish') {
                 systemInstruction = "You are a transliteration expert. Convert text to Finglish (Persian language using English alphabet). If input is English, translate to Persian first, then transliterate.";
                 userPrompt = `Convert this to Finglish:\n\n${transcriptData.fullTranscript}`;
            }

            const response = await ai.models.generateContent({ 
                model: 'gemini-2.5-flash', 
                config: { systemInstruction },
                contents: [{ parts: [{ text: userPrompt }] }], 
            });
            
            setTranslations(prev => ({ ...prev, [target]: response.text || null }));
        } catch (err) {
            console.error("Translation error:", err);
            setError(`Translation failed.`);
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

    const handleGenerateAudio = async (sourceKey: 'original' | 'persian' | 'english' | 'finglish') => {
        const textToSpeak = sourceKey === 'original' ? transcriptData?.fullTranscript : translations[sourceKey as TranslationTarget];
        if (!textToSpeak) return;

        setIsGeneratingAudio(sourceKey);
        setError(null);

        try {
            if (!process.env.API_KEY) throw new Error("API_KEY not found.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            
            let prompt = "";
            // Logic to choose voice/instruction based on language
            const isPersian = sourceKey === 'persian' || (sourceKey === 'original' && /[\u0600-\u06FF]/.test(textToSpeak));
            
            if (isPersian) {
                prompt = `
You are a highly skilled Iranian voice actor. Read this Persian text with a polished, standard **Iranian (Tehrani)** accent.
Be expressive.

Text: "${textToSpeak}"
`;
            } else {
                 // English or Finglish
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
                // Create WAV header
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
                setGeneratedAudioUrls(prev => ({ ...prev, [sourceKey]: url }));
            } else {
                throw new Error("No audio data received.");
            }
        } catch (err) {
            console.error("TTS Generation error:", err);
            const errorMessage = err instanceof Error ? err.message : "Error generating audio.";
            setError(`Failed to generate audio. ${errorMessage}`);
        } finally {
            setIsGeneratingAudio(false);
        }
    };
    
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        let animationFrameId: number;

        const loop = () => {
             setCurrentTime(audio.currentTime);
             if (!audio.paused && !audio.ended) {
                 animationFrameId = requestAnimationFrame(loop);
             }
        };

        const onPlay = () => loop();
        const onPause = () => cancelAnimationFrame(animationFrameId);
        
        // Basic event listeners
        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('ended', onPause);
        // Scrubbing fallback
        audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));

        return () => {
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', onPause);
            audio.removeEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
            cancelAnimationFrame(animationFrameId);
        };
    }, [audioUrl, status]);

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

        const isRtl = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(transcriptData.fullTranscript);
        const direction = isRtl ? 'rtl' : 'ltr';
        const fontFamily = isRtl ? 'font-vazir' : '';

        return (
            <div className={`space-y-4 ${fontFamily}`} dir={direction}>
                {transcriptData.lines.map((line, lineIndex) => {
                    const lineStart = line.words[0]?.start_time || 0;
                    const lineEnd = line.words[line.words.length - 1]?.end_time || 0;
                    const isLineActive = currentTime >= lineStart && currentTime <= lineEnd;

                    if (line.type === 'book_title') {
                        return (
                            <div key={lineIndex} className={`w-full bg-blue-900/40 border-blue-500 rounded-xl p-4 mb-6 transition-all duration-500 ${isLineActive ? 'shadow-lg shadow-blue-500/20 scale-[1.02] border-2' : 'border border-blue-900'}`}>
                                <h2 className="text-2xl font-bold text-center text-blue-100 uppercase tracking-widest drop-shadow-md">
                                    {line.content}
                                </h2>
                            </div>
                        );
                    }

                    if (line.type === 'chapter_title') {
                        return (
                            <div key={lineIndex} className={`w-full bg-gray-700/40 border-teal-500 rounded-lg py-2 px-4 mb-4 transition-all duration-500 ${isLineActive ? 'shadow-md shadow-teal-500/20 scale-[1.01] border-l-4' : 'border-l-2'}`}>
                                <h3 className="text-xl font-semibold text-center text-teal-200">
                                    {line.content}
                                </h3>
                            </div>
                        );
                    }

                    const isVerse = line.type === 'verse';
                    // Respect "Auto" direction, but allow center for songs
                    const textAlign = mode === 'song' ? 'text-center' : (isRtl ? 'text-right' : 'text-left');
                    
                    return (
                        <div 
                            key={lineIndex} 
                            className={`p-3 rounded-lg transition-all duration-300 ${textAlign} relative`}
                            style={{ 
                                backgroundColor: isLineActive ? `${lineHighlightColor}80` : 'transparent', 
                                borderRight: isRtl && isLineActive ? `4px solid ${wordHighlightColor}` : '4px solid transparent',
                                borderLeft: !isRtl && isLineActive ? `4px solid ${wordHighlightColor}` : '4px solid transparent',
                                transform: isLineActive ? 'scale(1.02)' : 'scale(1)',
                                boxShadow: isLineActive ? '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)' : 'none'
                            }}
                        >
                            {isVerse && line.label && (
                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold mx-2 mb-1 align-middle ${isLineActive ? 'bg-teal-500 text-white' : 'bg-gray-700 text-gray-400'}`}>
                                    {line.label}
                                </span>
                            )}

                            {line.words.map((wordObj, wordIndex) => {
                                const isWordActive = currentTime >= wordObj.start_time && currentTime < wordObj.end_time;
                                return (
                                    <span 
                                        key={wordIndex} 
                                        className={`inline-block mx-1 transition-all duration-100 px-0.5 rounded ${isWordActive ? 'font-bold' : 'text-gray-300'}`}
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

        const hasAnyTranslation = Object.values(translations).some(t => t !== null);

        return (
            <div>
                 {error && <p className="mb-4 text-center text-red-400 bg-red-900/50 p-3 rounded-lg">{error}</p>}
                <div className="mb-4 flex flex-wrap gap-2 justify-center items-center">
                    <button onClick={resetState} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition-colors">New File</button>
                    <button onClick={handleDownloadTranscript} className="bg-teal-600 hover:bg-teal-500 text-white font-bold py-2 px-4 rounded-lg transition-colors">Download Transcript</button>
                    <button onClick={handleExportToPowerPoint} className="bg-orange-600 hover:bg-orange-500 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2">
                      <Icon name="presentation" className="w-5 h-5" /> Export {mode === 'song' ? 'Worship Slides' : 'Presentation'}
                    </button>
                    
                    {/* Translation Buttons */}
                     <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700 gap-1">
                        <button onClick={() => handleTranslate('persian')} disabled={isTranslating} className="px-3 py-2 text-sm rounded transition-colors hover:bg-blue-600 hover:text-white text-gray-300 disabled:opacity-50">
                            To Persian
                        </button>
                        <button onClick={() => handleTranslate('english')} disabled={isTranslating} className="px-3 py-2 text-sm rounded transition-colors hover:bg-indigo-600 hover:text-white text-gray-300 disabled:opacity-50">
                            To English
                        </button>
                        <button onClick={() => handleTranslate('finglish')} disabled={isTranslating} className="px-3 py-2 text-sm rounded transition-colors hover:bg-purple-600 hover:text-white text-gray-300 disabled:opacity-50">
                            To Finglish
                        </button>
                     </div>

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
                
                <div className={`grid gap-4 ${hasAnyTranslation ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
                    {/* Original Section */}
                    <div className="flex flex-col h-[500px]">
                         <div className="flex justify-between items-center mb-2 px-2">
                            <h3 className="font-semibold text-lg text-teal-400">Original ({mode === 'song' ? 'Lyrics' : 'Transcript'})</h3>
                            {!generatedAudioUrls.original && (
                                <button onClick={() => handleGenerateAudio('original')} disabled={isGeneratingAudio !== false} className="bg-teal-600 hover:bg-teal-500 text-white font-bold py-1 px-3 text-sm rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center gap-1.5">
                                    {isGeneratingAudio === 'original' ? <><div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"></div> Gen... </> : <><Icon name="audio-wave" className="w-4 h-4" /> TTS</>}
                                </button>
                            )}
                        </div>
                         {generatedAudioUrls.original && <audio src={generatedAudioUrls.original} controls className="w-full mb-2 h-8" />}
                        <div ref={transcriptContainerRef} className="p-6 bg-gray-900/70 rounded-lg overflow-y-auto border border-gray-700 flex-grow scrollbar-thin scrollbar-thumb-gray-600">
                            {renderTranscript()}
                        </div>
                    </div>

                    {/* Translation Section */}
                    {hasAnyTranslation && (
                         <div className="flex flex-col h-[500px]">
                            {/* Translation Tabs */}
                            <div className="flex border-b border-gray-700 mb-2">
                                <button onClick={() => setActiveTab('persian')} className={`px-4 py-2 text-sm font-medium ${activeTab === 'persian' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}>
                                    Persian
                                </button>
                                <button onClick={() => setActiveTab('english')} className={`px-4 py-2 text-sm font-medium ${activeTab === 'english' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-gray-400 hover:text-gray-200'}`}>
                                    English
                                </button>
                                <button onClick={() => setActiveTab('finglish')} className={`px-4 py-2 text-sm font-medium ${activeTab === 'finglish' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-gray-400 hover:text-gray-200'}`}>
                                    Finglish
                                </button>
                            </div>

                            <div className="flex justify-between items-center mb-2 px-2">
                                 <h3 className="font-semibold text-lg text-gray-200 capitalize">{activeTab} Translation</h3>
                                 {!generatedAudioUrls[activeTab] && translations[activeTab] && (
                                    <button onClick={() => handleGenerateAudio(activeTab)} disabled={isGeneratingAudio !== false} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-1 px-3 text-sm rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center gap-1.5">
                                        {isGeneratingAudio === activeTab ? <><div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"></div> Gen... </> : <><Icon name="audio-wave" className="w-4 h-4" /> TTS</>}
                                    </button>
                                 )}
                            </div>
                            
                            {generatedAudioUrls[activeTab] && <audio src={generatedAudioUrls[activeTab]!} controls className="w-full mb-2 h-8" />}
                            
                            <div className="p-6 bg-gray-900/70 rounded-lg overflow-y-auto border border-gray-700 flex-grow scrollbar-thin scrollbar-thumb-gray-600">
                                {isTranslating && activeTab === activeTab ? (
                                    <div className="flex items-center justify-center h-full">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                                    </div>
                                ) : translations[activeTab] ? (
                                    <p 
                                        className={`text-lg leading-relaxed whitespace-pre-wrap text-gray-200 ${activeTab === 'persian' ? 'font-vazir' : ''}`}
                                        dir={activeTab === 'persian' ? 'rtl' : 'ltr'}
                                    >
                                        {translations[activeTab]}
                                    </p>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                        <Icon name="language" className="w-8 h-8 mb-2 opacity-50" />
                                        <p>No translation generated yet.</p>
                                        <button onClick={() => handleTranslate(activeTab)} className="mt-2 text-blue-400 hover:underline">Generate now</button>
                                    </div>
                                )}
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