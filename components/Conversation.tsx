import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { Icon } from './Icon.tsx';

type WordSegment = {
  word: string;
  start_time: number;
  end_time: number;
};

type TranscriptData = {
  transcript: string;
  word_segments: WordSegment[];
};

type Status = 'idle' | 'reading' | 'transcribing' | 'detecting_chords' | 'exporting' | 'done' | 'error';

const STATUS_MESSAGES: Record<Status, string> = {
    idle: 'Drop an audio file or click to upload',
    reading: 'Reading file...',
    transcribing: 'Transcribing audio, please wait...',
    detecting_chords: 'Analyzing for musical chords...',
    exporting: 'Generating presentation...',
    done: 'Processing complete.',
    error: 'An error occurred.',
};

export const Conversation: React.FC = () => {
    const [status, setStatus] = useState<Status>('idle');
    const [error, setError] = useState<string | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [transcriptData, setTranscriptData] = useState<TranscriptData | null>(null);
    const [chords, setChords] = useState<string | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [exportProgress, setExportProgress] = useState(0);
    const [totalSlides, setTotalSlides] = useState(0);


    const audioRef = useRef<HTMLAudioElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const transcriptContainerRef = useRef<HTMLDivElement>(null);

    const resetState = useCallback(() => {
        setStatus('idle');
        setError(null);
        setFile(null);
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
        }
        setAudioUrl(null);
        setTranscriptData(null);
        setChords(null);
        setCurrentTime(0);
        setExportProgress(0);
        setTotalSlides(0);
    }, [audioUrl]);

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

    const transcribeAudio = async (audioFile: File) => {
        try {
            if (!process.env.API_KEY) throw new Error("API_KEY not found.");
            setStatus('transcribing');
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const audioPart = await fileToGenerativePart(audioFile);

            const prompt = "Transcribe this audio, providing word-level timestamps.";

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{
                    parts: [
                        audioPart,
                        { text: prompt }
                    ]
                }],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            transcript: {
                                type: Type.STRING,
                                description: "The full transcript of the audio."
                            },
                            word_segments: {
                                type: Type.ARRAY,
                                description: "An array of word segments with timestamps.",
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        word: {
                                            type: Type.STRING,
                                            description: "A single word from the transcript."
                                        },
                                        start_time: {
                                            type: Type.NUMBER,
                                            description: "The start time of the word in seconds."
                                        },
                                        end_time: {
                                            type: Type.NUMBER,
                                            description: "The end time of the word in seconds."
                                        },
                                    },
                                    required: ['word', 'start_time', 'end_time']
                                }
                            }
                        },
                        required: ['transcript', 'word_segments']
                    }
                }
            });
            
            try {
                const jsonString = response.text.trim();
                const data = JSON.parse(jsonString);
                setTranscriptData(data);
                return data;
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
                        { text: `Analyze this audio file. The transcript is: "${transcript}". If there is music with chords, list the chords. If there are no discernible chords, respond with "none".` }
                    ],
                }],
            });
            
            const chordText = response.text.trim();
            if (chordText.toLowerCase() !== 'none' && chordText.length > 0) {
                setChords(chordText);
            }
        } catch (err) {
             console.error("Chord detection error:", err);
            // Don't block the user, just log the error.
        }
    };

    const handleFile = useCallback(async (selectedFile: File) => {
        if (!selectedFile.type.startsWith('audio/')) {
            setError("Invalid file type. Please upload an audio file.");
            setStatus('error');
            return;
        }
        resetState();
        setStatus('reading');
        setFile(selectedFile);
        setAudioUrl(URL.createObjectURL(selectedFile));

        const transcription = await transcribeAudio(selectedFile);
        if (transcription) {
            await detectChords(selectedFile, transcription.transcript);
            setStatus('done');
        }
    }, [resetState]);

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

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };
    
    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.add('border-teal-400');
    };
    
    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
         e.currentTarget.classList.remove('border-teal-400');
    };
    
    const handleDownloadTranscript = () => {
        if (!transcriptData) return;
        const blob = new Blob([transcriptData.transcript], { type: 'text/plain' });
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

            const chunks = transcriptData.transcript.match(/.{1,150}(\s|$)/g) || [];
            setTotalSlides(chunks.length);

            for (const [index, chunk] of chunks.entries()) {
                const slide = pres.addSlide();

                const promptResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: [{ parts: [{text: `Create a short, descriptive image generation prompt for this text: "${chunk.trim()}"`}]}],
                });

                const imageResponse = await ai.models.generateImages({
                    model: 'imagen-4.0-generate-001',
                    prompt: promptResponse.text,
                    config: { numberOfImages: 1, outputMimeType: 'image/jpeg' }
                });
                
                const b64Image = imageResponse.generatedImages[0].image.imageBytes;
                
                slide.addImage({ data: `data:image/jpeg;base64,${b64Image}`, w: '100%', h: '100%' });
                slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: '000000', transparency: 50 } });
                slide.addText(chunk.trim(), { x: 0.5, y: 0.5, w: '90%', h: '90%', align: 'center', valign: 'middle', color: 'FFFFFF', fontSize: 24, bold: true });

                setExportProgress(index + 1);
            }
            
            if (chunks.length > 0) {
              const firstSlide = pres.getSlide(1);
              if(firstSlide) {
                  const audioPart = await fileToGenerativePart(file);
                  firstSlide.addMedia({ type: 'audio', data: `data:${file.type};base64,${audioPart.inlineData.data}`, x: 0.1, y: 0.1, w:0.5, h:0.5 });
                  firstSlide.addText(
                      'SITE NAME | CHURCH NAME - DO NOT EDIT',
                      { x: 0, y: '95%', w: '100%', h: 0.25, align: 'center', fontSize: 8, color: 'BBBBBB', isTextBox: true }
                  );
              }
            }
            
            await pres.writeFile({
                fileName: `${file.name.split('.')[0]}.ppsx`,
            });

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
    
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const timeUpdate = () => setCurrentTime(audio.currentTime);
        audio.addEventListener('timeupdate', timeUpdate);
        return () => audio.removeEventListener('timeupdate', timeUpdate);
    }, [audioUrl, status]);

    useEffect(() => {
        if (!transcriptData || !transcriptContainerRef.current) return;

        const activeSegmentIndex = transcriptData.word_segments.findIndex(
            segment => currentTime >= segment.start_time && currentTime < segment.end_time
        );

        if (activeSegmentIndex !== -1) {
            const container = transcriptContainerRef.current;
            const activeWordElement = container.querySelector(
                `p > span:nth-child(${activeSegmentIndex + 1})`
            ) as HTMLElement;

            if (activeWordElement) {
                const containerRect = container.getBoundingClientRect();
                const elementRect = activeWordElement.getBoundingClientRect();

                if (elementRect.top < containerRect.top || elementRect.bottom > containerRect.bottom) {
                    activeWordElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                    });
                }
            }
        }
    }, [currentTime, transcriptData]);


    const renderTranscript = () => {
        if (!transcriptData) return null;
        return (
            <p className="text-lg leading-relaxed">
                {transcriptData.word_segments.map((segment, index) => {
                    const isActive = currentTime >= segment.start_time && currentTime < segment.end_time;
                    return (
                        <span
                            key={index}
                            className={`transition-colors duration-150 ${isActive ? 'text-teal-300 font-bold' : 'text-gray-300'}`}
                        >
                            {segment.word}{' '}
                        </span>
                    );
                })}
            </p>
        );
    };

    const renderContent = () => {
        if (status === 'idle' || (status === 'error' && !file)) {
            return (
                <div 
                    className="relative border-2 border-dashed border-gray-600 rounded-lg p-12 text-center cursor-pointer transition-colors hover:border-teal-500 bg-gray-800/50"
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onClick={() => inputRef.current?.click()}
                >
                    <input type="file" ref={inputRef} onChange={handleFileChange} accept="audio/*" className="hidden" />
                    <Icon name="upload" className="w-12 h-12 mx-auto text-gray-500" />
                    <p className="mt-4 text-gray-400">{STATUS_MESSAGES['idle']}</p>
                    {error && <p className="mt-2 text-red-400">{error}</p>}
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
                            <div className="w-full bg-gray-700 rounded-full h-2.5">
                                <div 
                                    className="bg-teal-400 h-2.5 rounded-full transition-all duration-300" 
                                    style={{ width: `${(exportProgress / totalSlides) * 100}%` }}>
                                </div>
                            </div>
                            <p className="mt-2 text-sm text-gray-400">
                               {`Generating slide ${exportProgress} of ${totalSlides}...`}
                            </p>
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div>
                 {error && <p className="mb-4 text-center text-red-400 bg-red-900/50 p-3 rounded-lg">{error}</p>}
                <div className="mb-4 flex flex-wrap gap-2 justify-center">
                    <button onClick={resetState} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition-colors">New File</button>
                    <button onClick={handleDownloadTranscript} className="bg-teal-600 hover:bg-teal-500 text-white font-bold py-2 px-4 rounded-lg transition-colors">Download Transcript</button>
                    <button onClick={handleExportToPowerPoint} className="bg-orange-600 hover:bg-orange-500 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2">
                      <Icon name="presentation" className="w-5 h-5" /> Export to PowerPoint
                    </button>
                </div>
                <audio ref={audioRef} src={audioUrl!} controls className="w-full mb-4" />
                <div ref={transcriptContainerRef} className="p-6 bg-gray-900/70 rounded-lg max-h-80 overflow-y-auto">
                    {renderTranscript()}
                </div>
                {chords && (
                    <div className="mt-4 p-4 bg-gray-900/70 rounded-lg">
                        <h3 className="font-semibold text-teal-400 mb-2">Detected Chords</h3>
                        <p className="text-gray-300 whitespace-pre-wrap font-mono">{chords}</p>
                    </div>
                )}
            </div>
        );
    };

    return <div className="p-6 min-h-[400px] flex flex-col justify-center">{renderContent()}</div>;
};