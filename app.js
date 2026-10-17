/* ============================================================
   app.js — the "brain" of Lafz (your English–Urdu dictionary)
   ------------------------------------------------------------
   This file has 9 parts. Read them in order:
     1. Saved data (localStorage)
     2. Helper functions (small tools we use everywhere)
     3. Words (the dictionary)
     4. My lists (📌 Memorize / ✅ Done), review dates, streak
     5. Speaking words aloud (Web Speech API)
     6. Popup (modal) and toast messages
     7. Router (decides which page to show)
     8. Pages: Home, Dictionary, Word page, Online search,
        My Lists, Flashcards, Quiz, Add/Edit word, Settings
     9. Start the app
   ============================================================ */


/* ============================================================
   1. SAVED DATA (localStorage)
   ------------------------------------------------------------
   localStorage is a small storage box inside your browser.
   It keeps data even after you close the tab. It can only
   store TEXT, so we turn our data object into text with
   JSON.stringify() and back into an object with JSON.parse().
   ============================================================ */

// The name of the "drawer" in localStorage where we keep everything.
const STORAGE_KEY = "lafz-vocab-data";

// What the data looks like for a brand-new user.
function defaultData() {
  return {
    version: 2,
    settings: {
      theme: "auto", // "light", "dark" or "auto" (= follow your phone/computer)
      dailyGoal: 5,  // words to learn (✅ Got it) every day
    },
    // progress[wordId] = { status, interval, nextReview, addedAt }
    //   status "memorize" → the word is in your 📌 Memorize list
    //   status "done"     → the word is in your ✅ Done list
    //   no entry at all   → a new word you have not touched yet
    progress: {},
    myWords: [],      // words you added yourself (or saved from online search)
    editedWords: {},  // built-in words you changed: { id: word }
    deletedIds: [],   // ids of built-in words you deleted
    stats: {
      streak: 0,            // days in a row you studied
      lastStudyDate: null,  // last day you studied, e.g. "2026-10-17"
      doneDate: null,       // the day that doneCount belongs to
      doneCount: 0,         // words you learned (✅ Got it) on that day
    },
  };
}

// Makes sure a word has every field with the right type.
// This protects the app from broken or old data (e.g. an imported file).
function cleanWord(w) {
  return {
    id: Number(w.id),
    word: String(w.word || "").trim(),
    partOfSpeech: String(w.partOfSpeech || ""),
    pronunciation: String(w.pronunciation || ""),
    urduMeaning: String(w.urduMeaning || ""),
    simpleEnglishMeaning: String(w.simpleEnglishMeaning || ""),
    synonyms: Array.isArray(w.synonyms) ? w.synonyms.map(String) : [],
    antonyms: Array.isArray(w.antonyms) ? w.antonyms.map(String) : [],
    level: ["easy", "medium", "hard"].includes(w.level) ? w.level : "medium",
    category: String(w.category || "My Words"),
    sentences: Array.isArray(w.sentences)
      ? w.sentences
          .filter((s) => s && s.en)
          .map((s) => ({ en: String(s.en), ur: String(s.ur || "") }))
      : [],
  };
}

// Older versions of this app saved progress in a different shape
// ({ learned, favourite ... }). This turns old progress into the new shape.
function upgradeProgress(oldProgress) {
  const progress = {};
  Object.entries(oldProgress || {}).forEach(([id, p]) => {
    if (!p || typeof p !== "object") return;
    if (p.status === "memorize" || p.status === "done") {
      progress[id] = p; // already the new shape
    } else if (p.learned) {
      progress[id] = { status: "done", interval: p.interval || 1, nextReview: p.nextReview || today(), addedAt: Date.now() };
    } else if (p.nextReview) {
      progress[id] = { status: "memorize", interval: 0, nextReview: null, addedAt: Date.now() };
    }
  });
  return progress;
}

// Mixes saved data with the default data, so missing parts are filled in.
function mergeWithDefaults(saved) {
  const fresh = defaultData();

  const editedWords = {};
  Object.values(saved.editedWords || {}).forEach((w) => {
    if (w && w.word) editedWords[w.id] = cleanWord(w);
  });

  const settings = { ...fresh.settings, ...saved.settings };
  settings.dailyGoal = Number(settings.dailyGoal) || 5;

  const progress = upgradeProgress(saved.progress);
  let myWords = Array.isArray(saved.myWords) ? saved.myWords.filter((w) => w && w.word).map(cleanWord) : [];

  // The first version gave your own words ids from 1001, but the big
  // dictionary now uses those numbers. So your words get new ids
  // from 10001, and their progress moves with them.
  const builtInIds = new Set(BUILT_IN_WORDS.map((w) => Number(w.id)));
  let nextId = Math.max(10000, ...myWords.map((w) => w.id));
  myWords = myWords.map((w) => {
    if (!builtInIds.has(w.id)) return w;
    const newId = ++nextId;
    if (progress[w.id]) {
      progress[newId] = progress[w.id];
      delete progress[w.id];
    }
    return { ...w, id: newId };
  });

  return {
    version: 2,
    settings: settings,
    progress: progress,
    myWords: myWords,
    editedWords: editedWords,
    deletedIds: Array.isArray(saved.deletedIds) ? saved.deletedIds.map(Number) : [],
    stats: { ...fresh.stats, ...saved.stats },
  };
}

// Reads the data from localStorage (or starts fresh).
function loadData() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return defaultData(); // first visit
    return mergeWithDefaults(JSON.parse(text));
  } catch (error) {
    // Storage is blocked, or the saved text is broken: start fresh.
    console.warn("Could not load saved data:", error);
    return defaultData();
  }
}

// Writes the data to localStorage. We call this after every change.
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn("Could not save data:", error);
    showToast("⚠️ Could not save. Is browser storage full or blocked?");
  }
}

// "data" holds EVERYTHING about you: your lists, settings and your own words.
let data = loadData();


/* ============================================================
   2. HELPER FUNCTIONS
   ============================================================ */

// Short names for finding elements on the page.
// $("#app") finds ONE element, $$(".card") finds ALL matching elements.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// The <main> element where every page is drawn.
const app = $("#app");

// Makes text safe to put inside HTML.
// Without this, text like "<b>" would be treated as real HTML code.
function escapeHTML(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Makes text safe to use inside a RegExp (search pattern).
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Returns a NEW list in random order (the "Fisher–Yates shuffle").
function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]]; // swap two items
  }
  return copy;
}

// Picks one random item from a list.
function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// plural(1, "word") → "word",  plural(3, "word") → "words"
function plural(count, word) {
  return count === 1 ? word : word + "s";
}

// " Hello  World " → "hello world"  (used to compare answers)
function normalise(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, " ");
}

// "happy, glad ,joyful" → ["happy", "glad", "joyful"]
function splitList(text) {
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

// true for text made of English letters, like "give up" or "well-known"
function isEnglishText(text) {
  return /^[a-z][a-z '-]*$/i.test(String(text).trim());
}

// Builds <option> tags for a <select>. list = [[value, label], ...]
function selectOptions(list, selectedValue) {
  return list
    .map(([value, label]) => {
      const selected = String(value) === String(selectedValue) ? "selected" : "";
      return `<option value="${escapeHTML(value)}" ${selected}>${escapeHTML(label)}</option>`;
    })
    .join("");
}

// ---- Dates ----
// We save dates as text like "2026-10-17" (year-month-day).
// This format is easy to compare: "2026-10-17" < "2026-10-20" is true.

function toDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // months start at 0
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function today() {
  return toDateString(new Date());
}

// addDays(2) → the date 2 days from today. addDays(-1) → yesterday.
function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toDateString(date);
}

// How many days from today until a date ("2026-10-20" → 3).
function daysFromToday(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const target = new Date(year, month - 1, day);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000); // 86400000 ms = 1 day
}

// A number that goes up by 1 every day (days since 1 January 1970).
function dayNumber() {
  return Math.floor(new Date(today()).getTime() / 86400000);
}


/* ============================================================
   3. WORDS (THE DICTIONARY)
   ------------------------------------------------------------
   The full dictionary = built-in words (from words.js)
                         + your edits  − words you deleted
                         + words you added or saved from online
   We never change words.js. All your changes live in "data".
   ============================================================ */

const LEVEL_ORDER = { easy: 1, medium: 2, hard: 3 };
const PARTS_OF_SPEECH = ["noun", "verb", "adjective", "adverb", "phrasal verb", "preposition", "expression", "other"];
const SHORT_POS = {
  noun: "n.", verb: "v.", adjective: "adj.", adverb: "adv.", "phrasal verb": "phr. v.",
  preposition: "prep.", conjunction: "conj.", expression: "exp.",
};
const DEFAULT_CATEGORIES = ["Daily Life", "Feelings", "Food & Cooking", "Study & School", "Travel & Transport", "Work & Office"];

// The words from words.js, cleaned once when the app starts.
const BUILT_INS = BUILT_IN_WORDS.map(cleanWord);
const BUILT_IN_IDS = new Set(BUILT_INS.map((w) => w.id));

// With 1,100 words, we don't want to rebuild the list again and again.
// So we build it once and keep it in "cache" until a word changes.
let cache = null;

function buildCache() {
  const deleted = new Set(data.deletedIds);
  const list = BUILT_INS
    .filter((w) => !deleted.has(w.id))              // remove deleted words
    .map((w) => data.editedWords[w.id] || w)         // use your edited version if there is one
    .concat(data.myWords);                           // add your own words
  cache = {
    list: list,
    sorted: [...list].sort((a, b) => a.word.localeCompare(b.word)),  // A to Z
    byId: new Map(list.map((w) => [w.id, w])),                        // fast lookup by id
    byWord: new Map(list.map((w) => [w.word.toLowerCase(), w])),      // fast lookup by spelling
  };
}

function getAllWords()    { if (!cache) buildCache(); return cache.list; }
function getSortedWords() { if (!cache) buildCache(); return cache.sorted; }
function getWordById(id)  { if (!cache) buildCache(); return cache.byId.get(id); }
function findWord(text)   { if (!cache) buildCache(); return cache.byWord.get(String(text).trim().toLowerCase()); }

// Call this after adding, editing or deleting a word.
function wordsChanged() {
  cache = null;
}

function isMyWord(id) {
  return data.myWords.some((w) => w.id === id);
}

function shortPos(pos) {
  return SHORT_POS[pos] || pos;
}

// The categories that are used by at least one word, A–Z.
function getCategories() {
  return [...new Set(getAllWords().map((w) => w.category).filter(Boolean))].sort();
}

// Your own words get ids from 10001 upwards, so they never clash with built-in ids.
function nextMyWordId() {
  const ids = data.myWords.map((w) => w.id);
  return Math.max(10000, ...ids) + 1;
}

// Saves a new word, or an edited word.
function saveWord(word) {
  const index = data.myWords.findIndex((w) => w.id === word.id);
  if (index !== -1) {
    data.myWords[index] = word;            // editing one of YOUR words
  } else if (BUILT_IN_IDS.has(word.id)) {
    data.editedWords[word.id] = word;      // editing a built-in word
  } else {
    data.myWords.push(word);               // a brand-new word
  }
  wordsChanged();
  saveData();
}

function deleteWord(id) {
  if (isMyWord(id)) {
    data.myWords = data.myWords.filter((w) => w.id !== id);
  } else {
    data.deletedIds.push(id);  // built-in words are only "hidden"
    delete data.editedWords[id];
  }
  delete data.progress[id];
  wordsChanged();
  saveData();
}


/* ============================================================
   4. MY LISTS, REVIEW DATES AND STREAK
   ------------------------------------------------------------
   Every word is in ONE of three places:
     🆕 New        you have not touched it yet
     📌 Memorize   you want to learn it (press "Memorize")
     ✅ Done       you know it (press "Got it")

   Done words come back for a quick review so you don't forget
   them (spaced repetition). Each time you still know a word,
   the gap DOUBLES: 1 day → 2 → 4 → 8 → 16 → 32 days ...
   If you forget it, it goes back to your Memorize list.
   ============================================================ */

function getStatus(id) {
  const p = data.progress[id];
  return p ? p.status : "new";
}

// 📌 Put a word in the Memorize list.
function setMemorize(id) {
  data.progress[id] = { status: "memorize", interval: 0, nextReview: null, addedAt: Date.now() };
  saveData();
}

// ✅ "Got it": move a word to the Done list and set its next review date.
// Returns the number of days until the next review.
function markGotIt(id) {
  const p = data.progress[id];
  const wasDone = Boolean(p && p.status === "done");
  const lastGap = wasDone ? p.interval : 0;
  const interval = lastGap > 0 ? lastGap * 2 : 1; // 1, 2, 4, 8, 16 ...

  data.progress[id] = {
    status: "done",
    interval: interval,
    nextReview: addDays(interval),
    addedAt: wasDone ? p.addedAt : Date.now(),
  };
  if (!wasDone) countLearnedToday(); // a newly learned word counts for today's goal
  recordStudy();
  saveData();
  return interval;
}

// Take a word out of both lists (it becomes "new" again).
function removeFromLists(id) {
  delete data.progress[id];
  saveData();
}

// All words in one list, newest first.
function getListWords(status) {
  return getAllWords()
    .filter((w) => getStatus(w.id) === status)
    .sort((a, b) => (data.progress[b.id].addedAt || 0) - (data.progress[a.id].addedAt || 0));
}

// Done words whose review date is today or earlier.
function getDueWords() {
  const todayText = today();
  return getAllWords().filter((w) => {
    const p = data.progress[w.id];
    return p && p.status === "done" && p.nextReview <= todayText;
  });
}

// Words you have never touched (easy words first).
function getNewWords() {
  return getAllWords()
    .filter((w) => !data.progress[w.id])
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.id - b.id);
}

// Numbers shown on the Home page and in the menu.
function getCounts() {
  let memorize = 0;
  let done = 0;
  getAllWords().forEach((w) => {
    const status = getStatus(w.id);
    if (status === "memorize") memorize++;
    if (status === "done") done++;
  });
  return {
    words: getAllWords().length,
    memorize: memorize,
    done: done,
    due: getDueWords().length,
    today: learnedToday(),
  };
}

// A short sentence about where a word is.
function statusText(id) {
  const p = data.progress[id];
  if (!p) return "🆕 New word — not in your lists yet";
  if (p.status === "memorize") return "📌 In your Memorize list";
  const days = daysFromToday(p.nextReview);
  if (days <= 0) return "✅ Done · quick review today";
  return `✅ Done · next review in ${days} ${plural(days, "day")}`;
}

// ---- Daily goal ----
function learnedToday() {
  return data.stats.doneDate === today() ? data.stats.doneCount : 0;
}

function countLearnedToday() {
  if (data.stats.doneDate !== today()) {
    data.stats.doneDate = today(); // a new day: start counting from 0
    data.stats.doneCount = 0;
  }
  data.stats.doneCount += 1;
}

// ---- Streak (days in a row) ----
function recordStudy() {
  const stats = data.stats;
  if (stats.lastStudyDate === today()) return; // already counted today
  // Studied yesterday? Streak grows. Otherwise it starts again at 1.
  stats.streak = stats.lastStudyDate === addDays(-1) ? stats.streak + 1 : 1;
  stats.lastStudyDate = today();
  saveData();
}

function currentStreak() {
  const last = data.stats.lastStudyDate;
  // If your last study day was before yesterday, the streak is broken.
  return last === today() || last === addDays(-1) ? data.stats.streak : 0;
}

// ---- Word of the Day and daily suggestions ----
function getWordOfTheDay() {
  const words = getAllWords();
  if (words.length === 0) return null;
  // dayNumber() goes up by 1 every day, so this picks a new word each day.
  return words[(dayNumber() * 7) % words.length];
}

// A few new words for today (from the easiest new words, changing every day).
function getSuggestions(count) {
  const pool = getNewWords().slice(0, 80);
  if (pool.length === 0) return [];
  const start = (dayNumber() * count) % pool.length;
  const picks = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    picks.push(pool[(start + i) % pool.length]);
  }
  return picks;
}


/* ============================================================
   5. SPEAKING WORDS ALOUD (Web Speech API)
   ------------------------------------------------------------
   speechSynthesis is built into the browser. We give it some
   text and an English voice, and it reads the text aloud.
   ============================================================ */

const canSpeak = "speechSynthesis" in window;
let englishVoice = null;

// Browsers load voices slowly, so we look for an English voice
// now AND again when the "voiceschanged" event happens.
function chooseEnglishVoice() {
  const voices = speechSynthesis.getVoices();
  const langOf = (voice) => voice.lang.replace("_", "-");
  englishVoice =
    voices.find((v) => langOf(v) === "en-US") ||
    voices.find((v) => langOf(v) === "en-GB") ||
    voices.find((v) => langOf(v).startsWith("en")) ||
    null;
}

if (canSpeak) {
  chooseEnglishVoice();
  speechSynthesis.onvoiceschanged = chooseEnglishVoice;
}

function speak(text, slow = false) {
  if (!canSpeak) {
    showToast("Sorry, this browser cannot speak. Please try Chrome.");
    return;
  }
  speechSynthesis.cancel(); // stop anything that is still speaking

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  if (englishVoice) {
    utterance.voice = englishVoice;
    utterance.lang = englishVoice.lang;
  }
  utterance.rate = slow ? 0.6 : 0.9; // 1 = normal speed
  speechSynthesis.speak(utterance);
}


/* ============================================================
   6. POPUP (MODAL) AND TOAST MESSAGES
   ============================================================ */

const modal = $("#modal");
const modalOk = $("#modal-ok");
const modalCancel = $("#modal-cancel");
let modalOnConfirm = null; // the function to run if you press OK

// Our own "Are you sure?" popup (nicer than the browser's confirm()).
function showConfirm({ title, message, okText = "OK", danger = false, onConfirm }) {
  $("#modal-title").textContent = title;
  $("#modal-message").textContent = message;
  modalOk.textContent = okText;
  modalOk.classList.toggle("btn-danger", danger);
  modalOk.classList.toggle("btn-primary", !danger);
  modalOnConfirm = onConfirm;
  modal.classList.remove("hidden");
  modalCancel.focus(); // "Cancel" is selected first, so Enter cannot delete by accident
}

function closeModal() {
  modal.classList.add("hidden");
  modalOnConfirm = null;
}

modalOk.addEventListener("click", () => {
  const action = modalOnConfirm;
  closeModal();
  if (action) action();
});
modalCancel.addEventListener("click", closeModal);

// Clicking the dark area outside the popup also closes it.
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});

// A small message at the bottom that disappears by itself.
const toast = $("#toast");
let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}


/* ============================================================
   7. ROUTER
   ------------------------------------------------------------
   The part after "#" in the address tells us which page to show:
     #/home            Home
     #/dictionary      Dictionary (A–Z, search, filters)
     #/word/5          Word page of the word with id 5
     #/online/hello    Online search for "hello"
     #/lists           My Lists → 📌 Memorize
     #/lists/done      My Lists → ✅ Done
     #/practice        Flashcards with your Memorize words
     #/review          Flashcards with Done words due today
     #/quiz            Quiz
     #/add  #/edit/5   Add or edit your own word
     #/settings        Settings
   When the "#" part changes, the browser fires "hashchange",
   and we run router() again.
   ============================================================ */

// Which menu link to highlight for each page.
const NAV_FOR_PAGE = {
  home: "home",
  dictionary: "dictionary", words: "dictionary", word: "dictionary", online: "dictionary",
  add: "dictionary", edit: "dictionary",
  lists: "lists", practice: "lists", review: "lists",
  quiz: "quiz", settings: "settings",
};

let currentPage = null;  // the page we are showing now
let previousPage = null; // the page before it

function router() {
  const hash = location.hash || "#/home";
  const parts = hash.replace(/^#\/?/, "").split("/"); // "#/word/5" → ["word", "5"]
  const page = parts[0] || "home";
  previousPage = currentPage;
  currentPage = page;
  let param = parts.slice(1).join("/");
  try {
    param = decodeURIComponent(param); // "%20" → " "
  } catch {
    // a broken address: keep it as it is
  }
  const id = Number(param);

  if (canSpeak) speechSynthesis.cancel();
  closeModal();
  window.scrollTo(0, 0);
  highlightNav(page);

  switch (page) {
    case "home":       renderHome(); break;
    case "dictionary":
    case "words":      renderDictionary(); break;
    case "word":       renderWordPage(id); break;
    case "online":     renderOnlinePage(param); break;
    case "lists":      renderLists(param === "done" ? "done" : "memorize"); break;
    case "practice":   startPractice(); break;
    case "review":     startReview(); break;
    case "quiz":       renderQuizMenu(); break;
    case "add":        renderWordForm(null); break;
    case "edit":       renderWordForm(id); break;
    case "settings":   renderSettings(); break;
    default:           renderHome();
  }
  refreshCounts();
}

function highlightNav(page) {
  $$(".nav a").forEach((link) => {
    const isActive = link.dataset.page === (NAV_FOR_PAGE[page] || "home");
    link.classList.toggle("active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

// Updates every number on the page that has data-count="..."
// (for example the 📌 badge in the menu), without redrawing the page.
function refreshCounts() {
  const counts = getCounts();
  $$("[data-count]").forEach((el) => {
    const value = counts[el.dataset.count];
    el.textContent = value;
    el.dataset.zero = value === 0;
  });
  const goalFill = $("#goal-fill");
  if (goalFill) {
    goalFill.style.width = Math.min(100, Math.round((counts.today / data.settings.dailyGoal) * 100)) + "%";
  }
}


/* ============================================================
   8. PAGES
   ------------------------------------------------------------
   Each render...() function builds the HTML for one page as a
   text "template" (the `backtick` strings with ${...} inside),
   puts it into <main id="app">, and then connects the buttons.
   ============================================================ */

/* ---------- 8a. Small pieces of HTML used on many pages ---------- */

// "adjective · /uh-BUN-duhnt/"
function metaLine(w) {
  const parts = [];
  if (w.partOfSpeech) parts.push(escapeHTML(w.partOfSpeech));
  if (w.pronunciation) parts.push("/" + escapeHTML(w.pronunciation) + "/");
  return parts.join(" · ");
}

// The two buttons 📌 Memorize and ✅ Got it.
// "big" buttons (on the word page) also show the Urdu meaning of the button.
function statusButtonsHTML(id, big) {
  const status = getStatus(id);
  const memo = status === "memorize";
  const done = status === "done";
  return `
    <button type="button" class="status-btn memo ${memo ? "on" : ""}" data-memo="${id}" aria-pressed="${memo}"
            title="${memo ? "In your Memorize list (click to remove)" : "Add to your Memorize list"}">
      <span class="status-main"><span aria-hidden="true">📌</span> <span class="status-label">${memo ? "Memorizing" : "Memorize"}</span></span>
      ${big ? `<span class="status-ur" lang="ur" dir="rtl">یاد کرنا ہے</span>` : ""}
    </button>
    <button type="button" class="status-btn done ${done ? "on" : ""}" data-done="${id}" aria-pressed="${done}"
            title="${done ? "In your Done list (click to remove)" : "I know this word"}">
      <span class="status-main"><span aria-hidden="true">✅</span> <span class="status-label">${done ? "Done" : "Got it"}</span></span>
      ${big ? `<span class="status-ur" lang="ur" dir="rtl">یاد ہو گیا</span>` : ""}
    </button>`;
}

// The buttons inside a box that remembers which word it belongs to,
// so we can redraw only these buttons after a click.
function statusGroupHTML(id, big = false) {
  return `<div class="status-btns ${big ? "big" : ""}" data-status-for="${id}" data-big="${big}">${statusButtonsHTML(id, big)}</div>`;
}

// After 📌 or ✅ is clicked: redraw that word's buttons everywhere on the page.
function refreshWordStatus(id) {
  $$(`[data-status-for="${id}"]`).forEach((box) => {
    box.innerHTML = statusButtonsHTML(id, box.dataset.big === "true");
  });
  $$(`[data-row="${id}"]`).forEach((row) => {
    row.classList.remove("status-new", "status-memorize", "status-done");
    row.classList.add("status-" + getStatus(id));
  });
  $$(`[data-status-text="${id}"]`).forEach((el) => {
    el.textContent = statusText(id);
  });
  refreshCounts();
}

// Puts a yellow highlight on the word inside a sentence.
function highlightWord(sentence, word) {
  const safeSentence = escapeHTML(sentence);
  if (!word) return safeSentence;
  const pattern = new RegExp(`\\b(${escapeRegExp(escapeHTML(word))}\\w*)`, "gi");
  return safeSentence.replace(pattern, "<mark>$1</mark>");
}

// All example sentences of a word: English first, Urdu under it.
function sentencesHTML(w, hidden = false) {
  if (w.sentences.length === 0) return `<p class="muted">No example sentences yet.</p>`;
  return `
    <ol class="sentence-list ${hidden ? "urdu-hidden" : ""}">
      ${w.sentences.map((s) => `
        <li class="sentence">
          <div class="sentence-en">
            <button type="button" class="speak-btn small" data-say="${escapeHTML(s.en)}" aria-label="Listen to this sentence">🔊</button>
            <p>${highlightWord(s.en, w.word)}</p>
          </div>
          ${s.ur
            ? `<p class="sentence-ur urdu" lang="ur" dir="rtl">${escapeHTML(s.ur)}</p>`
            : `<p class="sentence-ur muted small">(no Urdu translation)</p>`}
        </li>`).join("")}
    </ol>`;
}

// One dictionary row. Click the row to open it and see all the sentences.
function wordRowHTML(w, open = false) {
  return `
    <article class="dict-row status-${getStatus(w.id)} ${open ? "open" : ""}" data-row="${w.id}">
      <div class="dict-row-top">
        <button type="button" class="dict-main" data-toggle="${w.id}" aria-expanded="${open}">
          <span class="dict-word-col">
            <span class="dict-word">${escapeHTML(w.word)}</span>
            <span class="dict-pos">${escapeHTML(shortPos(w.partOfSpeech))}</span>
          </span>
          <span class="dict-urdu urdu" lang="ur" dir="rtl">${escapeHTML(w.urduMeaning) || "—"}</span>
          <span class="dict-chevron" aria-hidden="true">▾</span>
        </button>
        <div class="dict-actions">
          <button type="button" class="speak-btn small" data-say="${escapeHTML(w.word)}" aria-label="Listen to ${escapeHTML(w.word)}">🔊</button>
          ${statusGroupHTML(w.id)}
        </div>
      </div>
      <div class="dict-panel">${open ? wordPanelHTML(w) : ""}</div>
    </article>`;
}

// What you see when you open a row.
function wordPanelHTML(w) {
  return `
    <div class="panel-inner">
      <p class="panel-meaning">
        <span class="badge level-${w.level}">${w.level}</span>
        ${w.pronunciation ? `<span class="muted">/${escapeHTML(w.pronunciation)}/</span>` : ""}
        ${w.simpleEnglishMeaning ? `· ${escapeHTML(w.simpleEnglishMeaning)}` : ""}
      </p>
      ${sentencesHTML(w)}
      <div class="panel-footer">
        <span class="muted small">${w.synonyms.length ? "Same meaning: " + w.synonyms.map(escapeHTML).join(", ") : ""}</span>
        <a class="btn btn-ghost btn-small" href="#/word/${w.id}">Open full page →</a>
      </div>
    </div>`;
}

// Opens or closes a dictionary row.
function toggleRow(id) {
  const row = $(`[data-row="${id}"]`);
  if (!row) return;
  const open = !row.classList.contains("open");
  row.classList.toggle("open", open);
  row.querySelector("[data-toggle]").setAttribute("aria-expanded", open);
  const panel = row.querySelector(".dict-panel");
  if (open && !panel.innerHTML.trim()) {
    panel.innerHTML = wordPanelHTML(getWordById(id)); // build the panel only when needed
  }
  if (location.hash.startsWith("#/dictionary")) dict.openId = open ? id : null;
}

// Synonym / antonym "chips". Click one to open it in the dictionary,
// or to search it online if it is not in the dictionary.
function chipsHTML(list, className) {
  if (list.length === 0) return `<p class="muted">—</p>`;
  return `<div class="chips">${list.map((item) => {
    const found = findWord(item);
    const href = found ? `#/word/${found.id}` : `#/online/${encodeURIComponent(item)}`;
    return `<a class="chip ${className}" href="${href}" title="${found ? "Open in the dictionary" : "Search online"}">
      ${escapeHTML(item)}${found ? "" : " 🌐"}</a>`;
  }).join("")}</div>`;
}

// A simple centred message with an emoji and some buttons.
function renderMessage(emoji, title, text, buttonsHTML = "") {
  app.innerHTML = `
    <section class="page">
      <div class="card message-card">
        <div class="message-emoji">${emoji}</div>
        <h1>${title}</h1>
        <p class="muted">${text}</p>
        <div class="button-row center">${buttonsHTML}</div>
      </div>
    </section>`;
}

function renderNotFound() {
  renderMessage("🔍", "Word not found", "This word may have been deleted.",
    `<a href="#/dictionary" class="btn btn-primary">📖 Open the dictionary</a>`);
}

// Adds the easiest new words to the Memorize list (one click for you).
function addNewWordsForMe(count) {
  const picks = getNewWords().slice(0, count);
  picks.forEach((w, i) => {
    setMemorize(w.id);
    data.progress[w.id].addedAt = Date.now() - i; // the easiest word shows first
  });
  saveData();
  showToast(picks.length ? `✨ Added ${picks.length} new words to your Memorize list` : "You have no new words left!");
  return picks.length;
}


/* ---------- 8b. HOME ---------- */

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning! 👋";
  if (hour < 17) return "Good afternoon! 👋";
  return "Good evening! 👋";
}

function wordOfDayHTML(w) {
  return `
    <div class="card wotd">
      <p class="eyebrow">⭐ Word of the Day</p>
      <div class="wotd-main">
        <h2 class="wotd-word">${escapeHTML(w.word)}</h2>
        <button class="speak-btn" data-say="${escapeHTML(w.word)}" aria-label="Listen to the word">🔊</button>
      </div>
      <p class="muted">${metaLine(w)}</p>
      <p class="urdu big-urdu" lang="ur" dir="rtl">${escapeHTML(w.urduMeaning)}</p>
      <div class="wotd-example">${sentencesHTML({ ...w, sentences: w.sentences.slice(0, 2) })}</div>
      <div class="wotd-actions">
        ${statusGroupHTML(w.id)}
        <a class="btn btn-ghost btn-small" href="#/word/${w.id}">Open word →</a>
      </div>
    </div>`;
}

function renderHome() {
  const counts = getCounts();
  const goal = data.settings.dailyGoal;
  const wordOfDay = getWordOfTheDay();
  const suggestions = getSuggestions(5);

  app.innerHTML = `
    <section class="page">
      <div class="hello">
        <h1>${greeting()}</h1>
        <p class="muted">Your dictionary has <strong>${counts.words.toLocaleString()}</strong> words, each with simple Urdu and example sentences.</p>
      </div>

      <form class="home-search" id="home-search" role="search">
        <input type="search" id="home-search-input" dir="auto" aria-label="Search the dictionary"
               placeholder="🔍 Search an English or Urdu word…">
        <button class="btn btn-primary" type="submit">Search</button>
      </form>

      ${wordOfDay ? wordOfDayHTML(wordOfDay) : ""}

      <h2 class="section-title">My progress</h2>
      <div class="stats">
        <a class="stat" href="#/lists"><span class="stat-value" data-count="memorize">${counts.memorize}</span><span class="stat-label">📌 To memorize</span></a>
        <a class="stat" href="#/lists/done"><span class="stat-value" data-count="done">${counts.done}</span><span class="stat-label">✅ Done</span></a>
        <a class="stat" href="#/review"><span class="stat-value" data-count="due">${counts.due}</span><span class="stat-label">🔁 Review today</span></a>
        <div class="stat"><span class="stat-value">🔥 ${currentStreak()}</span><span class="stat-label">Day streak</span></div>
      </div>

      <div class="card">
        <div class="goal-top">
          <strong>🏁 Today's goal</strong>
          <span><span data-count="today">${counts.today}</span> / ${goal} words learned</span>
        </div>
        <div class="progress" aria-hidden="true"><div class="progress-fill" id="goal-fill"></div></div>
        <p class="muted small goal-text">Every time you press ✅ <strong>Got it</strong> on a new word, it counts for today's goal.</p>
      </div>

      <div class="big-buttons">
        <a href="#/dictionary" class="big-btn primary">
          <span class="big-icon">📖</span><strong>Dictionary</strong><span class="big-sub">${counts.words.toLocaleString()} words</span>
        </a>
        <a href="#/practice" class="big-btn">
          <span class="big-icon">🃏</span><strong>Practise</strong><span class="big-sub"><span data-count="memorize">${counts.memorize}</span> to memorize</span>
        </a>
        <a href="#/review" class="big-btn">
          <span class="big-icon">🔁</span><strong>Review</strong><span class="big-sub"><span data-count="due">${counts.due}</span> due today</span>
        </a>
        <a href="#/quiz" class="big-btn">
          <span class="big-icon">🎯</span><strong>Quiz</strong><span class="big-sub">Test yourself</span>
        </a>
      </div>

      ${suggestions.length ? `
        <div class="section-head">
          <h2 class="section-title">✨ New words for you today</h2>
          <a href="#/dictionary" class="small">See all words →</a>
        </div>
        <p class="muted small">Click a word to see its sentences. Press 📌 to memorize it, or ✅ if you already know it.</p>
        <div class="dict-list">${suggestions.map((w) => wordRowHTML(w)).join("")}</div>` : ""}
    </section>`;

  // Searching from Home opens the Dictionary with your search.
  $("#home-search").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("#home-search-input").value.trim();
    Object.assign(dict, { search: text, letter: "all", status: "all", level: "all", category: "all", shown: PAGE_SIZE });
    const exact = findWord(text);
    dict.openId = exact ? exact.id : null; // open the exact word straight away
    location.hash = "#/dictionary";
  });
}


/* ---------- 8c. DICTIONARY ---------- */

const PAGE_SIZE = 40; // how many rows we show at first
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// The dictionary filters are kept here, so they stay the same when you come back.
const dict = { search: "", letter: "all", status: "all", level: "all", category: "all", shown: PAGE_SIZE, openId: null };

// Filter buttons like "All · New · Memorize · Done".
function filterChipsHTML(name, options) {
  return options.map(([value, label]) => `
    <button type="button" class="filter-chip ${dict[name] === value ? "on" : ""}"
            data-filter="${name}" data-value="${value}" aria-pressed="${dict[name] === value}">${label}</button>`).join("");
}

function renderDictionary() {
  const categories = getCategories();
  if (!categories.includes(dict.category)) dict.category = "all";

  app.innerHTML = `
    <section class="page">
      <div class="page-header">
        <h1>📖 Dictionary</h1>
        <a href="#/add" class="btn btn-ghost btn-small">➕ Add my own word</a>
      </div>

      <div class="card filters">
        <input type="search" id="search" dir="auto" aria-label="Search words"
               placeholder="🔍 Type an English or Urdu word…" value="${escapeHTML(dict.search)}">

        <div class="letter-bar" role="group" aria-label="First letter">
          <button type="button" class="letter ${dict.letter === "all" ? "on" : ""}" data-letter="all">All</button>
          ${LETTERS.map((l) => `<button type="button" class="letter ${dict.letter === l ? "on" : ""}" data-letter="${l}">${l}</button>`).join("")}
        </div>

        <div class="chip-row" role="group" aria-label="Show">
          ${filterChipsHTML("status", [["all", "All words"], ["new", "🆕 New"], ["memorize", "📌 Memorize"], ["done", "✅ Done"]])}
        </div>

        <div class="chip-row" role="group" aria-label="Level and category">
          ${filterChipsHTML("level", [["all", "All levels"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]])}
          <select id="filter-category" aria-label="Category">
            ${selectOptions([["all", "All categories"], ...categories.map((c) => [c, c])], dict.category)}
          </select>
        </div>
      </div>

      <p class="muted small" id="result-count"></p>
      <div id="online-hint"></div>
      <div class="dict-list" id="dict-list"></div>
      <div class="center"><button type="button" class="btn btn-ghost hidden" id="show-more">Show more</button></div>
    </section>`;

  // Typing in the search box: show results at once (and forget the letter filter).
  $("#search").addEventListener("input", (event) => {
    dict.search = event.target.value;
    dict.shown = PAGE_SIZE;
    if (dict.search.trim()) setLetter("all");
    drawDictionary();
  });

  // A–Z buttons
  $$("[data-letter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setLetter(btn.dataset.letter);
      dict.search = "";
      $("#search").value = "";
      dict.shown = PAGE_SIZE;
      drawDictionary();
    });
  });

  // Status and level buttons
  $$("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      dict[btn.dataset.filter] = btn.dataset.value;
      $$(`[data-filter="${btn.dataset.filter}"]`).forEach((b) => {
        const on = b.dataset.value === btn.dataset.value;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on);
      });
      dict.shown = PAGE_SIZE;
      drawDictionary();
    });
  });

  $("#filter-category").addEventListener("change", (event) => {
    dict.category = event.target.value;
    dict.shown = PAGE_SIZE;
    drawDictionary();
  });

  $("#show-more").addEventListener("click", () => {
    dict.shown += PAGE_SIZE;
    drawDictionary();
  });

  drawDictionary();
}

function setLetter(letter) {
  dict.letter = letter;
  $$("[data-letter]").forEach((b) => b.classList.toggle("on", b.dataset.letter === letter));
}

// How well a word matches the search (smaller = better, -1 = no match).
function searchScore(w, query) {
  const word = w.word.toLowerCase();
  if (word === query) return 0;
  if (word.startsWith(query)) return 1;
  if (word.includes(query)) return 2;
  if (w.urduMeaning.includes(query)) return 3;
  if (w.simpleEnglishMeaning.toLowerCase().includes(query)) return 4;
  if (w.synonyms.some((s) => s.toLowerCase() === query)) return 4;
  return -1;
}

function filteredWords() {
  const query = dict.search.trim().toLowerCase();
  let list = getSortedWords().filter((w) => {
    if (dict.letter !== "all" && !w.word.toUpperCase().startsWith(dict.letter)) return false;
    if (dict.status !== "all" && getStatus(w.id) !== dict.status) return false;
    if (dict.level !== "all" && w.level !== dict.level) return false;
    if (dict.category !== "all" && w.category !== dict.category) return false;
    return true;
  });
  if (query) {
    list = list
      .map((w) => ({ w: w, score: searchScore(w, query) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => a.score - b.score)  // best matches first (A–Z stays inside each group)
      .map((item) => item.w);
  }
  return list;
}

function drawDictionary() {
  const results = filteredWords();
  const visible = results.slice(0, dict.shown);
  const total = getAllWords().length;

  $("#result-count").textContent = results.length === total
    ? `${total.toLocaleString()} words · click a word to see its sentences`
    : `Found ${results.length.toLocaleString()} of ${total.toLocaleString()} words`;

  $("#dict-list").innerHTML = visible.length
    ? visible.map((w) => wordRowHTML(w, w.id === dict.openId)).join("")
    : `<div class="empty-state">😕 No words found here. Try another letter or filter.</div>`;

  const left = results.length - visible.length;
  const moreButton = $("#show-more");
  moreButton.classList.toggle("hidden", left <= 0);
  moreButton.textContent = `Show more (${left.toLocaleString()} more ${plural(left, "word")})`;

  // Not in the dictionary? Offer to search the word online.
  const query = dict.search.trim();
  const showOnline = query && !findWord(query) && isEnglishText(query);
  $("#online-hint").innerHTML = showOnline ? `
    <div class="card online-hint">
      <span>“${escapeHTML(query)}” is not in your dictionary yet.</span>
      <a class="btn btn-primary btn-small" href="#/online/${encodeURIComponent(query.toLowerCase())}">🌐 Search “${escapeHTML(query)}” online</a>
    </div>` : "";
}


/* ---------- 8d. WORD PAGE ---------- */

let hideUrdu = false; // remembers the "Hide Urdu" button while the app is open

// The ← and → buttons in the word bar. At the first or last word there is
// no link, but we still draw an empty button, so the other buttons never move.
function wordNavButtonHTML(w, direction) {
  const arrow = direction === "prev" ? "←" : "→";
  const label = direction === "prev" ? "Previous word" : "Next word";
  if (!w) {
    return `<span class="bar-nav disabled" aria-hidden="true"><span class="bar-arrow">${arrow}</span></span>`;
  }
  return `
    <a class="bar-nav" href="#/word/${w.id}" title="${label}: ${escapeHTML(w.word)}" aria-label="${label}: ${escapeHTML(w.word)}">
      <span class="bar-arrow">${arrow}</span>
      <span class="bar-word">${escapeHTML(w.word)}</span>
    </a>`;
}

function renderWordPage(id) {
  const w = getWordById(id);
  if (!w) {
    renderNotFound();
    return;
  }

  // The words before and after this one (A–Z), for the ← → buttons.
  const sorted = getSortedWords();
  const index = sorted.findIndex((x) => x.id === w.id);
  const prev = sorted[index - 1];
  const next = sorted[index + 1];

  // Coming from another word (← →)? Then the bar must not fade or move,
  // so your next click lands in the same place. Only the content fades.
  const instant = previousPage === "word" ? "instant" : "";

  app.innerHTML = `
    <section class="page ${instant}">
      <a href="#/dictionary" class="back-link">← Dictionary</a>

      <!-- One bar with the 4 buttons you need to go through words quickly:
           ← previous word · 📌 Memorize · ✅ Got it · next word →
           It sticks under the top bar, so it never moves away. -->
      <div class="word-bar">
        ${wordNavButtonHTML(prev, "prev")}
        ${statusGroupHTML(w.id, true)}
        ${wordNavButtonHTML(next, "next")}
      </div>
      <p class="muted small keys-hint word-keys">Keyboard: ← → move between words · M = Memorize · G = Got it</p>

      <div class="card">
        <div class="detail-top">
          <div>
            <div class="detail-word-row">
              <h1 class="detail-word">${escapeHTML(w.word)}</h1>
              <button class="speak-btn" data-say="${escapeHTML(w.word)}" aria-label="Listen to the word">🔊</button>
              <button class="speak-btn" data-say="${escapeHTML(w.word)}" data-slow="true" aria-label="Listen slowly" title="Slowly">🐢</button>
            </div>
            <p class="muted">${metaLine(w)}</p>
          </div>
          <div class="detail-badges">
            <span class="badge level-${w.level}">${w.level}</span>
            <span class="badge badge-soft">${escapeHTML(w.category)}</span>
            ${isMyWord(w.id) ? '<span class="badge badge-soft">My word</span>' : ""}
          </div>
        </div>

        <div class="meanings">
          <div class="meaning-box">
            <p class="eyebrow">Urdu meaning</p>
            <p class="urdu big-urdu" lang="ur" dir="rtl">${escapeHTML(w.urduMeaning) || "—"}</p>
          </div>
          <div class="meaning-box">
            <p class="eyebrow">Simple English meaning</p>
            <p>${escapeHTML(w.simpleEnglishMeaning) || "—"}</p>
          </div>
        </div>

        <p class="status-text" data-status-text="${w.id}">${statusText(w.id)}</p>

        ${isMyWord(w.id) ? `
          <div class="action-buttons">
            <a class="btn btn-ghost btn-small" href="#/edit/${w.id}">✏️ Edit</a>
            <button class="btn btn-ghost btn-small danger-text" id="delete-btn">🗑️ Delete</button>
          </div>` : ""}
      </div>

      <div class="card">
        <div class="sentences-header">
          <h2 class="section-title">Example sentences (${w.sentences.length})</h2>
          <button class="btn btn-ghost btn-small" id="hide-urdu-btn" aria-pressed="${hideUrdu}">
            ${hideUrdu ? "👁️ Show Urdu" : "🙈 Hide Urdu"}
          </button>
        </div>
        <p class="muted small hide-hint ${hideUrdu ? "" : "hidden"}" id="hide-hint">
          Try to understand each sentence first, then tap the blurred Urdu to check.
        </p>
        <div id="sentence-box">${sentencesHTML(w, hideUrdu)}</div>
      </div>

      <div class="card">
        <div class="syn-ant">
          <div>
            <h2 class="section-title">Synonyms <span class="muted small">(same meaning)</span></h2>
            ${chipsHTML(w.synonyms, "chip-syn")}
          </div>
          <div>
            <h2 class="section-title">Antonyms <span class="muted small">(opposite)</span></h2>
            ${chipsHTML(w.antonyms, "chip-ant")}
          </div>
        </div>
      </div>

      ${isEnglishText(w.word) ? `
        <p class="center small">
          <a href="#/online/${encodeURIComponent(w.word.toLowerCase())}">🌐 See more English meanings online (Wiktionary)</a>
        </p>` : ""}
    </section>`;

  $("#hide-urdu-btn").addEventListener("click", (event) => {
    hideUrdu = !hideUrdu;
    const list = $("#sentence-box .sentence-list");
    if (list) list.classList.toggle("urdu-hidden", hideUrdu);
    $$(".sentence-ur.revealed").forEach((el) => el.classList.remove("revealed"));
    $("#hide-hint").classList.toggle("hidden", !hideUrdu);
    event.currentTarget.textContent = hideUrdu ? "👁️ Show Urdu" : "🙈 Hide Urdu";
    event.currentTarget.setAttribute("aria-pressed", hideUrdu);
  });

  const deleteButton = $("#delete-btn");
  if (deleteButton) {
    deleteButton.addEventListener("click", () => {
      showConfirm({
        title: "Delete this word?",
        message: `"${w.word}" will be removed from your dictionary and your lists.`,
        okText: "Yes, delete",
        danger: true,
        onConfirm: () => {
          deleteWord(w.id);
          showToast("🗑️ Word deleted");
          location.hash = "#/dictionary";
        },
      });
    });
  }
}


/* ---------- 8e. ONLINE SEARCH (for words that are not in the dictionary) ----------
   We ask two free websites:
     • Wiktionary  → English meanings and example sentences
     • MyMemory    → automatic Urdu translation
   This needs internet. The automatic Urdu may be harder or not perfect,
   so the page says so clearly.                                               */

const onlineCache = new Map();    // remembers results, so we don't ask twice
const translateCache = new Map();

// fetch() asks a website for data. We stop waiting after 12 seconds.
async function fetchJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 404) return { notFound: true };
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Wiktionary sends meanings with HTML tags inside. This keeps only the text.
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

async function lookUpOnline(word) {
  if (onlineCache.has(word)) return onlineCache.get(word);

  const result = await fetchJSON(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
  if (result.notFound || !Array.isArray(result.en)) {
    const nothing = { notFound: true };
    onlineCache.set(word, nothing);
    return nothing;
  }

  const meanings = [];
  const examples = [];
  result.en.forEach((part) => {
    const definitions = (part.definitions || [])
      .map((d) => ({ text: htmlToText(d.definition), examples: (d.examples || []).map(htmlToText) }))
      .filter((d) => d.text);
    if (definitions.length === 0) return;
    meanings.push({ partOfSpeech: String(part.partOfSpeech || "").toLowerCase(), definitions: definitions.slice(0, 4).map((d) => d.text) });
    definitions.forEach((d) => d.examples.forEach((example) => {
      if (example && example.length < 160 && !examples.includes(example)) examples.push(example);
    }));
  });

  const info = { word: word, meanings: meanings.slice(0, 3), examples: examples.slice(0, 5), notFound: meanings.length === 0 };
  onlineCache.set(word, info);
  return info;
}

// Automatic English → Urdu translation. Returns "" if it fails.
async function translateToUrdu(text) {
  if (translateCache.has(text)) return translateCache.get(text);
  let urdu = "";
  try {
    const result = await fetchJSON(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent("en|ur")}`);
    urdu = htmlToText(result && result.responseData ? result.responseData.translatedText : "");
    // Throw away answers that are warnings or not Urdu at all.
    if (/MYMEMORY|QUERY LENGTH|INVALID/i.test(urdu) || !/[؀-ۿ]/.test(urdu)) urdu = "";
  } catch {
    urdu = "";
  }
  translateCache.set(text, urdu);
  return urdu;
}

async function renderOnlinePage(rawWord) {
  const word = String(rawWord || "").trim().toLowerCase();
  if (!word) {
    location.hash = "#/dictionary";
    return;
  }
  const startHash = location.hash; // if you leave this page, we stop drawing it
  const inDictionary = findWord(word);

  app.innerHTML = `
    <section class="page">
      <a href="#/dictionary" class="back-link">← Dictionary</a>
      <div class="card message-card">
        <div class="spinner" aria-hidden="true"></div>
        <p>Searching “${escapeHTML(word)}” online…</p>
      </div>
    </section>`;

  if (!navigator.onLine) {
    renderOnlineProblem(word, "📡", "You are offline", "Online search needs internet. Your built-in dictionary still works offline.");
    return;
  }

  let info;
  try {
    info = await lookUpOnline(word);
  } catch {
    if (location.hash !== startHash) return;
    renderOnlineProblem(word, "📡", "Could not reach the online dictionary", "Please check your internet and try again.");
    return;
  }
  if (location.hash !== startHash) return;

  if (info.notFound) {
    // Suggest dictionary words that start the same way.
    const similar = getSortedWords().filter((w) => w.word.toLowerCase().startsWith(word.slice(0, 3))).slice(0, 8);
    renderOnlineProblem(word, "🤔", `“${escapeHTML(word)}” was not found`,
      "Please check the spelling." + (similar.length ? " Maybe you meant one of these:" : ""),
      similar.map((w) => `<a class="chip chip-syn" href="#/word/${w.id}">${escapeHTML(w.word)}</a>`).join(""));
    return;
  }

  app.innerHTML = `
    <section class="page">
      <a href="#/dictionary" class="back-link">← Dictionary</a>

      <div class="card">
        <p class="eyebrow">🌐 Online result · from Wiktionary</p>
        <div class="detail-word-row">
          <h1 class="detail-word">${escapeHTML(word)}</h1>
          <button class="speak-btn" data-say="${escapeHTML(word)}" aria-label="Listen to the word">🔊</button>
          <button class="speak-btn" data-say="${escapeHTML(word)}" data-slow="true" aria-label="Listen slowly" title="Slowly">🐢</button>
        </div>
        <div class="meaning-box">
          <p class="eyebrow">Urdu meaning (automatic)</p>
          <p class="urdu big-urdu" lang="ur" dir="rtl" id="online-urdu">⏳</p>
        </div>
        <p class="auto-note">⚠️ This Urdu is made by an automatic translator, so it may use harder words or be wrong.</p>
        ${inDictionary ? `
          <p class="online-hint-inline">This word is also in your dictionary with simple Urdu:
            <a href="#/word/${inDictionary.id}">open “${escapeHTML(inDictionary.word)}” →</a></p>` : ""}
        <div id="online-actions">
          ${inDictionary ? statusGroupHTML(inDictionary.id, true) : `
            <div class="status-btns big">
              <button type="button" class="status-btn memo" data-save-online="memorize">
                <span class="status-main">📌 <span class="status-label">Save &amp; Memorize</span></span>
                <span class="status-ur" lang="ur" dir="rtl">یاد کرنا ہے</span>
              </button>
              <button type="button" class="status-btn done" data-save-online="done">
                <span class="status-main">✅ <span class="status-label">Save &amp; Got it</span></span>
                <span class="status-ur" lang="ur" dir="rtl">یاد ہو گیا</span>
              </button>
            </div>`}
        </div>
      </div>

      <div class="card online-meanings">
        <h2 class="section-title">English meanings</h2>
        ${info.meanings.map((m) => `
          <h3>${escapeHTML(m.partOfSpeech)}</h3>
          <ol>${m.definitions.map((d) => `<li>${escapeHTML(d)}</li>`).join("")}</ol>`).join("")}
      </div>

      <div class="card">
        <h2 class="section-title">Example sentences (${info.examples.length})</h2>
        ${info.examples.length ? `
          <ol class="sentence-list">
            ${info.examples.map((en, i) => `
              <li class="sentence">
                <div class="sentence-en">
                  <button type="button" class="speak-btn small" data-say="${escapeHTML(en)}" aria-label="Listen to this sentence">🔊</button>
                  <p>${highlightWord(en, word)}</p>
                </div>
                <p class="sentence-ur urdu" lang="ur" dir="rtl" id="online-ex-${i}">⏳</p>
              </li>`).join("")}
          </ol>` : `<p class="muted">Wiktionary has no example sentences for this word.</p>`}
      </div>
    </section>`;

  // Translate the word and the sentences at the same time.
  const urduWord = translateToUrdu(word);
  const urduExamples = info.examples.map((en) => translateToUrdu(en));

  urduWord.then((urdu) => {
    const el = $("#online-urdu");
    if (el && location.hash === startHash) el.textContent = urdu || "(translation not available)";
  });
  urduExamples.forEach((promise, i) => promise.then((urdu) => {
    const el = $(`#online-ex-${i}`);
    if (el && location.hash === startHash) el.textContent = urdu || "(translation not available)";
  }));

  // "Save" buttons: the word becomes one of YOUR words (it then works offline too).
  $$("[data-save-online]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const newWord = cleanWord({
        id: nextMyWordId(),
        word: word,
        partOfSpeech: info.meanings[0].partOfSpeech,
        urduMeaning: await urduWord,
        simpleEnglishMeaning: info.meanings[0].definitions[0],
        level: "medium",
        category: "From Online",
        sentences: await Promise.all(info.examples.map(async (en, i) => ({ en: en, ur: await urduExamples[i] }))),
      });
      saveWord(newWord);
      if (btn.dataset.saveOnline === "done") markGotIt(newWord.id);
      else setMemorize(newWord.id);
      showToast(btn.dataset.saveOnline === "done" ? "✅ Saved to your Done list" : "📌 Saved to your Memorize list");
      location.hash = `#/word/${newWord.id}`;
    });
  });
}

function renderOnlineProblem(word, emoji, title, text, extraHTML = "") {
  renderMessage(emoji, title, text + (extraHTML ? `<span class="chips center-chips">${extraHTML}</span>` : ""),
    `<a href="#/online/${encodeURIComponent(word)}" class="btn btn-primary">🔄 Try again</a>
     <a href="#/dictionary" class="btn btn-ghost">📖 Dictionary</a>`);
}


/* ---------- 8f. MY LISTS (📌 Memorize / ✅ Done) ---------- */

const SESSION_SIZE = 20; // flashcards in one practice session

function renderLists(tab) {
  const memorizeWords = getListWords("memorize");
  const doneWords = getListWords("done");
  const due = getDueWords().length;
  const list = tab === "done" ? doneWords : memorizeWords;

  app.innerHTML = `
    <section class="page">
      <h1>📌 My Lists</h1>

      <div class="tabs" role="tablist">
        <a href="#/lists" class="tab ${tab === "memorize" ? "on" : ""}" role="tab" aria-selected="${tab === "memorize"}">
          📌 To memorize <span class="tab-count">${memorizeWords.length}</span>
        </a>
        <a href="#/lists/done" class="tab ${tab === "done" ? "on" : ""}" role="tab" aria-selected="${tab === "done"}">
          ✅ Done <span class="tab-count">${doneWords.length}</span>
        </a>
      </div>

      <div class="card list-intro">
        ${tab === "memorize" ? `
          <p>These are the words you want to learn. Practise them with flashcards. When you know a word, press ✅ <strong>Got it</strong>.</p>
          <div class="button-row">
            ${memorizeWords.length ? `<a href="#/practice" class="btn btn-primary">🃏 Practise ${Math.min(memorizeWords.length, SESSION_SIZE)} words</a>` : ""}
            <button type="button" class="btn btn-ghost" id="auto-add">✨ Add 10 new words for me</button>
          </div>` : `
          <p>These are the words you know. Each one comes back for a quick review after 1, 2, 4, 8, 16… days, so you don't forget it.</p>
          <div class="button-row">
            ${due ? `<a href="#/review" class="btn btn-primary">🔁 Review ${due} ${plural(due, "word")} now</a>`
                  : `<span class="muted">✅ Nothing to review today.</span>`}
          </div>`}
      </div>

      <div class="dict-list">
        ${list.length ? list.map((w) => wordRowHTML(w)).join("") : `
          <div class="empty-state">
            ${tab === "memorize"
              ? "Your Memorize list is empty. Open the 📖 Dictionary and press 📌 on words you want to learn."
              : "No words here yet. Press ✅ Got it on words you know."}
          </div>`}
      </div>
    </section>`;

  const autoAdd = $("#auto-add");
  if (autoAdd) {
    autoAdd.addEventListener("click", () => {
      addNewWordsForMe(10);
      renderLists("memorize");
      refreshCounts();
    });
  }
}


/* ---------- 8g. FLASHCARDS (Practise and Review) ---------- */

let session = null;        // the flashcard session you are doing now
let practiceOnlyIds = null; // set by the quiz: practise only these words

const SESSION_INFO = {
  practice: { title: "🃏 Practise", no: ["😕", "Not yet", "see it again soon"], yes: ["✅", "Got it", "move to Done"] },
  review:   { title: "🔁 Review",   no: ["😕", "Forgot", "back to Memorize"], yes: ["✅", "Still know it", ""] },
};

function startPractice() {
  let words;
  if (practiceOnlyIds) {
    words = practiceOnlyIds.map((id) => getWordById(id)).filter(Boolean);
    practiceOnlyIds = null;
  } else {
    words = shuffle(getListWords("memorize")).slice(0, SESSION_SIZE);
  }

  if (words.length === 0) {
    renderMessage("📌", "Your Memorize list is empty",
      "Open the dictionary and press 📌 Memorize on the words you want to learn — or let me pick some easy words for you.",
      `<button type="button" class="btn btn-primary" id="auto-add">✨ Add 10 new words for me</button>
       <a href="#/dictionary" class="btn btn-ghost">📖 Open the dictionary</a>`);
    $("#auto-add").addEventListener("click", () => {
      if (addNewWordsForMe(10)) startPractice();
      refreshCounts();
    });
    return;
  }

  session = { mode: "practice", queue: words.map((w) => w.id), total: words.length, done: 0, learned: 0 };
  renderFlashcard();
}

function startReview() {
  const words = shuffle(getDueWords());
  if (words.length === 0) {
    renderMessage("✅", "Nothing to review today",
      "Great job! Done words come back here when it is time to check them again.",
      `<a href="#/practice" class="btn btn-primary">🃏 Practise my words</a>
       <a href="#/home" class="btn btn-ghost">🏠 Home</a>`);
    return;
  }
  session = { mode: "review", queue: words.map((w) => w.id), total: words.length, done: 0, learned: 0 };
  renderFlashcard();
}

function renderFlashcard() {
  if (session.queue.length === 0) {
    renderSessionDone();
    return;
  }
  const w = getWordById(session.queue[0]);
  if (!w) { // the word was deleted: skip it
    session.queue.shift();
    renderFlashcard();
    return;
  }

  const info = SESSION_INFO[session.mode];
  const sentences = shuffle(w.sentences).slice(0, 2); // two example sentences
  const percent = Math.round((session.done / session.total) * 100);
  const p = data.progress[w.id];
  const nextGap = p && p.status === "done" && p.interval > 0 ? p.interval * 2 : 1;
  const yesHint = session.mode === "review" ? `next in ${nextGap} ${plural(nextGap, "day")}` : info.yes[2];

  app.innerHTML = `
    <section class="page flash-page">
      <div class="page-header">
        <h1>${info.title}</h1>
        <span class="score-pill">${session.done} / ${session.total}</span>
      </div>
      <div class="progress"><div class="progress-fill" style="width: ${percent}%"></div></div>

      <div class="flashcard" id="flashcard" tabindex="0" role="button" aria-label="Flashcard. Press Space to flip.">
        <div class="flashcard-inner">

          <div class="flash-face flash-front">
            <span class="badge level-${w.level}">${w.level}</span>
            <h2 class="flash-word">${escapeHTML(w.word)}</h2>
            <p class="muted">${metaLine(w)}</p>
            <button class="speak-btn big" data-say="${escapeHTML(w.word)}" aria-label="Listen to the word">🔊</button>
            <p class="tap-hint">👆 Tap the card to see the meaning</p>
          </div>

          <div class="flash-face flash-back">
            <p class="urdu flash-urdu" lang="ur" dir="rtl">${escapeHTML(w.urduMeaning) || "—"}</p>
            ${w.simpleEnglishMeaning ? `<p class="muted">${escapeHTML(w.simpleEnglishMeaning)}</p>` : ""}
            ${sentences.length ? `<div class="flash-sentence">${sentencesHTML({ ...w, sentences: sentences })}</div>` : ""}
          </div>

        </div>
      </div>

      <div class="rate-buttons">
        <button type="button" class="rate-btn rate-again" data-answer="no">
          <span class="rate-emoji">${info.no[0]}</span>${info.no[1]}<small>${info.no[2]}</small>
        </button>
        <button type="button" class="rate-btn rate-easy" data-answer="yes">
          <span class="rate-emoji">${info.yes[0]}</span>${info.yes[1]}<small>${yesHint}</small>
        </button>
      </div>
      <p class="muted small center keys-hint">Keyboard: Space = flip · 1 = ${info.no[1]} · 2 = ${info.yes[1]}</p>
      <p class="center"><a href="#/lists" class="small">⏹ Stop and go to My Lists</a></p>
    </section>`;

  $("#flashcard").addEventListener("click", (event) => {
    if (event.target.closest("[data-say]")) return; // the speaker button should not flip the card
    flipCard();
  });
  $$("[data-answer]").forEach((btn) => {
    btn.addEventListener("click", () => answerCard(btn.dataset.answer === "yes"));
  });
}

function flipCard() {
  const card = $("#flashcard");
  if (card) card.classList.toggle("flipped");
}

// knowIt = true for ✅, false for 😕
function answerCard(knowIt) {
  const id = session.queue.shift(); // take the first word out of the queue

  if (session.mode === "practice") {
    if (knowIt) {
      markGotIt(id);
      session.done += 1;
      session.learned += 1;
    } else {
      recordStudy();
      session.queue.push(id); // put it at the END, so you see it again soon
    }
  } else {
    if (knowIt) {
      markGotIt(id); // the gap doubles
      session.learned += 1;
    } else {
      setMemorize(id); // forgot → back to the Memorize list
      recordStudy();
    }
    session.done += 1;
  }
  renderFlashcard();
}

function renderSessionDone() {
  const due = getDueWords().length;
  const text = session.mode === "practice"
    ? `You learned ${session.learned} ${plural(session.learned, "word")}. They are in your ✅ Done list now.`
    : `You reviewed ${session.total} ${plural(session.total, "word")} and still knew ${session.learned}.`;
  renderMessage("🎉", "Well done!", text,
    `<a href="#/home" class="btn btn-primary">🏠 Home</a>
     <a href="#/quiz" class="btn btn-ghost">🎯 Take a quiz</a>
     ${due ? `<a href="#/review" class="btn btn-ghost">🔁 Review (${due})</a>` : ""}
     <a href="#/dictionary" class="btn btn-ghost">📖 Find more words</a>`);
}


/* ---------- 8h. QUIZ (you only need the mouse) ---------- */

const QUIZ_TYPES = {
  "en-ur":  { icon: "🔤", title: "English → Urdu",    description: "See an English word, click its Urdu meaning." },
  "ur-en":  { icon: "🔄", title: "Urdu → English",    description: "See an Urdu meaning, click the English word." },
  "blank":  { icon: "✍️", title: "Fill in the blank", description: "Click the missing word in a sentence." },
  "listen": { icon: "🎧", title: "Listening",         description: "Hear a word, click the one you heard." },
};

const QUESTIONS_PER_QUIZ = 10;
let quiz = null;          // the quiz you are playing now
let quizSource = "auto";  // "my" = words in your lists, "all" = whole dictionary

function myListWords() {
  return getAllWords().filter((w) => getStatus(w.id) !== "new");
}

function renderQuizMenu() {
  const mine = myListWords();
  const canUseMine = mine.length >= 4;
  if (quizSource === "auto") quizSource = canUseMine ? "my" : "all";
  if (quizSource === "my" && !canUseMine) quizSource = "all";

  app.innerHTML = `
    <section class="page">
      <h1>🎯 Quiz</h1>
      <p class="muted">${QUESTIONS_PER_QUIZ} questions. Just click the right answer.</p>

      <h2 class="section-title">1. Which words?</h2>
      <div class="chip-row quiz-source">
        <button type="button" class="filter-chip ${quizSource === "my" ? "on" : ""}" data-source="my" ${canUseMine ? "" : "disabled"}>
          📌 My words (${mine.length})
        </button>
        <button type="button" class="filter-chip ${quizSource === "all" ? "on" : ""}" data-source="all">
          📖 Whole dictionary
        </button>
      </div>
      ${canUseMine ? "" : `<p class="muted small">Tip: put at least 4 words in your lists to make a quiz from your own words.</p>`}

      <h2 class="section-title">2. Choose a quiz</h2>
      <div class="quiz-types">
        ${Object.entries(QUIZ_TYPES).map(([type, info]) => `
          <button type="button" class="card quiz-type" data-type="${type}" ${type === "listen" && !canSpeak ? "disabled" : ""}>
            <span class="quiz-icon">${info.icon}</span>
            <strong>${info.title}</strong>
            <span class="muted small">${info.description}</span>
          </button>`).join("")}
      </div>
    </section>`;

  $$("[data-source]").forEach((btn) => {
    btn.addEventListener("click", () => {
      quizSource = btn.dataset.source;
      renderQuizMenu();
    });
  });
  $$("[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => startQuiz(btn.dataset.type));
  });
}

// Finds a sentence that contains the word and hides the word with "_____".
function findSentenceWithWord(w) {
  const word = escapeRegExp(w.word);
  const exact = new RegExp(`\\b${word}\\b`, "i");  // "decide"
  const loose = new RegExp(`\\b${word}\\w*`, "i"); // "decided", "decides" ...

  const exactMatches = w.sentences.filter((s) => exact.test(s.en));
  const looseMatches = w.sentences.filter((s) => loose.test(s.en));
  const pattern = exactMatches.length ? exact : loose;
  const sentence = exactMatches.length ? pickRandom(exactMatches) : pickRandom(looseMatches);

  if (!sentence) return null;
  return { sentence: sentence, blanked: sentence.en.replace(pattern, "_____") };
}

// Is "other" a bad wrong answer for "w"? (same meaning → it would be confusing)
function tooSimilar(w, other) {
  if (other.id === w.id) return true;
  if (w.synonyms.some((s) => s.toLowerCase() === other.word.toLowerCase())) return true;
  if (other.synonyms.some((s) => s.toLowerCase() === w.word.toLowerCase())) return true;
  const parts = (text) => text.split("،").map((x) => x.trim()).filter(Boolean);
  const mine = parts(w.urduMeaning);
  return parts(other.urduMeaning).some((x) => mine.includes(x));
}

// 1 correct answer + 3 wrong answers (same part of speech first), mixed up.
function makeOptions(w, getValue) {
  const others = getAllWords().filter((o) => !tooSimilar(w, o) && getValue(o));
  const samePos = shuffle(others.filter((o) => o.partOfSpeech === w.partOfSpeech));
  const rest = shuffle(others.filter((o) => o.partOfSpeech !== w.partOfSpeech));
  const wrong = [];
  for (const o of samePos.concat(rest)) {
    const value = getValue(o);
    if (value !== getValue(w) && !wrong.includes(value)) wrong.push(value);
    if (wrong.length === 3) break;
  }
  return shuffle([getValue(w), ...wrong]);
}

function makeQuestion(type, w) {
  const question = {
    wordId: w.id,
    word: w.word,
    urdu: w.urduMeaning,
    prompt: w.word,    // what we show
    answer: w.word,    // the right answer
    options: makeOptions(w, (x) => x.word),
    sentence: w.sentences.length ? pickRandom(w.sentences) : null,
  };

  if (type === "en-ur") {
    question.answer = w.urduMeaning;
    question.options = makeOptions(w, (x) => x.urduMeaning);
  } else if (type === "ur-en") {
    question.prompt = w.urduMeaning;
  } else if (type === "blank") {
    const found = findSentenceWithWord(w);
    question.prompt = found.blanked;
    question.sentence = found.sentence;
  }
  return question;
}

function startQuiz(type) {
  let pool = quizSource === "my" ? myListWords() : getAllWords();
  pool = pool.filter((w) => w.urduMeaning);
  if (type === "blank") pool = pool.filter((w) => findSentenceWithWord(w));

  if (pool.length === 0) {
    showToast("No words for this quiz yet. Try “Whole dictionary”.");
    return;
  }

  const chosen = shuffle(pool).slice(0, QUESTIONS_PER_QUIZ);
  quiz = {
    type: type,
    questions: chosen.map((w) => makeQuestion(type, w)),
    index: 0,        // which question we are on
    score: 0,
    wrongIds: [],
    answered: false,
  };
  renderQuestion();
}

function renderQuestion() {
  const q = quiz.questions[quiz.index];
  const total = quiz.questions.length;
  const info = QUIZ_TYPES[quiz.type];
  quiz.answered = false;

  // 1) The question part — different for each quiz type
  let promptHTML = "";
  if (quiz.type === "en-ur") {
    promptHTML = `
      <p class="q-label">What is the Urdu meaning of this word?</p>
      <div class="q-prompt">
        <h2 class="q-word">${escapeHTML(q.prompt)}</h2>
        <button class="speak-btn" data-say="${escapeHTML(q.prompt)}" aria-label="Listen to the word">🔊</button>
      </div>`;
  } else if (quiz.type === "ur-en") {
    promptHTML = `
      <p class="q-label">Which English word has this meaning?</p>
      <p class="urdu q-urdu" lang="ur" dir="rtl">${escapeHTML(q.prompt)}</p>`;
  } else if (quiz.type === "blank") {
    promptHTML = `
      <p class="q-label">Click the missing word:</p>
      <p class="q-sentence">${escapeHTML(q.prompt).replace("_____", '<span class="blank">_____</span>')}</p>`;
  } else {
    promptHTML = `
      <p class="q-label">Listen, then click the word you heard:</p>
      <div class="listen-buttons">
        <button class="btn btn-primary" data-say="${escapeHTML(q.answer)}">🔊 Play again</button>
        <button class="btn btn-ghost" data-say="${escapeHTML(q.answer)}" data-slow="true">🐢 Slowly</button>
      </div>`;
  }

  // 2) The four answer buttons
  const isUrduOptions = quiz.type === "en-ur";

  app.innerHTML = `
    <section class="page">
      <div class="page-header">
        <h1>${info.icon} ${info.title}</h1>
        <span class="score-pill" id="score-pill">Score: ${quiz.score}</span>
      </div>
      <p class="muted small">Question ${quiz.index + 1} of ${total}</p>
      <div class="progress"><div class="progress-fill" style="width: ${(quiz.index / total) * 100}%"></div></div>

      <div class="card question-card">
        ${promptHTML}
        <div class="options">
          ${q.options.map((option, i) => `
            <button type="button" class="option ${isUrduOptions ? "urdu" : ""}" data-index="${i}"
                    ${isUrduOptions ? 'lang="ur" dir="rtl"' : ""}>${escapeHTML(option)}</button>`).join("")}
        </div>
        <div id="feedback"></div>
      </div>

      <button type="button" class="btn btn-primary btn-wide hidden" id="next-btn">
        ${quiz.index + 1 < total ? "Next question →" : "See my score 🏁"}
      </button>
    </section>`;

  // 3) Connect the buttons
  $$(".option").forEach((btn) => {
    btn.addEventListener("click", () => answerQuestion(q.options[btn.dataset.index], btn));
  });
  $("#next-btn").addEventListener("click", nextQuestion);

  if (quiz.type === "listen") setTimeout(() => speak(q.answer), 400); // play the word automatically
}

function answerQuestion(chosen, chosenButton) {
  if (quiz.answered) return; // ignore a second click
  quiz.answered = true;

  const q = quiz.questions[quiz.index];
  const isCorrect = normalise(chosen) === normalise(q.answer);
  if (isCorrect) quiz.score += 1;
  else quiz.wrongIds.push(q.wordId);

  // Colour the options: the right one green, your wrong choice red.
  $$(".option").forEach((btn) => {
    btn.disabled = true;
    if (q.options[btn.dataset.index] === q.answer) btn.classList.add("correct");
  });
  if (!isCorrect) chosenButton.classList.add("wrong");

  // Show the right answer and an example sentence.
  const s = q.sentence;
  $("#feedback").innerHTML = `
    <div class="feedback ${isCorrect ? "is-correct" : "is-wrong"}">
      <p class="feedback-title">${isCorrect ? "✓ Correct! Well done." : "✗ Not quite."}</p>
      <p>Answer: <strong>${escapeHTML(q.word)}</strong> =
        <span class="urdu" lang="ur" dir="rtl">${escapeHTML(q.urdu)}</span></p>
      ${s ? `
        <div class="sentence-en">
          <button type="button" class="speak-btn small" data-say="${escapeHTML(s.en)}" aria-label="Listen to the sentence">🔊</button>
          <p>${highlightWord(s.en, q.word)}</p>
        </div>
        <p class="urdu" lang="ur" dir="rtl">${escapeHTML(s.ur)}</p>` : ""}
    </div>`;

  $("#score-pill").textContent = `Score: ${quiz.score}`;
  const nextButton = $("#next-btn");
  nextButton.classList.remove("hidden");
  nextButton.focus();
}

function nextQuestion() {
  quiz.index += 1;
  window.scrollTo(0, 0);
  if (quiz.index < quiz.questions.length) renderQuestion();
  else renderQuizResult();
}

function renderQuizResult() {
  recordStudy(); // a quiz counts for your streak
  const total = quiz.questions.length;
  const percent = Math.round((quiz.score / total) * 100);
  const message = percent >= 80 ? "Excellent! 🌟" : percent >= 50 ? "Good job! 👍" : "Keep practising! 💪";
  const wrongWords = quiz.wrongIds.map((id) => getWordById(id)).filter(Boolean);

  app.innerHTML = `
    <section class="page">
      <div class="card message-card">
        <p class="eyebrow">Quiz finished</p>
        <div class="result-score">${quiz.score} / ${total}</div>
        <p class="result-message">${message}</p>
      </div>

      ${wrongWords.length ? `
        <h2 class="section-title">Words you got wrong (${wrongWords.length})</h2>
        <div class="dict-list">${wrongWords.map((w) => wordRowHTML(w)).join("")}</div>`
        : `<p class="center">🎉 You got every answer right!</p>`}

      <div class="button-row center" style="margin-top: 20px">
        ${wrongWords.length ? `<button type="button" class="btn btn-primary" id="practice-btn">📌 Memorize &amp; practise these words</button>` : ""}
        <button type="button" class="btn btn-ghost" id="again-btn">🔁 Another quiz</button>
        <a href="#/home" class="btn btn-ghost">🏠 Home</a>
      </div>
    </section>`;

  const practiceButton = $("#practice-btn");
  if (practiceButton) {
    practiceButton.addEventListener("click", () => {
      wrongWords.forEach((w) => setMemorize(w.id)); // wrong words go to your Memorize list
      practiceOnlyIds = wrongWords.map((w) => w.id);
      location.hash = "#/practice";
    });
  }
  $("#again-btn").addEventListener("click", renderQuizMenu);
}


/* ---------- 8i. ADD / EDIT MY OWN WORD ---------- */

function sentenceRowHTML(index, s) {
  return `
    <div class="sentence-row">
      <div class="sentence-row-top">
        <span class="sentence-number">Sentence ${index + 1}</span>
        ${index >= 3 ? '<button type="button" class="remove-sentence">✕ Remove</button>' : ""}
      </div>
      <input type="text" class="s-en" aria-label="English sentence"
             placeholder="English sentence, e.g. Water is abundant here." value="${escapeHTML(s.en)}">
      <input type="text" class="s-ur urdu-input" dir="rtl" lang="ur" aria-label="Urdu translation"
             placeholder="اردو ترجمہ" value="${escapeHTML(s.ur)}">
      <p class="field-error"></p>
    </div>`;
}

// After removing a row, fix the numbers: Sentence 1, 2, 3 ...
function renumberSentenceRows() {
  $$(".sentence-row .sentence-number").forEach((label, i) => {
    label.textContent = `Sentence ${i + 1}`;
  });
}

// Shows a red message under a box.
function showFieldError(input, message) {
  input.classList.add("invalid");
  input.setAttribute("aria-invalid", "true");
  input.closest(".field, .sentence-row").querySelector(".field-error").textContent = message;
}

function clearFieldError(input) {
  input.classList.remove("invalid");
  input.removeAttribute("aria-invalid");
  const box = input.closest(".field, .sentence-row");
  if (box) box.querySelector(".field-error").textContent = "";
}

// id = null → add a new word.  id = a number → edit that word.
function renderWordForm(id) {
  const editing = id ? getWordById(id) : null;
  if (id && !editing) {
    renderNotFound();
    return;
  }

  // Start values: the word we are editing, or empty boxes.
  const w = editing || {
    word: "", partOfSpeech: "noun", pronunciation: "", urduMeaning: "",
    simpleEnglishMeaning: "", synonyms: [], antonyms: [], level: "easy",
    category: "", sentences: [],
  };

  // Always show at least 3 sentence boxes.
  const sentences = w.sentences.map((s) => ({ ...s }));
  while (sentences.length < 3) sentences.push({ en: "", ur: "" });

  const partsOfSpeech = PARTS_OF_SPEECH.includes(w.partOfSpeech) || !w.partOfSpeech
    ? PARTS_OF_SPEECH
    : [...PARTS_OF_SPEECH, w.partOfSpeech];
  const categories = [...new Set([...DEFAULT_CATEGORIES, ...getCategories()])].sort();

  app.innerHTML = `
    <section class="page">
      <h1>${editing ? "✏️ Edit word" : "➕ Add my own word"}</h1>
      <p class="muted">Boxes with <span class="required">*</span> are required. Everything else is optional.</p>

      <form class="card" id="word-form" novalidate>
        <div class="form-grid">
          <div class="field">
            <label for="f-word">English word <span class="required">*</span></label>
            <input type="text" id="f-word" value="${escapeHTML(w.word)}" placeholder="e.g. abundant"
                   autocomplete="off" autocapitalize="off">
            <p class="field-error"></p>
          </div>

          <div class="field">
            <label for="f-urdu">Urdu meaning <span class="required">*</span></label>
            <input type="text" id="f-urdu" class="urdu-input" dir="rtl" lang="ur"
                   value="${escapeHTML(w.urduMeaning)}" placeholder="مثلاً: بہت زیادہ">
            <p class="field-error"></p>
          </div>

          <div class="field">
            <label for="f-pos">Part of speech</label>
            <select id="f-pos">${selectOptions(partsOfSpeech.map((p) => [p, p]), w.partOfSpeech)}</select>
          </div>

          <div class="field">
            <label for="f-pron">Pronunciation</label>
            <input type="text" id="f-pron" value="${escapeHTML(w.pronunciation)}" placeholder="e.g. uh-BUN-duhnt">
          </div>

          <div class="field full">
            <label for="f-meaning">Simple English meaning</label>
            <input type="text" id="f-meaning" value="${escapeHTML(w.simpleEnglishMeaning)}"
                   placeholder="e.g. more than enough; a lot">
          </div>

          <div class="field">
            <label for="f-level">Level</label>
            <select id="f-level">
              ${selectOptions([["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], w.level)}
            </select>
          </div>

          <div class="field">
            <label for="f-category">Category</label>
            <input type="text" id="f-category" list="category-list" value="${escapeHTML(w.category)}"
                   placeholder="e.g. Daily Life">
            <datalist id="category-list">
              ${categories.map((c) => `<option value="${escapeHTML(c)}"></option>`).join("")}
            </datalist>
          </div>

          <div class="field">
            <label for="f-syn">Synonyms <span class="muted small">(separate with commas)</span></label>
            <input type="text" id="f-syn" value="${escapeHTML(w.synonyms.join(", "))}" placeholder="plentiful, many">
          </div>

          <div class="field">
            <label for="f-ant">Antonyms <span class="muted small">(separate with commas)</span></label>
            <input type="text" id="f-ant" value="${escapeHTML(w.antonyms.join(", "))}" placeholder="scarce, rare">
          </div>
        </div>

        <h2 class="section-title">Example sentences</h2>
        <p class="muted small">Write short, simple sentences from daily life, with the Urdu translation under each one.
          Try to add at least 3.</p>
        <div id="sentence-rows">
          ${sentences.map((s, i) => sentenceRowHTML(i, s)).join("")}
        </div>
        <button type="button" class="btn btn-ghost" id="add-sentence-btn">➕ Add another sentence</button>

        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary">${editing ? "💾 Save changes" : "💾 Save word"}</button>
        </div>
      </form>
    </section>`;

  const form = $("#word-form");
  const rows = $("#sentence-rows");

  // "Add another sentence" adds a new empty row at the end.
  $("#add-sentence-btn").addEventListener("click", () => {
    rows.insertAdjacentHTML("beforeend", sentenceRowHTML(rows.children.length, { en: "", ur: "" }));
    rows.lastElementChild.querySelector(".s-en").focus();
  });

  // "Remove" buttons (we listen on the parent, so it works for new rows too).
  rows.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".remove-sentence");
    if (!removeButton) return;
    removeButton.closest(".sentence-row").remove();
    renumberSentenceRows();
  });

  // When you start typing in a red box, remove its error message.
  form.addEventListener("input", (event) => {
    if (event.target.classList.contains("invalid")) clearFieldError(event.target);
  });

  $("#cancel-btn").addEventListener("click", () => {
    location.hash = editing ? `#/word/${editing.id}` : "#/dictionary";
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault(); // don't reload the page
    handleWordFormSubmit(editing);
  });
}

function handleWordFormSubmit(editing) {
  $$("#word-form .invalid").forEach(clearFieldError);

  const wordInput = $("#f-word");
  const urduInput = $("#f-urdu");
  const word = wordInput.value.trim().replace(/\s+/g, " ");
  const urduMeaning = urduInput.value.trim();
  let firstProblem = null; // the first box with a mistake

  function problem(input, message) {
    showFieldError(input, message);
    if (!firstProblem) firstProblem = input;
  }

  // Rule 1: the English word is required and uses English letters.
  if (!word) {
    problem(wordInput, "Please type the English word.");
  } else if (!isEnglishText(word)) {
    problem(wordInput, "Please use English letters only (a–z).");
  } else {
    const same = findWord(word);
    if (same && (!editing || same.id !== editing.id)) problem(wordInput, `"${word}" is already in your dictionary.`);
  }

  // Rule 2: the Urdu meaning is required.
  if (!urduMeaning) problem(urduInput, "Please type the Urdu meaning.");

  // Rule 3: a sentence needs BOTH English and Urdu (or leave both empty).
  const sentences = [];
  $$(".sentence-row").forEach((row, i) => {
    const enInput = row.querySelector(".s-en");
    const urInput = row.querySelector(".s-ur");
    const en = enInput.value.trim();
    const ur = urInput.value.trim();
    if (en && !ur) problem(urInput, `Please add the Urdu translation for sentence ${i + 1}.`);
    else if (!en && ur) problem(enInput, `Please add the English sentence for sentence ${i + 1}.`);
    else if (en && ur) sentences.push({ en: en, ur: ur });
  });

  if (firstProblem) {
    firstProblem.focus();
    showToast("Please fix the boxes marked in red.");
    return;
  }

  const newWord = {
    id: editing ? editing.id : nextMyWordId(),
    word: word,
    partOfSpeech: $("#f-pos").value,
    pronunciation: $("#f-pron").value.trim(),
    urduMeaning: urduMeaning,
    simpleEnglishMeaning: $("#f-meaning").value.trim(),
    synonyms: splitList($("#f-syn").value),
    antonyms: splitList($("#f-ant").value),
    level: $("#f-level").value,
    category: $("#f-category").value.trim() || "My Words",
    sentences: sentences,
  };

  saveWord(newWord);
  if (!editing) setMemorize(newWord.id); // a new word goes straight to your Memorize list
  showToast(editing ? "✓ Changes saved!" : "✓ Saved and added to your 📌 Memorize list!");
  location.hash = `#/word/${newWord.id}`;
}


/* ---------- 8j. SETTINGS ---------- */

// ---- Light / dark theme ----
// data.settings.theme is "light", "dark" or "auto".
// "auto" follows the phone/computer setting (and changes when it changes).
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
let themeTimer = null;

function currentTheme() {
  const chosen = data.settings.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return systemDark.matches ? "dark" : "light";
}

// animate = true → colours fade smoothly instead of jumping.
function applyTheme(animate = false) {
  const theme = currentTheme();
  const root = document.documentElement;

  if (animate && root.dataset.theme !== theme) {
    // The class "theme-changing" turns on a short colour fade (see style.css).
    root.classList.add("theme-changing");
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => root.classList.remove("theme-changing"), 450);
  }

  root.dataset.theme = theme; // <html data-theme="dark">
  $('meta[name="theme-color"]').setAttribute("content", theme === "dark" ? "#1a1f29" : "#ffffff");

  // The quick button in the top bar shows what you will switch TO.
  const button = $("#theme-btn");
  button.textContent = theme === "dark" ? "☀️" : "🌙";
  button.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
}

// Change the theme, save it, and update the Settings buttons if they are on screen.
function setTheme(choice) {
  data.settings.theme = choice;
  saveData();
  applyTheme(true);
  $$("[data-theme-choice]").forEach((btn) => {
    const on = btn.dataset.themeChoice === choice;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on);
  });
}

// Downloads all your data as a .json file.
function exportData() {
  const text = JSON.stringify(data, null, 2);
  const file = new Blob([text], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = `lafz-backup-${today()}.json`;
  document.body.appendChild(link);
  link.click(); // pretend to click the link → the browser downloads the file
  link.remove();
  URL.revokeObjectURL(link.href);
  showToast("⬇️ Backup file downloaded");
}

// Reads a .json backup file and (after you agree) replaces your data.
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let imported = null;
    try {
      imported = JSON.parse(reader.result);
    } catch {
      imported = null;
    }
    if (!imported || typeof imported !== "object" || !imported.settings || !imported.progress) {
      showToast("❌ This file is not a Lafz backup.");
      return;
    }
    showConfirm({
      title: "Import this backup?",
      message: "Your current lists and words in this browser will be replaced by the backup file.",
      okText: "Yes, import",
      onConfirm: () => {
        data = mergeWithDefaults(imported);
        wordsChanged();
        saveData();
        applyTheme();
        showToast("✓ Backup imported!");
        renderSettings();
        refreshCounts();
      },
    });
  };
  reader.readAsText(file);
}

function renderSettings() {
  const s = data.settings;
  const goalChoices = [3, 5, 10, 15, 20];
  if (!goalChoices.includes(s.dailyGoal)) goalChoices.push(s.dailyGoal);

  app.innerHTML = `
    <section class="page">
      <h1>⚙️ Settings</h1>

      <div class="card settings-group">
        <h2 class="section-title">🎨 Appearance</h2>
        <p class="muted small">Dark mode is easier on the eyes at night. "Auto" follows your phone or computer.</p>
        <div class="segmented" role="group" aria-label="Theme">
          ${[["light", "☀️ Light"], ["dark", "🌙 Dark"], ["auto", "🖥️ Auto"]].map(([value, label]) => `
            <button type="button" class="segment ${s.theme === value ? "on" : ""}" data-theme-choice="${value}"
                    aria-pressed="${s.theme === value}">${label}</button>`).join("")}
        </div>
      </div>

      <div class="card settings-group">
        <h2 class="section-title">🏁 Daily goal</h2>
        <div class="setting-row">
          <label class="setting-text" for="goal-select">
            <strong>Words to learn per day</strong>
            <span class="muted small">Counted when you press ✅ Got it on a new word</span>
          </label>
          <select id="goal-select">
            ${selectOptions(goalChoices.sort((a, b) => a - b).map((n) => [n, `${n} words`]), s.dailyGoal)}
          </select>
        </div>
      </div>

      <div class="card settings-group">
        <h2 class="section-title">➕ My own words</h2>
        <p class="muted small">Can't find a word? Search it online from the Dictionary, or add it yourself with your own sentences.</p>
        <a href="#/add" class="btn btn-ghost">➕ Add my own word</a>
      </div>

      <div class="card settings-group">
        <h2 class="section-title">💾 Backup</h2>
        <p class="muted small">Your lists are saved only in this browser. Download a backup file to keep them safe,
          or to move them to another phone or computer.</p>
        <div class="button-row">
          <button type="button" class="btn btn-primary" id="export-btn">⬇️ Export my data</button>
          <button type="button" class="btn btn-ghost" id="import-btn">⬆️ Import a backup</button>
          <input type="file" id="import-file" accept=".json,application/json" hidden>
        </div>
      </div>

      <div class="card settings-group danger-zone">
        <h2 class="section-title">⚠️ Reset</h2>
        <p class="muted small">Empty your 📌 Memorize and ✅ Done lists and start again. Your own words are kept.</p>
        <div class="button-row">
          <button type="button" class="btn btn-danger" id="reset-btn">🗑️ Reset progress</button>
          ${data.deletedIds.length ? `
            <button type="button" class="btn btn-ghost" id="restore-btn">
              ♻️ Bring back ${data.deletedIds.length} deleted ${plural(data.deletedIds.length, "word")}
            </button>` : ""}
        </div>
      </div>

      <p class="muted small center">
        Lafz · ${getAllWords().length.toLocaleString()} words · made with HTML, CSS and JavaScript<br>
        Online search uses Wiktionary and the MyMemory translator (needs internet).
      </p>
    </section>`;

  $$("[data-theme-choice]").forEach((btn) => {
    btn.addEventListener("click", () => setTheme(btn.dataset.themeChoice));
  });

  $("#goal-select").addEventListener("change", (event) => {
    data.settings.dailyGoal = Number(event.target.value);
    saveData();
    showToast(`🏁 Daily goal: ${data.settings.dailyGoal} words`);
  });

  $("#export-btn").addEventListener("click", exportData);

  // The real file picker is hidden; our nice button "clicks" it for us.
  $("#import-btn").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) importData(file);
    event.target.value = ""; // so you can choose the same file again later
  });

  $("#reset-btn").addEventListener("click", () => {
    showConfirm({
      title: "Are you sure?",
      message: "This empties your Memorize and Done lists, review dates and streak. Your own words are kept. This cannot be undone.",
      okText: "Yes, reset",
      danger: true,
      onConfirm: () => {
        data.progress = {};
        data.stats = defaultData().stats;
        saveData();
        showToast("Progress has been reset");
        renderSettings();
        refreshCounts();
      },
    });
  });

  const restoreButton = $("#restore-btn");
  if (restoreButton) {
    restoreButton.addEventListener("click", () => {
      data.deletedIds = [];
      wordsChanged();
      saveData();
      showToast("♻️ Deleted words are back");
      renderSettings();
    });
  }
}


/* ============================================================
   9. START THE APP
   ============================================================ */

// One click listener for the WHOLE page area (called "event delegation").
// It works for buttons on every page, even ones drawn later.
app.addEventListener("click", (event) => {
  // 🔊 any button with data-say="..." speaks its text
  const speakButton = event.target.closest("[data-say]");
  if (speakButton) {
    speak(speakButton.dataset.say, speakButton.dataset.slow === "true");
    return;
  }

  // 📌 Memorize (click again to remove)
  const memoButton = event.target.closest("[data-memo]");
  if (memoButton) {
    const id = Number(memoButton.dataset.memo);
    if (getStatus(id) === "memorize") {
      removeFromLists(id);
      showToast("Removed from your Memorize list");
    } else {
      setMemorize(id);
      showToast("📌 Added to your Memorize list");
    }
    refreshWordStatus(id);
    return;
  }

  // ✅ Got it (click again to remove)
  const doneButton = event.target.closest("[data-done]");
  if (doneButton) {
    const id = Number(doneButton.dataset.done);
    if (getStatus(id) === "done") {
      removeFromLists(id);
      showToast("Removed from your Done list");
    } else {
      markGotIt(id);
      showToast("✅ Great! Moved to your Done list");
    }
    refreshWordStatus(id);
    return;
  }

  // Click a dictionary row → open or close it
  const rowButton = event.target.closest("[data-toggle]");
  if (rowButton) {
    toggleRow(Number(rowButton.dataset.toggle));
    return;
  }

  // In "Hide Urdu" mode, tapping a blurred Urdu sentence shows it.
  const hiddenUrdu = event.target.closest(".urdu-hidden .sentence-ur");
  if (hiddenUrdu) hiddenUrdu.classList.toggle("revealed");
});

// Keyboard shortcuts.
document.addEventListener("keydown", (event) => {
  // Escape closes the popup.
  if (!modal.classList.contains("hidden")) {
    if (event.key === "Escape") closeModal();
    return;
  }

  // Don't steal keys while you are typing in a box, or using Ctrl/Alt shortcuts.
  if (event.target.closest("input, textarea, select") || event.ctrlKey || event.altKey || event.metaKey) return;

  // Word page: ← → = previous / next word, M = 📌 Memorize, G = ✅ Got it
  if ($(".word-bar")) {
    const keyActions = {
      ArrowLeft: ".word-bar .bar-nav:first-child",
      ArrowRight: ".word-bar .bar-nav:last-child",
      m: ".word-bar [data-memo]",
      g: ".word-bar [data-done]",
    };
    const target = $(keyActions[event.key.length === 1 ? event.key.toLowerCase() : event.key] || "#none");
    if (target) {
      event.preventDefault();
      target.click();
    }
    return;
  }

  // Flashcards: Space/Enter = flip, 1 = 😕, 2 = ✅
  if (!$("#flashcard")) return; // not on the flashcard page
  if ((event.key === " " || event.key === "Enter") && !event.target.closest("button, a")) {
    event.preventDefault(); // stop Space from scrolling the page
    flipCard();
  }
  if (event.key === "1") answerCard(false);
  if (event.key === "2") answerCard(true);
});

// Clicking a menu link for the page you are ALREADY on does not change
// the address, so "hashchange" won't fire. We redraw the page ourselves
// (useful to restart a quiz or a flashcard session).
document.addEventListener("click", (event) => {
  const link = event.target.closest('a[href^="#/"]');
  if (link && link.getAttribute("href") === location.hash) router();
});

window.addEventListener("hashchange", router);

// The word bar sticks just under the top bar, so we measure how tall
// the top bar is (it changes on phones and when the fonts load).
function measureTopBar() {
  document.documentElement.style.setProperty("--topbar-height", $(".topbar").offsetHeight + "px");
}
window.addEventListener("resize", measureTopBar);
document.fonts.ready.then(measureTopBar);
measureTopBar();

// 🌙 / ☀️ button in the top bar: switch between light and dark.
$("#theme-btn").addEventListener("click", () => {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
});

// In "auto" mode, follow the phone/computer when it changes (e.g. at sunset).
systemDark.addEventListener("change", () => {
  if (data.settings.theme === "auto") applyTheme(true);
});

applyTheme(); // light or dark
router();     // draw the first page
