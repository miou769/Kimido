import { useState, useEffect } from "react";

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }

const REVIEW_STEPS = [1, 3, 7, 14];

const CONFIG = {
  readingSpeed: 6,
  minDelay: 2000,
  maxDelay: 12000,
  correctBase: 1500,
  wrongBase: 2500,
};

function getReadingSpeed(streak) {
  if (streak >= 10) return 10;
  if (streak >= 5) return 8;
  return CONFIG.readingSpeed;
}

function calcDelay(text, correct, streak) {
  const base = correct ? CONFIG.correctBase : CONFIG.wrongBase;
  const speed = getReadingSpeed(streak);
  const readTime = (text.length / speed) * 1000;
  return Math.min(Math.max(base, readTime), CONFIG.maxDelay);
}

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

function calcFieldAccSingle(field, results, QUESTIONS) {
  const qs = QUESTIONS.filter(q => q.field === field);
  let ok = 0, tot = 0;
  qs.forEach(q => {
    const r = results[q.id];
    if (r?.history?.length) { const h = r.history.slice(-10); ok += h.filter(Boolean).length; tot += h.length; }
  });
  return tot > 0 ? ok / tot : null;
}

function pickQuestion(pool, results, sessionSeen, QUESTIONS) {
  const scored = pool.map(q => {
    const r = results[q.id] || {};
    const wrong = r.wrong_count || 0;
    const due = isDue(r) ? 1 : 0;
    const recentMiss = (r.history || []).filter(x => !x).length;
    const priority = Math.min(r.priority || 0.5, 1.0);
    let score = wrong * 2 + due * 3 + recentMiss * 1.5 + priority * 1.5;
    if (wrong >= 5) score += 10;
    if (!r.history || r.history.length === 0) score += 3;
    if (isOnCooldown(r)) score -= 5;
    if (sessionSeen.has(q.id)) score -= 4;
    if (isMastered(r, QUESTIONS.length)) score -= 10;
    score = Math.min(score, 20);
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

function getWeakTop5(results, QUESTIONS) {
  const total = QUESTIONS.length;
  return QUESTIONS
    .filter(q => results[q.id]?.history?.length >= 2 && !isMastered(results[q.id], total))
    .map(q => { const r = results[q.id]; const h = r.history.slice(-10); return { q, acc: h.filter(Boolean).length / h.length, count: h.length }; })
    .sort((a, b) => a.acc - b.acc).slice(0, 5);
}

function calcPrediction(results, QUESTIONS) {
  const total = QUESTIONS.length;
  const mastered = QUESTIONS.filter(q => isMastered(results[q.id], total)).length;
  const pct = Math.round(mastered / total * 100);
  const label = pct >= 80 ? "合格圏内🎯" : pct >= 60 ? "もう少し💪" : pct >= 40 ? "基礎固め中📚" : "準備段階📖";
  return { mastered, total, pct, label };
}

function save(key, val) { try { localStorage.setItem(`kv4-${key}`, JSON.stringify(val)); } catch {} }
function load(key, fb) { try { const v = localStorage.getItem(`kv4-${key}`); return v ? JSON.parse(v) : fb; } catch { return fb; } }

const C = {
  bg: "#eaf9f7", bg2: "#ffffff", bg3: "#d4f2ee", border: "#a8ddd8",
  gold: "#009e96", gold2: "#00b8ae", text: "#1a3835", sub: "#6a9e9a",
  muted: "#3db8b3", green: "#1e9e6a", red: "#c04060", blue: "#4488aa",
};

export default function App() {
  const [QUESTIONS, setQUESTIONS] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("quiz");
  const [results, setResults] = useState({});
  const [selectedField, setSelectedField] = useState("all");
  const [phase, setPhase] = useState("question");
  const [currentQ, setCurrentQ] = useState(null);
  const [shuffledChoices, setShuffledChoices] = useState([]);
  const [isCorrect, setIsCorrect] = useState(null);
  const [sessionSeen] = useState(new Set());
  const [sessionScore, setSessionScore] = useState({ correct: 0, total: 0 });
  const [streak, setStreak] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [autoTimer, setAutoTimer] = useState(null);

  // 初回：questions.jsonを読み込む
  useEffect(() => {
    fetch('./questions.json')
      .then(r => r.json())
      .then(data => {
        setQUESTIONS(data);
        setResults(load("results", {}));
        setLoading(false);
      })
      .catch(err => {
        console.error('questions.json読み込みエラー:', err);
        setLoading(false);
      });
  }, []);

  const FIELDS = QUESTIONS.length > 0 ? [...new Set(QUESTIONS.map(q => q.field))] : [];

  const saveResults = r => { setResults(r); save("results", r); };
  const getPool = () => selectedField === "all" ? QUESTIONS : QUESTIONS.filter(q => q.field === selectedField);

  const nextQuestion = () => {
    if (QUESTIONS.length === 0) return;
    const pool = getPool();
    const q = pickQuestion(pool, results, sessionSeen, QUESTIONS);
    setCurrentQ(q);
    setShuffledChoices(shuffle(q.choices));
    setPhase("question");
    setIsCorrect(null);
    setStopped(false);
  };

  useEffect(() => {
    if (QUESTIONS.length > 0) nextQuestion();
  }, [QUESTIONS, selectedField]);

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
    let priority = Math.min(r.priority ?? 0.5, 1.0);
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
    if (autoTimer) clearTimeout(autoTimer);
    const explanation = correct ? currentQ.fb_ok : currentQ.fb_ng;
    const delay = calcDelay(explanation, correct, streak);
    const timer = setTimeout(() => {
      const pool = selectedField === "all" ? QUESTIONS : QUESTIONS.filter(q => q.field === selectedField);
      const nextQ = pickQuestion(pool, newResults, sessionSeen, QUESTIONS);
      setCurrentQ(nextQ);
      setShuffledChoices(shuffle(nextQ.choices));
      setPhase("question");
      setIsCorrect(null);
      setStopped(false);
    }, delay);
    setAutoTimer(timer);
  };

  const stopAuto = () => { if (autoTimer) clearTimeout(autoTimer); setStopped(true); };

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: C.gold, background: C.bg, minHeight: "100vh" }}>問題を読み込み中ちゃむ🌸</div>;
  }

  if (QUESTIONS.length === 0) {
    return <div style={{ padding: 40, textAlign: "center", color: C.red, background: C.bg, minHeight: "100vh" }}>questions.jsonの読み込みに失敗したちゃむ🙏</div>;
  }

  const pred = calcPrediction(results, QUESTIONS);
  const dueCount = QUESTIONS.filter(q => isDue(results[q.id])).length;
  const weakList = getWeakTop5(results, QUESTIONS);

  const s = {
    app: { background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'Hiragino Kaku Gothic Pro','Noto Sans JP',sans-serif", display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto" },
    hdr: { background: "linear-gradient(135deg,#eaf9f7,#d4f2ee)", padding: "10px 16px 8px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 50 },
    content: { flex: 1, overflowY: "auto", padding: 14, paddingBottom: 76 },
    card: { background: C.bg2, borderRadius: 12, padding: 14, marginBottom: 10, border: `1px solid ${C.border}` },
    tabBar: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: C.bg2, borderTop: `1px solid ${C.border}`, display: "flex", zIndex: 100 },
    tab: active => ({ flex: 1, padding: "9px 2px 7px", textAlign: "center", fontSize: 11, color: active ? C.gold : C.sub, fontWeight: active ? 700 : 400, cursor: "pointer", background: "none", border: "none", borderTop: `2px solid ${active ? C.gold : "transparent"}` }),
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
          { val: `🔥${streak}`, label: "連続正解", color: streak >= 5 ? "#ff9a3c" : C.text },
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
            <div style={{ fontSize: 15, lineHeight: 1.75, fontWeight: 400, color: "#a08060" }}>{currentQ.q}</div>
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
                <button key={c} onClick={() => handleAnswer(c)} style={{ width: "100%", padding: "10px 12px", marginBottom: 6, borderRadius: 9, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 13, fontWeight: 500, cursor: "pointer", textAlign: "left" }}>{c}</button>
              ))}
            </div>
          )}
        </>
      )}
      {currentQ && phase === "feedback" && (
        <>
          <div style={{ ...s.card, borderLeft: `4px solid ${isCorrect ? C.green : C.red}` }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: isCorrect ? C.green : C.red, marginRight: 8 }}>{isCorrect ? "○" : "×"} {isCorrect ? "正解" : "不正解"}</span>
            <div style={{ fontSize: 15, lineHeight: 1.9, color: "#3db8b3", marginTop: 10, fontWeight: 500 }}>{isCorrect ? currentQ.fb_ok : currentQ.fb_ng}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={stopAuto} style={{ flex: 1, padding: 12, borderRadius: 10, background: stopped ? "#fce8d8" : "transparent", border: `1px solid #d4888f`, color: "#d4888f", fontSize: 13, cursor: "pointer" }}>{stopped ? "⏸ 停止中" : "⏸ 停止"}</button>
            <button onClick={nextQuestion} style={{ flex: 2, padding: 12, borderRadius: 10, background: `${C.gold}22`, border: `1px solid ${C.gold}`, color: C.gold, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>次の問題へ →</button>
          </div>
        </>
      )}
    </div>
  );

  const renderStats = () => {
    const fieldStats = FIELDS.map(f => {
      const acc = calcFieldAccSingle(f, results, QUESTIONS);
      const qs = QUESTIONS.filter(q => q.field === f);
      const mastered = qs.filter(q => isMastered(results[q.id], QUESTIONS.length)).length;
      return { f, acc, mastered, total: qs.length };
    });
    return (
      <div>
        <div style={s.card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, marginBottom: 10 }}>総合進捗</div>
          <div style={{ textAlign: "center", padding: "8px 0 12px" }}>
            <div style={{ fontSize: 44, fontWeight: 700, color: C.gold, lineHeight: 1 }}>{pred.pct}<span style={{ fontSize: 20 }}>%</span></div>
            <div style={{ fontSize: 13, color: C.sub, marginTop: 4 }}>{pred.label} — 習得 {pred.mastered}/{pred.total}</div>
          </div>
        </div>
        <div style={s.card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, marginBottom: 10 }}>分野別正解率</div>
          {fieldStats.map(({ f, acc, mastered, total }) => (
            <div key={f} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: C.muted }}>{f}</span>
                <span style={{ color: C.sub }}>{mastered}/{total} | {acc !== null ? Math.round(acc * 100) : "--"}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderWeak = () => (
    <div style={s.card}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, marginBottom: 10 }}>🔴 弱点問題 TOP5</div>
      {weakList.length === 0 ? (
        <div style={{ textAlign: "center", color: C.sub, padding: "20px 0" }}>問題を解いて弱点を見つけてちゃむ🌸</div>
      ) : weakList.map(({ q, acc, count }) => (
        <div key={q.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: C.gold, marginBottom: 3 }}>{q.field}</div>
          <div style={{ fontSize: 12, color: "#a08060", marginBottom: 4 }}>{q.q.length > 50 ? q.q.slice(0, 50) + "…" : q.q}</div>
          <span style={{ fontSize: 10, color: C.sub }}>{Math.round(acc * 100)}% ({count}回)</span>
        </div>
      ))}
    </div>
  );

  const renderReview = () => {
    const dueList = QUESTIONS.filter(q => isDue(results[q.id]));
    return (
      <div style={s.card}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, marginBottom: 10 }}>🔔 本日の復習</div>
        {dueList.length === 0 ? (
          <div style={{ textAlign: "center", color: C.green, padding: "16px 0" }}>今日の復習は完了ちゃむ🌸</div>
        ) : (
          <div style={{ fontSize: 13, color: C.gold }}>{dueList.length}問 復習待ちちゃむ</div>
        )}
      </div>
    );
  };

  return (
    <div style={s.app}>
      <div style={s.hdr}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, letterSpacing: 2 }}>⚖ きみまろ道場</div>
            <div style={{ fontSize: 10, color: C.sub }}>司法書士 民法 {QUESTIONS.length}問 | {pred.mastered}問習得</div>
          </div>
          {dueCount > 0 && <div style={{ background: `${C.red}33`, color: C.red, border: `1px solid ${C.red}`, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>🔔{dueCount}</div>}
        </div>
      </div>
      <div style={s.content}>
        {tab === "quiz" && renderQuiz()}
        {tab === "stats" && renderStats()}
        {tab === "weak" && renderWeak()}
        {tab === "review" && renderReview()}
      </div>
      <div style={s.tabBar}>
        {[["quiz","📝 問題"],["stats","🌸 成績"],["weak","🔴 弱点"],["review","🔔 復習"]].map(([id,label]) => (
          <button key={id} style={s.tab(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
    </div>
  );
}
