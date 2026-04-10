let data;
let index = 0;
let isPlaying = false;
let rateSpeed = 1.0;
let currentQuestion = null;

async function load() {
  const res = await fetch("questions.json");
  data = await res.json();
  data.questions = sortQuestions(data.questions);
}

function speak(text) {
  return new Promise(resolve => {
    const uttr = new SpeechSynthesisUtterance(text);
    uttr.lang = "ja-JP";
    uttr.rate = rateSpeed;
    uttr.onend = resolve;
    uttr.onerror = resolve;
    speechSynthesis.speak(uttr);
  });
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getProgress() {
  return JSON.parse(localStorage.getItem("progress") || "{}");
}

function saveProgress(progress) {
  localStorage.setItem("progress", JSON.stringify(progress));
}

function getPriority(q, progress) {
  const p = progress[q.id];
  if (!p) return 0;
  const diff = Date.now() - p.last;
  return diff / (p.interval || 1);
}

function sortQuestions(list) {
  const progress = getProgress();
  return list.slice().sort((a, b) => getPriority(b, progress) - getPriority(a, progress));
}

function rate(result) {
  if (!currentQuestion) return;
  const progress = getProgress();
  const p = progress[currentQuestion.id] || { interval: 60000 };
  p.interval = result === "good"
    ? Math.min(p.interval * 2, 1000 * 60 * 60 * 24 * 14)
    : 60000;
  p.last = Date.now();
  progress[currentQuestion.id] = p;
  saveProgress(progress);
  next();
}

function next() {
  index++;
  if (isPlaying) play();
}

async function play() {
  if (index >= data.questions.length) {
    data.questions = sortQuestions(data.questions);
    index = 0;
    document.getElementById("status").textContent = "✅ 全問終了！最初からちゃむ🌸";
    isPlaying = false;
    return;
  }

  const q = data.questions[index];
  currentQuestion = q;

  document.getElementById("status").textContent = `【問題 ${index + 1}】${q.question}`;
  document.getElementById("progress").textContent = `${index + 1} / ${data.questions.length}問`;

  await speak(q.question);
  await wait(2000);

  document.getElementById("status").textContent = `【解説】${q.explanation}`;
  await speak(q.explanation);

  // 評価待ち（○×を押すまで次に進まない）
}

function start() {
  if (isPlaying) return;
  if (!data) {
    document.getElementById("status").textContent = "読み込み中ちゃむ…";
    load()
      .then(() => { isPlaying = true; play(); })
      .catch(() => { document.getElementById("status").textContent = "❌ questions.jsonが見つからないちゃむ"; });
  } else {
    isPlaying = true;
    play();
  }
}

function stop() {
  isPlaying = false;
  speechSynthesis.cancel();
  document.getElementById("status").textContent = "⏸ 停止中ちゃむ";
}

function skip() {
  speechSynthesis.cancel();
  next();
}

function changeRate(r) {
  rateSpeed = parseFloat(r);
}
