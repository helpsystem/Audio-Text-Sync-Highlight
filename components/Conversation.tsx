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
    idle: 'فایل صوتی را اینجا رها کنید یا کلیک کنید',
    reading: 'در حال خواندن فایل...',
    transcribing: 'در حال تبدیل صدا به متن و ساختاردهی...',
    detecting_chords: 'در حال تشخیص آکوردهای موسیقی...',
    exporting: 'در حال ساخت پاورپوینت (اسلاید + تصاویر)...',
    done: 'پردازش تکمیل شد.',
    error: 'خطایی رخ داد.',
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
    
    // Sync Adjustment
    const [syncDelay, setSyncDelay] = useState(0);

    // Translation - Now stores arrays of strings (lines) to maintain sync
    const [translations, setTranslations] = useState<{
        persian: string[] | null;
        english: string[] | null;
        finglish: string[] | null;
    }>({ persian: null, english: null, finglish: null });
    const [activeTab, setActiveTab] = useState<TranslationTarget>('persian');
    const [isTranslating, setIsTranslating] = useState(false);

    // Editing & Sync State
    const [isEditing, setIsEditing] = useState(false);
    const [isSyncMode, setIsSyncMode] = useState(false);

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
    const translationContainerRef = useRef<HTMLDivElement>(null);

    // Calculate the time used for highlighting (Audio Time - User Delay)
    const effectiveTime = Math.max(0, currentTime - syncDelay);

    const resetState = useCallback(() => {
        setStatus('idle');
        setError(null);
        setFile(null);
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
        setTranscriptData(null);
        setChords(null);
        setCurrentTime(0);
        setSyncDelay(0);
        setExportProgress(0);
        setTotalSlides(0);
        setTranslations({ persian: null, english: null, finglish: null });
        setIsTranslating(false);
        setIsEditing(false);
        setIsSyncMode(false);
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
    
    // --- Editing Functions ---
    const handleLineChange = (lineIndex: number, newContent: string) => {
        setTranscriptData(prev => {
            if (!prev) return null;
            const newLines = [...prev.lines];
            const line = newLines[lineIndex];
            
            const startTime = line.words[0]?.start_time || 0;
            const endTime = line.words[line.words.length - 1]?.end_time || 0;
            const duration = Math.max(0.1, endTime - startTime); 

            const newWordsStr = newContent.trim().split(/\s+/).filter(w => w.length > 0);
            const wordDuration = newWordsStr.length > 0 ? duration / newWordsStr.length : 0;

            const newWords: WordSegment[] = newWordsStr.map((w, i) => ({
                word: w,
                start_time: Number((startTime + (i * wordDuration)).toFixed(2)),
                end_time: Number((startTime + ((i + 1) * wordDuration)).toFixed(2))
            }));

            if (newWords.length === 0) {
                 newWords.push({ word: '', start_time: startTime, end_time: endTime });
            }

            newLines[lineIndex] = {
                ...line,
                content: newContent,
                words: newWords
            };

            return { 
                ...prev, 
                lines: newLines, 
                fullTranscript: newLines.map(l => l.content).join('\n') 
            };
        });
    };

    const handleTranslationChange = (lineIndex: number, newContent: string) => {
        setTranslations(prev => {
            const currentLangLines = prev[activeTab];
            if (!currentLangLines) return prev;
            
            const newLines = [...currentLangLines];
            newLines[lineIndex] = newContent;
            
            return {
                ...prev,
                [activeTab]: newLines
            };
        });
    };

    // --- Manual Sync Function ---
    const handleManualSync = (lineIndex: number, wordIndex: number) => {
        if (!audioRef.current) return;
        const time = audioRef.current.currentTime;
        const formattedTime = Number(time.toFixed(2));

        setTranscriptData(prev => {
            if (!prev) return null;
            const newLines = [...prev.lines];
            
            // 1. Update Current Word
            const line = {...newLines[lineIndex]};
            const newWords = [...line.words];
            const word = {...newWords[wordIndex]};

            const oldDuration = word.end_time - word.start_time;
            word.start_time = formattedTime;
            // Extend the word duration or just shift it. Keeping duration constant is often safer or just +0.5s.
            // Let's shift the end time by original duration to keep length consistent.
            word.end_time = Number((formattedTime + oldDuration).toFixed(2));
            
            newWords[wordIndex] = word;
            line.words = newWords;
            newLines[lineIndex] = line;

            // 2. Close Previous Word Gap (Karaoke Style)
            // Find the immediate previous word across lines if necessary
            let prevLineIndex = lineIndex;
            let prevWordIndex = wordIndex - 1;

            if (prevWordIndex < 0) {
                prevLineIndex = lineIndex - 1;
                while (prevLineIndex >= 0 && newLines[prevLineIndex].words.length === 0) {
                    prevLineIndex--;
                }
                if (prevLineIndex >= 0) {
                    prevWordIndex = newLines[prevLineIndex].words.length - 1;
                }
            }

            if (prevLineIndex >= 0 && prevWordIndex >= 0) {
                 const pLine = newLines[prevLineIndex] === line ? line : {...newLines[prevLineIndex]};
                 const pWords = pLine === line ? newWords : [...pLine.words];
                 const prevWord = {...pWords[prevWordIndex]};
                 
                 // Set previous word end time to current word start time
                 prevWord.end_time = formattedTime;
                 
                 pWords[prevWordIndex] = prevWord;
                 pLine.words = pWords;
                 newLines[prevLineIndex] = pLine;
            }

            return { ...prev, lines: newLines };
        });
    };

    // -------------------------

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

    const handleDownloadProjectJSON = () => {
        if (!transcriptData) return;
        
        // Merge translations into the line structure for the "Project" file
        const mergedLines = transcriptData.lines.map((line, index) => ({
            ...line,
            translations: {
                persian: translations.persian?.[index] || null,
                english: translations.english?.[index] || null,
                finglish: translations.finglish?.[index] || null
            }
        }));

        const dataToSave = {
            metadata: {
                filename: file?.name,
                generated_at: new Date().toISOString(),
                mode: mode,
                type: 'project_full'
            },
            structure: mergedLines
        };
        const jsonContent = JSON.stringify(dataToSave, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${file?.name.split('.')[0]}_full_project.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleDownloadSpecificJSON = (target: 'original' | 'persian' | 'english' | 'finglish') => {
        if (!transcriptData) return;

        let linesToSave = [];
        
        if (target === 'original') {
            linesToSave = transcriptData.lines; // Has word-level precision
        } else {
             const translatedLines = translations[target];
             if (!translatedLines) {
                 alert(`No ${target} translation available to download.`);
                 return;
             }
             
             // Map original lines to translated content, preserving line timing
             linesToSave = transcriptData.lines.map((line, index) => ({
                 content: translatedLines[index],
                 start_time: line.words[0]?.start_time || 0,
                 end_time: line.words[line.words.length-1]?.end_time || 0,
                 type: line.type,
                 label: line.label
                 // Note: 'words' array is omitted as we don't have word-level sync for translations
             }));
        }

        const dataToSave = {
            metadata: {
                filename: file?.name,
                language: target,
                generated_at: new Date().toISOString(),
                mode: mode,
                type: 'single_language_timing'
            },
            lines: linesToSave
        };
        
        const jsonContent = JSON.stringify(dataToSave, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${file?.name.split('.')[0]}_${target}_timing.json`;
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
        setActiveTab(target); 

        try {
            if (!process.env.API_KEY) throw new Error("API_KEY not found.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            
            let systemInstruction = "";
            let userPrompt = "";
            const linesContent = transcriptData.lines.map(l => l.content);

            if (target === 'persian') {
                systemInstruction = "You are a professional translator. Translate each line of the provided array to fluent, formal Iranian Persian (Farsi). Maintain the exact number of lines and the order.";
                userPrompt = `Translate these lines:\n${JSON.stringify(linesContent)}`;
            } else if (target === 'english') {
                systemInstruction = "You are a professional translator. Translate each line of the provided array to fluent English. Maintain the exact number of lines and the order.";
                userPrompt = `Translate these lines:\n${JSON.stringify(linesContent)}`;
            } else if (target === 'finglish') {
                 systemInstruction = "You are a transliteration expert. Convert each line of the provided array to Finglish (Persian language using English alphabet). If input is English, translate to Persian first, then transliterate. Maintain the exact number of lines and the order.";
                 userPrompt = `Convert these lines:\n${JSON.stringify(linesContent)}`;
            }

            const response = await ai.models.generateContent({ 
                model: 'gemini-2.5-flash', 
                config: { 
                    systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            translated_lines: {
                                type: Type.ARRAY,
                                items: { type: Type.STRING }
                            }
                        }
                    }
                },
                contents: [{ parts: [{ text: userPrompt }] }], 
            });
            
            const result = JSON.parse(response.text || "{}");
            if (result.translated_lines && Array.isArray(result.translated_lines)) {
                 setTranslations(prev => ({ ...prev, [target]: result.translated_lines }));
            } else {
                throw new Error("Invalid response format from translation.");
            }
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
        let textToSpeak = "";
        
        if (sourceKey === 'original') {
            textToSpeak = transcriptData?.fullTranscript || "";
        } else {
             const lines = translations[sourceKey as TranslationTarget];
             textToSpeak = lines ? lines.join('\n') : "";
        }
        
        if (!textToSpeak) return;

        setIsGeneratingAudio(sourceKey);
        setError(null);

        try {
            if (!process.env.API_KEY) throw new Error("API_KEY not found.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            
            let prompt = "";
            const isPersian = sourceKey === 'persian' || (sourceKey === 'original' && /[\u0600-\u06FF]/.test(textToSpeak));
            
            if (isPersian) {
                prompt = `
You are a highly skilled Iranian voice actor. Read this Persian text with a polished, standard **Iranian (Tehrani)** accent.
Be expressive.

Text: "${textToSpeak}"
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
        
        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('ended', onPause);
        audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));

        return () => {
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', onPause);
            audio.removeEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
            cancelAnimationFrame(animationFrameId);
        };
    }, [audioUrl, status]);

    // Scroll Logic for Main Transcript
    useEffect(() => {
        if (!transcriptData || !transcriptContainerRef.current || isEditing || isSyncMode) return; // Disable auto-scroll when editing or syncing
        const activeLineIndex = transcriptData.lines.findIndex(line => {
             const start = line.words[0]?.start_time;
             const end = line.words[line.words.length - 1]?.end_time;
             // Use effectiveTime for synchronization logic
             return start !== undefined && end !== undefined && effectiveTime >= start && effectiveTime <= end;
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
    }, [effectiveTime, transcriptData, isEditing, isSyncMode]);

    // Scroll Logic for Translations
    useEffect(() => {
        if (!translations[activeTab] || !translationContainerRef.current || !transcriptData || isEditing || isSyncMode) return; // Disable auto-scroll when editing or syncing
        const activeLineIndex = transcriptData.lines.findIndex(line => {
             const start = line.words[0]?.start_time;
             const end = line.words[line.words.length - 1]?.end_time;
             // Use effectiveTime for synchronization logic
             return start !== undefined && end !== undefined && effectiveTime >= start && effectiveTime <= end;
        });

         if (activeLineIndex !== -1) {
            const container = translationContainerRef.current;
            const activeLineElement = container.children[activeLineIndex] as HTMLElement;
            if (activeLineElement) {
                 const containerRect = container.getBoundingClientRect();
                 const elementRect = activeLineElement.getBoundingClientRect();
                 if (elementRect.top < containerRect.top + 20 || elementRect.bottom > containerRect.bottom - 20) {
                     activeLineElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                 }
            }
        }
    }, [effectiveTime, transcriptData, activeTab, translations, isEditing, isSyncMode]);

    const renderTranscript = () => {
        if (!transcriptData) return null;

        const isRtl = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(transcriptData.fullTranscript);
        const direction = isRtl ? 'rtl' : 'ltr';
        const fontFamily = isRtl ? 'font-vazir' : '';

        return (
            <div className={`space-y-4 ${fontFamily}`} dir={direction}>
                {transcriptData.lines.map((line, lineIndex) => {
                    // Editing View
                    if (isEditing) {
                        return (
                            <div key={lineIndex} className="mb-2">
                                <textarea
                                    value={line.content}
                                    onChange={(e) => handleLineChange(lineIndex, e.target.value)}
                                    className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 focus:border-teal-500 outline-none resize-none overflow-hidden min-h-[50px]"
                                    style={{ height: `${Math.max(50, line.content.length / 2)}px` }} // simple auto-height approximation
                                    placeholder="Type corrected text here..."
                                />
                                <div className="text-xs text-gray-500 mt-1 flex justify-between">
                                     <span>{line.type}</span>
                                     <span>{(line.words[line.words.length-1]?.end_time - line.words[0]?.start_time).toFixed(1)}s</span>
                                </div>
                            </div>
                        );
                    }

                    // Normal View
                    const lineStart = line.words[0]?.start_time || 0;
                    const lineEnd = line.words[line.words.length - 1]?.end_time || 0;
                    const isLineActive = effectiveTime >= lineStart && effectiveTime <= lineEnd;

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
                                const isWordActive = effectiveTime >= wordObj.start_time && effectiveTime < wordObj.end_time;
                                return (
                                    <span 
                                        key={wordIndex}
                                        onClick={() => isSyncMode && handleManualSync(lineIndex, wordIndex)}
                                        className={`inline-block mx-1 transition-all duration-100 px-0.5 rounded 
                                            ${isWordActive ? 'font-bold' : 'text-gray-300'} 
                                            ${isSyncMode ? 'cursor-pointer hover:bg-yellow-500/30 hover:text-yellow-200 border-b border-dashed border-yellow-600' : ''}`}
                                        style={{ 
                                            color: isWordActive ? wordHighlightColor : undefined,
                                            textShadow: isWordActive ? `0 0 10px ${wordHighlightColor}66` : 'none',
                                            transform: isWordActive ? 'scale(1.1)' : 'scale(1)',
                                        }}
                                        title={isSyncMode ? "Tap to sync this word to current audio time" : ""}
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
    
    const renderTranslationContent = () => {
         const lines = translations[activeTab];
         if (!lines || !transcriptData) {
             return (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                    <Icon name="language" className="w-8 h-8 mb-2 opacity-50" />
                    <p className="mb-2">ترجمه‌ای موجود نیست</p>
                    <button onClick={() => handleTranslate(activeTab)} className="mt-2 text-blue-400 hover:underline">ایجاد ترجمه</button>
                </div>
             );
         }
         
         const isRtl = activeTab === 'persian';
         const fontFamily = isRtl ? 'font-vazir' : '';
         
         return (
             <div ref={translationContainerRef} className={`space-y-4 ${fontFamily}`} dir={isRtl ? 'rtl' : 'ltr'}>
                 {lines.map((lineText, index) => {
                     // Check mapping with original transcript lines
                     const originalLine = transcriptData.lines[index];
                     if (!originalLine) return null; // Safety check
                     
                     if (isEditing) {
                        return (
                            <div key={index} className="mb-2">
                                <textarea
                                    value={lineText}
                                    onChange={(e) => handleTranslationChange(index, e.target.value)}
                                    className="w-full bg-gray-800 text-white p-2 rounded border border-gray-600 focus:border-blue-500 outline-none resize-none overflow-hidden min-h-[50px]"
                                    style={{ height: `${Math.max(50, lineText.length / 2)}px` }}
                                    placeholder="Type corrected translation..."
                                />
                            </div>
                        );
                     }
                     
                     const lineStart = originalLine.words[0]?.start_time || 0;
                     const lineEnd = originalLine.words[originalLine.words.length - 1]?.end_time || 0;
                     // Use effectiveTime
                     const isLineActive = effectiveTime >= lineStart && effectiveTime <= lineEnd;
                     
                     return (
                         <div 
                             key={index}
                             className={`p-3 rounded-lg transition-all duration-300 ${mode === 'song' ? 'text-center' : (isRtl ? 'text-right' : 'text-left')}`}
                             style={{ 
                                backgroundColor: isLineActive ? `${lineHighlightColor}80` : 'transparent',
                                borderRight: isRtl && isLineActive ? `4px solid ${wordHighlightColor}` : '4px solid transparent',
                                borderLeft: !isRtl && isLineActive ? `4px solid ${wordHighlightColor}` : '4px solid transparent',
                                transform: isLineActive ? 'scale(1.02)' : 'scale(1)',
                                color: isLineActive ? '#ffffff' : '#9ca3af' // gray-400 inactive, white active
                            }}
                         >
                            {lineText}
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
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all font-vazir ${mode === 'speech' ? 'bg-teal-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
            >
                <Icon name="book" className="w-4 h-4" /> کلام (کتاب مقدس / کتاب صوتی)
            </button>
            <button
                onClick={() => setMode('song')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all font-vazir ${mode === 'song' ? 'bg-teal-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
            >
                <Icon name="music" className="w-4 h-4" /> سرود پرستشی
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
                        <p className="mt-4 text-gray-400 font-vazir">
                            {mode === 'speech' ? 'بارگذاری فایل صوتی (کتاب مقدس یا کتاب صوتی)' : 'بارگذاری فایل صوتی (سرود پرستشی)'}
                        </p>
                        <p className="mt-2 text-xs text-gray-500 font-vazir">
                             {mode === 'speech' ? 'تمرکز: متن‌نگاری دقیق، زمان‌بندی، ترجمه' : 'تمرکز: آکورد، متن شعر، ساخت اسلاید'}
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
                    <p className="mt-4 text-lg text-gray-300 font-vazir">{STATUS_MESSAGES[status]}</p>
                    {status === 'exporting' && totalSlides > 0 && (
                        <div className="mt-4 w-full max-w-xs mx-auto">
                            <div className="w-full bg-gray-700 rounded-full h-2.5"><div className="bg-teal-400 h-2.5 rounded-full transition-all duration-300" style={{ width: `${(exportProgress / totalSlides) * 100}%` }}></div></div>
                            <p className="mt-2 text-sm text-gray-400">{`در حال ساخت اسلاید ${exportProgress} از ${totalSlides}...`}</p>
                        </div>
                    )}
                </div>
            );
        }

        const hasAnyTranslation = Object.values(translations).some(t => t !== null);

        return (
            <div>
                 {error && <p className="mb-4 text-center text-red-400 bg-red-900/50 p-3 rounded-lg">{error}</p>}
                <div className="mb-4 flex flex-wrap gap-2 justify-center items-center font-vazir text-sm">
                    <button onClick={resetState} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition-colors">فایل جدید</button>
                    <button onClick={handleDownloadTranscript} className="bg-teal-600 hover:bg-teal-500 text-white font-bold py-2 px-4 rounded-lg transition-colors">دانلود متن (TXT)</button>
                    <button onClick={handleDownloadProjectJSON} className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2">
                        <Icon name="code" className="w-5 h-5" /> دانلود پروژه (JSON)
                    </button>
                    <button onClick={handleExportToPowerPoint} className="bg-orange-600 hover:bg-orange-500 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2">
                      <Icon name="presentation" className="w-5 h-5" /> خروجی پاورپوینت
                    </button>
                    
                    {/* Translation Buttons */}
                     <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700 gap-1">
                        <button onClick={() => handleTranslate('persian')} disabled={isTranslating} className="px-3 py-2 text-sm rounded transition-colors hover:bg-blue-600 hover:text-white text-gray-300 disabled:opacity-50">
                            به فارسی
                        </button>
                        <button onClick={() => handleTranslate('english')} disabled={isTranslating} className="px-3 py-2 text-sm rounded transition-colors hover:bg-indigo-600 hover:text-white text-gray-300 disabled:opacity-50">
                            به انگلیسی
                        </button>
                        <button onClick={() => handleTranslate('finglish')} disabled={isTranslating} className="px-3 py-2 text-sm rounded transition-colors hover:bg-purple-600 hover:text-white text-gray-300 disabled:opacity-50">
                            به فینگلیش
                        </button>
                     </div>

                    {/* Edit Toggle */}
                    <button 
                        onClick={() => { setIsEditing(!isEditing); if(!isEditing) setIsSyncMode(false); }} 
                        className={`p-2 rounded-lg transition-colors flex items-center gap-2 font-bold ${isEditing ? 'bg-yellow-600 text-white shadow-lg' : 'bg-gray-800 text-yellow-500 hover:bg-gray-700'}`}
                        title={isEditing ? "ذخیره تغییرات" : "ویرایش متن"}
                    >
                         <Icon name={isEditing ? 'save' : 'edit'} className="w-5 h-5" />
                         {isEditing ? 'ذخیره' : ''}
                    </button>

                    {/* Manual Sync Toggle */}
                    <button 
                        onClick={() => { setIsSyncMode(!isSyncMode); if(!isSyncMode) setIsEditing(false); }} 
                        className={`p-2 rounded-lg transition-colors flex items-center gap-2 font-bold ${isSyncMode ? 'bg-red-600 text-white shadow-lg animate-pulse' : 'bg-gray-800 text-red-500 hover:bg-gray-700'}`}
                        title={isSyncMode ? "خروج از حالت هماهنگی" : "حالت هماهنگی لمسی"}
                    >
                         <Icon name="touch" className="w-5 h-5" />
                         {isSyncMode ? 'هماهنگی لمسی' : ''}
                    </button>

                    <button onClick={() => setShowAppearance(!showAppearance)} className={`p-2 rounded-lg transition-colors ${showAppearance ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                         <Icon name="palette" className="w-6 h-6" />
                    </button>
                </div>

                {showAppearance && (
                    <div className="mb-6 bg-gray-800 p-4 rounded-lg border border-gray-700 flex flex-wrap justify-center gap-8 animate-fade-in-down font-vazir">
                        <div className="flex flex-col items-center gap-2">
                            <label className="text-xs text-gray-400 uppercase font-semibold">رنگ هایلایت کلمه</label>
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
                            <label className="text-xs text-gray-400 uppercase font-semibold">رنگ هایلایت خط (پس‌زمینه)</label>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="color" 
                                    value={lineHighlightColor} 
                                    onChange={(e) => setLineHighlightColor(e.target.value)} 
                                    className="w-10 h-10 rounded cursor-pointer bg-transparent border-0 p-0"
                                />
                                <span className="text-sm font-mono text-gray-300">{lineHighlightColor}</span>
                            </div>
                            <span className="text-xs text-gray-500">(50% شفافیت)</span>
                        </div>
                    </div>
                )}

                <audio ref={audioRef} src={audioUrl!} controls className="w-full mb-4" />

                {/* Sync Controls */}
                <div className="flex flex-col items-center justify-center gap-2 mb-6 bg-gray-800/40 p-3 rounded-xl border border-gray-700/50 font-vazir">
                    <div className="flex items-center gap-2 text-gray-300 text-sm mb-1">
                        <span className="font-semibold text-teal-400">تنظیم دستی زمان</span>
                        <span className="text-xs text-gray-500">(اصلاح جلو یا عقب افتادن متن)</span>
                    </div>
                    <div className="flex items-center gap-4 bg-gray-900 rounded-lg p-1.5 border border-gray-700">
                         <button 
                            onClick={() => setSyncDelay(d => Math.max(d - 0.1, -5))} 
                            className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded transition-colors border border-gray-700"
                            title="متن دیرتر می‌آید"
                        >
                            متن عقبه (-)
                        </button>
                        <div className="flex flex-col items-center w-20">
                            <span className={`font-mono font-bold text-lg ${syncDelay !== 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
                                {syncDelay > 0 ? '+' : ''}{syncDelay.toFixed(2)}s
                            </span>
                        </div>
                        <button 
                            onClick={() => setSyncDelay(d => Math.min(d + 0.1, 10))} 
                            className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded transition-colors border border-gray-700"
                            title="متن زودتر می‌آید"
                        >
                             متن جلوئه (+)
                        </button>
                    </div>
                    <div className="text-[10px] text-gray-500">
                        {syncDelay > 0 ? "ایجاد تاخیر (متن خیلی سریع بود)" : syncDelay < 0 ? "کاهش زمان (متن خیلی کند بود)" : "هماهنگی کامل"}
                    </div>
                </div>
                
                <div className={`grid gap-4 ${hasAnyTranslation ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
                    {/* Original Section */}
                    <div className="flex flex-col h-[500px]">
                         <div className="flex justify-between items-center mb-2 px-2 font-vazir">
                            <h3 className="font-semibold text-lg text-teal-400">متن اصلی ({mode === 'song' ? 'شعر' : 'متن'})</h3>
                            <div className="flex gap-2">
                                <button onClick={() => handleDownloadSpecificJSON('original')} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-1 px-3 text-sm rounded-lg transition-colors flex items-center gap-1.5" title="دانلود زمان‌بندی (JSON)">
                                    <Icon name="download" className="w-4 h-4" /> JSON
                                </button>
                                {!generatedAudioUrls.original && (
                                    <button onClick={() => handleGenerateAudio('original')} disabled={isGeneratingAudio !== false} className="bg-teal-600 hover:bg-teal-500 text-white font-bold py-1 px-3 text-sm rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center gap-1.5">
                                        {isGeneratingAudio === 'original' ? <><div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"></div> در حال ساخت... </> : <><Icon name="audio-wave" className="w-4 h-4" /> خوانش متن</>}
                                    </button>
                                )}
                            </div>
                        </div>
                         {generatedAudioUrls.original && <audio src={generatedAudioUrls.original} controls className="w-full mb-2 h-8" />}
                        <div ref={transcriptContainerRef} className="p-6 bg-gray-900/70 rounded-lg overflow-y-auto border border-gray-700 flex-grow scrollbar-thin scrollbar-thumb-gray-600 text-right">
                            {renderTranscript()}
                        </div>
                    </div>

                    {/* Translation Section */}
                    {hasAnyTranslation && (
                         <div className="flex flex-col h-[500px]">
                            {/* Translation Tabs */}
                            <div className="flex border-b border-gray-700 mb-2 font-vazir text-sm">
                                <button onClick={() => setActiveTab('persian')} className={`px-4 py-2 font-medium ${activeTab === 'persian' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}>
                                    فارسی
                                </button>
                                <button onClick={() => setActiveTab('english')} className={`px-4 py-2 font-medium ${activeTab === 'english' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-gray-400 hover:text-gray-200'}`}>
                                    انگلیسی
                                </button>
                                <button onClick={() => setActiveTab('finglish')} className={`px-4 py-2 font-medium ${activeTab === 'finglish' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-gray-400 hover:text-gray-200'}`}>
                                    فینگلیش
                                </button>
                            </div>

                            <div className="flex justify-between items-center mb-2 px-2 font-vazir">
                                 <h3 className="font-semibold text-lg text-gray-200 capitalize">ترجمه {activeTab === 'persian' ? 'فارسی' : activeTab === 'english' ? 'انگلیسی' : 'فینگلیش'}</h3>
                                 <div className="flex gap-2">
                                    {translations[activeTab] && (
                                        <button onClick={() => handleDownloadSpecificJSON(activeTab)} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-1 px-3 text-sm rounded-lg transition-colors flex items-center gap-1.5" title={`دانلود زمان‌بندی ${activeTab}`}>
                                            <Icon name="download" className="w-4 h-4" /> JSON
                                        </button>
                                    )}
                                     {!generatedAudioUrls[activeTab] && translations[activeTab] && (
                                        <button onClick={() => handleGenerateAudio(activeTab)} disabled={isGeneratingAudio !== false} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-1 px-3 text-sm rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center gap-1.5">
                                            {isGeneratingAudio === activeTab ? <><div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"></div> در حال ساخت... </> : <><Icon name="audio-wave" className="w-4 h-4" /> خوانش متن</>}
                                        </button>
                                     )}
                                 </div>
                            </div>
                            
                            {generatedAudioUrls[activeTab] && <audio src={generatedAudioUrls[activeTab]!} controls className="w-full mb-2 h-8" />}
                            
                            <div className="p-6 bg-gray-900/70 rounded-lg overflow-y-auto border border-gray-700 flex-grow scrollbar-thin scrollbar-thumb-gray-600">
                                {isTranslating && activeTab === activeTab ? (
                                    <div className="flex items-center justify-center h-full">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                                    </div>
                                ) : renderTranslationContent()}
                            </div>
                         </div>
                    )}
                </div>

                {chords && (
                    <div className="mt-4 p-4 bg-gray-800 rounded-lg border border-teal-500/30 font-vazir" dir="ltr">
                        <h3 className="text-lg font-semibold text-teal-400 mb-2 flex items-center gap-2 text-right w-full justify-end">
                            <span className="mr-auto"></span> آکوردهای تشخیص داده شده <Icon name="music" className="w-5 h-5" />
                        </h3>
                        <pre className="whitespace-pre-wrap font-mono text-sm text-gray-300 overflow-x-auto text-left">
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