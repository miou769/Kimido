import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  RefreshCcw, BookOpen, Sparkles, Volume2, 
  BrainCircuit, ArrowRight, BarChart3, Scale, 
  Target, Flame, Headphones, Pause, Play, Ghost, Briefcase
} from 'lucide-react';

// --- CONFIG ---
const apiKey = ""; // 司令官のAPIキーがあればここに入れます（なくても基本機能は動きます）
const MASTERY_THRESHOLD = 7;
const REPEAT_GUARD_COUNT = 15;
const AUTO_NEXT_DELAY = 10000; 
const HANDS_FREE_WAIT = 4000; 

// --- DATA FALLBACK (GitHubで questions.json が見つかるまでの仮データ) ---
const FALLBACK_DATA = [
  { 
    "id": 1, 
    "field": "システム待機中", 
    "tag": "ロード", 
    "q": "GitHub上の questions.json を読み込んでいます。もしこの画面が出続ける場合は、ファイルの場所や名前を確認してくだちゃい！", 
    "a": "○", 
    "choices": ["○", "×"], 
    "fb_ok": "準備完了を待つちゃむ！", 
    "fb_ng": "エラーかもちゃむ！" 
  }
];

// --- API HELPERS (TTS生成) ---
const fetchTts = async (text) => {
  try {
    if (!apiKey) return null; // APIキーがない場合はスキップ
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `朗読：${text}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } },
        model: "gemini-2.5-flash-preview-tts"
      })
    });
    const res = await response.json();
    return res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } catch (e) { return null; }
};

const pcmToWav = (pcmData, sampleRate) => {
  const buffer = new ArrayBuffer(44 + pcmData.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, string) => { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); };
  writeString(0, 'RIFF'); view.setUint32(4, 36 + pcmData.length * 2, true); writeString(8, 'WAVE');
  writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeString(36, 'data'); view.setUint32(40, pcmData.length * 2, true);
  for (let i = 0; i < pcmData.length; i++) view.setInt16(44 + i * 2, pcmData[i], true);
  return new Blob([buffer], { type: 'audio/wav' });
};

export default function App() {
  const [DATA, setDATA] = useState(null);
  const [appState, setAppState] = useState('setup');
  const [viewMode, setViewMode] = useState('dojo'); 
  const [targetCount, setTargetCount] = useState(200);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState(() => JSON.parse(localStorage.getItem('kimimaro-dojo-mastery') || '{}'));
  const [sessionCount, setSessionCount] = useState(0);
  const [history, setHistory] = useState([]);
  const [shuffledChoices, setShuffledChoices] = useState([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);
  const [aiContent, setAiContent] = useState({ type: '', text: '' });
  const [loadingState, setLoadingState] = useState("");
  const [isPaused, setIsPaused] = useState(false);
  const autoTimerRef = useRef(null);
  const audioRef = useRef(null);

  // JSONデータのロード機構 (ここが司令官のデータを読み込む核です！)
  useEffect(() => {
    fetch('questions.json')
      .then(res => {
        if (!res.ok) throw new Error("JSON not found");
        return res.json();
      })
      .then(data => {
        // Claude先輩のデータなどで choices が無い場合に備えた安全装置
        const safeData = data.map(q => ({
          ...q,
          choices: q.choices || ["○", "×"]
        }));
        setDATA(safeData);
      })
      .catch(err => {
        console.warn("questions.jsonが見つかりません。プレビュー用データを使います。");
        setDATA(FALLBACK_DATA);
      });
  }, []);

  const currentQ = useMemo(() => DATA && DATA.length > 0 ? (DATA[currentIndex] || DATA[0]) : null, [DATA, currentIndex]);

  const handleShuffleChoices = useCallback((idx) => {
    if (!DATA) return;
    const q = DATA[idx] || DATA[0];
    setShuffledChoices([...(q.choices || ["○", "×"])].sort(() => Math.random() - 0.5));
  }, [DATA]);

  const handleTtsPlay = async (text, onEnd = null) => {
    setLoadingState("tts");
    const data = await fetchTts(text);
    if (data) {
      const wavBlob = pcmToWav(new Int16Array(new Uint8Array(atob(data).split("").map(c => c.charCodeAt(0))).buffer), 24000);
      if (audioRef.current) audioRef.current.pause();
      audioRef.current = new Audio(URL.createObjectURL(wavBlob));
      audioRef.current.onended = () => { setLoadingState(""); if (onEnd) onEnd(); };
      audioRef.current.play();
    } else {
      setLoadingState("");
      if (onEnd) onEnd();
    }
  };

  const pickNext = useCallback(() => {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    if (audioRef.current) audioRef.current.pause();
    if (!DATA) return;

    const available = DATA.filter(q => !history.includes(q.id));
    const pool = available.length > 0 ? available : DATA;
    const nextQ = pool[Math.floor(Math.random() * pool.length)];
    const nextIdx = DATA.findIndex(q => q.id === nextQ.id);
    
    setCurrentIndex(nextIdx);
    handleShuffleChoices(nextIdx);
    setShowFeedback(false);
    setIsCorrect(null);
    setAiContent({ type: '', text: '' });
    setHistory(prev => [nextQ.id, ...prev].slice(0, REPEAT_GUARD_COUNT));
    
    if (viewMode === 'ear') {
       handleTtsPlay(`問題です。${nextQ.q}`, () => {
         autoTimerRef.current = setTimeout(() => {
           handleTtsPlay(`正解は、${nextQ.a}ちゃむ。解説、${nextQ.fb_ok}`, () => {
             autoTimerRef.current = setTimeout(() => {
               setSessionCount(prev => prev + 1);
               pickNext();
             }, 3000);
           });
         }, HANDS_FREE_WAIT);
       });
    }
  }, [history, handleShuffleChoices, viewMode, DATA]);

  const handleAnswer = (choice) => {
    if (showFeedback || !currentQ) return;
    const correct = choice === currentQ.a;
    setIsCorrect(correct);
    setShowFeedback(true);
    setSessionCount(prev => prev + 1);

    const r = results[currentQ.id] || { correct_count: 0 };
    const newResults = {
      ...results,
      [currentQ.id]: { correct_count: r.correct_count + (correct ? 1 : 0) }
    };
    setResults(newResults);
    localStorage.setItem('kimimaro-dojo-mastery', JSON.stringify(newResults));
    
    if (viewMode === 'dojo' && !isPaused) autoTimerRef.current = setTimeout(pickNext, AUTO_NEXT_DELAY);
  };

  const handleAiCall = async (type) => {
    if (!apiKey) {
      setAiContent({ type: 'error', text: "APIキーが設定されていないためAIと通信できませんちゃむ。" });
      return;
    }
    setIsPaused(true);
    setLoadingState("ai");
    setAiContent({ type, text: '' });
    const prompts = {
      else: "Javaエンジニアの視点でelse（例外・ひっかけ）をデバッグして。",
      detail: "背景法理を初心者向けに詳しく解説してちゃむ。",
      statute: "関連条文を抜き出して。全文表示してちゃむ。",
      practical: "この法律知識が、実際の司法書士の実務（登記・供託・訴訟等）においてどのように機能するか、具体的活用シーンをシミュレーションしてちゃむ。"
    };
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `問題: ${currentQ.q}\n解答: ${currentQ.a}` }] }],
          systemInstruction: { parts: [{ text: prompts[type] }] }
        })
      });
      const data = await response.json();
      setAiContent({ type, text: data.candidates?.[0]?.content?.parts?.[0]?.text || "解析失敗ちゃむ。" });
    } catch (e) { setAiContent({ type: 'error', text: "通信エラーだちゃむ。" }); }
    finally { setLoadingState(""); }
  };

  if (!DATA) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white space-y-4">
        <RefreshCcw className="w-10 h-10 animate-spin text-emerald-500" />
        <p className="text-xs font-black tracking-[0.2em] text-emerald-400">LOADING ARSENAL...</p>
      </div>
    );
  }

  if (appState === 'setup') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 text-white font-sans">
        <div className="max-w-md w-full space-y-12 text-center animate-in zoom-in-95">
          <div className="space-y-4">
            <div className="bg-emerald-500 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-sm rotate-3"><Target className="w-8 h-8 text-white" /></div>
            <h1 className="text-3xl font-black tracking-tight">きみまろ道場</h1>
            <Badge variant="secondary" className="bg-white/10 text-emerald-400 border-none px-3 py-1 uppercase tracking-widest text-[10px]">v20.5 Main Edition</Badge>
            <p className="text-xs text-slate-400 font-bold">装填完了：{DATA.length}問</p>
          </div>
          
          <div className="grid grid-cols-2 gap-3 px-4">
            {[20, 50, 100, 200].map(n => (
              <Button key={n} onClick={() => { setTargetCount(n); setSessionCount(0); setAppState('dojo'); setViewMode('dojo'); handleShuffleChoices(currentIndex); }}
                className="h-16 rounded-xl bg-white/5 hover:bg-emerald-600 border border-white/10 text-lg font-black transition-all active:scale-95"
              >
                {n}問 撃破
              </Button>
            ))}
          </div>

          <Button 
            onClick={() => { setViewMode('ear'); setAppState('dojo'); setTargetCount(999); pickNext(); }}
            className="w-full h-16 rounded-2xl bg-orange-100 hover:bg-orange-200 text-orange-700 text-lg font-bold flex items-center justify-center gap-3 transition-all active:scale-95 border-none"
          >
            <Headphones className="w-6 h-6" /> 耳勉（自動）を開始
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#f8faf8] flex flex-col font-sans overflow-hidden select-none text-slate-800">
      
      <nav className="bg-white border-b border-emerald-100 flex justify-around items-center shrink-0 h-14 z-[60] shadow-sm px-2">
        {[
          { id: 'dojo', icon: BookOpen, label: '道場' },
          { id: 'stats', icon: BarChart3, label: '分析' },
          { id: 'setup', icon: RefreshCcw, label: '再選' }
        ].map(t => (
          <button key={t.id} onClick={() => t.id === 'setup' ? setAppState('setup') : setViewMode(t.id)} 
            className={`flex-1 flex flex-col items-center justify-center h-full transition-all border-b-4 ${viewMode === t.id && appState !== 'setup' ? 'border-emerald-500 text-emerald-600 bg-emerald-50/50' : 'border-transparent text-slate-300'}`}>
            <t.icon className="w-5 h-5 mb-0.5" />
            <span className="text-[8px] font-black uppercase tracking-tighter">{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="flex-1 flex flex-col min-h-0 px-4 pt-4 overflow-hidden">
        <div className="max-w-md mx-auto w-full flex flex-col h-full gap-4">
          
          {viewMode === 'dojo' && currentQ && (
            <>
              <Card className="border-emerald-50 shadow-sm rounded-[2rem] bg-[#f2fcf5] shrink-0 overflow-hidden relative border">
                <div className="bg-emerald-400/20 h-1 transition-all duration-700" style={{ width: `${(sessionCount/targetCount)*100}%` }} />
                <CardContent className="p-6 space-y-4">
                  <div className="flex justify-between items-center">
                    <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-600 bg-white/80 px-2.5 font-normal tracking-tight">
                      {currentQ.field || '分野なし'} • {sessionCount}/{targetCount}
                    </Badge>
                    
                    <div className="flex items-center gap-3">
                      <button onClick={() => handleTtsPlay(currentQ.q)} 
                        className={`p-2 rounded-full transition-all ${loadingState === "tts" ? "bg-emerald-100 text-emerald-600 animate-pulse" : "bg-white text-slate-300 hover:text-emerald-500 shadow-sm"}`}>
                        <Volume2 className="w-4 h-4" />
                      </button>
                      
                      <div className="flex gap-1.5 ml-1">
                        {[...Array(MASTERY_THRESHOLD)].map((_, i) => (
                          <div key={i} className={`w-2.5 h-2.5 rounded-full ${i < (results[currentQ.id]?.correct_count || 0) ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="min-h-[110px] flex items-center justify-center px-4 py-2">
                    <p className="text-base leading-loose text-[#4a3c32] font-normal text-center">
                      {currentQ.q}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* スマート解答ボタン（2択は丸ボタン、それ以外は四角ボタン） */}
              {!showFeedback ? (
                currentQ.choices && currentQ.choices.length === 2 && currentQ.choices.includes("○") ? (
                  <div className="flex justify-center gap-12 py-3 shrink-0">
                    {shuffledChoices.map(choice => (
                      <button key={choice} onClick={() => handleAnswer(choice)}
                        className="w-24 h-24 text-6xl flex items-center justify-center rounded-full shadow-sm border border-emerald-50 bg-white active:scale-95 transition-all hover:bg-emerald-50"
                      >
                        {choice === "○" ? "🌸" : "💩"}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 py-1 shrink-0 px-4 overflow-y-auto max-h-[40vh]">
                    {shuffledChoices.map(choice => (
                      <button key={choice} onClick={() => handleAnswer(choice)}
                        className="w-full min-h-[3.5rem] px-4 py-2 text-[15px] font-bold flex items-center justify-center rounded-xl shadow-sm border border-emerald-50 bg-white active:scale-95 transition-all text-[#4a3c32] hover:bg-emerald-50"
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                )
              ) : (
                <div className="flex-1 flex flex-col min-h-0 gap-3 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <div className={`p-4 rounded-[2rem] border flex flex-col gap-4 shadow-sm shrink-0 ${isCorrect ? 'bg-emerald-50 border-emerald-100' : 'bg-orange-50 border-orange-100'}`}>
                    <div className="flex items-center gap-4 px-2">
                       <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-black text-sm ${isCorrect ? 'bg-emerald-500' : 'bg-[#ffb380]'}`}>
                         {isCorrect ? '○' : '×'}
                       </div>
                       <p className={`text-[13px] font-bold leading-relaxed flex-1 ${isCorrect ? 'text-emerald-800' : 'text-orange-900'}`}>
                         {isCorrect ? currentQ.fb_ok : currentQ.fb_ng}
                       </p>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <Button onClick={pickNext} className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black rounded-2xl relative overflow-hidden active:scale-95 shadow-none border-none">
                        次へ進む <ArrowRight className="w-4 h-4 ml-1.5" />
                        {!isPaused && (
                          <div className="absolute bottom-0 left-0 h-1 bg-white/30 animate-timer-bar origin-left" style={{ animationDuration: `${AUTO_NEXT_DELAY}ms` }} />
                        )}
                      </Button>
                      
                      <Button onClick={() => setIsPaused(!isPaused)} variant="outline" 
                        className={`h-12 w-32 rounded-2xl border transition-all shadow-none ${isPaused ? 'bg-orange-100 border-[#ffb380] text-orange-600' : 'bg-white border-slate-200 text-slate-400'}`}>
                        {isPaused ? <Play className="w-5 h-5 fill-current" /> : <Pause className="w-5 h-5 fill-current" />}
                        <span className="ml-1.5 text-[10px] font-black uppercase">{isPaused ? '再開' : '停止'}</span>
                      </Button>
                    </div>

                    <div className="grid grid-cols-4 gap-2 px-1">
                      {[
                        { id: 'else', label: 'Else解析', color: 'bg-violet-100 text-violet-700', icon: Ghost },
                        { id: 'detail', label: '詳細解説', color: 'bg-blue-100 text-blue-700', icon: Sparkles },
                        { id: 'statute', label: '条文確認', color: 'bg-slate-100 text-slate-700', icon: Scale },
                        { id: 'practical', label: '実務ハック', color: 'bg-emerald-100 text-emerald-700', icon: Briefcase }
                      ].map(b => (
                        <Button key={b.id} size="sm" onClick={() => handleAiCall(b.id)} 
                          className={`${b.color} border-none text-[9px] font-black h-9 rounded-xl shadow-none active:translate-y-0.5 transition-all flex flex-col items-center justify-center gap-0.5`}>
                          <b.icon className="w-3 h-3" />
                          <span>{b.label}</span>
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 bg-slate-900 rounded-t-[2.5rem] relative overflow-hidden flex flex-col">
                    <div className="p-5 py-3 border-b border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className={`w-4 h-4 text-violet-400 ${loadingState === "ai" ? 'animate-spin' : ''}`} />
                        <span className="text-[10px] font-black text-white/30 tracking-[0.2em] uppercase">Log Output</span>
                      </div>
                      {loadingState === "ai" && <Badge className="bg-violet-600 text-[8px] animate-pulse">Analyzing...</Badge>}
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
                       {aiContent.text ? (
                         <div className="animate-in fade-in duration-700 pb-12">
                           <p className="text-[14px] leading-loose whitespace-pre-wrap font-sans text-slate-200">
                             {aiContent.text}
                           </p>
                         </div>
                       ) : (
                         <div className="h-full flex flex-col items-center justify-center opacity-10">
                            <BrainCircuit className="w-14 h-14 text-white mb-4" />
                            <p className="text-[11px] text-white tracking-widest text-center uppercase font-black px-10">Select an analysis thread to deploy logic logs</p>
                         </div>
                       )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {viewMode === 'ear' && (
             <div className="flex-1 flex flex-col items-center justify-center space-y-12 animate-in zoom-in-95 duration-500">
               <div className="relative">
                 <div className="bg-[#ffb380]/10 w-48 h-48 rounded-full absolute -inset-6 animate-pulse" />
                 <div className="bg-[#ffb380] w-36