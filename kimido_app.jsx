import { useState, useEffect, useRef } from "react";

const CONFIG = {
  readingSpeed: 6,
  minDelay: 2000,
  maxDelay: 12000,
  correctBase: 1500,
  wrongBase: 2500,
};
function getReadingSpeed(s) { return s >= 10 ? 10 : s >= 5 ? 8 : CONFIG.readingSpeed; }
function calcDelay(text, correct, streak) {
  const base = correct ? CONFIG.correctBase : CONFIG.wrongBase;
  const readTime = (text.length / getReadingSpeed(streak)) * 1000;
  return Math.min(Math.max(base, readTime), CONFIG.maxDelay);
}
const QUESTIONS = window.QUESTIONS || [];


const FIELDS = [...new Set(QUESTIONS.map(q => q.field))];
const REVIEW_STEPS = [1, 3, 7, 14];

function todayStr() { return new Date().toISOString().slice(0, 10); }
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function isDue(r) { return r?.nextReview && todayStr() >= r.nextReview; }
function isOnCooldown(r) { return r?.cooldownUntil ? todayStr() < r.cooldownUntil : false; }

function isMastered(r, total) {
  const cc = total < 100 ? 5 : total < 300 ? 7 : 10;
  if (!r || (r.correct_count || 0) < cc) return false;
  if (!r.history || r.history.length < 3) return false;
  return r.history.slice(-5).filter(Boolean).length >= 4;
}

function calcFieldAccSingle(field, results) {
  const qs = QUESTIONS.filter(q => q.field === field);
  let ok = 0, tot = 0;
  qs.forEach(q => {
    const r = results[q.id];
    if (r?.history?.length) { const h = r.history.slice(-10); ok += h.filter(Boolean).length; tot += h.length; }
  });
  return tot > 0 ? ok / tot : null;
}

function pickQuestion(pool, results, sessionSeen) {
  const scored = pool.map(q => {
    const r = results[q.id] || {};
    const wrong = r.wrong_count || 0;
    const due = isDue(r) ? 1 : 0;
    const recentMiss = (r.history || []).filter(x => !x).length;
    const priority = Math.min(r.priority || 0.5, 1.0);
    let score = wrong * 2 + due * 3 + recentMiss * 1.5 + priority * 1.5;
    if (wrong >= 5) score += 10;
    score = Math.min(score, 20);
    if (!r.history || r.history.length === 0) score += 3;
    if (isOnCooldown(r)) score -= 5;
    if (sessionSeen.has(q.id)) score -= 4;
    if (isMastered(r, QUESTIONS.length)) score -= 10;
    return { q, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const topN = Math.max(1, Math.floor(scored.length * 0.3));
  const top = scored.slice(0, topN);
  const totalW = top.reduce((s, i) => s + Math.max(0.1, i.score + 15), 0);
  let rand = Math.random() * totalW;
  for (const item of top) { rand -= Math.max(0.1, item.score + 15); if (rand <= 0) return item.q; }
  return top[0].q;
}
function getWeakTop5(results) {
  const total = QUESTIONS.length;
  return QUESTIONS
    .filter(q => results[q.id]?.history?.length >= 2 && !isMastered(results[q.id], total))
    .map(q => { const r = results[q.id]; const h = r.history.slice(-10); return { q, acc: h.filter(Boolean).length / h.length, count: h.length }; })
    .sort((a, b) => a.acc - b.acc).slice(0, 5);
}

function calcPrediction(results) {
  const total = QUESTIONS.length;
  const mastered = QUESTIONS.filter(q => isMastered(results[q.id], total)).length;
  const pct = Math.round(mastered / total * 100);
  const label = pct >= 80 ? "合格圏内🎯" : pct >= 60 ? "もう少し💪" : pct >= 40 ? "基礎固め中📚" : "準備段階📖";
  return { mastered, total, pct, label };
}

function save(key, val) {
  try { localStorage.setItem(`kv4-${key}`, JSON.stringify(val)); } catch {}
  try { window.storage && window.storage.set(`kv4-${key}`, JSON.stringify(val)); } catch {}
}
function load(key, fb) {
  try { const v = localStorage.getItem(`kv4-${key}`); if (v) return JSON.parse(v); } catch {}
  return fb;
}
async function loadFromStorage(key, fb) {
  try {
    if (window.storage) {
      const r = await window.storage.get(`kv4-${key}`);
      if (r && r.value) return JSON.parse(r.value);
    }
  } catch {}
  try { const v = localStorage.getItem(`kv4-${key}`); if (v) return JSON.parse(v); } catch {}
  return fb;
}

const C = {
  bg: "#eaf9f7", bg2: "#ffffff", bg3: "#d4f2ee", border: "#a8ddd8",
  gold: "#009e96", gold2: "#00b8ae", text: "#1a3835", sub: "#6a9e9a",
  muted: "#3db8b3", green: "#1e9e6a", red: "#d4721a", blue: "#4488aa",
};

export default function App() {
  const [tab, setTab] = useState("quiz");
  const [results, setResults] = useState({});
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [selectedField, setSelectedField] = useState("all");
  const [phase, setPhase] = useState("question");
  const [currentQ, setCurrentQ] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);
  const [sessionSeen] = useState(new Set());
  const autoTimer = useRef(null);
  const [sessionScore, setSessionScore] = useState({ correct: 0, total: 0 });
  const [streak, setStreak] = useState(0);
  const [showData, setShowData] = useState(false);
  const [todayCount, setTodayCount] = useState(() => load("todayCount", 0));
  const [flash, setFlash] = useState(null);
  const [stopped, setStopped] = useState(false);
  const [barFlash, setBarFlash] = useState(false);
  const [editTotal, setEditTotal] = useState(false);
  const [editTotalVal, setEditTotalVal] = useState("");
  const [totalSolved, setTotalSolved] = useState(() => load("totalSolved", 0)); // "ok" | "ng" | null
  const [goal, setGoal] = useState(() => load("goal", 50));

  // 日付切替でtodayCountリセット
  useEffect(() => {
    const last = load("lastDate", "");
    const today = todayStr();
    if (last !== today) {
      setTodayCount(0);
      save("todayCount", 0);
      save("lastDate", today);
    }
  }, []);

  // goal保存
  useEffect(() => { save("goal", goal); }, [goal]);

  const audioCtxRef = useRef(null);
  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const playCelebration = (times = 1) => {
    try {
      const ctx = getAudioCtx();
      for (let i = 0; i < times; i++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "triangle"; o.frequency.value = 880;
        g.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.22);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.3);
        o.start(ctx.currentTime + i * 0.22);
        o.stop(ctx.currentTime + i * 0.22 + 0.3);
      }
    } catch(e) {}
  };

  const playSound = (correct) => {
    try {
      const ctx = getAudioCtx();
      if (correct) {
        // 正解：チリーン♪（明るく上昇する2音）
        [660, 990].forEach((freq, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.type = "triangle"; o.frequency.value = freq;
          g.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.35);
          o.start(ctx.currentTime + i * 0.18);
          o.stop(ctx.currentTime + i * 0.18 + 0.35);
        });
      } else {
        // 不正解：ドスン（重く短い・邪魔しない）
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "square"; o.frequency.value = 80;
        g.gain.setValueAtTime(0.25, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        o.start(); o.stop(ctx.currentTime + 0.2);
      }
    } catch(e) {}
  };

  const saveResults = r => {
    setResults(r);
    save("results", r);
    try { window.storage && window.storage.set("kv4-results", JSON.stringify(r)); } catch {}
  };
  const getPool = () => selectedField === "all" ? QUESTIONS : QUESTIONS.filter(q => q.field === selectedField);

  const [shuffledChoices, setShuffledChoices] = useState([]);

  const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);

  const nextQuestion = () => {
    const pool = getPool();
    const q = pickQuestion(pool, results, sessionSeen);
    setCurrentQ(q);
    setShuffledChoices(shuffle(q.choices));
    setPhase("question");
    setIsCorrect(null);
  };

  useEffect(() => {
    loadFromStorage("results", {}).then(r => {
      setResults(r);
      setStorageLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (storageLoaded) nextQuestion();
  }, [selectedField, storageLoaded]);

  const handleAnswer = choice => {
    if (!currentQ || phase === "feedback") return;
    const correct = choice === currentQ.a;
    setIsCorrect(correct);
    setPhase("feedback");
    sessionSeen.add(currentQ.id);
    setSessionScore(s => ({ correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }));
    setStreak(s => correct ? s + 1 : 0);
    const r = results[currentQ.id] || { correct_count: 0, wrong_count: 0, history: [], priority: 0.5, step: 0 };
    const newHistory = [...(r.history || []).slice(-2), correct];
    let priority = r.priority ?? 0.5;
    let step = r.step ?? 0;
    if (correct) { priority = Math.max(0.1, priority - 0.1); step = Math.min(step + 1, REVIEW_STEPS.length - 1); }
    else { priority = Math.min(1.0, priority + 0.2); step = 0; }
    const newResults = {
      ...results,
      [currentQ.id]: {
        ...r, correct_count: (r.correct_count || 0) + (correct ? 1 : 0),
        wrong_count: (r.wrong_count || 0) + (correct ? 0 : 1),
        history: newHistory, priority, step,
        nextReview: correct ? addDays(REVIEW_STEPS[step]) : null,
        cooldownUntil: correct ? null : addDays(1),
      }
    };
    saveResults(newResults);
    const nc = todayCount + 1;
    setTodayCount(nc);
    save("todayCount", nc);
    setBarFlash(true);
    setTimeout(() => setBarFlash(false), 800);
    const ts = totalSolved + 1;
    setTotalSolved(ts);
    save("totalSolved", ts);
    if (ts % 100 === 0) {
      playCelebration(4);   // 100問：チリン4回
    } else if (ts % 80 === 0) {
      playCelebration(3);   // 80問：チリン3回
    } else if (ts % 50 === 0) {
      playCelebration(2);  // 50問：チリン2回
    } else if (ts % 30 === 0) {
      playCelebration(1);  // 30問：チリン1回
    } else {
      playSound(correct);
    }
    setFlash(correct ? "ok" : "ng");
    setTimeout(() => setFlash(null), 600);
    if (autoTimer.current) clearTimeout(autoTimer.current);
    const explanation = correct ? currentQ.fb_ok : currentQ.fb_ng;
    const delay = calcDelay(explanation, correct, streak);
    autoTimer.current = setTimeout(() => {
      const pool = selectedField === "all" ? QUESTIONS : QUESTIONS.filter(q => q.field === selectedField);
      const nextQ = pickQuestion(pool, newResults, sessionSeen);
      setCurrentQ(nextQ);
      setShuffledChoices(shuffle(nextQ.choices));
      setPhase("question");
      setIsCorrect(null);
      autoTimer.current = null;
    }, delay);
  };

  const pred = calcPrediction(results);
  const dueCount = QUESTIONS.filter(q => isDue(results[q.id])).length;
  const weakList = getWeakTop5(results);

  const s = {
    app: { background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'Hiragino Kaku Gothic Pro','Noto Sans JP',sans-serif", display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto" },
    hdr: { background: C.bg2, padding: "10px 16px 8px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 50 },
    content: { flex: 1, overflowY: "auto", padding: 14, paddingBottom: 76 },
    card: { background: C.bg2, borderRadius: 12, padding: 14, marginBottom: 10, border: `1px solid ${C.border}` },
    tabBar: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: C.bg2, borderTop: `1px solid ${C.border}`, display: "flex", zIndex: 100 },
    tab: active => ({ flex: 1, padding: "9px 2px 7px", textAlign: "center", fontSize: 11, color: active ? C.gold : C.sub, fontWeight: active ? 700 : 400, cursor: "pointer", background: "none", border: "none", borderTop: `2px solid ${active ? C.gold : "transparent"}` }),
    secTitle: { fontSize: 11, fontWeight: 700, color: C.gold, letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" },
    statBar: { height: 6, borderRadius: 3, background: C.border, overflow: "hidden", marginBottom: 3 },
    fill: (pct, col) => ({ height: "100%", width: `${Math.min(100, pct)}%`, background: col, borderRadius: 3, transition: "width 0.6s" }),
    nextBtn: { width: "100%", padding: 13, borderRadius: 10, background: `linear-gradient(135deg,${C.gold},${C.gold2})`, border: "none", color: C.bg, fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 8 },
  };

  const renderQuiz = () => (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
        {["all", ...FIELDS].map(f => (
          <button key={f} onClick={() => setSelectedField(f)} style={{ whiteSpace: "nowrap", padding: "4px 10px", borderRadius: 20, border: `1px solid ${selectedField === f ? C.gold : C.border}`, background: selectedField === f ? `${C.gold}22` : "transparent", color: selectedField === f ? C.gold : C.sub, fontSize: 11, cursor: "pointer", fontWeight: selectedField === f ? 700 : 400 }}>
            {f === "all" ? "全分野" : f}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[
          { val: sessionScore.total > 0 ? Math.round(sessionScore.correct / sessionScore.total * 100) + "%" : "--", label: "今回正答率", color: C.gold },
          { val: `🔥${streak}`, label: "連続正解", color: streak >= 5 ? "#d4721a" : C.text },
          { val: pred.mastered, label: "習得済み", color: C.green },
        ].map(({ val, label, color }) => (
          <div key={label} style={{ ...s.card, flex: 1, padding: "8px 4px", marginBottom: 0, textAlign: "center" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color }}>{val}</div>
            <div style={{ fontSize: 9, color: C.sub }}>{label}</div>
          </div>
        ))}
      </div>
      {currentQ && phase === "question" && (
        <>
          <div style={s.card}>
            <div style={{ fontSize: 10, color: C.gold, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>{currentQ.field} ▸ {currentQ.tag}</div>
            <div style={{ fontSize: 15, lineHeight: 1.75, fontWeight: 400, color: "#4a2000" }}>{currentQ.q}</div>
          </div>
          {currentQ.choices.length === 2 ? (
            <div style={{ display: "flex", gap: 10, padding: "2px 0" }}>
              {[["🌸","○","#d4721a"],["💩","×","#a08060"]].map(([emoji,val,col]) => (
                <button key={val} onClick={() => handleAnswer(val)} style={{ flex: 1, padding: 18, borderRadius: 12, border: `1px solid ${col}`, background: "transparent", color: col, fontSize: 32, fontWeight: 400, cursor: "pointer" }}>{emoji}</button>
              ))}
            </div>
          ) : (
            <div style={s.card}>
              {shuffledChoices.map(c => (
                <button key={c} onClick={() => handleAnswer(c)} style={{ width: "100%", padding: "11px 12px", marginBottom: 7, borderRadius: 9, border: `1px solid ${C.border}`, background: `${C.blue}22`, color: C.muted, fontSize: 13, fontWeight: 500, cursor: "pointer", textAlign: "left" }}>{c}</button>
              ))}
            </div>
          )}
        </>
      )}
      {currentQ && phase === "feedback" && (
        <div>
          <div style={{ ...s.card, borderLeft: `4px solid ${isCorrect ? C.green : C.red}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: isCorrect ? C.green : C.red, marginBottom: 8 }}>{isCorrect ? "○ 正解" : "× 不正解"}</div>
            <div style={{ fontSize: 15, lineHeight: 1.9, color: "#d4721a", fontWeight: 500 }}>{isCorrect ? currentQ.fb_ok : currentQ.fb_ng}</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button onClick={() => { if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null; } setStopped(true); }}
              style={{ flex: 1, padding: 11, borderRadius: 9, border: "1px solid #e8a8b8", background: stopped ? "#f5e0cc" : "transparent", color: stopped ? "#c26010" : "#d4721a", fontSize: 13, cursor: "pointer", fontWeight: 500 }}>
              {stopped ? "⏸ 停止中" : "⏸ 停止"}
            </button>
            <button onClick={() => { if (autoTimer.current) clearTimeout(autoTimer.current); const pool = selectedField === "all" ? QUESTIONS : QUESTIONS.filter(q => q.field === selectedField); const nextQ = pickQuestion(pool, results, sessionSeen); setCurrentQ(nextQ); setShuffledChoices(shuffle(nextQ.choices)); setPhase("question"); setIsCorrect(null); setStopped(false); }}
              style={{ flex: 2, padding: 11, borderRadius: 9, border: "1px solid #5cc8c2", background: "#b2e8e5", color: "#1a6e6a", fontSize: 13, cursor: "pointer", fontWeight: 500 }}>
              次の問題へ →
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderStats = () => {
    const fieldStats = FIELDS.map(f => {
      const acc = calcFieldAccSingle(f, results);
      const qs = QUESTIONS.filter(q => q.field === f);
      const mastered = qs.filter(q => isMastered(results[q.id], QUESTIONS.length)).length;
      return { f, acc, mastered, total: qs.length };
    });
    return (
      <div>
        <div style={s.card}>
          <div style={s.secTitle}>総合進捗</div>
          <div style={{ fontSize: 10, color: C.sub, marginBottom: 8 }}>※ 同じ問題に7回正解で「習得済み」になるちゃむ</div>
          <div style={{ textAlign: "center", padding: "8px 0 12px" }}>
            <div style={{ fontSize: 44, fontWeight: 700, color: C.gold, lineHeight: 1 }}>{pred.pct}<span style={{ fontSize: 20 }}>%</span></div>
            <div style={{ fontSize: 13, color: C.sub, marginTop: 4 }}>{pred.label} — 習得 {pred.mastered}/{pred.total}</div>
          </div>
          <div style={s.statBar}><div style={s.fill(pred.pct, `linear-gradient(90deg,${C.gold},${C.gold2})`)} /></div>
        </div>
        <div style={s.card}>
          <div style={s.secTitle}>分野別正解率</div>
          {fieldStats.map(({ f, acc, mastered, total }) => (
            <div key={f} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 12, color: C.muted }}>{f}</span>
                <span style={{ fontSize: 10, color: C.sub }}>{mastered}/{total} | {acc !== null ? Math.round(acc * 100) : "--"}%</span>
              </div>
              <div style={s.statBar}><div style={s.fill(acc !== null ? acc * 100 : 0, acc !== null ? acc >= 0.7 ? C.green : acc >= 0.5 ? C.gold : C.red : C.border)} /></div>
            </div>
          ))}
        </div>

        <div style={{ ...s.card, marginBottom: 10 }}>
          <div style={s.secTitle}>累計問題数の修正</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <input type="number" min="0" defaultValue={totalSolved}
              id="totalSolvedInput"
              style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 14, color: C.text, background: C.bg3 }}
            />
            <button onClick={() => {
              const v = Number(document.getElementById('totalSolvedInput').value);
              if (!isNaN(v) && v >= 0) { setTotalSolved(v); save("totalSolved", v); }
            }} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.gold}`, background: `${C.gold}22`, color: C.gold, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
              修正する
            </button>
          </div>
          <div style={{ fontSize: 10, color: C.sub, marginTop: 4 }}>現在の累計：{totalSolved}問</div>
        </div>
        <button onClick={() => { if (window.confirm("学習データをリセットしますか？")) { save("results", {}); setResults({}); setSessionScore({ correct: 0, total: 0 }); setStreak(0); } }} style={{ width: "100%", padding: 12, borderRadius: 10, background: "transparent", border: `1px solid ${C.red}`, color: C.red, fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
          データをリセット
        </button>
        <button onClick={() => setShowData(v => !v)}
          style={{ width: "100%", padding: 12, borderRadius: 10, background: "transparent", border: `1px solid ${C.gold}`, color: C.gold, fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
          💾 {showData ? "データを隠す" : "データを表示（長押しコピー）"}
        </button>
        {showData && (
          <div>
            <textarea readOnly value={JSON.stringify(results)}
              style={{ width: "100%", height: 100, fontSize: 10, color: "#333", background: "#f5f5f0", border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, boxSizing: "border-box", marginBottom: 4, resize: "none" }}
            />
            <div style={{ fontSize: 10, color: C.sub, marginBottom: 8 }}>
              ※このArtifact内では自動保存されます。メモアプリへのバックアップ用ちゃむ🌸
            </div>
          </div>
        )}
        <button onClick={() => {
          const text = window.prompt("保存したデータを貼り付けてちゃむ🌸");
          if (!text) return;
          try {
            const loaded = JSON.parse(text);
            save("results", loaded);
            setResults(loaded);
            alert("✔ データを読み込みましたちゃむ🌸");
          } catch { alert("読み込みに失敗したちゃむ…データが正しいか確認してちゃむ"); }
        }} style={{ width: "100%", padding: 12, borderRadius: 10, background: "transparent", border: `1px solid ${C.green}`, color: C.green, fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
          📂 データを貼り付けて読み込む
        </button>
      </div>
    );
  };

  const renderWeak = () => (
    <div>
      <div style={s.card}>
        <div style={s.secTitle}>🔴 弱点問題 TOP5</div>
        {weakList.length === 0 ? (
          <div style={{ textAlign: "center", color: C.sub, padding: "20px 0" }}>問題を解いて弱点を見つけてちゃむ🌸</div>
        ) : weakList.map(({ q, acc, count }) => (
          <div key={q.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: C.gold }}>{q.field}</span>
              <span style={{ fontSize: 10, color: acc < 0.5 ? C.red : C.gold }}>{Math.round(acc * 100)}% ({count}回)</span>
            </div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>{q.q.length > 50 ? q.q.slice(0, 50) + "…" : q.q}</div>
            <button onClick={() => { setCurrentQ(q); setPhase("question"); setTab("quiz"); }} style={{ padding: "4px 10px", borderRadius: 6, background: `${C.gold}22`, border: `1px solid ${C.gold}`, color: C.gold, fontSize: 11, cursor: "pointer" }}>この問題を解く</button>
          </div>
        ))}
      </div>
      <div style={s.card}>
        <div style={s.secTitle}>未学習問題</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.blue, textAlign: "center" }}>
          {QUESTIONS.filter(q => !results[q.id]?.history?.length).length}<span style={{ fontSize: 13, color: C.sub, marginLeft: 4 }}>問</span>
        </div>
        <div style={{ fontSize: 11, color: C.sub, textAlign: "center", marginTop: 4 }}>アルゴリズムが自動で優先出題するちゃむ🌸</div>
      </div>
    </div>
  );

  const renderReview = () => {
    const dueList = QUESTIONS.filter(q => isDue(results[q.id]));
    return (
      <div>
        <div style={s.card}>
          <div style={s.secTitle}>🔔 本日の復習</div>
          {dueList.length === 0 ? (
            <div style={{ textAlign: "center", color: C.green, padding: "16px 0" }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>✓</div>
              <div style={{ fontSize: 13 }}>今日の復習は完了ちゃむ🌸</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: C.gold, marginBottom: 10 }}>{dueList.length}問 復習待ちちゃむ</div>
              {dueList.slice(0, 5).map(q => (
                <div key={q.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: C.sub, marginBottom: 3 }}>{q.field} ▸ {q.tag}</div>
                  <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 6 }}>{q.q.length > 45 ? q.q.slice(0, 45) + "…" : q.q}</div>
                  <button onClick={() => { setCurrentQ(q); setPhase("question"); setTab("quiz"); }} style={{ padding: "4px 10px", borderRadius: 6, background: `${C.green}22`, border: `1px solid ${C.green}`, color: C.green, fontSize: 11, cursor: "pointer" }}>復習する</button>
                </div>
              ))}
              {dueList.length > 5 && <div style={{ fontSize: 11, color: C.sub, textAlign: "center" }}>他 {dueList.length - 5}問</div>}
            </>
          )}
        </div>
        <div style={s.card}>
          <div style={s.secTitle}>習得進捗</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 34, fontWeight: 700, color: C.green }}>{pred.mastered}<span style={{ fontSize: 14, color: C.sub }}>/{pred.total}</span></div>
            <div style={{ fontSize: 12, color: C.sub }}>{pred.label}</div>
          </div>
          <div style={{ ...s.statBar, marginTop: 10 }}><div style={s.fill(pred.pct, C.green)} /></div>
        </div>
      </div>
    );
  };

  return (
    <div style={s.app}>
      <div style={s.hdr}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, letterSpacing: 2 }}>⚖ きみまろ道場</div>
            <div style={{ fontSize: 10, color: C.sub }}>司法書士 民法 {QUESTIONS.length}問 | {pred.mastered}問習得</div>
          </div>
          {dueCount > 0 && <div style={{ background: `${C.red}33`, color: C.red, border: `1px solid ${C.red}`, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>🔔{dueCount}</div>}
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>今日 {todayCount}問 / 目標 <span style={{color:"#ff7c2a"}}>累計{totalSolved}問</span></span>
            <select value={goal} onChange={e => { const g = Number(e.target.value); setGoal(g); setTodayCount(0); save("todayCount", 0); save("goal", g); }}
              style={{ fontSize: 11, color: C.gold, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, padding: "1px 4px", cursor: "pointer" }}>
              {[10,20,30,50,100,150,200].map(n => <option key={n} value={n}>{n}問</option>)}
            </select>
          </div>
          <div style={{ background: "#ede8e0", height: 6, borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, todayCount / goal * 100)}%`, background: todayCount >= goal ? C.green : "#ff7c2a", height: 6, borderRadius: 3, transition: "width 0.4s" }} />
          </div>
          {todayCount >= goal && <div style={{ fontSize: 10, color: C.green, textAlign: "right", marginTop: 2 }}>🎉 目標達成！</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 10, color: C.green }}>✓ 正解 {sessionScore.correct}</span>
            <span style={{ fontSize: 10, color: C.red }}>✗ 不正解 {sessionScore.total - sessionScore.correct}</span>
            <span style={{ fontSize: 10, color: C.sub }}>計 {sessionScore.total}問</span>
            {editTotal ? (
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="number" value={editTotalVal} onChange={e => setEditTotalVal(e.target.value)}
                  style={{ width: 55, fontSize: 11, padding: "1px 4px", borderRadius: 4, border: `1px solid ${C.gold}`, color: C.text, background: C.bg3 }} />
                <button onClick={() => { const v = Number(editTotalVal); if (!isNaN(v) && v >= 0) { setTotalSolved(v); save("totalSolved", v); } setEditTotal(false); }}
                  style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: C.gold, border: "none", color: "#fff", cursor: "pointer" }}>OK</button>
                <button onClick={() => setEditTotal(false)}
                  style={{ fontSize: 10, padding: "2px 4px", borderRadius: 4, background: "transparent", border: `1px solid ${C.sub}`, color: C.sub, cursor: "pointer" }}>✕</button>
              </span>
            ) : (
              <button onClick={() => { setEditTotalVal(String(totalSolved)); setEditTotal(true); }}
                style={{ fontSize: 10, color: C.gold, background: "transparent", border: `1px solid ${C.gold}`, borderRadius: 4, padding: "1px 6px", cursor: "pointer" }}>累計修正</button>
            )}
          </div>
        </div>
      </div>
      <div style={{ ...s.content, transition: "background 0.3s", background: flash === "ok" ? "#c8f0e0" : flash === "ng" ? "#f5c8d0" : C.bg }}>
        {tab === "quiz" && renderQuiz()}
        {tab === "stats" && renderStats()}
        {tab === "weak" && renderWeak()}
        {tab === "review" && renderReview()}
      </div>
      <div style={s.tabBar}>
        {[["quiz","📝 問題"],["stats","📊 成績"],["weak","🔴 弱点"],["review","🔔 復習"]].map(([id,label]) => (
          <button key={id} style={s.tab(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
    </div>
  );
}
